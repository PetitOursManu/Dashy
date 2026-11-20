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
import { authenticator } from 'otplib';

/**
 * "Sign in with Kosmy Board" — OpenID Connect client tests.
 *
 * A small fake Kosmy Board (discovery, token endpoint with client_secret_basic
 * + PKCE checks, JWKS) runs in-process; the tests play the browser.
 */

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dashy-kosmy-'));
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'SuperSecret!2026';
const APP_ORIGIN = 'http://dashy.test';
const CLIENT_ID = 'kb-dashy-test';
const CLIENT_SECRET = 'top secret/with:odd chars';

let mongo: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let disconnectDb: () => Promise<void>;
let oidc: typeof import('../src/services/kosmyBoard/oidc.js');

/* --------------------------- fake Kosmy Board ------------------------------ */

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
let board: Server;
let ISSUER = '';

interface PendingCode {
  nonce: string;
  challenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
}
const codes = new Map<string, PendingCode>();
let tokenRequests = 0;

function signIdToken(claims: Record<string, unknown>, opts: { key?: crypto.KeyObject; kid?: string } = {}) {
  return jwt.sign(claims, opts.key ?? privateKey, {
    algorithm: 'RS256',
    keyid: opts.kid ?? KID,
  });
}

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
      tokenRequests++;
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const auth = req.headers.authorization ?? '';
        const expected = oidc.basicAuthHeader(CLIENT_ID, CLIENT_SECRET);
        if (auth !== expected) return json(401, { error: 'invalid_client' });
        const form = new URLSearchParams(raw);
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (!pending || form.get('grant_type') !== 'authorization_code') {
          return json(400, { error: 'invalid_grant' });
        }
        if (form.get('redirect_uri') !== pending.redirectUri) return json(400, { error: 'invalid_grant' });
        if (oidc.codeChallenge(form.get('code_verifier') ?? '') !== pending.challenge) {
          return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
        }
        const now = Math.floor(Date.now() / 1000);
        const id_token = signIdToken({
          iss: ISSUER,
          aud: CLIENT_ID,
          iat: now,
          exp: now + 300,
          nonce: pending.nonce,
          ...pending.claims,
        });
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

/* ------------------------------ browser jar -------------------------------- */

class Browser {
  cookies = new Map<string, string>();
  setCookies: string[] = [];

