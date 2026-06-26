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
let shareToken = '';

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

test('image theme: glass preference, background upload, fetch, and delete', async () => {
  // Switch to the image theme and turn glass off. Tint defaults to light.
  const prof = await api('PATCH', '/api/auth/profile', { theme: 'image', glass: false });
  assert.equal(prof.status, 200);
  const pj = await prof.json();
  assert.equal(pj.user.theme, 'image');
  assert.equal(pj.user.glass, false);
  assert.equal(pj.user.glassDark, false);

  // Switching the tint to dark persists.
  const dark = await api('PATCH', '/api/auth/profile', { glassDark: true });
  assert.equal((await dark.json()).user.glassDark, true);

  // Upload a background image.
  const form = new FormData();
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  form.set('background', new Blob([png], { type: 'image/png' }), 'bg.png');
  const up = await fetch(baseUrl + '/api/auth/background', {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  assert.equal(up.status, 200);
  assert.equal((await up.json()).user.hasBackground, true);

  const img = await fetch(`${baseUrl}/api/auth/background`, { headers: { Cookie: cookieHeader() } });
  assert.equal(img.status, 200);

  const del = await api('DELETE', '/api/auth/background');
  assert.equal((await del.json()).user.hasBackground, false);

  // Restore the default theme so later tests aren't affected.
  await api('PATCH', '/api/auth/profile', { theme: 'light', glass: true });
});

test('admin can update app content and roll back', async () => {
  // Replace the standalone app's content with new HTML.
  const form = new FormData();
  form.set(
    'content',
    new Blob(['<!doctype html><title>V2</title><h1>Version Two</h1>'], { type: 'text/html' }),
    'v2.html',
  );
  const up = await fetch(`${baseUrl}/api/apps/${appId}/content`, {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  assert.equal(up.status, 200);
  const { app } = await up.json();
  assert.equal(app.versions.length, 1);
  const oldVid = app.versions[0].vid;

  // The hosted app now serves the new content.
  let html = await (
    await fetch(`${baseUrl}/hosted/${slug}/`, { headers: { Cookie: cookieHeader() } })
  ).text();
  assert.match(html, /Version Two/);

  // Roll back to the previous version.
  const rb = await api('POST', `/api/apps/${appId}/versions/${oldVid}/rollback`);
  assert.equal(rb.status, 200);

  html = await (
    await fetch(`${baseUrl}/hosted/${slug}/`, { headers: { Cookie: cookieHeader() } })
  ).text();
  assert.match(html, /Hello Dashy/);
});

test('admin can create a public share link (served without auth)', async () => {
  const res = await api('POST', `/api/apps/${appId}/share`, { password: '', expiresInDays: null });
  assert.equal(res.status, 200);
  const { app } = await res.json();
  assert.ok(app.share?.token);
  assert.equal(app.share.hasPassword, false);
  shareToken = app.share.token;

  // Public access — no cookie at all.
  const pub = await fetch(`${baseUrl}/share/${shareToken}/`, { redirect: 'manual' });
  assert.equal(pub.status, 200);
  assert.match(await pub.text(), /Hello Dashy/);
});

test('password-protected share gates then unlocks', async () => {
  const set = await api('POST', `/api/apps/${appId}/share`, {
    password: 'sesame',
    expiresInDays: null,
  });
  assert.equal((await set.json()).app.share.hasPassword, true);

  // Gate shows a password form, not the app.
  const gated = await fetch(`${baseUrl}/share/${shareToken}/`, { redirect: 'manual' });
  const gatedHtml = await gated.text();
  assert.match(gatedHtml, /password/i);
  assert.doesNotMatch(gatedHtml, /Hello Dashy/);

  // Wrong password.
  const wrong = await fetch(`${baseUrl}/share/${shareToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=nope',
    redirect: 'manual',
  });
  assert.equal(wrong.status, 401);

  // Correct password → cookie + redirect → content reachable.
  const ok = await fetch(`${baseUrl}/share/${shareToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=sesame',
    redirect: 'manual',
  });
  assert.equal(ok.status, 302);
  const cookie = (ok.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  assert.match(cookie, /dashy_share_/);

  const unlocked = await fetch(`${baseUrl}/share/${shareToken}/`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  assert.equal(unlocked.status, 200);
  assert.match(await unlocked.text(), /Hello Dashy/);
});

test('expired share returns 410 and revoke removes it', async () => {
  const { HostedApp } = await import('../src/models/HostedApp.js');
  await HostedApp.updateOne(
    { 'share.token': shareToken },
    { $set: { 'share.expiresAt': new Date(Date.now() - 1000) } },
  );
  const expired = await fetch(`${baseUrl}/share/${shareToken}/`, { redirect: 'manual' });
  assert.equal(expired.status, 410);

  const revoke = await api('DELETE', `/api/apps/${appId}/share`);
  assert.equal(revoke.status, 200);
  assert.equal((await revoke.json()).app.share, null);

  const gone = await fetch(`${baseUrl}/share/${shareToken}/`, { redirect: 'manual' });
  assert.equal(gone.status, 404);
});

test('lists active sessions and revokes another device', async () => {
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }); // device A

  // Second device logs in; capture its token separately.
  const resB = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    redirect: 'manual',
  });
  const tokenB = (resB.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('dashy_token='))!;

  const { sessions } = await (await api('GET', '/api/auth/sessions')).json();
  assert.ok(sessions.length >= 2);
  assert.equal(sessions.filter((s: { current: boolean }) => s.current).length, 1);

  // Revoke a non-current session from device A.
  const other = sessions.find((s: { current: boolean }) => !s.current);
  const rev = await api('DELETE', `/api/auth/sessions/${other.id}`);
  assert.equal(rev.status, 200);
  assert.equal((await rev.json()).current, false);

  // The revoked device's token is now rejected.
  const checkB = await fetch(baseUrl + '/api/auth/me', {
    headers: { Cookie: tokenB },
    redirect: 'manual',
  });
  assert.equal(checkB.status, 401);
});

test('admin can export and restore a backup', async () => {
  const res = await fetch(baseUrl + '/api/admin/backup', {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /zip/);

  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const manifestEntry = zip.getEntry('manifest.json');
  assert.ok(manifestEntry, 'backup must contain manifest.json');
  const manifest = JSON.parse(zip.readAsText(manifestEntry!));
  assert.ok(Array.isArray(manifest.apps) && manifest.apps.length >= 1);

  const before = (await (await api('GET', '/api/apps')).json()).apps.length;

  const form = new FormData();
  form.set('backup', new Blob([buf], { type: 'application/zip' }), 'backup.zip');
  const restore = await fetch(baseUrl + '/api/admin/restore', {
    method: 'POST',
    headers: { Cookie: cookieHeader() },
    body: form,
  });
  assert.equal(restore.status, 200);
  const { restored } = await restore.json();
  assert.ok(restored >= 1);

  const after = (await (await api('GET', '/api/apps')).json()).apps.length;
  assert.equal(after, before + restored);
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

// ------------------------------- AI assistant --------------------------------

test('new users get assistant access by default', async () => {
  const { users } = await (await api('GET', '/api/users')).json();
  const bob = users.find((u: { email: string }) => u.email === BOB_EMAIL);
  assert.equal(bob.chatEnabled, true);
});

test('chat config is admin-only and never returns the key', async () => {
  const res = await api('GET', '/api/chat/config');
  assert.equal(res.status, 200);
  const { config, providers } = await res.json();
  assert.equal(config.hasApiKey, false);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.apiKeyEnc, undefined);
  assert.ok(providers.includes('claude'));
});

test('assistant cannot be enabled without an API key', async () => {
  const res = await api('PUT', '/api/chat/config', { enabled: true });
  assert.equal(res.status, 400);
});

test('admin can configure the assistant (key stored, not echoed)', async () => {
  const res = await api('PUT', '/api/chat/config', {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test-key',
    enabled: true,
  });
  assert.equal(res.status, 200);
  const { config } = await res.json();
  assert.equal(config.provider, 'openai');
  assert.equal(config.model, 'gpt-test');
  assert.equal(config.enabled, true);
  assert.equal(config.hasApiKey, true);
  assert.equal(config.apiKey, undefined);
});

test('assistant is available to an enabled user', async () => {
  const { available } = await (await api('GET', '/api/chat/status')).json();
  assert.equal(available, true);
});

test('admin can disable the assistant for a specific user', async () => {
  const res = await api('PATCH', `/api/users/${bobId}`, { chatEnabled: false });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.chatEnabled, false);
});

test('a disabled user cannot use the assistant or its config', async () => {
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });

  const { available } = await (await api('GET', '/api/chat/status')).json();
  assert.equal(available, false);

  const chat = await api('POST', '/api/chat', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(chat.status, 403);

  // Config + alert endpoints remain admin-only.
  assert.equal((await api('GET', '/api/chat/config')).status, 403);
  assert.equal((await api('PUT', '/api/chat/config', { enabled: false })).status, 403);
  assert.equal((await api('GET', '/api/chat/alerts')).status, 403);
});

test('assistant misuse alerts are admin-only and start empty', async () => {
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const res = await api('GET', '/api/chat/alerts');
  assert.equal(res.status, 200);
  const { alerts } = await res.json();
  assert.ok(Array.isArray(alerts));
  assert.equal(alerts.length, 0);
});

// ------------------- user history, time-out & notifications ------------------

test('admin can read a user history', async () => {
  const res = await api('GET', `/api/users/${bobId}/history`);
  assert.equal(res.status, 200);
  const h = await res.json();
  assert.equal(typeof h.twoFactorEnabled, 'boolean');
  assert.equal(typeof h.botAlertCount, 'number');
  assert.ok(Array.isArray(h.topApps));
  assert.ok(Array.isArray(h.notifications));
});

test('admin can time out the assistant for a user (and clear it)', async () => {
  // Enable the assistant + ensure Bob's access is on, so the time-out is the
  // only thing gating him.
  await api('PATCH', `/api/users/${bobId}`, { chatEnabled: true });
  await api('PUT', '/api/chat/config', {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test-key',
    enabled: true,
  });

  const set = await api('POST', `/api/users/${bobId}/chat-timeout`, { minutes: 60 });
  assert.equal(set.status, 200);
  assert.ok((await set.json()).chatTimeoutUntil);

  // Bob is now timed out.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });
  assert.equal((await (await api('GET', '/api/chat/status')).json()).available, false);
  assert.equal(
    (await api('POST', '/api/chat', { messages: [{ role: 'user', content: 'hi' }] })).status,
    403,
  );

  // Admin clears it → available again.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const clear = await api('POST', `/api/users/${bobId}/chat-timeout`, { minutes: null });
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).chatTimeoutUntil, null);

  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });
  assert.equal((await (await api('GET', '/api/chat/status')).json()).available, true);

  // Disable the assistant again for a clean state.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await api('PUT', '/api/chat/config', { apiKey: '', enabled: false });
});

