import pg from 'pg';
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

const { Client } = pg;

/** Postgres numeric/decimal/bigint are returned as strings by node-postgres to
 * avoid precision loss — keep them as strings and let the UI render them. */
const NUMERIC_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'decimal',
  'numeric',
  'real',
  'double precision',
  'money',
]);
const BOOLEAN_TYPES = new Set(['boolean']);
const JSON_TYPES = new Set(['json', 'jsonb']);
const DATE_TYPES = new Set([
  'date',
  'time',
  'time with time zone',
  'time without time zone',
  'timestamp',
  'timestamp with time zone',
  'timestamp without time zone',
]);

function mapType(dataType: string): FieldType {
  const t = dataType.toLowerCase();
  if (NUMERIC_TYPES.has(t)) return 'number';
  if (BOOLEAN_TYPES.has(t)) return 'boolean';
  if (JSON_TYPES.has(t)) return 'json';
  if (DATE_TYPES.has(t)) return 'date';
  if (t === 'ARRAY' || t.endsWith('[]')) return 'json';
  return 'string';
}

/** Double-quote an identifier, escaping embedded quotes — makes SQL injection
 * through table/column names impossible regardless of their content. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Convert a driver value into something JSON-safe for the API response. */
function normalize(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return value as Record<string, unknown>;
  return value as CellValue;
}

function clientConfig(config: ConnectionConfig, timeoutMs: number): pg.ClientConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl === 'require' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: TEST_TIMEOUT_MS,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
    application_name: 'dashy-db-explorer',
  };
}

/** Connect, run `fn`, and always disconnect. */
async function withClient<T>(
  config: ConnectionConfig,
  timeoutMs: number,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new Client(clientConfig(config, timeoutMs));
  try {
    await client.connect();
  } catch (err) {
    throw new DriverError(err instanceof Error ? err.message : 'Connection failed');
  }
  try {
    return await fn(client);
  } catch (err) {
    throw new DriverError(err instanceof Error ? err.message : 'Query failed');
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function primaryKeyColumns(
  client: pg.Client,
  schema: string,
  table: string,
): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position`,
    [schema, table],
  );
  return rows.map((r) => r.column_name);
}

async function columnDefs(
  client: pg.Client,
  schema: string,
  table: string,
): Promise<FieldDef[]> {
  const { rows } = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, table],
  );
  const pk = new Set(await primaryKeyColumns(client, schema, table));
  return rows.map((r) => ({
    name: r.column_name,
    type: mapType(r.data_type),
    nullable: r.is_nullable === 'YES',
    primaryKey: pk.has(r.column_name),
    rawType: r.data_type,
  }));
}

export const postgresDriver: DatabaseDriver = {
  engine: 'postgresql',

  async testConnection(config): Promise<TestResult> {
    try {
      await withClient(config, TEST_TIMEOUT_MS, async (client) => {
        await client.query('SELECT 1');
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  },

  async listSchemas(config): Promise<SchemaInfo[]> {
    return withClient(config, QUERY_TIMEOUT_MS, async (client) => {
      const { rows } = await client.query<{ schema_name: string }>(
        `SELECT schema_name
           FROM information_schema.schemata
          WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
            AND schema_name NOT LIKE 'pg_toast%'
            AND schema_name NOT LIKE 'pg_temp%'
          ORDER BY schema_name`,
      );
      return rows.map((r) => ({ name: r.schema_name }));
    });
  },

  async listCollections(config, schema): Promise<CollectionInfo[]> {
    return withClient(config, QUERY_TIMEOUT_MS, async (client) => {
      const { rows } = await client.query<{
        table_name: string;
        table_type: string;
        estimate: string | null;
      }>(
        `SELECT t.table_name,
                t.table_type,
                c.reltuples::bigint AS estimate
           FROM information_schema.tables t
           LEFT JOIN pg_namespace n ON n.nspname = t.table_schema
           LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
          WHERE t.table_schema = $1
          ORDER BY t.table_name`,
        [schema],
      );
      return rows.map((r) => {
        const est = r.estimate === null ? -1 : Number(r.estimate);
        return {
          name: r.table_name,
          rowCount: est >= 0 ? est : null,
          kind: r.table_type === 'VIEW' ? 'view' : 'table',
        };
      });
    });
  },

  async getCollectionSchema(config, schema, collection): Promise<FieldDef[]> {
    return withClient(config, QUERY_TIMEOUT_MS, (client) =>
      columnDefs(client, schema, collection),
    );
  },

  async listRows(config, schema, collection, opts: ListRowsOpts): Promise<ListRowsResult> {
    return withClient(config, QUERY_TIMEOUT_MS, async (client) => {
      const fields = await columnDefs(client, schema, collection);
      const fieldNames = new Set(fields.map((f) => f.name));
      const primaryKey = fields.filter((f) => f.primaryKey).map((f) => f.name);
      const rel = `${quoteIdent(schema)}.${quoteIdent(collection)}`;

      // WHERE (contains/eq) — only on a real column; value is always a bound param.
      const params: unknown[] = [];
      let where = '';
      if (opts.filter && fieldNames.has(opts.filter.field)) {
        const col = quoteIdent(opts.filter.field);
        if (opts.filter.op === 'contains') {
          params.push(`%${opts.filter.value}%`);
          where = `WHERE ${col}::text ILIKE $${params.length}`;
        } else {
          params.push(opts.filter.value);
          where = `WHERE ${col}::text = $${params.length}`;
        }
      }

      const countRes = await client.query<{ total: string }>(
        `SELECT count(*)::bigint AS total FROM ${rel} ${where}`,
        params,
      );
      const total = Number(countRes.rows[0]?.total ?? 0);

      // ORDER BY — only on a real column, direction is a fixed keyword.
      let orderBy = '';
      if (opts.sort && fieldNames.has(opts.sort.field)) {
        const dir = opts.sort.dir === 'desc' ? 'DESC' : 'ASC';
        orderBy = `ORDER BY ${quoteIdent(opts.sort.field)} ${dir}`;
      }

      const limit = opts.pageSize;
      const offset = (opts.page - 1) * opts.pageSize;
      const dataParams = [...params, limit, offset];
      const dataRes = await client.query(
        `SELECT * FROM ${rel} ${where} ${orderBy} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      );

      const rows: Row[] = dataRes.rows.map((raw: Record<string, unknown>) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(raw)) out[k] = normalize(v);
        return out;
      });

      return { rows, total, fields, primaryKey };
    });
  },
};