  private absorb(res: Response): void {
    this.setCookies = res.headers.getSetCookie?.() ?? [];
    for (const c of this.setCookies) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(method: string, pathname: string, body?: unknown): Promise<Response> {
    const res = await fetch(baseUrl + pathname, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    this.absorb(res);
    return res;
  }

  async login(email: string, password: string): Promise<void> {
    const res = await this.fetch('POST', '/api/auth/login', { email, password });
    assert.equal(res.status, 200);
  }
}

/** The Board's side of an authorization request: issue a code for `claims`. */
function boardAuthorize(authorizationUrl: string, claims: Record<string, unknown>) {
  const u = new URL(authorizationUrl);
  assert.equal(u.origin + u.pathname, `${ISSUER}/authorize`);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(u.searchParams.get('redirect_uri'), `${APP_ORIGIN}/auth/kosmy-board/callback`);
  assert.equal(u.searchParams.get('scope'), 'openid profile email');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  const state = u.searchParams.get('state')!;
  const nonce = u.searchParams.get('nonce')!;
  assert.ok(state.length >= 22 && nonce.length >= 22, 'state/nonce carry >= 128 bits');
  const code = crypto.randomBytes(16).toString('hex');
  codes.set(code, {
    nonce,
    challenge: u.searchParams.get('code_challenge')!,
    redirectUri: u.searchParams.get('redirect_uri')!,
    claims,
  });
  return { state, code };
}

/** Run a whole sign-in up to the callback response. */
async function signInWithBoard(b: Browser, claims: Record<string, unknown>, query = '') {
  const start = await b.fetch('GET', `/auth/kosmy-board/login${query}`);
  assert.equal(start.status, 303);
  const { state, code } = boardAuthorize(start.headers.get('location')!, claims);
  const cb = await b.fetch(
    'GET',
    `/auth/kosmy-board/callback?code=${code}&state=${state}&iss=${encodeURIComponent(ISSUER)}`,
  );
  return { cb, state, code };
}

function metaRefreshTarget(html: string): string | null {
  const m = /<meta http-equiv="refresh" content="0;url=([^"]*)">/.exec(html);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

const admin = new Browser();

/* --------------------------------- setup ----------------------------------- */

before(async () => {
  mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = mongo.getUri('dashy_kosmy_test');
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
  oidc = await import('../src/services/kosmyBoard/oidc.js');
  disconnectDb = dd;

  ensureDataDirs();
  await connectDb();
  await seedAdmin();
  // Make sure the partial unique index on kosmySub exists before the tests.
  const { User } = await import('../src/models/User.js');
  await User.syncIndexes();

  await startBoard();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => board.close(() => resolve()));
  await disconnectDb();
  await mongo.stop();
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/* --------------------- status check from Kosmy Board ----------------------- */

describe('reachability from Kosmy Board', () => {
  // The built client (server/public) is git-ignored: skip the shell test without it.
  const noShell = !fs.existsSync(path.resolve(import.meta.dirname, '../public/index.html'));

  test('the SPA shell can be read cross-origin', { skip: noShell && 'client not built' }, async () => {
    for (const p of ['/', '/settings']) {
      const res = await fetch(baseUrl + p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin', p);
    }
  });

  test('the API keeps the same-origin resource policy', async () => {
    for (const p of ['/healthz', '/api/auth/me', '/api/nope']) {
      const res = await fetch(baseUrl + p);
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin', p);
    }
  });
});

/* ------------------------------ pure helpers ------------------------------- */

describe('protocol helpers', () => {
  test('PKCE S256 is BASE64URL(SHA-256(verifier)) without padding', () => {
    const verifier = 'dBjftJeZ4CVP-mJ92K1Qkv-7RhP4j4K0B5i9xPFlxYKk';
    const expected = crypto
      .createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    assert.equal(oidc.codeChallenge(verifier), expected);
    assert.match(oidc.codeChallenge(verifier), /^[A-Za-z0-9_-]{43}$/);
  });

  test('client_secret_basic form-encodes before base64', () => {
    const h = oidc.basicAuthHeader('a b', 'x:y/z');
    assert.equal(Buffer.from(h.slice(6), 'base64').toString(), 'a+b:x%3Ay%2Fz');
  });

  test('target_link_uri: same origin only', () => {
    const base = 'https://dashy.example.com';
    assert.equal(oidc.safeTarget('https://dashy.example.com/security?x=1', base), '/security?x=1');
    assert.equal(oidc.safeTarget('/settings', base), '/settings');
    assert.equal(oidc.safeTarget('https://evil.example.com/', base), '/');
    assert.equal(oidc.safeTarget('//evil.example.com/x', base), '/');
    assert.equal(oidc.safeTarget('http://dashy.example.com/', base), '/');
    assert.equal(oidc.safeTarget('javascript:alert(1)', base), '/');
    assert.equal(oidc.safeTarget('/auth/kosmy-board/login', base), '/');
    assert.equal(oidc.safeTarget(null, base), '/');
  });

  test('issuer normalization', () => {
    assert.equal(oidc.normalizeIssuer(' https://b.example.com/oidc/ '), 'https://b.example.com/oidc');
    assert.equal(oidc.normalizeIssuer('ftp://b.example.com'), null);
    assert.equal(oidc.normalizeIssuer('https://b.example.com/oidc?x=1'), null);
    assert.equal(oidc.normalizeIssuer(''), null);
  });

  test('bounce page escapes its target and has no script', () => {
    const html = oidc.bouncePage(`/x?a="><script>alert(1)</script>'`);
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /<meta http-equiv="refresh" content="0;url=\/x\?a=%22&gt;&lt;script&gt;/);
  });
});

describe('ID token verification', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const good = () => ({ iss: ISSUER, aud: CLIENT_ID, sub: 'u-1', nonce: 'n-1', iat: now(), exp: now() + 60 });
  const verify = (token: string) =>
    oidc.verifyIdToken(token, {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      nonce: 'n-1',
      jwksUri: `${ISSUER}/jwks`,
    });

  test('accepts a valid token', async () => {
    const claims = await verify(signIdToken({ ...good(), name: 'Ada', email: 'ada@example.com' }));
    assert.equal(claims.sub, 'u-1');
    assert.equal(claims.email, 'ada@example.com');
  });

  test('rejects wrong iss, aud, nonce, expired, missing exp', async () => {
    for (const bad of [
      { ...good(), iss: 'http://evil.example.com/oidc' },
      { ...good(), aud: 'someone-else' },
      { ...good(), nonce: 'other' },
      { ...good(), iat: now() - 600, exp: now() - 300 },
    ]) {
      await assert.rejects(verify(signIdToken(bad)), /invalid ID token/);
    }
    const { exp: _exp, ...noExp } = good();
    await assert.rejects(verify(signIdToken(noExp)), /invalid ID token/);
  });

  test('rejects a token signed by another key or with HS256', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await assert.rejects(verify(signIdToken(good(), { key: other })), /invalid ID token/);
    const hs = jwt.sign(good(), 'shared', { algorithm: 'HS256', keyid: KID });
    await assert.rejects(verify(hs), /unexpected alg/);
  });
});

/* ------------------------------ admin settings ----------------------------- */

describe('admin settings', () => {
  test('only admins can read the settings', async () => {
    const anon = new Browser();
    assert.equal((await anon.fetch('GET', '/api/admin/kosmy-board')).status, 401);
  });

  test('shows the addresses to copy and starts disabled', async () => {
    const res = await admin.fetch('GET', '/api/admin/kosmy-board');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.redirectUri, `${APP_ORIGIN}/auth/kosmy-board/callback`);
    assert.equal(body.initiateLoginUri, `${APP_ORIGIN}/auth/kosmy-board/login`);
    assert.equal(body.enabled, false);
    assert.equal(body.config.autoCreate, false);
    assert.equal(body.config.requireDashy2fa, false);
    const status = await (await new Browser().fetch('GET', '/api/auth/kosmy-board')).json();
    assert.equal(status.enabled, false);
  });

  test('launch is refused while not configured', async () => {
    const res = await new Browser().fetch('GET', '/auth/kosmy-board/login');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/login?kosmy_error=not_configured');
  });

  test('rejects an invalid issuer', async () => {
    const res = await admin.fetch('PUT', '/api/admin/kosmy-board', { issuer: 'not a url' });
    assert.equal(res.status, 400);
  });

  test('saves the settings; the secret is write-only', async () => {
    const res = await admin.fetch('PUT', '/api/admin/kosmy-board', {
      issuer: `${ISSUER}/`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(CLIENT_SECRET), 'secret never echoed');
    const body = JSON.parse(text);
    assert.equal(body.config.issuer, ISSUER, 'trailing slash dropped');
    assert.equal(body.config.hasClientSecret, true);
    assert.equal(body.enabled, true);
    const again = await (await admin.fetch('GET', '/api/admin/kosmy-board')).text();
    assert.ok(!again.includes(CLIENT_SECRET));
    const status = await (await new Browser().fetch('GET', '/api/auth/kosmy-board')).json();
    assert.equal(status.enabled, true);
  });
});

/* ---------------------------------- launch --------------------------------- */

describe('launch', () => {
  test('redirects to the Board with state, nonce and PKCE; Lax flow cookie', async () => {
    const b = new Browser();
    const res = await b.fetch('GET', '/auth/kosmy-board/login');
    assert.equal(res.status, 303);
    const loc = new URL(res.headers.get('location')!);
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    assert.match(loc.searchParams.get('code_challenge')!, /^[A-Za-z0-9_-]{43}$/);
    const flowCookie = b.setCookies.find((c) => c.startsWith('dashy_kosmy_flow='))!;
    assert.match(flowCookie, /HttpOnly/i);
    assert.match(flowCookie, /SameSite=Lax/i);
    assert.match(flowCookie, /Path=\/auth\/kosmy-board/i);
  });

  test('third-party initiated: refuses another issuer', async () => {
    const res = await new Browser().fetch(
      'GET',
      `/auth/kosmy-board/login?iss=${encodeURIComponent('http://evil.example.com/oidc')}`,
    );
    assert.equal(res.headers.get('location'), '/login?kosmy_error=issuer');
  });

  test('third-party initiated: accepts the configured issuer, keeps a same-origin target only', async () => {
    const { User } = await import('../src/models/User.js');
    await User.updateOne({ email: ADMIN_EMAIL }, { $set: { kosmySub: 'sub-admin' } });

    const b = new Browser();
    const evil = await signInWithBoard(
      b,
      { sub: 'sub-admin' },
      `?iss=${encodeURIComponent(ISSUER)}&target_link_uri=${encodeURIComponent('https://evil.example.com/')}`,
    );
    assert.equal(metaRefreshTarget(await evil.cb.text()), '/');

    const ok = await signInWithBoard(
      b,
      { sub: 'sub-admin' },
      `?iss=${encodeURIComponent(ISSUER)}&target_link_uri=${encodeURIComponent(`${APP_ORIGIN}/settings`)}`,
    );
    assert.equal(metaRefreshTarget(await ok.cb.text()), '/settings');

    await User.updateOne({ email: ADMIN_EMAIL }, { $unset: { kosmySub: 1 } });
  });
});

/* --------------------------------- callback -------------------------------- */

describe('callback', () => {
  test('an unlinked Board account is refused (no auto-creation by default)', async () => {
    const b = new Browser();
    const { cb } = await signInWithBoard(b, { sub: 'sub-unknown', email: ADMIN_EMAIL });
    assert.equal(cb.status, 303);
    assert.equal(cb.headers.get('location'), '/login?kosmy_error=not_linked');
    assert.equal(b.cookies.has('dashy_token'), false);
  });

  test('state is single use and bound to the browser', async () => {
    const b = new Browser();
    const start = await b.fetch('GET', '/auth/kosmy-board/login');
    const { state, code } = boardAuthorize(start.headers.get('location')!, { sub: 'x' });

    // Another browser (no flow cookie) cannot use it.
    const stranger = new Browser();
    const r1 = await stranger.fetch('GET', `/auth/kosmy-board/callback?code=${code}&state=${state}`);
    assert.equal(r1.headers.get('location'), '/login?kosmy_error=expired');

    const r2 = await b.fetch('GET', `/auth/kosmy-board/callback?code=${code}&state=${state}`);
    assert.equal(r2.headers.get('location'), '/login?kosmy_error=not_linked');

    // Replay with the same cookie value: refused.
    b.cookies.set('dashy_kosmy_flow', state);
    const r3 = await b.fetch('GET', `/auth/kosmy-board/callback?code=${code}&state=${state}`);
    assert.equal(r3.headers.get('location'), '/login?kosmy_error=expired');
  });

  test('a response from another issuer is refused before the code exchange', async () => {
    const b = new Browser();
    const start = await b.fetch('GET', '/auth/kosmy-board/login');
    const { state, code } = boardAuthorize(start.headers.get('location')!, { sub: 'x' });
    const before = tokenRequests;
    const res = await b.fetch(
      'GET',
      `/auth/kosmy-board/callback?code=${code}&state=${state}&iss=${encodeURIComponent('http://evil.example.com/oidc')}`,
    );
    assert.equal(res.headers.get('location'), '/login?kosmy_error=issuer');
    assert.equal(tokenRequests, before);
  });

  test('access_denied from the Board is reported', async () => {
    const b = new Browser();
    const start = await b.fetch('GET', '/auth/kosmy-board/login');
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const res = await b.fetch('GET', `/auth/kosmy-board/callback?error=access_denied&state=${state}`);
    assert.equal(res.headers.get('location'), '/login?kosmy_error=denied');
  });
});

/* ---------------------------- link, sign in, unlink ------------------------ */

describe('linking and signing in', () => {
  const user = new Browser();
  const USER_EMAIL = 'ada@example.com';
  const USER_PASSWORD = 'AdaLovelace!2026';
  const SUB = '6b0e1c1e-4f2b-4a8e-9d55-1d1c6c0f0a01';

  before(async () => {
    const res = await admin.fetch('POST', '/api/users', {
      email: USER_EMAIL,
      password: USER_PASSWORD,
      role: 'user',
    });
    assert.ok(res.status === 201 || res.status === 200, `create user: ${res.status}`);
    await user.login(USER_EMAIL, USER_PASSWORD);
  });

  test('"Link to Kosmy Board" stores the sub on the signed-in account', async () => {
    const start = await user.fetch('POST', '/api/auth/kosmy-board/link');
    assert.equal(start.status, 200);
    const { url } = await start.json();
    const { state, code } = boardAuthorize(url, { sub: SUB, email: 'someone-else@example.com' });

    // The callback cannot see the Strict session cookie in a real browser:
    // drop it for this request to mimic that, then follow the bounce.
    const session = user.cookies.get('dashy_token')!;
    user.cookies.delete('dashy_token');
    const cb = await user.fetch(
      'GET',
      `/auth/kosmy-board/callback?code=${code}&state=${state}&iss=${encodeURIComponent(ISSUER)}`,
    );
    assert.equal(cb.status, 200);
    assert.equal(metaRefreshTarget(await cb.text()), '/auth/kosmy-board/link/finish');
    user.cookies.set('dashy_token', session);

    const finish = await user.fetch('GET', '/auth/kosmy-board/link/finish');
    assert.equal(finish.status, 303);
    assert.equal(finish.headers.get('location'), '/security?kosmy=linked');

    const me = await (await user.fetch('GET', '/api/auth/me')).json();
    assert.equal(me.user.kosmyLinked, true);
    assert.equal(me.user.kosmySub, undefined, 'sub itself is not exposed');
  });

  test('link finish needs the same signed-in user', async () => {
    const start = await user.fetch('POST', '/api/auth/kosmy-board/link');
    const { url } = await start.json();
    const { state, code } = boardAuthorize(url, { sub: SUB });
    await user.fetch('GET', `/auth/kosmy-board/callback?code=${code}&state=${state}`);
    // Session swapped for the admin's before the finish step.
    const flow = user.cookies.get('dashy_kosmy_flow')!;
    const other = new Browser();
    other.cookies.set('dashy_token', admin.cookies.get('dashy_token')!);
    other.cookies.set('dashy_kosmy_flow', flow);
    const res = await other.fetch('GET', '/auth/kosmy-board/link/finish');
    assert.equal(res.headers.get('location'), '/security?kosmy_error=session');
  });

  test('a Board account already linked elsewhere cannot be linked again', async () => {
    const start = await admin.fetch('POST', '/api/auth/kosmy-board/link');
    const { url } = await start.json();
    const { state, code } = boardAuthorize(url, { sub: SUB });
    await admin.fetch('GET', `/auth/kosmy-board/callback?code=${code}&state=${state}`);
    const res = await admin.fetch('GET', '/auth/kosmy-board/link/finish');
    assert.equal(res.headers.get('location'), '/security?kosmy_error=already_linked');
  });

  test('sign-in by sub opens a session through a CSP-safe bounce page', async () => {
    const b = new Browser();
    const { cb } = await signInWithBoard(b, { sub: SUB, email: 'not-ada@example.com' });
    assert.equal(cb.status, 200);
    assert.match(cb.headers.get('content-type') ?? '', /text\/html/);
    assert.match(cb.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(cb.headers.get('cache-control'), 'no-store');
    const html = await cb.text();
    assert.doesNotMatch(html, /<script/i);
    assert.equal(metaRefreshTarget(html), '/');

    const session = b.setCookies.find((c) => c.startsWith('dashy_token='))!;
    assert.match(session, /SameSite=Strict/i);
    assert.match(session, /HttpOnly/i);
    assert.equal(b.cookies.has('dashy_kosmy_flow'), false, 'flow cookie cleared');

    const me = await (await b.fetch('GET', '/api/auth/me')).json();
    assert.equal(me.user.email, USER_EMAIL, 'matched by sub, not by email');
    assert.equal(me.user.role, 'user');
  });

  test("Dashy's 2FA is skipped by default, and required when the admin asks", async () => {
    // Enable 2FA on the user.
    const setup = await (await user.fetch('POST', '/api/auth/2fa/setup')).json();
    const enable = await user.fetch('POST', '/api/auth/2fa/enable', {
      token: authenticator.generate(setup.secret),
    });
    assert.equal(enable.status, 200);

    // Default: the Board sign-in replaces Dashy's password + 2FA.
    const direct = new Browser();
    const r1 = await signInWithBoard(direct, { sub: SUB });
    assert.equal(r1.cb.status, 200);
    assert.equal((await direct.fetch('GET', '/api/auth/me')).status, 200);

    // Admin setting on: hand over to the 2FA step of the login page.
    await admin.fetch('PUT', '/api/admin/kosmy-board', { requireDashy2fa: true });
    const strict = new Browser();
    const r2 = await signInWithBoard(strict, { sub: SUB }, `?target_link_uri=${encodeURIComponent('/settings')}`);
    assert.equal(metaRefreshTarget(await r2.cb.text()), '/login?kosmy_2fa=1&next=%2Fsettings');
    assert.equal((await strict.fetch('GET', '/api/auth/me')).status, 401, 'pending only');
    const verify = await strict.fetch('POST', '/api/auth/2fa/verify', {
      token: authenticator.generate(setup.secret),
    });
    assert.equal(verify.status, 200);
    assert.equal((await strict.fetch('GET', '/api/auth/me')).status, 200);

    await admin.fetch('PUT', '/api/admin/kosmy-board', { requireDashy2fa: false });
  });

  test('unlinking requires the Dashy password', async () => {
    const wrong = await user.fetch('DELETE', '/api/auth/kosmy-board', { password: 'nope-nope' });
    assert.equal(wrong.status, 401);
    const ok = await user.fetch('DELETE', '/api/auth/kosmy-board', { password: USER_PASSWORD });
    assert.equal(ok.status, 200);
    const me = await (await user.fetch('GET', '/api/auth/me')).json();
    assert.equal(me.user.kosmyLinked, false);

    const { cb } = await signInWithBoard(new Browser(), { sub: SUB });
    assert.equal(cb.headers.get('location'), '/login?kosmy_error=not_linked');
  });
});

/* ------------------------------ auto-creation ------------------------------ */

describe('automatic account creation', () => {
  before(async () => {
    await admin.fetch('PUT', '/api/admin/kosmy-board', { autoCreate: true });
  });
  after(async () => {
    await admin.fetch('PUT', '/api/admin/kosmy-board', { autoCreate: false });
  });

  test('never takes over an existing account with the same email', async () => {
    const { cb } = await signInWithBoard(new Browser(), { sub: 'sub-new-1', email: ADMIN_EMAIL });
    assert.equal(cb.headers.get('location'), '/login?kosmy_error=email_taken');
  });

  test('creates a regular user (never admin) for an unknown sub', async () => {
    const b = new Browser();
    const { cb } = await signInWithBoard(b, {
      sub: 'sub-new-2',
      email: 'grace@example.com',
      name: 'Grace Hopper',
      locale: 'fr',
      role: 'admin',
      is_admin: true,
    });
    assert.equal(cb.status, 200);
    const me = await (await b.fetch('GET', '/api/auth/me')).json();
    assert.equal(me.user.email, 'grace@example.com');
    assert.equal(me.user.role, 'user');
    assert.equal(me.user.fullName, 'Grace Hopper');
    assert.equal(me.user.language, 'fr');
    assert.equal(me.user.kosmyLinked, true);

    // The same sub signs in to the same account afterwards.
    const again = new Browser();
    await signInWithBoard(again, { sub: 'sub-new-2', email: 'changed@example.com' });
    const me2 = await (await again.fetch('GET', '/api/auth/me')).json();
    assert.equal(me2.user.id, me.user.id);
  });
});
