import jwt from 'jsonwebtoken';
import { env, isProduction } from '../config/env.js';

export interface JwtPayload {
  sub: string; // user id
  role: 'admin' | 'user';
  tv: number; // token version (for "sign out everywhere")
  jti?: string; // session id (for per-device revocation)
}

/**
 * Intermediate token issued after password verification but BEFORE the TOTP
 * step, when 2FA is enabled. It cannot access protected resources — only the
 * /auth/2fa/verify endpoint accepts it.
 */
export interface PendingPayload {
  sub: string;
  pending2fa: true;
}

const ACCESS_TTL = '7d';
const PENDING_TTL = '5m';

export const COOKIE_NAME = 'dashy_token';

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function signPendingToken(userId: string): string {
  return jwt.sign({ sub: userId, pending2fa: true }, env.JWT_SECRET, {
    expiresIn: PENDING_TTL,
  });
}

export function verifyToken<T = JwtPayload>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET) as T;
}

/** Short-lived cookie token proving a visitor unlocked a password-protected share. */
export function signShareUnlock(shareToken: string): string {
  return jwt.sign({ share: shareToken }, env.JWT_SECRET, { expiresIn: '6h' });
}

export function verifyShareUnlock(token: string, shareToken: string): boolean {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { share?: string };
    return payload.share === shareToken;
  } catch {
    return false;
  }
}

/** Cookie options shared by login/logout so they always match. */
export function cookieOptions(maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}
