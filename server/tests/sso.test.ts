import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

// --- Test-time configuration (must be set BEFORE importing app modules) ---
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-sso-'));
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'SuperSecret!2026';
const SSO_SECRET = 'sso-test-secret-which-is-long-enough-1234';
const CALLBACK = 'https://mocky.example.com/sso/dashy/callback';

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let disconnectDb: () => Promise<void>;

/** Tiny cookie jar (the server uses a single httpOnly cookie). */
const cookies = new Map<string, string>();
function applySetCookie(res: Response): void {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeader(): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function api(method: string, pathname: string, body?: unknown): Promise<Response> {
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  applySetCookie(res);
  return res;
}

before(async () => {
  mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongo.getUri('dashy_sso_test');
  process.env.JWT_SECRET = 'test-jwt-secret-which-is-long-enough';
  process.env.ENCRYPTION_KEY = 'd'.repeat(64);
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.ALLOW_REGISTRATION = 'false';
  process.env.DATA_DIR = TMP_DATA;
  process.env.PORT = '3000';
  // Enable SSO for this suite.
  process.env.SSO_SHARED_SECRET = SSO_SECRET;
  process.env.SSO_ALLOWED_REDIRECTS = `${CALLBACK},http://localhost:5173/sso/dashy/callback`;

  const { connectDb, disconnectDb: dd } = await import('../src/config/db.js');
  const { ensureDataDirs } = await import('../src/config/paths.js');
  const { seedAdmin } = await import('../src/services/seed.js');
  const { createApp } = await import('../src/app.js');
  disconnectDb = dd;

  ensureDataDirs();
  await connectDb();
  await seedAdmin();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
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

test('authorize rejects a missing redirect_uri', async () => {
  cookies.clear();
  const res = await api('GET', '/api/sso/authorize');
  assert.equal(res.status, 400);
});

test('authorize rejects an unregistered redirect_uri', async () => {
  const res = await api(
    'GET',
    `/api/sso/authorize?redirect_uri=${encodeURIComponent('https://evil.example.com/cb')}`,
  );
  assert.equal(res.status, 400);
});

test('unauthenticated authorize redirects to login with next', async () => {
  cookies.clear();
  const res = await api(
    'GET',
    `/api/sso/authorize?redirect_uri=${encodeURIComponent(CALLBACK)}&state=xyz`,
  );
  assert.equal(res.status, 302);
  const location = res.headers.get('location') ?? '';
  assert.match(location, /^\/login\?next=/);
  assert.match(decodeURIComponent(location), /\/api\/sso\/authorize/);
});

test('authenticated authorize mints a valid SSO token and preserves state', async () => {
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const res = await api(
    'GET',
    `/api/sso/authorize?redirect_uri=${encodeURIComponent(CALLBACK)}&state=opaque123`,
  );
  assert.equal(res.status, 302);

  const location = res.headers.get('location') ?? '';
  const url = new URL(location);
  assert.equal(url.origin + url.pathname, CALLBACK);
  assert.equal(url.searchParams.get('state'), 'opaque123');

  const token = url.searchParams.get('token');
  assert.ok(token, 'a token should be present');

  const payload = jwt.verify(token!, SSO_SECRET, {
    algorithms: ['HS256'],
    issuer: 'dashy',
    audience: 'https://mocky.example.com',
  }) as jwt.JwtPayload;
  assert.equal(payload.email, ADMIN_EMAIL);
  assert.equal(payload.role, 'admin');
  assert.ok(payload.sub, 'sub (Dashy user id) present');
  assert.ok(payload.jti, 'jti present for single-use enforcement');
  // ~60s lifetime.
  assert.ok(payload.exp! - payload.iat! <= 60 && payload.exp! - payload.iat! >= 55);
});

test('a token minted for Mocky is rejected for a different audience', async () => {
  const res = await api(
    'GET',
    `/api/sso/authorize?redirect_uri=${encodeURIComponent(CALLBACK)}&state=a`,
  );
  const token = new URL(res.headers.get('location') ?? '').searchParams.get('token')!;
  assert.throws(() =>
    jwt.verify(token, SSO_SECRET, { audience: 'https://other-app.example.com' }),
  );
});
