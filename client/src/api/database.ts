import { http } from './client';

export type DbEngine = 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'redis';
export type SslMode = 'disable' | 'require';

/** Non-sensitive connection metadata — the only shape the backend ever exposes. */
export interface ConnectionMeta {
  id: string;
  type: DbEngine;
  source: 'manual' | 'auto';
  sslMode: SslMode;
  hasPassword: boolean;
  hostHint: string;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionStatus =
  | { status: 'none' }
  | { status: 'configured'; connection: ConnectionMeta; engineSupported: boolean };

export interface ConnectionInput {
  type: DbEngine;
  host: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  sslMode?: SslMode;
}

export interface TestResult {
  ok: boolean;
  error?: string;
}

export interface SchemaInfo {
  name: string;
}
export interface CollectionInfo {
  name: string;
  rowCount: number | null;
  kind: 'table' | 'view' | 'collection';
}

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'unknown';
export interface FieldDef {
  name: string;
  type: FieldType;
  nullable: boolean;
  primaryKey: boolean;
  rawType?: string;
}

export type CellValue = string | number | boolean | null | Record<string, unknown> | unknown[];
export type Row = Record<string, CellValue>;

export interface ListRowsResult {
  rows: Row[];
  total: number;
  fields: FieldDef[];
  primaryKey: string[];
}

export interface ListRowsParams {
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  filterField?: string;
  filterOp?: 'eq' | 'contains';
  filterValue?: string;
}

const base = (appId: string) => `/api/apps/${appId}/database`;
const enc = encodeURIComponent;

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const databaseApi = {
  getConnection: (appId: string) => http.get<ConnectionStatus>(`${base(appId)}/connection`),

  test: (appId: string, input: ConnectionInput) =>
    http.post<TestResult>(`${base(appId)}/connection/test`, input),

  save: (appId: string, input: ConnectionInput) =>
    http.post<{ status: 'configured'; connection: ConnectionMeta }>(
      `${base(appId)}/connection`,
      input,
    ),

  // Backend requires an explicit confirm flag in addition to the UI dialog.
  remove: (appId: string) => http.del<{ status: 'none' }>(`${base(appId)}/connection`, { confirm: true }),

  schemas: (appId: string) => http.get<{ schemas: SchemaInfo[] }>(`${base(appId)}/schemas`),

  collections: (appId: string, schema: string) =>
    http.get<{ collections: CollectionInfo[] }>(`${base(appId)}/schemas/${enc(schema)}/collections`),

  fields: (appId: string, schema: string, name: string) =>
    http.get<{ fields: FieldDef[] }>(
      `${base(appId)}/schemas/${enc(schema)}/collections/${enc(name)}/fields`,
    ),

  rows: (appId: string, schema: string, name: string, params: ListRowsParams) => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pageSize: params.pageSize,
      sortField: params.sortField,
      sortDir: params.sortDir,
      filterField: params.filterField,
      filterOp: params.filterOp,
      filterValue: params.filterValue,
    };
    return http.get<ListRowsResult>(
      `${base(appId)}/schemas/${enc(schema)}/collections/${enc(name)}/rows${qs(query)}`,
    );
  },
};