let notifId = '';

test('admin sends a dashboard notification; user must acknowledge it', async () => {
  const res = await api('POST', '/api/notifications', { userId: bobId, message: 'Welcome to Dashy!' });
  assert.equal(res.status, 201);
  notifId = (await res.json()).notification.id;

  // Appears in the admin tile, unread.
  const adminList = await (await api('GET', '/api/notifications/admin')).json();
  const mine = adminList.notifications.find((n: { id: string }) => n.id === notifId);
  assert.ok(mine);
  assert.equal(mine.readAt, null);

  // Bob sees it, reads it, then it's gone from his unread list.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });
  const before = await (await api('GET', '/api/notifications')).json();
  assert.ok(before.notifications.some((n: { id: string }) => n.id === notifId));
  assert.equal((await api('POST', `/api/notifications/${notifId}/read`)).status, 200);
  const after = await (await api('GET', '/api/notifications')).json();
  assert.equal(after.notifications.some((n: { id: string }) => n.id === notifId), false);
});

test('notification + history endpoints are admin-only; admin sees the read receipt', async () => {
  // Bob (regular user) is blocked from admin notification + history endpoints.
  assert.equal((await api('GET', '/api/notifications/admin')).status, 403);
  assert.equal((await api('POST', '/api/notifications', { userId: bobId, message: 'x' })).status, 403);
  assert.equal((await api('GET', `/api/users/${bobId}/history`)).status, 403);
  assert.equal((await api('POST', `/api/users/${bobId}/chat-timeout`, { minutes: 15 })).status, 403);

  // Admin now sees the read receipt, then dismisses the notification.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const list = await (await api('GET', '/api/notifications/admin')).json();
  const read = list.notifications.find((n: { id: string }) => n.id === notifId);
  assert.ok(read.readAt, 'notification should show a read timestamp');

  assert.equal((await api('DELETE', `/api/notifications/${notifId}`)).status, 200);
  const after = await (await api('GET', '/api/notifications/admin')).json();
  assert.equal(after.notifications.some((n: { id: string }) => n.id === notifId), false);
});

