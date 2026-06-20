import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authenticator } from 'otplib';
import AdmZip from 'adm-zip';

// --- Test-time configuration (must be set BEFORE importing app modules) ---
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-data-'));
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'SuperSecret!2026';

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let disconnectDb: () => Promise<void>;

/** Tiny cookie jar around fetch (the server uses a single httpOnly cookie). */
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
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  applySetCookie(res);
  return res;
}

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
  process.env.PORT = '3000'; // unused — the test listens on an ephemeral port

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

test('rejects unauthenticated access to /api/apps', async () => {
  cookies.clear();
  const res = await api('GET', '/api/apps');
  assert.equal(res.status, 401);
});

test('admin can log in (no 2FA yet)', async () => {
  const res = await api('POST', '/api/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.user.email, ADMIN_EMAIL);
  assert.equal(json.user.role, 'admin');
  // The frontend keys off `id`, not `_id`.
  assert.ok(json.user.id, 'user should expose id');
  assert.equal(json.user._id, undefined);
  // Sensitive fields must never be serialized.
  assert.equal(json.user.passwordHash, undefined);
  assert.equal(json.user.twoFactorSecret, undefined);
});

test('rejects bad password', async () => {
  cookies.clear();
  const res = await api('POST', '/api/auth/login', {
    email: ADMIN_EMAIL,
    password: 'wrong-password',
  });
  assert.equal(res.status, 401);
});

let slug = '';
let appId = '';
let zipSlug = '';

test('admin can import a standalone HTML app', async () => {
  // Re-authenticate (previous test cleared cookies).
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const form = new FormData();
  form.set('name', 'My Test App');
  form.set('description', 'A standalone HTML artifact');
  form.set(
    'content',
    new Blob(['<!doctype html><title>T</title><h1>Hello Dashy</h1>'], { type: 'text/html' }),
    'artifact.html',
  );

  const res = await fetch(baseUrl + '/api/apps', {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  applySetCookie(res);
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.app.name, 'My Test App');
  assert.equal(json.app.entryFile, 'index.html');
  assert.match(json.app.slug, /^my-test-app/);
  assert.ok(json.app.id, 'app should expose id');
  assert.equal(json.app.previewUrl, `/api/apps/${json.app.id}/preview`);
  slug = json.app.slug;
  appId = json.app.id;
});

test('imported app appears in the list', async () => {
  const res = await api('GET', '/api/apps');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.apps.length, 1);
  assert.equal(json.apps[0].url, `/hosted/${slug}/`);
});

test('hosted app is served with its content', async () => {
  const res = await fetch(`${baseUrl}/hosted/${slug}/`, {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Hello Dashy/);
});

test('hosted serving blocks path traversal', async () => {
  const res = await fetch(`${baseUrl}/hosted/${slug}/..%2f..%2f..%2fpackage.json`, {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  });
  assert.ok(res.status === 400 || res.status === 404);
});

test('admin can import a ZIP site and entry file is detected', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<h1>Zip Home</h1>'));
  zip.addFile('style.css', Buffer.from('h1{color:red}'));
  const buf = zip.toBuffer();

  const form = new FormData();
  form.set('name', 'Zip Site');
  form.set('content', new Blob([buf], { type: 'application/zip' }), 'site.zip');

  const res = await fetch(baseUrl + '/api/apps', {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.app.entryFile, 'index.html');
  zipSlug = json.app.slug;

  // Its CSS asset is reachable under the hosted path.
  const css = await fetch(`${baseUrl}/hosted/${json.app.slug}/style.css`, {
    headers: { Cookie: cookieHeader() },
  });
  assert.equal(css.status, 200);
});

// ---------------------- app features: category, opens, favorites -------------

test('importing with a category stores it', async () => {
  const form = new FormData();
  form.set('name', 'Categorized App');
  form.set('category', 'Tools');
  form.set('content', new Blob(['<h1>cat</h1>'], { type: 'text/html' }), 'c.html');
  const res = await fetch(baseUrl + '/api/apps', {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  assert.equal(res.status, 201);
  const { app } = await res.json();
  assert.equal(app.category, 'Tools');
  assert.equal(app.openCount, 0);
  assert.equal(app.isFavorite, false);
});

async function openCountFor(targetSlug: string): Promise<number> {
  const { apps } = await (await api('GET', '/api/apps')).json();
  return apps.find((a: { slug: string }) => a.slug === targetSlug)?.openCount ?? 0;
}

test('opening an app root increments its open count', async () => {
  await fetch(`${baseUrl}/hosted/${slug}/`, {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  });
  // recordOpen is fire-and-forget, so poll briefly for the increment.
  let count = 0;
  for (let i = 0; i < 30; i++) {
    count = await openCountFor(slug);
    if (count > 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(count >= 1, 'open count should be at least 1');
});

test('sub-asset requests do not count as opens', async () => {
  const before = await openCountFor(zipSlug);
  await fetch(`${baseUrl}/hosted/${zipSlug}/style.css`, { headers: { Cookie: cookieHeader() } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await openCountFor(zipSlug), before);
});

test('favorite toggle works and is reflected in the list', async () => {
  const on = await (await api('POST', `/api/apps/${appId}/favorite`)).json();
  assert.equal(on.isFavorite, true);
  const { apps } = await (await api('GET', '/api/apps')).json();
  assert.equal(apps.find((a: { id: string }) => a.id === appId).isFavorite, true);

  const off = await (await api('POST', `/api/apps/${appId}/favorite`)).json();
  assert.equal(off.isFavorite, false);
});

test('admin analytics endpoints respond', async () => {
  const ov = await (await api('GET', '/api/stats/overview')).json();
  assert.equal(ov.opensByMonth.length, 6);
  assert.ok(Array.isArray(ov.topApps));
  assert.ok(ov.totalOpens >= 1);

  const act = await (await api('GET', '/api/stats/activity')).json();
  assert.ok(act.activities.some((a: { type: string }) => a.type === 'app.imported'));

  const st = await (await api('GET', '/api/stats/storage')).json();
  assert.ok(st.total > 0);
  assert.ok(Array.isArray(st.apps));
});

// ------------------------- profile, avatar, sessions -------------------------

test('user can update profile + preferences (internal fields hidden)', async () => {
  const res = await api('PATCH', '/api/auth/profile', {
    nickname: 'Ada',
    fullName: 'Ada Lovelace',
    jobTitle: 'Engineer',
    language: 'fr',
    theme: 'violet',
    timezone: 'Europe/Paris',
    dateFormat: 'dmy',
  });
  assert.equal(res.status, 200);

  const { user } = await (await api('GET', '/api/auth/me')).json();
  assert.equal(user.nickname, 'Ada');
  assert.equal(user.fullName, 'Ada Lovelace');
  assert.equal(user.language, 'fr');
  assert.equal(user.theme, 'violet');
  assert.equal(user.timezone, 'Europe/Paris');
  assert.equal(user.dateFormat, 'dmy');
  assert.equal(user.hasAvatar, false);
  // Internal fields never leak.
  assert.equal(user.tokenVersion, undefined);
  assert.equal(user.avatar, undefined);
});

test('avatar upload, fetch, and delete', async () => {
  const { user } = await (await api('GET', '/api/auth/me')).json();

  const form = new FormData();
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  form.set('avatar', new Blob([png], { type: 'image/png' }), 'a.png');
  const up = await fetch(baseUrl + '/api/auth/avatar', {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  assert.equal(up.status, 200);
  assert.equal((await up.json()).user.hasAvatar, true);

  const img = await fetch(`${baseUrl}/api/auth/avatar/${user.id}`, {
    headers: { Cookie: cookieHeader() },
  });
  assert.equal(img.status, 200);

  const del = await api('DELETE', '/api/auth/avatar');
  assert.equal((await del.json()).user.hasAvatar, false);
});

test('logout-all invalidates previously issued tokens', async () => {
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const oldToken = cookies.get('dashy_token');
  assert.equal((await api('GET', '/api/apps')).status, 200);

  await api('POST', '/api/auth/logout-all');

  // Replaying the captured (now-stale) token must be rejected.
  const replay = await fetch(baseUrl + '/api/apps', {
    headers: { Cookie: `dashy_token=${oldToken}` },
    redirect: 'manual',
  });
  assert.equal(replay.status, 401);
});

// ------------------------- multi-user / access control -----------------------

const BOB_EMAIL = 'bob@example.com';
const BOB_PASSWORD = 'BobPassword!2026';
let bobId = '';

test('admin can create a regular user with app access', async () => {
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const res = await api('POST', '/api/users', {
    email: BOB_EMAIL,
    password: BOB_PASSWORD,
    role: 'user',
    allowedApps: [appId],
  });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  assert.equal(user.email, BOB_EMAIL);
  assert.equal(user.role, 'user');
  assert.deepEqual(user.allowedApps, [appId]);
  assert.equal(user.passwordHash, undefined);
  bobId = user.id;
});

test('admin can list users', async () => {
  const res = await api('GET', '/api/users');
  assert.equal(res.status, 200);
  const { users } = await res.json();
  const emails = users.map((u: { email: string }) => u.email);
  assert.ok(emails.includes(ADMIN_EMAIL));
  assert.ok(emails.includes(BOB_EMAIL));
});

test('regular user sees only their assigned apps', async () => {
  await api('POST', '/api/auth/logout');
  cookies.clear();
  const login = await api('POST', '/api/auth/login', {
    email: BOB_EMAIL,
    password: BOB_PASSWORD,
  });
  assert.equal(login.status, 200);

  const { apps } = await (await api('GET', '/api/apps')).json();
  assert.equal(apps.length, 1);
  assert.equal(apps[0].slug, slug);
});

test('regular user can open an allowed app but not others', async () => {
  const allowed = await fetch(`${baseUrl}/hosted/${slug}/`, {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  });
  assert.equal(allowed.status, 200);

  const denied = await fetch(`${baseUrl}/hosted/${zipSlug}/`, {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  });
  assert.equal(denied.status, 403);
});

test('regular user is blocked from admin-only endpoints', async () => {
  assert.equal((await api('GET', '/api/users')).status, 403);
  assert.equal((await api('POST', '/api/users', {})).status, 403);
  assert.equal((await api('GET', '/api/stats/overview')).status, 403);

  const form = new FormData();
  form.set('name', 'Should Fail');
  form.set('content', new Blob(['<h1>x</h1>'], { type: 'text/html' }), 'x.html');
  const importRes = await fetch(baseUrl + '/api/apps', {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  assert.equal(importRes.status, 403);
});

test('admin can revoke access and the app disappears for the user', async () => {
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const res = await api('PATCH', `/api/users/${bobId}`, { allowedApps: [] });
  assert.equal(res.status, 200);

  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });

  const { apps } = await (await api('GET', '/api/apps')).json();
  assert.equal(apps.length, 0);
  const denied = await fetch(`${baseUrl}/hosted/${slug}/`, {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  });
  assert.equal(denied.status, 403);

  // Restore the admin session for the remaining tests.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

test('full 2FA enable + login flow', async () => {
  // Start setup.
  const setupRes = await api('POST', '/api/auth/2fa/setup');
  assert.equal(setupRes.status, 200);
  const { secret, backupCodes } = await setupRes.json();
  assert.ok(secret);
  assert.equal(backupCodes.length, 10);

  // Enable with a valid TOTP code.
  const enableRes = await api('POST', '/api/auth/2fa/enable', {
    token: authenticator.generate(secret),
  });
  assert.equal(enableRes.status, 200);

  // Log out, then logging in should now require 2FA.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  const loginRes = await api('POST', '/api/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  const loginJson = await loginRes.json();
  assert.equal(loginJson.twoFactorRequired, true);

  // /api/apps must still be blocked with only the pending token.
  const blocked = await api('GET', '/api/apps');
  assert.equal(blocked.status, 401);

  // Complete with a TOTP code.
  const verifyRes = await api('POST', '/api/auth/2fa/verify', {
    token: authenticator.generate(secret),
  });
  assert.equal(verifyRes.status, 200);

  // Now authorized again.
  const ok = await api('GET', '/api/apps');
  assert.equal(ok.status, 200);

  // A backup code also completes login.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const backupRes = await api('POST', '/api/auth/2fa/verify', { token: backupCodes[0] });
  assert.equal(backupRes.status, 200);

  // The same backup code cannot be reused.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const reuse = await api('POST', '/api/auth/2fa/verify', { token: backupCodes[0] });
  assert.equal(reuse.status, 401);
});
