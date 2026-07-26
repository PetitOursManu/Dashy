import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDbFromEnv, redactDetected } from '../src/services/deployDbDetect.js';

test('detects a Postgres connection URL', () => {
  const d = detectDbFromEnv({ DATABASE_URL: 'postgres://bob:s3cret@db.example.com:6543/shop' });
  assert.ok(d);
  assert.equal(d.type, 'postgresql');
  assert.equal(d.host, 'db.example.com');
  assert.equal(d.port, 6543);
  assert.equal(d.user, 'bob');
  assert.equal(d.password, 's3cret');
  assert.equal(d.database, 'shop');
});

test('detects discrete Postgres vars with the default port', () => {
  const d = detectDbFromEnv({ POSTGRES_USER: 'app', POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'appdb' });
  assert.ok(d);
  assert.equal(d.type, 'postgresql');
  assert.equal(d.port, 5432);
  assert.equal(d.password, 'pw');
  assert.equal(d.database, 'appdb');
});

test('detects MySQL/MariaDB vars', () => {
  const d = detectDbFromEnv({
    MARIADB_USER: 'wp',
    MARIADB_PASSWORD: 'pw',
    MARIADB_DATABASE: 'wordpress',
  });
  assert.ok(d);
  assert.equal(d.type, 'mysql');
  assert.equal(d.port, 3306);
  assert.equal(d.database, 'wordpress');
});

test('redactDetected strips the password', () => {
  const d = detectDbFromEnv({ MONGO_URI: 'mongodb://u:p@h:27017/db' });
  assert.ok(d);
  const r = redactDetected(d) as Record<string, unknown>;
  assert.equal(r.hasPassword, true);
  assert.equal(r.password, undefined);
});

test('returns null when nothing matches', () => {
  assert.equal(detectDbFromEnv({ FOO: 'bar' }), null);
});
