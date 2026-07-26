import type { DbEngine } from '../db-drivers/types.js';
import { DEFAULT_PORTS } from './connectionResolver.js';

/**
 * Best-effort detection of a database's connection details from the environment
 * variables of an app Dashy deployed itself (the Store keeps them in
 * StoreInstalledApp.deployEnv). Recognizes both the common single-URL form
 * (DATABASE_URL, MONGO_URI, REDIS_URL…) and the discrete per-engine variables
 * (POSTGRES_, MYSQL_ or MARIADB_, MONGO_INITDB_).
 *
 * The full result (password included) is server-side only. Use
 * {@link redactDetected} for anything sent to the browser.
 */
export interface DetectedConnection {
  type: DbEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DetectedMeta {
  type: DbEngine;
  host: string;
  port: number;
  user: string;
  database: string;
  hasPassword: boolean;
}

/** Env keys that may hold a full connection URL, richest first. */
const URL_KEYS = [
  'DATABASE_URL',
  'DB_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'MYSQL_URL',
  'MARIADB_URL',
  'MONGODB_URI',
  'MONGO_URI',
  'MONGO_URL',
  'REDIS_URL',
];

function engineFromScheme(protocol: string): DbEngine | null {
  const s = protocol.replace(/:$/, '').toLowerCase();
  if (s === 'postgres' || s === 'postgresql') return 'postgresql';
  if (s === 'mysql' || s === 'mariadb') return 'mysql';
  if (s === 'mongodb' || s === 'mongodb+srv') return 'mongodb';
  if (s === 'redis' || s === 'rediss') return 'redis';
  return null;
}

function fromUrl(raw: string): DetectedConnection | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const engine = engineFromScheme(u.protocol);
  if (!engine) return null;
  return {
    type: engine,
    host: u.hostname,
    port: u.port ? Number(u.port) : DEFAULT_PORTS[engine],
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

function fromDiscrete(env: Record<string, string>): DetectedConnection | null {
  const g = (k: string): string => env[k] ?? '';
  const num = (v: string, fallback: number): number => (Number(v) > 0 ? Number(v) : fallback);

  if (g('POSTGRES_PASSWORD') || g('POSTGRES_USER') || g('POSTGRES_DB')) {
    const user = g('POSTGRES_USER') || 'postgres';
    return {
      type: 'postgresql',
      host: g('POSTGRES_HOST') || g('PGHOST'),
      port: num(g('POSTGRES_PORT') || g('PGPORT'), 5432),
      user,
      password: g('POSTGRES_PASSWORD') || g('PGPASSWORD'),
      database: g('POSTGRES_DB') || g('PGDATABASE') || user,
    };
  }

  const myUser = g('MYSQL_USER') || g('MARIADB_USER');
  const myPass = g('MYSQL_PASSWORD') || g('MARIADB_PASSWORD');
  const myDb = g('MYSQL_DATABASE') || g('MARIADB_DATABASE');
  const myRoot = g('MYSQL_ROOT_PASSWORD') || g('MARIADB_ROOT_PASSWORD');
  if (myUser || myPass || myDb || myRoot) {
    return {
      type: 'mysql',
      host: g('MYSQL_HOST') || g('MARIADB_HOST'),
      port: num(g('MYSQL_PORT') || g('MARIADB_PORT'), 3306),
      user: myUser || (myRoot ? 'root' : ''),
      password: myPass || myRoot,
      database: myDb,
    };
  }

  if (g('MONGO_INITDB_ROOT_USERNAME') || g('MONGO_INITDB_ROOT_PASSWORD')) {
    return {
      type: 'mongodb',
      host: g('MONGO_HOST'),
      port: num(g('MONGO_PORT'), 27017),
      user: g('MONGO_INITDB_ROOT_USERNAME'),
      password: g('MONGO_INITDB_ROOT_PASSWORD'),
      database: g('MONGO_INITDB_DATABASE'),
    };
  }

  if (g('REDIS_PASSWORD')) {
    return {
      type: 'redis',
      host: g('REDIS_HOST'),
      port: num(g('REDIS_PORT'), 6379),
      user: '',
      password: g('REDIS_PASSWORD'),
      database: '',
    };
  }

  return null;
}

/** Detect a database connection from a deployed app's env vars, or null. */
export function detectDbFromEnv(env: Record<string, string>): DetectedConnection | null {
  for (const key of URL_KEYS) {
    if (env[key]) {
      const detected = fromUrl(env[key]);
      if (detected) return detected;
    }
  }
  return fromDiscrete(env);
}

/** Strip the password before exposing a detection to the client. */
export function redactDetected(d: DetectedConnection): DetectedMeta {
  return {
    type: d.type,
    host: d.host,
    port: d.port,
    user: d.user,
    database: d.database,
    hasPassword: Boolean(d.password),
  };
}
