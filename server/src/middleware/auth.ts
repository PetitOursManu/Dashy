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
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new ApiError(401, 'Authentication required');

    const payload = verifyToken<JwtPayload & { pending2fa?: boolean }>(token);
    if (payload.pending2fa) {
      throw new ApiError(401, 'Two-factor authentication not completed');
    }

    const user = await User.findById(payload.sub).select('tokenVersion');
    // Treat a missing version as 0 so tokens issued before this field existed
    // (and freshly seeded users) remain valid.
    if (!user || (payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new ApiError(401, 'Session expired, please sign in again');
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

    req.user = { sub: payload.sub, role: payload.role, tv: payload.tv, jti: payload.jti };
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
