import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import argon2 from 'argon2';

// --- Test-time configuration (must be set BEFORE importing app modules) ---
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-data-'));
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'SuperSecret!2026';
const USER_EMAIL = 'user@example.com';
const USER_PASSWORD = 'UserSecret!2026';

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let disconnectDb: () => Promise<void>;
let appId = '';

/** A cookie jar keyed independently so admin/user sessions don't collide. */
function makeJar() {
  const cookies = new Map<string, string>();
  const apply = (res: Response): void => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const header = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const api = async (method: string, pathname: string, body?: unknown): Promise<Response> => {
    const res = await fetch(baseUrl + pathname, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: header() },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    apply(res);
    return res;
  };
  return { api };
}

const admin = makeJar();
const normalUser = makeJar();
const anon = makeJar();

before(async () => {
  mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongo.getUri('dashy_test');
  process.env.JWT_SECRET = 'test-jwt-secret-which-is-long-enough';
  process.env.ENCRYPTION_KEY = 'b'.repeat(64);
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.ALLOW_REGISTRATION = 'false';
  process.env.DATA_DIR = TMP_DATA;
  process.env.PORT = '3000';

  const { connectDb, disconnectDb: dd } = await import('../src/config/db.js');
  const { ensureDataDirs } = await import('../src/config/paths.js');
  const { seedAdmin } = await import('../src/services/seed.js');
  const { createApp } = await import('../src/app.js');
  const { User } = await import('../src/models/User.js');
  const { HostedApp } = await import('../src/models/HostedApp.js');
  disconnectDb = dd;

  ensureDataDirs();
  await connectDb();
  await seedAdmin();

  // A non-admin user (for the role-gate test) and a HostedApp to target.
  await User.create({
    email: USER_EMAIL,
    passwordHash: await argon2.hash(USER_PASSWORD),
    role: 'user',
  });
  const adminDoc = await User.findOne({ email: ADMIN_EMAIL });
  const app = await HostedApp.create({ name: 'Test App', slug: 'test-app', owner: adminDoc!._id });
  appId = app.id;

  const expressApp = createApp();
  await new Promise<void>((resolve) => {
    server = expressApp.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Establish sessions.
  await admin.api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await normalUser.api('POST', '/api/auth/login', { email: USER_EMAIL, password: USER_PASSWORD });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDb();
  await mongo.stop();
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

test('unauthenticated access is rejected', async () => {
  const res = await anon.api('GET', `/api/apps/${appId}/database/connection`);
  assert.equal(res.status, 401);
});

test('non-admin users are forbidden', async () => {
  const res = await normalUser.api('GET', `/api/apps/${appId}/database/connection`);
  assert.equal(res.status, 403);
});

test('invalid / unknown app ids are handled', async () => {
  const bad = await admin.api('GET', '/api/apps/not-an-id/database/connection');
  assert.equal(bad.status, 400);
  const missing = await admin.api('GET', '/api/apps/64b8f0000000000000000000/database/connection');
  assert.equal(missing.status, 404);
});

test('status is "none" before any connection is configured', async () => {
  const res = await admin.api('GET', `/api/apps/${appId}/database/connection`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'none' });
});

test('saving an unsupported engine returns 501', async () => {
  const res = await admin.api('POST', `/api/apps/${appId}/database/connection`, {
    type: 'mongodb',
    host: 'db.internal',
  });
  assert.equal(res.status, 501);
});

test('saving a Postgres connection never leaks secrets', async () => {
  const res = await admin.api('POST', `/api/apps/${appId}/database/connection`, {
    type: 'postgresql',
    host: '127.0.0.1',
    port: 1,
    user: 'app',
    password: 'super-secret',
    database: 'appdb',
    sslMode: 'disable',
  });
  assert.equal(res.status, 200);
  const { connection } = (await res.json()) as { connection: Record<string, unknown> };
  assert.equal(connection.type, 'postgresql');
  assert.equal(connection.hasPassword, true);
  assert.equal(connection.hostHint, '.0.1'); // last 4 chars of "127.0.0.1"
  // No secret or raw connection detail may be serialized.
  for (const leaked of ['host', 'user', 'database', 'password', 'passwordEnc']) {
    assert.equal(connection[leaked], undefined, `${leaked} must not be serialized`);
  }
});

test('GET connection reports configured + engineSupported without secrets', async () => {
  const res = await admin.api('GET', `/api/apps/${appId}/database/connection`);
  const body = (await res.json()) as {
    status: string;
    engineSupported: boolean;
    connection: Record<string, unknown>;
  };
  assert.equal(body.status, 'configured');
  assert.equal(body.engineSupported, true);
  assert.equal(body.connection.password, undefined);
  assert.equal(body.connection.host, undefined);
});

test('testConnection to an unreachable host returns ok:false (not an exception)', async () => {
  const res = await admin.api('POST', `/api/apps/${appId}/database/connection/test`, {
    type: 'postgresql',
    host: '127.0.0.1',
    port: 1,
    user: 'app',
    password: 'x',
    database: 'appdb',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.ok(body.error, 'a failure reason should be provided');
});

test('browsing an unreachable database surfaces a 502', async () => {
  const res = await admin.api('GET', `/api/apps/${appId}/database/schemas`);
  assert.equal(res.status, 502);
});

test('deleting the connection requires an explicit confirm flag', async () => {
  const noConfirm = await admin.api('DELETE', `/api/apps/${appId}/database/connection`, {});
  assert.equal(noConfirm.status, 400);

  const confirmed = await admin.api('DELETE', `/api/apps/${appId}/database/connection`, {
    confirm: true,
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await confirmed.json(), { status: 'none' });
});
