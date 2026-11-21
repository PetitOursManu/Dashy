import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

/**
 * "Admin in Kosmy Board" (kosmy.board-admin.v1) — Dashy's side.
 *
 * A fake Kosmy Board (discovery + JWKS) runs in-process; the tests play the
 * Board's server: they sign one-request admin tokens with the Board's key and
 * call /api/kosmy-board/admin like the Board does.
 */

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-kosmy-admin-'));
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'SuperSecret!2026';
const APP_ORIGIN = 'http://dashy.test';
const CLIENT_ID = 'kb-dashy-admin-test';
const CLIENT_SECRET = 'board client secret';
const ADMIN_SUB = 'board-sub-admin';
const MEMBER_SUB = 'board-sub-member';
const ADMIN_PATH = '/api/kosmy-board/admin';

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let disconnectDb: () => Promise<void>;
let User: typeof import('../src/models/User.js').User;
let Activity: typeof import('../src/models/Activity.js').Activity;

/* --------------------------- fake Kosmy Board ------------------------------ */

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'board-key-1';
let board: Server;
let ISSUER = '';

function startBoard(): Promise<void> {
  board = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', ISSUER);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/oidc/.well-known/openid-configuration') {
      return json(200, {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (url.pathname === '/oidc/jwks') {
      const jwk = publicKey.export({ format: 'jwk' });
      return json(200, { keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] });
    }
    json(404, { error: 'not_found' });
  });
  return new Promise((resolve) => {
    board.listen(0, '127.0.0.1', () => {
      const { port } = board.address() as AddressInfo;
      ISSUER = `http://127.0.0.1:${port}/oidc`;
      resolve();
    });
  });
}

interface TokenOptions {
  method?: string;
  path?: string;
  sub?: string;
  claims?: Record<string, unknown>;
  typ?: string;
  key?: crypto.KeyObject;
}

/** What the Board's server signs for one request. */
function adminToken(o: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: o.sub ?? ADMIN_SUB,
      iat: now,
      exp: now + 60,
      jti: crypto.randomUUID(),
      htm: o.method ?? 'GET',
      htu: `${APP_ORIGIN}${o.path ?? ADMIN_PATH}`,
      name: 'Board person',
      email: 'person@example.com',
      ...o.claims,
    },
    o.key ?? privateKey,
    { algorithm: 'RS256', keyid: KID, header: { alg: 'RS256', typ: o.typ ?? 'kb-admin+jwt' } },
  );
}

