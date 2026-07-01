import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authenticator } from 'otplib';

// --- Test-time configuration (must be set BEFORE importing app modules) ---
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-mobile-'));
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'SuperSecret!2026';
const USER_EMAIL = 'user@example.com';
const USER_PASSWORD = 'UserSecret!2026';

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let disconnectDb: () => Promise<void>;

// Captured app modules (imported after env is configured).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let User: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let HostedApp: any;
let encrypt: (s: string) => string;

/** Bearer-token fetch helper — the mobile API never uses cookies. */
async function api(
  method: string,
  pathname: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return fetch(baseUrl + pathname, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
}

before(async () => {
  mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongo.getUri('dashy_mobile_test');
  process.env.JWT_SECRET = 'test-jwt-secret-which-is-long-enough';
  process.env.ENCRYPTION_KEY = 'c'.repeat(64);
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.ALLOW_REGISTRATION = 'false';
  process.env.DATA_DIR = TMP_DATA;
  process.env.PORT = '3000'; // unused — the test listens on an ephemeral port

  const { connectDb, disconnectDb: dd } = await import('../src/config/db.js');
  const { ensureDataDirs } = await import('../src/config/paths.js');
  const { seedAdmin } = await import('../src/services/seed.js');
  const { createApp } = await import('../src/app.js');
  ({ User } = await import('../src/models/User.js'));
  ({ HostedApp } = await import('../src/models/HostedApp.js'));
  ({ encrypt } = await import('../src/utils/crypto.js'));
  const argon2 = (await import('argon2')).default;
  disconnectDb = dd;

  ensureDataDirs();
  await connectDb();
  await seedAdmin();

  // A regular (non-staff) user with one accessible app, to verify per-role
  // filtering and the absence of the admin block.
  const admin = await User.findOne({ email: ADMIN_EMAIL });
  const app = await HostedApp.create({
    name: 'Shared App',
    slug: 'shared-app',
    owner: admin._id,
  });
  await User.create({
    email: USER_EMAIL,
    passwordHash: await argon2.hash(USER_PASSWORD),
    role: 'user',
    allowedApps: [app._id],
  });

  const httpServer = createApp();
  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDb();
  await mongo.stop();
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

test('GET /info responds without authentication', async () => {
  const res = await api('GET', '/api/mobile/v1/info');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.apiVersion, 1);
  assert.equal(json.server.name, 'Dashy');
  assert.equal(json.features.twoFactor, true);
});

test('rejects /sync without a Bearer token', async () => {
  const res = await api('GET', '/api/mobile/v1/sync');
  assert.equal(res.status, 401);
});

test('rejects a malformed Bearer token', async () => {
  const res = await api('GET', '/api/mobile/v1/sync', { token: 'not-a-real-token' });
  assert.equal(res.status, 401);
});

let adminToken = '';

test('login returns a Bearer token + user in the body', async () => {
  const res = await api('POST', '/api/mobile/v1/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, device: 'iPhone 16' },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.token, 'token should be present');
  assert.equal(json.user.email, ADMIN_EMAIL);
  assert.equal(json.user.role, 'admin');
  assert.equal(json.user.passwordHash, undefined);
  adminToken = json.token;
});

test('login rejects a bad password', async () => {
  const res = await api('POST', '/api/mobile/v1/auth/login', {
    body: { email: ADMIN_EMAIL, password: 'wrong-password' },
  });
  assert.equal(res.status, 401);
});

test('/sync returns the admin snapshot with the admin block', async () => {
  const res = await api('GET', '/api/mobile/v1/sync', { token: adminToken });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.user.email, ADMIN_EMAIL);
  assert.ok(Array.isArray(json.apps), 'apps should be an array');
  assert.equal(json.apps.length, 1, 'admin sees every app');
  assert.ok(Array.isArray(json.notifications));
  assert.ok(json.admin, 'admin block present for staff');
  assert.ok(json.admin.store, 'store summary present');
  assert.equal(typeof json.admin.stats.totalUsers, 'number');
});

test('/sync exposes the assistant availability block', async () => {
  const res = await api('GET', '/api/mobile/v1/sync', { token: adminToken });
  const json = await res.json();
  assert.ok(json.chat, 'chat block present');
  // No provider is configured in tests, so the AI is unavailable, but the user
  // may still contact an admin (canRequest).
  assert.equal(json.chat.available, false);
  assert.equal(json.chat.canRequest, true);
});

test('/chat/status reports unavailable when no provider is configured', async () => {
  const res = await api('GET', '/api/mobile/v1/chat/status', { token: adminToken });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.available, false);
  assert.equal(json.canRequest, true);
});

test('POST /chat returns 503 when the assistant is not configured', async () => {
  const res = await api('POST', '/api/mobile/v1/chat', {
    token: adminToken,
    body: { messages: [{ role: 'user', content: 'Bonjour' }] },
  });
  assert.equal(res.status, 503);
});

test('POST /chat rejects a malformed body', async () => {
  const res = await api('POST', '/api/mobile/v1/chat', {
    token: adminToken,
    body: { messages: [] }, // min 1 message required
  });
  assert.equal(res.status, 400);
});

test('the named device shows up in active sessions', async () => {
  const res = await api('GET', '/api/mobile/v1/auth/sessions', { token: adminToken });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.sessions.some((s: { userAgent: string }) => s.userAgent === 'iPhone 16'));
});