// ----------------------------- notes & requests ------------------------------

test('personal note is saved, sanitized, and reloads', async () => {
  // (Admin session is active here.)
  const save = await api('PUT', '/api/auth/note', {
    content: '<b onclick="x()">Hi</b><script>alert(1)</script><i>there</i>',
  });
  assert.equal(save.status, 200);
  assert.equal((await save.json()).content, '<b>Hi</b><i>there</i>');

  const get = await api('GET', '/api/auth/note');
  assert.equal((await get.json()).content, '<b>Hi</b><i>there</i>');
});

let reqId = '';

test('user sends a project request; admin sees and resolves it; history is kept', async () => {
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });

  const create = await api('POST', '/api/requests', {
    kind: 'idea',
    message: 'Please add a unit converter',
  });
  assert.equal(create.status, 201);
  reqId = (await create.json()).request.id;

  const mine = await (await api('GET', '/api/requests')).json();
  assert.ok(mine.requests.some((r: { id: string; status: string }) => r.id === reqId));

  // Admin endpoints are off-limits to Bob.
  assert.equal((await api('GET', '/api/requests/admin')).status, 403);
  assert.equal(
    (await api('POST', `/api/requests/${reqId}/status`, { status: 'resolved' })).status,
    403,
  );

  // Admin sees it, resolves it, then dismisses it.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const adminList = await (await api('GET', '/api/requests/admin')).json();
  assert.ok(adminList.requests.some((r: { id: string }) => r.id === reqId));

  assert.equal(
    (await api('POST', `/api/requests/${reqId}/status`, { status: 'resolved' })).status,
    200,
  );
  assert.equal(
    (await api('POST', `/api/requests/${reqId}/status`, { status: 'dismissed' })).status,
    200,
  );
  // Dismissed → gone from the admin list.
  const afterDismiss = await (await api('GET', '/api/requests/admin')).json();
  assert.equal(afterDismiss.requests.some((r: { id: string }) => r.id === reqId), false);

  // …but still in Bob's history, marked dismissed.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });
  const history = await (await api('GET', '/api/requests')).json();
  const kept = history.requests.find((r: { id: string; status: string }) => r.id === reqId);
  assert.ok(kept);
  assert.equal(kept.status, 'dismissed');

  // Restore admin session for the remaining tests.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