/** Call Dashy as the Board's server does. */
async function call(
  method: string,
  pathname: string,
  opts: { token?: string | null; body?: unknown; lang?: string } = {},
): Promise<Response> {
  const token = opts.token === undefined ? adminToken({ method, path: pathname }) : opts.token;
  return fetch(baseUrl + pathname, {
    method,
    headers: {
      Accept: 'application/json',
      'Accept-Language': opts.lang ?? 'en',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
}

async function expectError(res: Response, status: number, error: string): Promise<{ message?: string }> {
  assert.equal(res.status, status);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  const body = (await res.json()) as { error: string; message?: string };
  assert.equal(body.error, error);
  return body;
}

/* --------------------------------- setup ----------------------------------- */

before(async () => {
  mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongo.getUri('dashy_kosmy_admin_test');
  process.env.JWT_SECRET = 'test-jwt-secret-which-is-long-enough';
  process.env.ENCRYPTION_KEY = 'e'.repeat(64);
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.ALLOW_REGISTRATION = 'false';
  process.env.DATA_DIR = TMP_DATA;
  process.env.APP_ORIGIN = APP_ORIGIN;
  process.env.PORT = '3000';

  const { connectDb, disconnectDb: dd } = await import('../src/config/db.js');
  const { ensureDataDirs } = await import('../src/config/paths.js');
  const { seedAdmin } = await import('../src/services/seed.js');
  const { createApp } = await import('../src/app.js');
  ({ User } = await import('../src/models/User.js'));
  ({ Activity } = await import('../src/models/Activity.js'));
  disconnectDb = dd;

  ensureDataDirs();
  await connectDb();
  await seedAdmin();
  await User.syncIndexes();
  await startBoard();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => board.close(() => resolve()));
  await disconnectDb();
  await mongo.stop();
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** Sign in to Dashy with a password; returns the session cookie header. */
async function login(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) return null;
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

/* --------------------------------- tests ----------------------------------- */

describe('admin in Kosmy Board', () => {
  test('refused until Kosmy Board sign-in is configured', async () => {
    const body = await expectError(await call('GET', ADMIN_PATH), 401, 'invalid_token');
    assert.ok(body.message, 'a readable message');
  });

  test('setup: configure the sign-in and link accounts', async () => {
    const cookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.ok(cookie);
    const res = await fetch(`${baseUrl}/api/admin/kosmy-board`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    });
    assert.equal(res.status, 200);
    await User.updateOne({ email: ADMIN_EMAIL }, { $set: { kosmySub: ADMIN_SUB } });
    const argon2 = (await import('argon2')).default;
    await User.create({
      email: 'member@example.com',
      passwordHash: await argon2.hash('Member!2026', { type: argon2.argon2id }),
      role: 'user',
      kosmySub: MEMBER_SUB,
    });
  });

  test('a valid token gets the manifest (JSON, no-store, no CORS)', async () => {
    const res = await call('GET', ADMIN_PATH);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json; charset=utf-8/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    const body = await res.json();
    assert.equal(body.protocol, 'kosmy.board-admin.v1');
    assert.equal(body.app.name, 'Dashy');
    assert.equal(body.user.role, 'Administrator');
    const ids = body.sections.map((s: { id: string }) => s.id);
    assert.deepEqual(ids.slice(0, 3), ['overview', 'users', 'apps']);
    assert.ok(ids.length >= 1 && ids.length <= 20);
    for (const id of ids) assert.match(id, /^[a-z0-9-]{1,40}$/);
  });

  test('French when the Board asks for it', async () => {
    const body = await (await call('GET', ADMIN_PATH, { lang: 'fr' })).json();
    assert.equal(body.sections[0].title, "Vue d'ensemble");
    assert.equal(body.user.role, 'Administrateur');
  });

  test('no token, or not a Bearer token', async () => {
    await expectError(await call('GET', ADMIN_PATH, { token: null }), 401, 'invalid_token');
    const res = await fetch(baseUrl + ADMIN_PATH, { headers: { Authorization: 'Basic abc' } });
    await expectError(res, 401, 'invalid_token');
  });

  test('an ID token (typ JWT) is never accepted', async () => {
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt.sign(
      { iss: ISSUER, aud: CLIENT_ID, sub: ADMIN_SUB, iat: now, exp: now + 300, nonce: 'n' },
      privateKey,
      { algorithm: 'RS256', keyid: KID },
    );
    await expectError(await call('GET', ADMIN_PATH, { token: idToken }), 401, 'invalid_token');
    // Even with the request binding claims, the header typ decides.
    const typJwt = adminToken({ typ: 'JWT' });
    await expectError(await call('GET', ADMIN_PATH, { token: typJwt }), 401, 'invalid_token');
  });

  test('wrong audience, issuer, signing key or expired token', async () => {
    for (const token of [
      adminToken({ claims: { aud: 'another-client' } }),
      adminToken({ claims: { iss: 'https://evil.example.com/oidc' } }),
      adminToken({ key: other.privateKey }),
      adminToken({ claims: { iat: Math.floor(Date.now() / 1000) - 200, exp: Math.floor(Date.now() / 1000) - 100 } }),
    ]) {
      await expectError(await call('GET', ADMIN_PATH, { token }), 401, 'invalid_token');
    }
  });

  test('an HS256 token is refused', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { iss: ISSUER, aud: CLIENT_ID, sub: ADMIN_SUB, iat: now, exp: now + 60, jti: 'x', htm: 'GET', htu: APP_ORIGIN + ADMIN_PATH },
      'secret',
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'kb-admin+jwt' } },
    );
    await expectError(await call('GET', ADMIN_PATH, { token }), 401, 'invalid_token');
  });

  test('a token works once (jti)', async () => {
    const token = adminToken();
    assert.equal((await call('GET', ADMIN_PATH, { token })).status, 200);
    await expectError(await call('GET', ADMIN_PATH, { token }), 401, 'invalid_token');
  });

  test('a token is bound to its method (htm) and path (htu)', async () => {
    const forPost = adminToken({ method: 'POST', path: `${ADMIN_PATH}/users` });
    await expectError(await call('GET', `${ADMIN_PATH}/users`, { token: forPost }), 401, 'invalid_token');
    const forUsers = adminToken({ path: `${ADMIN_PATH}/users` });
    await expectError(await call('GET', `${ADMIN_PATH}/settings`, { token: forUsers }), 401, 'invalid_token');
    const forManifest = adminToken({ path: ADMIN_PATH });
    await expectError(await call('GET', `${ADMIN_PATH}/users`, { token: forManifest }), 401, 'invalid_token');
    // A reverse-proxy prefix in htu is fine: only the end of the path must match.
    const prefixed = adminToken({ claims: { htu: `https://dashy.example.com/apps${ADMIN_PATH}/users` }, path: '' });
    assert.equal((await call('GET', `${ADMIN_PATH}/users`, { token: prefixed })).status, 200);
  });

  test('not_linked: the Board account is not linked to a Dashy account', async () => {
    const token = adminToken({ sub: 'nobody-knows-me' });
    const body = await expectError(await call('GET', ADMIN_PATH, { token }), 403, 'not_linked');
    assert.ok(body.message && body.message.length > 10);
  });

  test('forbidden: linked, but not a Dashy administrator', async () => {
    const token = adminToken({ sub: MEMBER_SUB });
    const body = await expectError(await call('GET', ADMIN_PATH, { token }), 403, 'forbidden');
    assert.ok(body.message);
  });

  test('every section answers, without secrets', async () => {
    const { sections } = await (await call('GET', ADMIN_PATH)).json();
    for (const { id } of sections as { id: string }[]) {
      const res = await call('GET', `${ADMIN_PATH}/${id}`);
      assert.equal(res.status, 200, id);
      const text = await res.text();
      assert.ok(!text.includes(CLIENT_SECRET), `${id}: no client secret`);
      assert.ok(!/passwordHash|apiKeyEnc|TokenEnc|KeyEnc|clientSecretEnc/.test(text), `${id}: no secret fields`);
      const section = JSON.parse(text);
      assert.equal(section.id, id);
      assert.ok(Array.isArray(section.blocks) && section.blocks.length <= 30, id);
    }
  });

  test('the users section lists the accounts', async () => {
    const res = await call('GET', `${ADMIN_PATH}/users`, { lang: 'fr' });
    assert.equal(res.status, 200);
    const section = await res.json();
    assert.equal(section.title, 'Utilisateurs');
    const table = section.blocks.find((b: { type: string }) => b.type === 'table');
    const emails = table.rows.map((r: { cells: { email: string } }) => r.cells.email);
    assert.ok(emails.includes(ADMIN_EMAIL) && emails.includes('member@example.com'));
    const self = table.rows.find((r: { cells: { email: string } }) => r.cells.email === ADMIN_EMAIL);
    assert.ok(!self.actions.includes('delete'), 'no deleting yourself');
    const member = table.rows.find((r: { cells: { email: string } }) => r.cells.email === 'member@example.com');
    assert.ok(member.actions.includes('delete'));
    for (const r of table.rows) {
      for (const a of r.actions) assert.ok(table.rowActions.some((d: { id: string }) => d.id === a), a);
    }
  });

  test('an action runs Dashy\'s own handler: create an account', async () => {
    const res = await call('POST', `${ADMIN_PATH}/users`, {
      body: { action: 'create', values: { email: 'new@example.com', role: 'user', chatEnabled: true } },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.message);
    assert.ok(body.reveal?.value && body.reveal.value.length >= 8, 'the password is revealed once');
    assert.equal(body.section.id, 'users');
    const rows = body.section.blocks.find((b: { type: string }) => b.type === 'table').rows;
    assert.ok(rows.some((r: { cells: { email: string } }) => r.cells.email === 'new@example.com'));

    // The effect is real: the new account signs in with the revealed password…
    assert.ok(await login('new@example.com', body.reveal.value));
    // …and it went through the same activity log as Dashy's admin.
    const logged = await Activity.findOne({ type: 'user.created', message: /new@example\.com/ });
    assert.equal(logged?.actorEmail, ADMIN_EMAIL);
  });

  test('a row action: change a role, with Dashy\'s rules', async () => {
    const member = await User.findOne({ email: 'member@example.com' });
    const res = await call('POST', `${ADMIN_PATH}/users`, {
      body: { action: 'make-subadmin', row: String(member!._id) },
    });
    assert.equal(res.status, 200);
    assert.equal((await User.findById(member!._id))!.role, 'subadmin');

    // Back to a regular user, so the "forbidden" case above stays true.
    await call('POST', `${ADMIN_PATH}/users`, { body: { action: 'make-user', row: String(member!._id) } });
    assert.equal((await User.findById(member!._id))!.role, 'user');
  });

  test('refused actions answer with a readable message', async () => {
    const admin = await User.findOne({ email: ADMIN_EMAIL });
    // Not offered for your own row (Dashy refuses deleting yourself too).
    const self = await expectError(
      await call('POST', `${ADMIN_PATH}/users`, { body: { action: 'delete', row: String(admin!._id) } }),
      409,
      'not_available',
    );
    assert.ok(self.message);
    // Dashy's validation, translated.
    const bad = await expectError(
      await call('POST', `${ADMIN_PATH}/users`, {
        body: { action: 'create', values: { email: 'not-an-email', role: 'user' } },
        lang: 'fr',
      }),
      422,
      'invalid',
    );
    assert.match(bad.message ?? '', /Saisie refusée/);
    // Dashy's own rule: one account per email.
    const dup = await expectError(
      await call('POST', `${ADMIN_PATH}/users`, {
        body: { action: 'create', values: { email: ADMIN_EMAIL, role: 'user' } },
        lang: 'fr',
      }),
      409,
      'conflict',
    );
    assert.equal(dup.message, 'Un compte existe déjà avec cet e-mail.');
    await expectError(
      await call('POST', `${ADMIN_PATH}/users`, { body: { action: 'nope', row: String(admin!._id) } }),
      404,
      'not_found',
    );
    await expectError(await call('POST', `${ADMIN_PATH}/users`, { body: { values: {} } }), 400, 'invalid');
  });

  test('settings: secrets are write-only', async () => {
    const res = await call('POST', `${ADMIN_PATH}/assistant`, {
      body: {
        action: 'save-assistant',
        values: { enabled: false, provider: 'openai', model: '', apiKey: 'sk-very-secret-key' },
      },
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('sk-very-secret-key'));
    const form = JSON.parse(text).section.blocks.find((b: { type: string }) => b.type === 'form');
    const key = form.fields.find((f: { name: string }) => f.name === 'apiKey');
    assert.equal(key.type, 'password');
    assert.equal(key.value, undefined);
    assert.equal(key.placeholder, 'Unchanged');
  });

  test('never the SPA, never another route', async () => {
    await expectError(await call('GET', `${ADMIN_PATH}/unknown-section`), 404, 'not_found');
    await expectError(await call('GET', `${ADMIN_PATH}/Users`), 404, 'not_found');
    await expectError(await call('GET', `${ADMIN_PATH}/users/extra`), 404, 'not_found');
    await expectError(await call('DELETE', `${ADMIN_PATH}/users`), 405, 'method_not_allowed');
    // A CORS preflight gets no CORS headers (no browser may call this API).
    const pre = await fetch(baseUrl + ADMIN_PATH, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
    assert.notEqual(pre.status, 204);
  });

  test('a Dashy session cookie is not an admin token', async () => {
    const cookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await fetch(baseUrl + ADMIN_PATH, { headers: { Cookie: cookie! } });
    await expectError(res, 401, 'invalid_token');
    const session = cookie!.split('=').slice(1).join('=');
    const bearer = await fetch(baseUrl + ADMIN_PATH, { headers: { Authorization: `Bearer ${session}` } });
    await expectError(bearer, 401, 'invalid_token');
  });
});
