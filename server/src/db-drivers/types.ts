/**
 * Common abstraction over the database engines the DB Explorer can browse.
 *
 * The vocabulary is deliberately generic so it can cover relational
 * (schemas/tables/rows), document (databases/collections/documents) and
 * key-value (indexes/keyspaces/keys) engines behind one interface. Phase 1 is
 * read-only and ships the two relational drivers (Postgres, MySQL/MariaDB); the
 * write half of the interface (insert/update/delete) is added in Phase 2.
 *
 * Engine → generic-concept mapping (kept here as the single source of truth):
 *
 *   generic    | postgresql / mysql | mongodb     | sqlite        | redis
 *   -----------|--------------------|-------------|---------------|---------------
 *   schema     | schema / database  | database    | "main"        | db index 0-15
 *   collection | table              | collection  | table         | key prefix
 *   row        | row                | document    | row           | one key
 *   primaryKey | declared PK        | _id         | rowid / PK    | the key name
 */

export type DbEngine = 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'redis';

/** SQL-style TLS negotiation. `disable` = plain, `require` = TLS without CA check. */
export type SslMode = 'disable' | 'require';

/**
 * Everything a driver needs to open a connection. Never serialized to the
 * client — the frontend only ever sees the non-sensitive metadata derived from
 * the stored {@link DbConnection} document.
 */
export interface ConnectionConfig {
  type: DbEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  /** Database name (SQL/Mongo), file path (SQLite) or db index (Redis). */
  database: string;
  ssl?: SslMode;
}

export interface SchemaInfo {
  name: string;
}

export interface CollectionInfo {
  name: string;
  /** Estimated row count when cheaply available, else null. */
  rowCount: number | null;
  kind: 'table' | 'view' | 'collection';
}

/** Normalized cell type, used by the frontend to pick an editor/renderer. */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'unknown';

export interface FieldDef {
  name: string;
  type: FieldType;
  nullable: boolean;
  primaryKey: boolean;
  /** Raw engine type for display (e.g. "varchar(255)"), best-effort. */
  rawType?: string;
}

export type CellValue = string | number | boolean | null | Record<string, unknown> | unknown[];
export type Row = Record<string, CellValue>;

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export interface FilterSpec {
  field: string;
  op: 'eq' | 'contains';
  value: string;
}

export interface ListRowsOpts {
  page: number;
  pageSize: number;
  sort?: SortSpec;
  filter?: FilterSpec;
}

export interface ListRowsResult {
  rows: Row[];
  total: number;
  fields: FieldDef[];
  /** Column(s) that uniquely identify a row (empty if none could be determined). */
  primaryKey: string[];
}

export interface TestResult {
  ok: boolean;
  error?: string;
}

/**
 * Read surface implemented by every engine in Phase 1. Write operations
 * (insertRow/updateRow/deleteRow) land in Phase 2 as an extension of this
 * interface so existing drivers keep compiling.
 */
export interface DatabaseDriver {
  engine: DbEngine;

  /** Open, ping, close — with a short timeout so the UI never hangs. */
  testConnection(config: ConnectionConfig): Promise<TestResult>;

  /** Top-level containers (SQL schemas, Mongo databases, Redis db indexes). */
  listSchemas(config: ConnectionConfig): Promise<SchemaInfo[]>;

  /** Tables / collections / key-prefixes inside one schema. */
  listCollections(config: ConnectionConfig, schema: string): Promise<CollectionInfo[]>;

  /** Column/field definitions for one collection. */
  getCollectionSchema(
    config: ConnectionConfig,
    schema: string,
    collection: string,
  ): Promise<FieldDef[]>;

  /** One page of rows, plus the total and the resolved column defs. */
  listRows(
    config: ConnectionConfig,
    schema: string,
    collection: string,
    opts: ListRowsOpts,
  ): Promise<ListRowsResult>;
}

/** Timeouts shared by every driver (ms). */
export const TEST_TIMEOUT_MS = 5_000;
export const QUERY_TIMEOUT_MS = 15_000;

/** Raised by drivers for expected connection/query failures (mapped to 502). */
export class DriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverError';
  }
}
