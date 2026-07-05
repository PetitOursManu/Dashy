import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Identity claims Dashy asserts to a client app when it signs an SSO token.
 * The token proves *who* the user is — it grants no access to Dashy itself.
 */
export interface SsoIdentity {
  sub: string; // stable Dashy user id
  email: string;
  name?: string; // display name when available
  role: 'admin' | 'subadmin' | 'user' | 'temp';
}

/**
 * Sign a short-lived (60 s) HS256 token for a client app, using the dedicated
 * SSO secret (never JWT_SECRET). `audience` is the callback's origin so a token
 * minted for one app can't be replayed against another. A random `jti` lets the
 * client enforce single use.
 */
export function signSsoToken(identity: SsoIdentity, audience: string): string {
  if (!env.SSO_SHARED_SECRET) {
    // Guarded by `ssoEnabled` at the route level; this is a safety net.
    throw new Error('SSO_SHARED_SECRET is not configured');
  }
  const claims: Record<string, unknown> = {
    sub: identity.sub,
    email: identity.email,
    role: identity.role,
  };
  if (identity.name) claims.name = identity.name;

  return jwt.sign(claims, env.SSO_SHARED_SECRET, {
    algorithm: 'HS256',
    expiresIn: '60s',
    issuer: 'dashy',
    audience,
    jwtid: crypto.randomBytes(16).toString('hex'),
  });
}
