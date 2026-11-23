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
 * "Users managed by the Board" (kosmy.board-users.v1) — Dashy's side.
 *
 * A fake Kosmy Board (discovery, token endpoint, JWKS) runs in-process; the
 * tests play the Board's server (one-request `kb-admin+jwt` tokens on
 * /api/kosmy-board/users) and the browser (sign-in with the
 * `kosmy_board_access` claim).
 */

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-kosmy-users-'));
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'SuperSecret!2026';
const APP_ORIGIN = 'http://dashy.test';
const CLIENT_ID = 'kb-dashy-users-test';
const CLIENT_SECRET = 'board client secret';
const ADMIN_SUB = '0b6e1c1e-0000-4a8e-9d55-00000000a001';
const MEMBER_SUB = '0b6e1c1e-0000-4a8e-9d55-00000000b001';
const USERS_PATH = '/api/kosmy-board/users';

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let disconnectDb: () => Promise<void>;
let User: typeof import('../src/models/User.js').User;
let HostedApp: typeof import('../src/models/HostedApp.js').HostedApp;
let oidc: typeof import('../src/services/kosmyBoard/oidc.js');
let appA = '';
let appB = '';

/* --------------------------- fake Kosmy Board ------------------------------ */

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'board-key-1';
let board: Server;
let ISSUER = '';

interface PendingCode {
  nonce: string;
  challenge: string;
  claims: Record<string, unknown>;
}
const codes = new Map<string, PendingCode>();

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
    if (url.pathname === '/oidc/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.headers.authorization !== oidc.basicAuthHeader(CLIENT_ID, CLIENT_SECRET)) {
          return json(401, { error: 'invalid_client' });
        }
        const form = new URLSearchParams(raw);
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (!pending || oidc.codeChallenge(form.get('code_verifier') ?? '') !== pending.challenge) {
          return json(400, { error: 'invalid_grant' });
        }
        const now = Math.floor(Date.now() / 1000);
        const id_token = jwt.sign(
          { iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 300, nonce: pending.nonce, ...pending.claims },
          privateKey,
          { algorithm: 'RS256', keyid: KID },
        );
        json(200, { access_token: 'at', token_type: 'Bearer', id_token });
      });
      return;
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
}

/** What the Board's server signs for one request. */
function boardToken(o: TokenOptions = {}): string {
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
      htu: `${APP_ORIGIN}${o.path ?? USERS_PATH}`,
      ...o.claims,
    },
    privateKey,
    { algorithm: 'RS256', keyid: KID, header: { alg: 'RS256', typ: o.typ ?? 'kb-admin+jwt' } },
  );
}

/** Call Dashy as the Board's server does. */
async function call(
  method: string,
  pathname: string,
  opts: { token?: string | null; body?: unknown; lang?: string; as?: string } = {},
): Promise<Response> {
  const token =
    opts.token === undefined ? boardToken({ method, path: pathname, sub: opts.as }) : opts.token;
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

const put = (sub: string, body: unknown, opts: { lang?: string; as?: string } = {}) =>
  call('PUT', `${USERS_PATH}/${sub}`, { body, ...opts });
const del = (sub: string, opts: { lang?: string; as?: string } = {}) =>
  call('DELETE', `${USERS_PATH}/${sub}`, opts);

async function expectError(res: Response, status: number, error: string): Promise<{ message?: string }> {
  assert.equal(res.status, status);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  const body = (await res.json()) as { error: string; message?: string };
  assert.equal(body.error, error);
  return body;
}

/* ------------------------------ browser side ------------------------------- */

/** Password sign-in; returns the session cookie, or the failing status. */
async function passwordLogin(email: string, password: string): Promise<{ status: number; cookie: string }> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, cookie };
}

async function me(cookie: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
}