test('favorite toggle is reflected in the next /sync', async () => {
  const sync = await (await api('GET', '/api/mobile/v1/sync', { token: adminToken })).json();
  const appId = sync.apps[0].id;

  const fav = await api('POST', `/api/mobile/v1/apps/${appId}/favorite`, { token: adminToken });
  assert.equal(fav.status, 200);
  assert.equal((await fav.json()).isFavorite, true);

  const after = await (await api('GET', '/api/mobile/v1/sync', { token: adminToken })).json();
  assert.deepEqual(after.favorites, [appId]);
  assert.equal(after.apps[0].isFavorite, true);
});

test('a regular user gets no admin block and only their apps', async () => {
  const login = await (
    await api('POST', '/api/mobile/v1/auth/login', {
      body: { email: USER_EMAIL, password: USER_PASSWORD },
    })
  ).json();
  const res = await api('GET', '/api/mobile/v1/sync', { token: login.token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.admin, undefined, 'non-staff must not receive the admin block');
  assert.equal(json.apps.length, 1);
  assert.equal(json.apps[0].slug, 'shared-app');
});

test('a regular user is denied admin-only endpoints', async () => {
  const login = await (
    await api('POST', '/api/mobile/v1/auth/login', {
      body: { email: USER_EMAIL, password: USER_PASSWORD },
    })
  ).json();
  const res = await api('GET', '/api/mobile/v1/stats/overview', { token: login.token });
  assert.equal(res.status, 403);
});

test('2FA login flow: pending token then TOTP verification', async () => {
  // Enable 2FA directly on the admin (skips the interactive setup endpoints).
  const secret = authenticator.generateSecret();
  await User.updateOne(
    { email: ADMIN_EMAIL },
    { twoFactorEnabled: true, twoFactorSecret: encrypt(secret) },
  );

  const step1 = await api('POST', '/api/mobile/v1/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assert.equal(step1.status, 200);
  const j1 = await step1.json();
  assert.equal(j1.twoFactorRequired, true);
  assert.ok(j1.pendingToken, 'a pending token should be issued');
  assert.equal(j1.token, undefined, 'no access token before 2FA is verified');

  const step2 = await api('POST', '/api/mobile/v1/auth/2fa/verify', {
    body: { pendingToken: j1.pendingToken, token: authenticator.generate(secret) },
  });
  assert.equal(step2.status, 200);
  const j2 = await step2.json();
  assert.ok(j2.token, 'access token issued after successful 2FA');

  // The Bearer token works against a normal cookie-based web route too.
  const me = await fetch(baseUrl + '/api/auth/me', {
    headers: { Authorization: `Bearer ${j2.token}` },
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, ADMIN_EMAIL);

  // Restore non-2FA state for any later runs.
  await User.updateOne(
    { email: ADMIN_EMAIL },
    { twoFactorEnabled: false, twoFactorSecret: null },
  );
});
