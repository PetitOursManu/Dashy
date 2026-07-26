import { decrypt } from '../utils/crypto.js';
import type { ConnectionConfig, DbEngine, SslMode } from '../db-drivers/types.js';
import type { DbConnectionDoc } from '../models/DbConnection.js';

/**
 * Turns a stored or user-supplied connection into a {@link ConnectionConfig}
 * the drivers can use. Phase 1 covers the manual path (fallback that works for
 * any app, even `tile` cards Dashy knows nothing about). Automatic detection
 * from a Coolify-deployed app's env vars is Phase 5 and plugs in here.
 */

export const DEFAULT_PORTS: Record<DbEngine, number> = {
  postgresql: 5432,
  mysql: 3306,
  mongodb: 27017,
  sqlite: 0,
  redis: 6379,
};

export interface ManualConnectionInput {
  type: DbEngine;
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  sslMode?: SslMode;
}

/** Build a live config from a manual form payload (used by "test" and "save"). */
export function configFromManual(input: ManualConnectionInput): ConnectionConfig {
  return {
    type: input.type,
    host: input.host,
    port: input.port && input.port > 0 ? input.port : DEFAULT_PORTS[input.type],
    user: input.user,
    password: input.password,
    database: input.database,
    ssl: input.sslMode ?? 'disable',
  };
}

/** Build a live config from a stored connection, decrypting the password. */
export function configFromStored(doc: DbConnectionDoc): ConnectionConfig {
  return {
    type: doc.type,
    host: doc.host,
    port: doc.port > 0 ? doc.port : DEFAULT_PORTS[doc.type],
    user: doc.user,
    password: doc.passwordEnc ? decrypt(doc.passwordEnc) : '',
    database: doc.database,
    ssl: doc.sslMode,
  };
}
