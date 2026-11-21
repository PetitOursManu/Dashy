/**
 * "Sign in with Kosmy Board" — OpenID Connect client helpers.
 *
 * Kosmy Board is a standard OpenID Connect provider. This module holds the
 * protocol pieces: discovery, PKCE, the authorization URL, the code exchange
 * (client_secret_basic) and the full ID token check (RS256 via jwks_uri, iss,
 * aud, exp, nonce). It has no database dependency so it can be unit-tested.
 *
 * Spec: Kosmy Board `docs/integration.md`.
 */
import crypto, { type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const LOGIN_PATH = '/auth/kosmy-board/login';
export const CALLBACK_PATH = '/auth/kosmy-board/callback';
export const LINK_FINISH_PATH = '/auth/kosmy-board/link/finish';
/** Cookie binding the browser to its pending flow (holds the `state`). */
export const FLOW_COOKIE = 'dashy_kosmy_flow';
export const FLOW_COOKIE_PATH = '/auth/kosmy-board';
export const FLOW_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_TARGET = '/';

const HTTP_TIMEOUT_MS = 10_000;

/* ------------------------------ small helpers ------------------------------ */

/** Trim and drop trailing slashes. Returns null for anything that is not an http(s) URL. */
export function normalizeIssuer(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().replace(/\/+$/, '');
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.search || u.hash || u.username || u.password) return null;
    return v;
  } catch {
    return null;
  }
}

/** Public base URL of this instance (APP_ORIGIN), without trailing slash. */
export function baseUrl(appOrigin: string): string {
  return appOrigin.trim().replace(/\/+$/, '');
}

export function redirectUri(base: string): string {
  return `${base}${CALLBACK_PATH}`;
}

export function initiateLoginUri(base: string): string {
  return `${base}${LOGIN_PATH}`;
}

/**
 * Where to land after sign-in. Only a page of this instance (same origin) is
 * accepted; anything else falls back to the dashboard. Prevents open redirects.
 */