test('admin can reply to a request, notifying the requester', async () => {
  // Bob files a fresh request.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });
  const create = await api('POST', '/api/requests', { kind: 'file', message: 'Add my portfolio' });
  const id = (await create.json()).request.id;

  // Admin replies → request resolved + a notification reaches Bob.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // The `all` filter surfaces every status; the default view hides dismissed.
  const all = await (await api('GET', '/api/requests/admin?status=all')).json();
  assert.ok(all.requests.some((r: { id: string }) => r.id === id));

  const reply = await api('POST', `/api/requests/${id}/reply`, {
    message: 'Sounds good — I added it!',
  });
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).request.status, 'resolved');

  // Bob receives the reply as a dashboard notification, carrying the original
  // request text so he knows what it's about.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });
  const notifs = await (await api('GET', '/api/notifications')).json();
  const replyNotif = notifs.notifications.find(
    (n: { message: string }) => n.message === 'Sounds good — I added it!',
  );
  assert.ok(replyNotif);
  assert.equal(replyNotif.requestMessage, 'Add my portfolio');
  await api('POST', `/api/notifications/${replyNotif.id}/read`); // clear it

  // Reply is admin-only.
  assert.equal((await api('POST', `/api/requests/${id}/reply`, { message: 'x' })).status, 403);

  // Admin archives the request → it leaves the default + all views but shows
  // under ?status=archived.
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert.equal((await api('POST', `/api/requests/${id}/archive`, { archived: true })).status, 200);

  const visible = await (await api('GET', '/api/requests/admin?status=all')).json();
  assert.equal(visible.requests.some((r: { id: string }) => r.id === id), false);
  const archived = await (await api('GET', '/api/requests/admin?status=archived')).json();
  assert.ok(archived.requests.some((r: { id: string }) => r.id === id));

  // Unarchive brings it back.
  assert.equal((await api('POST', `/api/requests/${id}/archive`, { archived: false })).status, 200);
  const back = await (await api('GET', '/api/requests/admin?status=all')).json();
  assert.ok(back.requests.some((r: { id: string }) => r.id === id));
});

