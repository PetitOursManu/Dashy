import mysql from 'mysql2/promise';
import {
  DriverError,
  QUERY_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  type CellValue,
  type CollectionInfo,
  type ConnectionConfig,
  type DatabaseDriver,
  type FieldDef,
  type FieldType,
  type ListRowsOpts,
  type ListRowsResult,
  type Row,
  type SchemaInfo,
  type TestResult,
} from './types.js';

const SYSTEM_SCHEMAS = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);

const NUMERIC_TYPES = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
  'decimal',
  'dec',
  'numeric',
  'float',
  'double',
  'real',
  'bit',
]);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp', 'time', 'year']);

function mapType(dataType: string): FieldType {
  const t = dataType.toLowerCase();
  if (t === 'json') return 'json';
  if (NUMERIC_TYPES.has(t)) return 'number';
  if (DATE_TYPES.has(t)) return 'date';
  return 'string';
}

/** Backtick-quote an identifier via mysql2's own escaper (no qualified split). */
function quoteIdent(name: string): string {
  return mysql.escapeId(name, true);
}

function normalize(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return value as Record<string, unknown>;
  return value as CellValue;
}

async function withConn<T>(
  config: ConnectionConfig,
  fn: (conn: mysql.Connection) => Promise<T>,
): Promise<T> {
  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database || undefined,
      ssl: config.ssl === 'require' ? { rejectUnauthorized: false } : undefined,
      connectTimeout: TEST_TIMEOUT_MS,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: false,
    });
  } catch (err) {
    throw new DriverError(err instanceof Error ? err.message : 'Connection failed');
  }
  try {
    return await fn(conn);
  } catch (err) {
    throw new DriverError(err instanceof Error ? err.message : 'Query failed');
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/** Run one SELECT with a portable client-side timeout, returning the rows. */
async function query<T extends mysql.RowDataPacket>(
  conn: mysql.Connection,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const [rows] = await conn.query<T[]>({ sql, values, timeout: QUERY_TIMEOUT_MS });
  return rows;
}

async function columnDefs(
  conn: mysql.Connection,
  schema: string,
  table: string,
): Promise<FieldDef[]> {
  const rows = await query<mysql.RowDataPacket>(
    conn,
    `SELECT column_name, data_type, is_nullable, column_key
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position`,
    [schema, table],
  );
  return rows.map((r) => ({
    name: String(r.column_name ?? r.COLUMN_NAME),
    type: mapType(String(r.data_type ?? r.DATA_TYPE)),
    nullable: String(r.is_nullable ?? r.IS_NULLABLE) === 'YES',
    primaryKey: String(r.column_key ?? r.COLUMN_KEY) === 'PRI',
    rawType: String(r.data_type ?? r.DATA_TYPE),
  }));
}

export const mysqlDriver: DatabaseDriver = {
  engine: 'mysql',

  async testConnection(config): Promise<TestResult> {
    try {
      await withConn(config, async (conn) => {
        await conn.query('SELECT 1');
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  },

  async listSchemas(config): Promise<SchemaInfo[]> {
    return withConn(config, async (conn) => {
      const rows = await query<mysql.RowDataPacket>(
        conn,
        `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`,
      );
      return rows
        .map((r) => String(r.schema_name ?? r.SCHEMA_NAME))
        .filter((name) => !SYSTEM_SCHEMAS.has(name.toLowerCase()))
        .map((name) => ({ name }));
    });
  },

  async listCollections(config, schema): Promise<CollectionInfo[]> {
    return withConn(config, async (conn) => {
      const rows = await query<mysql.RowDataPacket>(
        conn,
        `SELECT table_name, table_type, table_rows
           FROM information_schema.tables
          WHERE table_schema = ?
          ORDER BY table_name`,
        [schema],
      );
      return rows.map((r) => {
        const type = String(r.table_type ?? r.TABLE_TYPE);
        const estimate = r.table_rows ?? r.TABLE_ROWS;
        return {
          name: String(r.table_name ?? r.TABLE_NAME),
          rowCount: estimate === null || estimate === undefined ? null : Number(estimate),
          kind: type === 'VIEW' ? ('view' as const) : ('table' as const),
        };
      });
    });
  },

  async getCollectionSchema(config, schema, collection): Promise<FieldDef[]> {
    return withConn(config, (conn) => columnDefs(conn, schema, collection));
  },

  async listRows(config, schema, collection, opts: ListRowsOpts): Promise<ListRowsResult> {
    return withConn(config, async (conn) => {
      const fields = await columnDefs(conn, schema, collection);
      const fieldNames = new Set(fields.map((f) => f.name));
      const primaryKey = fields.filter((f) => f.primaryKey).map((f) => f.name);
      const rel = `${quoteIdent(schema)}.${quoteIdent(collection)}`;

      const params: unknown[] = [];
      let where = '';
      if (opts.filter && fieldNames.has(opts.filter.field)) {
        const col = quoteIdent(opts.filter.field);
        if (opts.filter.op === 'contains') {
          where = `WHERE ${col} LIKE ?`;
          params.push(`%${opts.filter.value}%`);
        } else {
          where = `WHERE CAST(${col} AS CHAR) = ?`;
          params.push(opts.filter.value);
        }
      }

      const countRows = await query<mysql.RowDataPacket>(
        conn,
        `SELECT count(*) AS total FROM ${rel} ${where}`,
        params,
      );
      const total = Number(countRows[0]?.total ?? countRows[0]?.TOTAL ?? 0);

      let orderBy = '';
      if (opts.sort && fieldNames.has(opts.sort.field)) {
        const dir = opts.sort.dir === 'desc' ? 'DESC' : 'ASC';
        orderBy = `ORDER BY ${quoteIdent(opts.sort.field)} ${dir}`;
      }

      const limit = opts.pageSize;
      const offset = (opts.page - 1) * opts.pageSize;
      const dataRows = await query<mysql.RowDataPacket>(
        conn,
        `SELECT * FROM ${rel} ${where} ${orderBy} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      const rows: Row[] = dataRows.map((raw) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(raw)) out[k] = normalize(v);
        return out;
      });

      return { rows, total, fields, primaryKey };
    });
  },
};
