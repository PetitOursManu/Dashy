import type { NextFunction, Request, Response } from 'express';
import { COOKIE_NAME, verifyToken, type JwtPayload } from '../utils/jwt.js';
import { ApiError } from './error.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Require a valid (fully authenticated, non-pending) access token cookie. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    throw new ApiError(401, 'Authentication required');
  }
  try {
    const payload = verifyToken<JwtPayload & { pending2fa?: boolean }>(token);
    if (payload.pending2fa) {
      throw new ApiError(401, 'Two-factor authentication not completed');
    }
    req.user = { sub: payload.sub, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, 'Invalid or expired session');
  }
}

/** Require the authenticated user to be an admin. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    throw new ApiError(403, 'Administrator privileges required');
  }
  next();
}
