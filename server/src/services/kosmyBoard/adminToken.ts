/**
 * "Admin in Kosmy Board" (protocol kosmy.board-admin.v1) — the Board's token.
 *
 * The Board's server calls Dashy's admin API with a short-lived JWT signed by
 * the same key as its ID tokens (RS256, `jwks_uri`), made for ONE request:
 *
 *   header  { alg: RS256, kid, typ: "kb-admin+jwt" }
 *   claims  iss, aud (client ID), sub, iat, exp (60 s), jti, htm, htu
 *
 * Checks, in the spec's order: signature (the JWKS cache of the sign-in),
 * `typ` (an ID token is never accepted here), iss, aud, exp (30 s clock
 * tolerance), htm = method, htu's path ends with the requested path, and the
 * `jti` has never been seen (kept in memory until the token expires).
 *
 * Spec: Kosmy Board `docs/admin-api.md`. No database dependency.
 */
import jwt from 'jsonwebtoken';
import { OidcError, signingKeys } from './oidc.js';

export const ADMIN_TOKEN_TYP = 'kb-admin+jwt';
const CLOCK_TOLERANCE_S = 30;
/** Tokens are valid 60 s; refuse anything issued long before (iat). */
const MAX_TOKEN_AGE = '2m';

type FetchLike = typeof fetch;

export interface AdminTokenClaims {
  sub: string;
  jti: string;
  /** Display only (logs): never used to find an account. */
  name?: string;
  email?: string;
}

/** jti → time (ms) after which it may be forgotten (its token has expired). */
const seenJti = new Map<string, number>();

export function clearSeenJti(): void {
  seenJti.clear();
}

function purgeSeenJti(now: number): void {
  for (const [jti, until] of seenJti) if (until < now) seenJti.delete(jti);
}

function fail(reason: string): never {
  throw new OidcError('token', `invalid admin token: ${reason}`);
}

/** `typ` per RFC 8725 §3.11: case-insensitive, optional "application/" prefix. */
function isAdminTyp(typ: unknown): boolean {
  if (typeof typ !== 'string') return false;
  const t = typ.toLowerCase();
  return t === ADMIN_TOKEN_TYP || t === `application/${ADMIN_TOKEN_TYP}`;
}

/**
 * Verify the Board's admin token for this request. `path` is the path of the
 * request as Dashy received it (e.g. `/api/kosmy-board/admin/users`).
 * Throws `OidcError('token', …)` on any failure.
 */
export async function verifyAdminToken(
  token: string,
  p: { issuer: string; clientId: string; jwksUri: string; method: string; path: string },
  fetchImpl: FetchLike = fetch,
): Promise<AdminTokenClaims> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded.payload === 'string') fail('not a JWT');
  if (decoded.header.alg !== 'RS256') fail(`unexpected alg ${decoded.header.alg}`);

  // 1. Signature, with the keys already cached for the sign-in.
  const keys = await signingKeys(p.jwksUri, decoded.header.kid, fetchImpl);
  if (keys.length === 0) fail('unknown signing key');

  let payload: jwt.JwtPayload | null = null;
  let lastError: Error | null = null;
  for (const key of keys) {
    try {
      // 3. iss, aud, exp (+ iat age) are checked here too.
      payload = jwt.verify(token, key, {
        algorithms: ['RS256'],
        issuer: p.issuer,
        audience: p.clientId,
        clockTolerance: CLOCK_TOLERANCE_S,
        maxAge: MAX_TOKEN_AGE,
      }) as jwt.JwtPayload;
      break;
    } catch (e) {
      lastError = e as Error;
    }
  }
  if (!payload) fail(lastError?.message ?? 'verification failed');

  // 2. Only a token made for this API: never an ID token or another Board JWT.
  if (!isAdminTyp(decoded.header.typ)) fail('wrong typ');
  if (typeof payload.exp !== 'number') fail('missing exp');

  // 4. Made for this very request.
  if (payload.htm !== p.method) fail('htm mismatch');
  let htuPath = '';
  try {
    htuPath = new URL(String(payload.htu)).pathname;
  } catch {
    fail('invalid htu');
  }
  if (!htuPath.endsWith(p.path)) fail('htu mismatch');

  // 5. Single use.
  const now = Date.now();
  purgeSeenJti(now);
  if (typeof payload.jti !== 'string' || !payload.jti) fail('missing jti');
  if (seenJti.has(payload.jti)) fail('replayed jti');
  seenJti.set(payload.jti, payload.exp * 1000 + CLOCK_TOLERANCE_S * 1000);

  if (typeof payload.sub !== 'string' || !payload.sub) fail('missing sub');
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return { sub: payload.sub, jti: payload.jti, name: str(payload.name), email: str(payload.email) };
}
