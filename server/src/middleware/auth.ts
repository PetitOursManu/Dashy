import type { NextFunction, Request, Response } from 'express';
import { COOKIE_NAME, verifyToken, type JwtPayload } from '../utils/jwt.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { ApiError } from './error.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Extract the access token from the request. The web app sends it as an
 * httpOnly cookie; native mobile clients (which can't use cookies) send it as an
 * `Authorization: Bearer <token>` header. The cookie takes priority so existing
 * browser behaviour is unchanged.
 */
function getRequestToken(req: Request): string | undefined {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return undefined;
}

/**
 * Require a valid (fully authenticated, non-pending) access token cookie, and
 * verify the token's version still matches the user's — so "sign out of all
 * devices" (which bumps tokenVersion) invalidates previously issued tokens.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = getRequestToken(req);
    if (!token) throw new ApiError(401, 'Authentication required');

    const payload = verifyToken<JwtPayload & { pending2fa?: boolean }>(token);
    if (payload.pending2fa) {
      throw new ApiError(401, 'Two-factor authentication not completed');
    }

    const user = await User.findById(payload.sub).select('tokenVersion role expiresAt');
    // Treat a missing version as 0 so tokens issued before this field existed
    // (and freshly seeded users) remain valid.
    if (!user || (payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new ApiError(401, 'Session expired, please sign in again');
    }

    // Temporary accounts stop working the moment they expire.
    if (user.role === 'temp' && user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(401, 'This temporary account has expired');
    }

    // Tokens issued with a session id (jti) are revocable per-device: the
    // session must still exist. Older tokens without a jti skip this check.
    if (payload.jti) {
      const session = await Session.findOne({ jti: payload.jti, user: payload.sub }).select(
        'lastSeenAt',
      );
      if (!session) {
        throw new ApiError(401, 'Session expired, please sign in again');
      }
      // Refresh last-seen at most once per minute (fire-and-forget).
      if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
        Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch(
          () => {},
        );
      }
    }

    // The DB role is authoritative (so role changes take effect immediately and
    // a stale token can't keep elevated access).
    req.user = { sub: payload.sub, role: user.role, tv: payload.tv, jti: payload.jti };
    next();
  } catch (err) {
    next(err instanceof ApiError ? err : new ApiError(401, 'Invalid or expired session'));
  }
}

/** Require the authenticated user to be an admin. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    throw new ApiError(403, 'Administrator privileges required');
  }
  next();
}

/** Require admin OR semi-admin (staff) — for user moderation surfaces. */
export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin' && req.user?.role !== 'subadmin') {
    throw new ApiError(403, 'Staff privileges required');
  }
  next();
}

/** Block temporary accounts (no password change / no 2FA). */
export function blockTemp(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role === 'temp') {
    throw new ApiError(403, 'Not available for temporary accounts');
  }
  next();
}
