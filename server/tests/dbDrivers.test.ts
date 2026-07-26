import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postgresDriver } from '../src/db-drivers/postgres.driver.js';
import { mysqlDriver } from '../src/db-drivers/mysql.driver.js';
import { resolveDriver, SUPPORTED_ENGINES } from '../src/db-drivers/index.js';
import { DriverError, type ConnectionConfig, type DbEngine } from '../src/db-drivers/types.js';

/**
 * These run without a live database: they cover the factory wiring and the
 * error path (an unreachable host must fail cleanly, never hang or throw an
 * uncontrolled error). Happy-path query mapping needs a reachable Postgres/MySQL
 * instance and is out of scope on a machine without Docker — see README.
 */

const unreachable = (type: DbEngine): ConnectionConfig => ({
  type,
  host: '127.0.0.1',
  port: 1, // reserved/closed → immediate ECONNREFUSED
  user: 'x',
  password: 'x',
  database: 'x',
  ssl: 'disable',
});

test('factory resolves supported engines only', () => {
  assert.equal(resolveDriver('postgresql'), postgresDriver);
  assert.equal(resolveDriver('mysql'), mysqlDriver);
  assert.equal(resolveDriver('mongodb'), null);
  assert.equal(resolveDriver('redis'), null);
  assert.ok(SUPPORTED_ENGINES.includes('postgresql'));
  assert.ok(SUPPORTED_ENGINES.includes('mysql'));
});

test('drivers advertise their engine', () => {
  assert.equal(postgresDriver.engine, 'postgresql');
  assert.equal(mysqlDriver.engine, 'mysql');
});

test('postgres testConnection fails cleanly on an unreachable host', async () => {
  const res = await postgresDriver.testConnection(unreachable('postgresql'));
  assert.equal(res.ok, false);
  assert.ok(res.error, 'a reason should be reported');
});

test('mysql testConnection fails cleanly on an unreachable host', async () => {
  const res = await mysqlDriver.testConnection(unreachable('mysql'));
  assert.equal(res.ok, false);
  assert.ok(res.error, 'a reason should be reported');
});

test('read operations reject with DriverError on an unreachable host', async () => {
  await assert.rejects(() => postgresDriver.listSchemas(unreachable('postgresql')), DriverError);
  await assert.rejects(() => mysqlDriver.listSchemas(unreachable('mysql')), DriverError);
});