/** A whole Board sign-in up to the callback; returns it and the cookies it set. */
async function signInWithBoard(claims: Record<string, unknown>) {
  const jar = new Map<string, string>();
  const absorb = (res: Response) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      const value = pair.slice(eq + 1).trim();
      if (value) jar.set(pair.slice(0, eq).trim(), value);
      else jar.delete(pair.slice(0, eq).trim());
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const start = await fetch(`${baseUrl}/auth/kosmy-board/login`, { redirect: 'manual' });
  absorb(start);
  const u = new URL(start.headers.get('location')!);
  const code = crypto.randomBytes(16).toString('hex');
  codes.set(code, {
    nonce: u.searchParams.get('nonce')!,
    challenge: u.searchParams.get('code_challenge')!,
    claims,
  });
  const cb = await fetch(
    `${baseUrl}/auth/kosmy-board/callback?code=${code}&state=${u.searchParams.get('state')}&iss=${encodeURIComponent(ISSUER)}`,
    { headers: { Cookie: cookieHeader() }, redirect: 'manual' },
  );
  absorb(cb);
  return { cb, cookie: jar.has('dashy_token') ? `dashy_token=${jar.get('dashy_token')}` : '' };
}

/* --------------------------------- setup ----------------------------------- */

before(async () => {
  mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongo.getUri('dashy_kosmy_users_test');
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
  ({ HostedApp } = await import('../src/models/HostedApp.js'));
  oidc = await import('../src/services/kosmyBoard/oidc.js');
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

/* --------------------------------- tests ----------------------------------- */

describe('users managed by Kosmy Board', () => {
  test('refused until Kosmy Board sign-in is configured', async () => {
    await expectError(await call('GET', USERS_PATH), 401, 'invalid_token');
  });

  test('setup: configure the sign-in, link the admin, add apps and accounts', async () => {
    const { cookie } = await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await fetch(`${baseUrl}/api/admin/kosmy-board`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    });
    assert.equal(res.status, 200);
    const admin = await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { $set: { kosmySub: ADMIN_SUB } });
    const argon2 = (await import('argon2')).default;
    // A linked regular user (not an administrator).
    await User.create({
      email: 'member@example.com',
      passwordHash: await argon2.hash('Member!2026', { type: argon2.argon2id }),
      role: 'user',
      kosmySub: MEMBER_SUB,
    });
    // An existing Dashy account, not linked to the Board.
    await User.create({
      email: 'existing@example.com',
      passwordHash: await argon2.hash('Existing!2026', { type: argon2.argon2id }),
      role: 'user',
      fullName: 'Existing Person',
    });
    appA = String((await HostedApp.create({ name: 'Alpha', slug: 'alpha', owner: admin!._id }))._id);
    appB = String((await HostedApp.create({ name: 'Beta', slug: 'beta', owner: admin!._id }))._id);
  });

  test('GET: roles, restrictions and linked accounts (JSON, no-store, no CORS)', async () => {
    const res = await call('GET', USERS_PATH);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json; charset=utf-8/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const body = await res.json();
    assert.equal(body.protocol, 'kosmy.board-users.v1');
    assert.deepEqual(
      body.roles.map((r: { value: string }) => r.value),
      ['admin', 'subadmin', 'user'],
    );
    assert.equal(body.roles[0].admin, true);
    assert.equal(body.roles[1].admin, undefined, 'a semi-admin is not an administrator');
    for (const r of body.roles) {
      assert.match(r.value, /^[a-z0-9_-]{1,40}$/);
      assert.ok(r.label.length <= 60 && r.description.length <= 200);
    }
    assert.equal(body.defaultRole, 'user');

    const names = body.fields.map((f: { name: string }) => f.name);
    assert.deepEqual(names, ['chatEnabled', `app_${appA}`, `app_${appB}`]);
    assert.ok(body.fields.every((f: { type: string }) => f.type === 'checkbox'));
    assert.equal(body.fields[0].value, true);
    assert.equal(body.fields[0].roles, undefined, 'the assistant applies to every role');
    assert.deepEqual(body.fields[1].roles, ['user'], 'staff see every app');
    assert.equal(body.fields[1].label, 'App: Alpha');

    const admin = body.users.find((u: { sub: string }) => u.sub === ADMIN_SUB);
    assert.deepEqual(admin, {
      sub: ADMIN_SUB,
      role: 'admin',
      values: { chatEnabled: true, [`app_${appA}`]: false, [`app_${appB}`]: false },
      active: true,
      account: ADMIN_EMAIL,
    });
    assert.ok(body.users.some((u: { sub: string }) => u.sub === MEMBER_SUB));
    assert.ok(!body.users.some((u: { account: string }) => u.account === 'existing@example.com'), 'linked only');
    assert.doesNotMatch(JSON.stringify(body), /passwordHash|\$argon2/);
  });

  test('GET in French', async () => {
    const body = await (await call('GET', USERS_PATH, { lang: 'fr' })).json();
    assert.equal(body.roles[0].label, 'Administrateur');
    assert.equal(body.fields[0].label, 'Assistant IA');
    assert.equal(body.fields[1].label, 'Appli : Alpha');
  });

  test('the token: required, typ, single use, bound to method (htm) and path (htu)', async () => {
    await expectError(await call('GET', USERS_PATH, { token: null }), 401, 'invalid_token');
    await expectError(await call('GET', USERS_PATH, { token: boardToken({ typ: 'JWT' }) }), 401, 'invalid_token');

    const once = boardToken();
    assert.equal((await call('GET', USERS_PATH, { token: once })).status, 200);
    await expectError(await call('GET', USERS_PATH, { token: once }), 401, 'invalid_token');

    const target = `${USERS_PATH}/${MEMBER_SUB}`;
    const forGet = boardToken({ method: 'GET', path: target });
    await expectError(await call('PUT', target, { token: forGet, body: { role: 'user' } }), 401, 'invalid_token');
    const forPut = boardToken({ method: 'PUT', path: target });
    await expectError(await call('DELETE', target, { token: forPut }), 401, 'invalid_token');
    const forList = boardToken({ method: 'DELETE', path: USERS_PATH });
    await expectError(await call('DELETE', target, { token: forList }), 401, 'invalid_token');
    const forOther = boardToken({ method: 'DELETE', path: `${USERS_PATH}/someone-else` });
    await expectError(await call('DELETE', target, { token: forOther }), 401, 'invalid_token');
    const forAdminApi = boardToken({ path: '/api/kosmy-board/admin' });
    await expectError(await call('GET', USERS_PATH, { token: forAdminApi }), 401, 'invalid_token');
    // An ID token is never accepted.
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt.sign(
      { iss: ISSUER, aud: CLIENT_ID, sub: ADMIN_SUB, iat: now, exp: now + 300, nonce: 'n' },
      privateKey,
      { algorithm: 'RS256', keyid: KID },
    );
    await expectError(await call('GET', USERS_PATH, { token: idToken }), 401, 'invalid_token');
  });

  test('the person who acts must be a linked Dashy administrator', async () => {
    const nobody = await expectError(await call('GET', USERS_PATH, { as: 'nobody-knows-me' }), 403, 'not_linked');
    assert.ok(nobody.message);
    const member = await expectError(await call('GET', USERS_PATH, { as: MEMBER_SUB }), 403, 'forbidden');
    assert.match(member.message ?? '', /administrator/);
    await expectError(await put('aaaa-new', { role: 'admin', email: 'x@example.com' }, { as: MEMBER_SUB }), 403, 'forbidden');
  });

  test('unknown address, other method', async () => {
    await expectError(await put('not_a_valid_sub', { role: 'user' }), 404, 'not_found');
    await expectError(await call('POST', USERS_PATH), 405, 'method_not_allowed');
    await expectError(await call('GET', `${USERS_PATH}/${MEMBER_SUB}`), 405, 'method_not_allowed');
  });

  const NEW_SUB = '5b6e1c1e-1111-4a8e-9d55-000000000001';

  test('PUT creates a password-less account linked to the sub', async () => {
    const res = await put(
      NEW_SUB,
      {
        name: 'Alice Martin',
        email: 'Alice@Example.com',
        locale: 'fr',
        role: 'user',
        values: { chatEnabled: false, [`app_${appA}`]: true },
      },
      { lang: 'fr' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(body, { ok: true, status: 'created', account: 'alice@example.com', message: 'Compte Dashy créé.' });

    const u = await User.findOne({ kosmySub: NEW_SUB });
    assert.ok(u);
    assert.equal(u.email, 'alice@example.com');
    assert.equal(u.fullName, 'Alice Martin');
    assert.equal(u.language, 'fr');
    assert.equal(u.role, 'user');
    assert.equal(u.chatEnabled, false);
    assert.deepEqual(u.allowedApps.map(String), [appA]);
    assert.equal(u.disabled, false);
    // No usable password: no password can sign in.
    assert.equal((await passwordLogin('alice@example.com', 'Alice Martin')).status, 401);
  });

  test('PUT is idempotent; a missing field keeps its value', async () => {
    const same = {
      name: 'Alice Martin',
      email: 'alice@example.com',
      role: 'user',
      values: { chatEnabled: false, [`app_${appA}`]: true },
    };
    const r1 = await (await put(NEW_SUB, same)).json();
    assert.equal(r1.status, 'updated');
    const r2 = await (await put(NEW_SUB, same)).json();
    assert.equal(r2.status, 'updated');
    assert.equal(await User.countDocuments({ email: 'alice@example.com' }), 1);

    // Only app B sent: app A and the assistant keep their values.
    await put(NEW_SUB, { role: 'user', values: { [`app_${appB}`]: true } });
    let u = await User.findOne({ kosmySub: NEW_SUB });
    assert.deepEqual(u!.allowedApps.map(String).sort(), [appA, appB].sort());
    assert.equal(u!.chatEnabled, false);

    // An app deleted since (unknown id) is ignored; app A removed.
    await put(NEW_SUB, {
      role: 'user',
      values: { [`app_${appA}`]: false, app_0123456789abcdef01234567: true, notAField: 3 },
    });
    u = await User.findOne({ kosmySub: NEW_SUB });
    assert.deepEqual(u!.allowedApps.map(String), [appB]);

    const list = await (await call('GET', USERS_PATH)).json();
    const row = list.users.find((x: { sub: string }) => x.sub === NEW_SUB);
    assert.deepEqual(row, {
      sub: NEW_SUB,
      role: 'user',
      values: { chatEnabled: false, [`app_${appA}`]: false, [`app_${appB}`]: true },
      active: true,
      account: 'alice@example.com',
    });
  });

  test('PUT updates the role, the name and the email', async () => {
    const res = await put(NEW_SUB, { name: 'Alice M.', email: 'alice.m@example.com', role: 'subadmin' });
    assert.equal((await res.json()).status, 'updated');
    const u = await User.findOne({ kosmySub: NEW_SUB });
    assert.equal(u!.role, 'subadmin');
    assert.equal(u!.fullName, 'Alice M.');
    assert.equal(u!.email, 'alice.m@example.com');
    assert.equal(u!.chatEnabled, false, 'unchanged');
  });

  test('PUT links an existing unlinked account by its email', async () => {
    const res = await put('5b6e1c1e-2222-4a8e-9d55-000000000002', {
      name: 'Existing P.',
      email: 'existing@example.com',
      role: 'user',
      values: { [`app_${appA}`]: true },
    });
    const body = await res.json();
    assert.equal(body.status, 'linked');
    assert.equal(body.account, 'existing@example.com');
    const u = await User.findOne({ email: 'existing@example.com' });
    assert.equal(u!.kosmySub, '5b6e1c1e-2222-4a8e-9d55-000000000002');
    assert.deepEqual(u!.allowedApps.map(String), [appA]);
    // Its own password still works.
    assert.equal((await passwordLogin('existing@example.com', 'Existing!2026')).status, 200);
  });

  test('PUT: an email linked to another Board account is a conflict (409)', async () => {
    const body = await expectError(
      await put('5b6e1c1e-3333-4a8e-9d55-000000000003', { email: 'member@example.com', role: 'user' }),
      409,
      'conflict',
    );
    assert.match(body.message ?? '', /another Kosmy Board account/);
    const fr = await expectError(
      await put('5b6e1c1e-3333-4a8e-9d55-000000000003', { email: 'member@example.com', role: 'user' }, { lang: 'fr' }),
      409,
      'conflict',
    );
    assert.match(fr.message ?? '', /déjà relié/);
    // Changing a linked account's email to one already used.
    await expectError(await put(NEW_SUB, { email: 'existing@example.com', role: 'subadmin' }), 409, 'conflict');
    assert.equal(await User.countDocuments({ kosmySub: '5b6e1c1e-3333-4a8e-9d55-000000000003' }), 0);
  });

  test('PUT: invalid values are refused (422) with a message', async () => {
    const S = '5b6e1c1e-4444-4a8e-9d55-000000000004';
    const ok = { email: 'new4@example.com', role: 'user' };
    for (const body of [
      { ...ok, role: 'superuser' },
      { ...ok, role: 'temp' },
      { email: 'new4@example.com' },
      { ...ok, values: { chatEnabled: 'yes' } },
      { ...ok, values: { [`app_${appA}`]: 1 } },
      { ...ok, values: [true] },
      { ...ok, email: 'not an email' },
      { role: 'user', name: 'No Email' },
    ]) {
      const err = await expectError(await put(S, body), 422, 'invalid');
      assert.ok(err.message, JSON.stringify(body));
    }
    const fr = await expectError(await put(S, { ...ok, values: { chatEnabled: 'oui' } }, { lang: 'fr' }), 422, 'invalid');
    assert.equal(fr.message, 'Assistant IA : oui ou non.');
    await expectError(await put(S, [ok]), 400, 'invalid');
    assert.equal(await User.countDocuments({ email: 'new4@example.com' }), 0);
  });

  test('guards: no self-demotion, no self-removal', async () => {
    const demote = await expectError(await put(ADMIN_SUB, { role: 'user', email: ADMIN_EMAIL }), 409, 'conflict');
    assert.match(demote.message ?? '', /your own administrator rights/);
    const remove = await expectError(await del(ADMIN_SUB, { lang: 'fr' }), 409, 'conflict');
    assert.equal(remove.message, 'Vous ne pouvez pas retirer votre propre accès.');
    const me = await User.findOne({ kosmySub: ADMIN_SUB });
    assert.equal(me!.role, 'admin');
    assert.equal(me!.disabled, false);
    // Re-sending the admin's own role is fine.
    assert.equal((await put(ADMIN_SUB, { role: 'admin', email: ADMIN_EMAIL })).status, 200);
  });

  test('DELETE disables the account: sessions closed, every sign-in refused', async () => {
    const EX = '5b6e1c1e-2222-4a8e-9d55-000000000002';
    const { cookie } = await passwordLogin('existing@example.com', 'Existing!2026');
    assert.equal((await me(cookie)).status, 200);
    const mobile = await fetch(`${baseUrl}/api/mobile/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existing@example.com', password: 'Existing!2026' }),
    });
    const { token: mobileToken } = await mobile.json();
    assert.ok(mobileToken);

    const res = await del(EX);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);

    const u = await User.findOne({ kosmySub: EX });
    assert.equal(u!.disabled, true, 'disabled, not deleted');
    assert.equal((await me(cookie)).status, 401, 'open web session refused');
    const m = await fetch(`${baseUrl}/api/mobile/v1/auth/me`, { headers: { Authorization: `Bearer ${mobileToken}` } });
    assert.equal(m.status, 401, 'mobile token refused');
    assert.equal((await passwordLogin('existing@example.com', 'Existing!2026')).status, 403);
    const mobileAgain = await fetch(`${baseUrl}/api/mobile/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existing@example.com', password: 'Existing!2026' }),
    });
    assert.equal(mobileAgain.status, 403);
    const board = await signInWithBoard({ sub: EX });
    assert.equal(board.cb.headers.get('location'), '/login?kosmy_error=account_disabled');
    assert.equal(board.cookie, '');

    const list = await (await call('GET', USERS_PATH)).json();
    assert.equal(list.users.find((x: { sub: string }) => x.sub === EX).active, false);

    // Idempotent, and nothing to do for an unknown sub.
    assert.equal((await del(EX)).status, 200);
    assert.equal((await del('5b6e1c1e-9999-4a8e-9d55-000000000009')).status, 200);
  });

  test('PUT re-enables a disabled account', async () => {
    const EX = '5b6e1c1e-2222-4a8e-9d55-000000000002';
    const res = await put(EX, { email: 'existing@example.com', role: 'user' });
    assert.equal((await res.json()).status, 'updated');
    assert.equal((await User.findOne({ kosmySub: EX }))!.disabled, false);
    assert.equal((await passwordLogin('existing@example.com', 'Existing!2026')).status, 200);
  });

  test('a disabled administrator loses the admin in the Board; never zero active admins', async () => {
    const B = '5b6e1c1e-5555-4a8e-9d55-000000000005';
    await put(B, { email: 'second-admin@example.com', role: 'admin' });
    assert.equal((await call('GET', USERS_PATH, { as: B })).status, 200, 'B administers too');
    assert.equal((await del(B)).status, 200);
    const refused = await expectError(await call('GET', '/api/kosmy-board/admin', { as: B }), 403, 'forbidden');
    assert.match(refused.message ?? '', /disabled/);

    // B (disabled) does not count: the seeded admin is the last active one.
    const { cookie } = await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const self = await User.findOne({ email: ADMIN_EMAIL });
    const patch = await fetch(`${baseUrl}/api/users/${self!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(patch.status, 400);
    assert.equal((await User.findOne({ email: ADMIN_EMAIL }))!.role, 'admin');
  });
});

describe('the kosmy_board_access claim at sign-in', () => {
  test('creates the account and applies the role and restrictions', async () => {
    const S = '5b6e1c1e-6666-4a8e-9d55-000000000006';
    const { cb, cookie } = await signInWithBoard({
      sub: S,
      email: 'claimed@example.com',
      name: 'Claimed Person',
      kosmy_board_access: { role: 'user', values: { chatEnabled: false, [`app_${appB}`]: true } },
    });
    assert.equal(cb.status, 200, 'bounce page');
    assert.ok(cookie, 'signed in');
    const body = await (await me(cookie)).json();
    assert.equal(body.user.email, 'claimed@example.com');
    const u = await User.findOne({ kosmySub: S });
    assert.equal(u!.role, 'user');
    assert.equal(u!.chatEnabled, false);
    assert.deepEqual(u!.allowedApps.map(String), [appB]);

    // A later sign-in applies the new values (role and restrictions).
    await signInWithBoard({ sub: S, kosmy_board_access: { role: 'subadmin', values: { chatEnabled: true } } });
    const again = await User.findOne({ kosmySub: S });
    assert.equal(again!.role, 'subadmin');
    assert.equal(again!.chatEnabled, true);
  });

  test('never links an existing account by its email', async () => {
    const S = '5b6e1c1e-7777-4a8e-9d55-000000000007';
    const argon2 = (await import('argon2')).default;
    await User.create({
      email: 'unlinked@example.com',
      passwordHash: await argon2.hash('Unlinked!2026', { type: argon2.argon2id }),
    });
    const { cb, cookie } = await signInWithBoard({
      sub: S,
      email: 'unlinked@example.com',
      kosmy_board_access: { role: 'admin', values: {} },
    });
    assert.equal(cb.headers.get('location'), '/login?kosmy_error=email_taken');
    assert.equal(cookie, '');
    const u = await User.findOne({ email: 'unlinked@example.com' });
    assert.equal(u!.kosmySub, undefined);
    assert.equal(u!.role, 'user');
  });

  test('an invalid claim refuses the sign-in', async () => {
    const { cb } = await signInWithBoard({
      sub: '5b6e1c1e-8888-4a8e-9d55-000000000008',
      email: 'bad-claim@example.com',
      kosmy_board_access: { role: 'owner', values: {} },
    });
    assert.equal(cb.headers.get('location'), '/login?kosmy_error=access_invalid');
    assert.equal(await User.countDocuments({ email: 'bad-claim@example.com' }), 0);
  });

  test('without the claim, nothing changes (no auto-creation by default)', async () => {
    const { cb } = await signInWithBoard({ sub: '5b6e1c1e-aaaa-4a8e-9d55-00000000000a', email: 'nobody@example.com' });
    assert.equal(cb.headers.get('location'), '/login?kosmy_error=not_linked');
  });

  test('the access given again in the Board re-enables a disabled account', async () => {
    const S = '5b6e1c1e-6666-4a8e-9d55-000000000006';
    assert.equal((await del(S)).status, 200);
    const refused = await signInWithBoard({ sub: S });
    assert.equal(refused.cb.headers.get('location'), '/login?kosmy_error=account_disabled');
    const { cookie } = await signInWithBoard({ sub: S, kosmy_board_access: { role: 'user', values: {} } });
    assert.ok(cookie);
    assert.equal((await me(cookie)).status, 200);
  });

  test("the claim never demotes Dashy's last active administrator", async () => {
    const { cookie } = await signInWithBoard({
      sub: ADMIN_SUB,
      kosmy_board_access: { role: 'user', values: {} },
    });
    assert.ok(cookie);
    assert.equal((await User.findOne({ kosmySub: ADMIN_SUB }))!.role, 'admin');
  });
});
