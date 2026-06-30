import type { Request } from 'express';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { User, type UserDoc } from '../models/User.js';
import { Session } from '../models/Session.js';
import { ApiError } from '../middleware/error.js';
import { decrypt } from '../utils/crypto.js';
import { signAccessToken } from '../utils/jwt.js';

/**
 * Shared authentication logic used by both the cookie-based web flow
 * (`authController`) and the Bearer-token mobile flow (`mobileAuthController`),
 * so credential checks, session creation and 2FA verification stay in one place.
 */

/**
 * Verify an email/password pair. Always runs an argon2 verification (against a
 * dummy hash when the user is missing) to limit the timing oracle, and blocks
 * expired temporary accounts. Returns the user on success, throws 401 otherwise.
 */
export async function verifyCredentials(email: string, password: string): Promise<UserDoc> {
  const user = await User.findOne({ email });
  const valid = user ? await argon2.verify(user.passwordHash, password) : false;
  if (!user || !valid) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (user.role === 'temp' && user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(401, 'This temporary account has expired');
  }
  return user;
}

/**
 * Create a revocable session record for `user` and sign an access token bound to
 * it (via `jti`). `deviceLabel` lets a mobile client name the session; otherwise
 * the request's User-Agent is used. The caller decides how to deliver the token
 * (httpOnly cookie for web, response body for mobile).
 */
export async function issueSession(
  req: Request,
  user: UserDoc,
  deviceLabel?: string,
): Promise<{ token: string; jti: string }> {
  const jti = crypto.randomBytes(16).toString('hex');
  await Session.create({
    user: user.id,
    jti,
    userAgent: (deviceLabel ?? String(req.headers['user-agent'] ?? '')).slice(0, 250),
    ip: req.ip ?? '',
  });
  const token = signAccessToken({
    sub: user.id,
    role: user.role,
    tv: user.tokenVersion,
    jti,
  });
  return { token, jti };
}

/**
 * Verify a TOTP token or a single-use backup code against the user's 2FA secret.
 * Mutates `user` (marking a backup code used) but does NOT save — the caller
 * persists.
 */
export async function verifyTwoFactorToken(user: UserDoc, token: string): Promise<boolean> {
  if (!user.twoFactorSecret) return false;
  const secret = decrypt(user.twoFactorSecret);

  // TOTP first (6 digits).
  if (/^\d{6}$/.test(token.trim())) {
    if (authenticator.verify({ token: token.trim(), secret })) return true;
  }

  // Otherwise try backup codes.
  for (const bc of user.backupCodes) {
    if (bc.used) continue;
    if (await argon2.verify(bc.hash, token.trim())) {
      bc.used = true;
      return true;
    }
  }
  return false;
}