// ---------------------------------- Store ------------------------------------

test('store endpoints are admin-only', async () => {
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: BOB_EMAIL, password: BOB_PASSWORD });
  assert.equal((await api('GET', '/api/store/catalog')).status, 403);
  assert.equal((await api('GET', '/api/store/config')).status, 403);
  assert.equal((await api('POST', '/api/store/sources', {})).status, 403);

  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

let storeSourceId = '';

test('store: a local source validates manifests and lists valid ones', async () => {
  const catalog = {
    apps: [
      { id: 'demo-tile', name: 'Demo Tile', type: 'tile', version: '1.0.0', author: 'Tester', tile: { url: 'https://example.com/' } },
      { id: 'BAD ID', name: 'Invalid', type: 'tile' },
    ],
  };
  const file = path.join(TMP_DATA, 'catalog.json');
  fs.writeFileSync(file, JSON.stringify(catalog));

  const create = await api('POST', '/api/store/sources', {
    name: 'Local Test',
    type: 'local',
    location: file,
  });
  assert.equal(create.status, 201);
  storeSourceId = (await create.json()).source.id;

  const res = await api('GET', '/api/store/catalog?refresh=1');
  assert.equal(res.status, 200);
  const apps = (await res.json()).apps as { id: string; source: string }[];
  // The valid tile is listed; the malformed one is silently dropped.
  assert.ok(apps.some((a) => a.id === 'demo-tile' && a.source === 'Local Test'));
  assert.equal(apps.some((a) => a.id === 'BAD ID'), false);
});

let installedId = '';

test('store: installing a tile creates a card and tracks it', async () => {
  const res = await api('POST', '/api/store/install', { source: 'Local Test', manifestId: 'demo-tile' });
  assert.equal(res.status, 201);
  const { app } = await res.json();
  assert.equal(app.url, 'https://example.com/');

  // The card now shows in the dashboard app list.
  const apps = (await (await api('GET', '/api/apps')).json()).apps as { id: string; url: string }[];
  assert.ok(apps.some((a) => a.id === app.id && a.url === 'https://example.com/'));

  // …and in the installed list, which the catalog marks as installed.
  const installed = (await (await api('GET', '/api/store/installed')).json()).installed as {
    id: string;
    manifestId: string;
  }[];
  const mine = installed.find((i) => i.manifestId === 'demo-tile');
  assert.ok(mine);
  installedId = mine.id;

  const cat = (await (await api('GET', '/api/store/catalog')).json()).apps as {
    id: string;
    installed: boolean;
  }[];
  assert.equal(cat.find((a) => a.id === 'demo-tile')?.installed, true);
});

test('store: uninstall removes the card; config hides tokens', async () => {
  const del = await api('DELETE', `/api/store/installed/${installedId}`);
  assert.equal(del.status, 200);
  const installed = (await (await api('GET', '/api/store/installed')).json()).installed as unknown[];
  assert.equal(installed.length, 0);

  // Config: drivers always include manual; tokens are never echoed back.
  const cfgRes = await api('PUT', '/api/store/config', {
    coolifyEnabled: true,
    coolifyBaseUrl: 'https://coolify.test',
    coolifyToken: 'super-secret',
    coolifyProjectUuid: 'p',
    coolifyServerUuid: 's',
    coolifyDestinationUuid: 'd',
    wildcardEnabled: true,
    baseDomain: 'apps.test',
  });
  assert.equal(cfgRes.status, 200);
  const { config, drivers } = await cfgRes.json();
  assert.equal(config.coolifyToken, undefined);
  assert.equal(config.hasCoolifyToken, true);
  assert.equal(config.wildcardEnabled, true);
  assert.ok((drivers as { id: string }[]).some((d) => d.id === 'manual'));

  // Clean up the test source.
  await api('DELETE', `/api/store/sources/${storeSourceId}`);
});

