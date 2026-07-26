import type { DatabaseDriver, DbEngine } from './types.js';
import { postgresDriver } from './postgres.driver.js';
import { mysqlDriver } from './mysql.driver.js';

/**
 * Engine → driver registry. Grows one entry per phase:
 *   Phase 1 → postgresql, mysql (MySQL + MariaDB share the wire protocol)
 *   Phase 3 → mongodb · Phase 4 → sqlite, redis
 */
const DRIVERS: Partial<Record<DbEngine, DatabaseDriver>> = {
  postgresql: postgresDriver,
  mysql: mysqlDriver,
};

/** Engines that have a working driver right now. */
export const SUPPORTED_ENGINES = Object.keys(DRIVERS) as DbEngine[];

/** Resolve a driver instance for an engine, or null if not yet supported. */
export function resolveDriver(type: DbEngine): DatabaseDriver | null {
  return DRIVERS[type] ?? null;
}