export function safeTarget(target: string | null | undefined, base: string): string {
  if (!target) return DEFAULT_TARGET;
  try {
    const origin = new URL(base).origin;
    const u = new URL(target, base);
    if (u.origin !== origin) return DEFAULT_TARGET;
    const path = u.pathname + u.search;
    if (!path.startsWith('/') || path.startsWith('//')) return DEFAULT_TARGET;
    // Never bounce back into the sign-in flow itself.
    if (path.startsWith('/auth/kosmy-board')) return DEFAULT_TARGET;
    return path;
  } catch {
    return DEFAULT_TARGET;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** PKCE S256: BASE64URL(SHA-256(verifier)). */
export function codeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export class OidcError extends Error {
  constructor(
    /** Short code used to pick the message shown to the user. */
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

type FetchLike = typeof fetch;

/* -------------------------- discovery (cached) ----------------------------- */

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, { doc: Discovery; at: number }>();

interface JwksEntry {
  keys: Map<string, KeyObject>;
  /** Keys without a `kid`, tried in order. */
  anonymous: KeyObject[];
  at: number;
}
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Minimum delay between two JWKS refetches triggered by an unknown `kid`. */
const JWKS_REFRESH_MIN_MS = 30 * 1000;
const jwksCache = new Map<string, JwksEntry>();

export function clearOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

export async function discover(issuer: string, fetchImpl: FetchLike = fetch): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.doc;

  let res: Response;
  try {
    res = await fetchImpl(`${issuer}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OidcError('unreachable', `discovery failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new OidcError('unreachable', `discovery failed (HTTP ${res.status})`);
  const doc = (await res.json().catch(() => ({}))) as Discovery;
  if (doc.issuer !== issuer) throw new OidcError('issuer', 'discovery: issuer mismatch');
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[k] !== 'string') throw new OidcError('unreachable', `discovery: missing ${k}`);
  }
  discoveryCache.set(issuer, { doc, at: Date.now() });
  return doc;
}

/* ---------------------------- authorization URL ---------------------------- */

export function buildAuthorizationUrl(
  doc: Pick<Discovery, 'authorization_endpoint'>,
  p: { clientId: string; redirectUri: string; state: string; nonce: string; verifier: string },
): string {
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: 'openid profile email',
    state: p.state,
    nonce: p.nonce,
    code_challenge: codeChallenge(p.verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

/* ------------------------------ token exchange ----------------------------- */

/** HTTP Basic credentials per RFC 6749 §2.3.1 (form-urlencoded, then base64). */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
  return `Basic ${Buffer.from(`${enc(clientId)}:${enc(clientSecret)}`).toString('base64')}`;
}

/** Exchange the authorization code (client_secret_basic + PKCE verifier). Returns the raw ID token. */
export async function exchangeCode(
  doc: Pick<Discovery, 'token_endpoint'>,
  p: { code: string; redirectUri: string; verifier: string; clientId: string; clientSecret: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(doc.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: basicAuthHeader(p.clientId, p.clientSecret),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: p.code,
        redirect_uri: p.redirectUri,
        code_verifier: p.verifier,
      }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OidcError('unreachable', `token endpoint unreachable: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as {
    id_token?: unknown;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || typeof body.id_token !== 'string') {
    throw new OidcError(
      'exchange',
      `token endpoint refused the code: ${body.error_description || body.error || res.status}`,
    );
  }
  return body.id_token;
}

/* ---------------------------------- JWKS ----------------------------------- */

async function fetchJwks(jwksUri: string, fetchImpl: FetchLike): Promise<JwksEntry> {
  let res: Response;
  try {
    res = await fetchImpl(jwksUri, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OidcError('unreachable', `jwks unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new OidcError('unreachable', `jwks failed (HTTP ${res.status})`);
  const body = (await res.json().catch(() => ({}))) as { keys?: unknown };
  const entry: JwksEntry = { keys: new Map(), anonymous: [], at: Date.now() };
  for (const raw of Array.isArray(body.keys) ? body.keys : []) {
    const jwk = raw as { kty?: string; use?: string; alg?: string; kid?: string };
    if (jwk.kty !== 'RSA') continue;
    if (jwk.use && jwk.use !== 'sig') continue;
    if (jwk.alg && jwk.alg !== 'RS256') continue;
    try {
      const key = crypto.createPublicKey({ key: raw as crypto.JsonWebKey, format: 'jwk' });
      if (jwk.kid) entry.keys.set(jwk.kid, key);
      else entry.anonymous.push(key);
    } catch {
      /* skip unusable keys */
    }
  }
  return entry;
}

/**
 * Signing keys for a JWT header (ID token, or the Board's admin token),
 * refetching the JWKS once if the `kid` is unknown.
 */
export async function signingKeys(
  jwksUri: string,
  kid: string | undefined,
  fetchImpl: FetchLike,
): Promise<KeyObject[]> {
  let entry = jwksCache.get(jwksUri);
  const stale = !entry || Date.now() - entry.at > JWKS_TTL_MS;
  const unknownKid =
    !!entry && !!kid && !entry.keys.has(kid) && Date.now() - entry.at > JWKS_REFRESH_MIN_MS;
  if (stale || unknownKid) {
    entry = await fetchJwks(jwksUri, fetchImpl);
    jwksCache.set(jwksUri, entry);
  }
  if (!entry) return [];
  if (kid) {
    const key = entry.keys.get(kid);
    return key ? [key] : [];
  }
  return [...entry.keys.values(), ...entry.anonymous];
}

/* -------------------------------- ID token --------------------------------- */

export interface KosmyClaims {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  locale?: string;
}

/** Full ID token check: RS256 signature (jwks_uri), iss, aud, exp, nonce. */
export async function verifyIdToken(
  idToken: string,
  p: { issuer: string; clientId: string; nonce: string; jwksUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<KosmyClaims> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded.payload === 'string') {
    throw new OidcError('token', 'invalid ID token: not a JWT');
  }
  if (decoded.header.alg !== 'RS256') {
    throw new OidcError('token', `invalid ID token: unexpected alg ${decoded.header.alg}`);
  }

  const keys = await signingKeys(p.jwksUri, decoded.header.kid, fetchImpl);
  if (keys.length === 0) throw new OidcError('token', 'invalid ID token: unknown signing key');

  let payload: jwt.JwtPayload | null = null;
  let lastError: Error | null = null;
  for (const key of keys) {
    try {
      payload = jwt.verify(idToken, key, {
        algorithms: ['RS256'],
        issuer: p.issuer,
        audience: p.clientId,
        clockTolerance: 30,
      }) as jwt.JwtPayload;
      break;
    } catch (e) {
      lastError = e as Error;
    }
  }
  if (!payload) {
    throw new OidcError('token', `invalid ID token: ${lastError?.message ?? 'verification failed'}`);
  }
  if (typeof payload.exp !== 'number') {
    throw new OidcError('token', 'invalid ID token: missing exp');
  }
  if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, p.nonce)) {
    throw new OidcError('token', 'invalid ID token: nonce mismatch');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new OidcError('token', 'invalid ID token: missing sub');
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    sub: payload.sub,
    name: str(payload.name),
    email: str(payload.email),
    preferred_username: str(payload.preferred_username),
    locale: str(payload.locale),
  };
}

/* ------------------------------ bounce page -------------------------------- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A tiny page that navigates to `path` (a same-origin path) with a meta refresh.
 *
 * Why: the callback is reached at the end of a navigation started on another
 * site (the Board). Dashy's session cookie is SameSite=Strict, so a plain 302
 * from the callback would lead to a request WITHOUT the cookie that was just
 * set, and the user would look signed out. A navigation started by this
 * same-origin page counts as same-site, so the cookie is sent. No script is
 * used, so the page satisfies Dashy's CSP as is.
 */
export function bouncePage(path: string, label = 'Continue'): string {
  // `path` comes from safeTarget(), but stay strict: quotes would end the
  // meta refresh URL, so percent-encode them before HTML-escaping.
  const url = escapeHtml(path.replace(/'/g, '%27').replace(/"/g, '%22'));
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="refresh" content="0;url=${url}">`,
    '<title>Dashy</title>',
    '<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#57534e}a{color:#ea580c}</style>',
    `</head><body><p><a href="${url}">${escapeHtml(label)}</a></p></body></html>`,
  ].join('');
}