let managedId = '';
let managedLocation = '';

test('store: a managed catalogue can be created and edited from the API', async () => {
  // Create a Dashy-owned catalogue (admin gives just a name).
  const create = await api('POST', '/api/store/sources/managed', { name: 'My Catalogue' });
  assert.equal(create.status, 201);
  const src = (await create.json()).source as { id: string; managed: boolean; type: string; location: string };
  assert.equal(src.managed, true);
  assert.equal(src.type, 'local');
  managedId = src.id;
  managedLocation = src.location;
  // The backing file was created under DATA_DIR/catalogs.
  assert.ok(managedLocation.includes('catalogs'));
  assert.equal(fs.existsSync(managedLocation), true);

  // Add a valid tile app; it shows up in the merged catalogue.
  const add = await api('POST', `/api/store/sources/${managedId}/apps`, {
    id: 'welcome-demo',
    name: 'Welcome Demo',
    type: 'tile',
    version: '1.0.0',
    tile: { url: 'https://example.com/' },
  });
  assert.equal(add.status, 201);
  let cat = (await (await api('GET', '/api/store/catalog?refresh=1')).json()).apps as {
    id: string; source: string; version: string;
  }[];
  assert.ok(cat.some((a) => a.id === 'welcome-demo' && a.source === 'My Catalogue'));

  // An invalid manifest is rejected with 422.
  const bad = await api('POST', `/api/store/sources/${managedId}/apps`, {
    id: 'BAD ID',
    name: 'Nope',
    type: 'tile',
    tile: { url: 'not-a-url' },
  });
  assert.equal(bad.status, 422);

  // Editing the app bumps its version in the catalogue.
  const edit = await api('PATCH', `/api/store/sources/${managedId}/apps/welcome-demo`, {
    id: 'welcome-demo',
    name: 'Welcome Demo',
    type: 'tile',
    version: '2.0.0',
    tile: { url: 'https://example.com/' },
  });
  assert.equal(edit.status, 200);
  cat = (await (await api('GET', '/api/store/catalog?refresh=1')).json()).apps as {
    id: string; version: string;
  }[];
  assert.equal(cat.find((a) => a.id === 'welcome-demo')?.version, '2.0.0');

  // Removing the app drops it from the catalogue.
  const del = await api('DELETE', `/api/store/sources/${managedId}/apps/welcome-demo`);
  assert.equal(del.status, 200);
  cat = (await (await api('GET', '/api/store/catalog?refresh=1')).json()).apps as { id: string }[];
  assert.equal(cat.some((a) => a.id === 'welcome-demo'), false);
});

test('store: app editing is rejected on read-only sources; managed delete cleans the file', async () => {
  // A remote (non-managed) source cannot be edited via the app endpoints.
  const remote = await api('POST', '/api/store/sources', {
    name: 'Remote Guard',
    type: 'remote',
    location: 'https://example.com/catalog.json',
  });
  const remoteId = (await remote.json()).source.id;
  const guard = await api('POST', `/api/store/sources/${remoteId}/apps`, {
    id: 'x', name: 'X', type: 'tile', version: '1.0.0', tile: { url: 'https://example.com/' },
  });
  assert.equal(guard.status, 400);
  await api('DELETE', `/api/store/sources/${remoteId}`);

  // Deleting the managed source removes its backing file too.
  const del = await api('DELETE', `/api/store/sources/${managedId}`);
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(managedLocation), false);
});

test('assistant config is cleaned up + bob re-enabled', async () => {
  await api('POST', '/api/auth/logout');
  cookies.clear();
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await api('PATCH', `/api/users/${bobId}`, { chatEnabled: true });
  const res = await api('PUT', '/api/chat/config', { apiKey: '', enabled: false });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).config.hasApiKey, false);
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
  // Regular users cannot create public share links.
  assert.equal(
    (await api('POST', `/api/apps/${appId}/share`, { password: '', expiresInDays: null })).status,
    403,
  );
  // Regular users cannot export backups.
  assert.equal((await api('GET', '/api/admin/backup')).status, 403);

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
