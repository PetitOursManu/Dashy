import type { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { ApiError } from '../middleware/error.js';
import { verifyCredentials, issueSession, verifyTwoFactorToken } from '../services/auth.js';
import { signPendingToken, verifyToken, type PendingPayload } from '../utils/jwt.js';

/**
 * Bearer-token authentication for the mobile app. Mirrors the cookie-based web
 * flow in `authController`, but returns the access token in the JSON body (a
 * native app has no cookie store) and carries the pending-2FA token in the
 * request body instead of a short-lived cookie.
 */

// ----------------------------- validation schemas -----------------------------

export const mobileLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  // Optional human-friendly device label, surfaced in the user's active sessions.
  device: z.string().max(120).trim().optional(),
});

export const mobileTwoFactorSchema = z.object({
  // Pending token returned by /login when 2FA is required.
  pendingToken: z.string().min(1),
  // 6-digit TOTP code OR a backup code like "a1b2-c3d4".
  token: z.string().min(6).max(20),
  // Optional human-friendly device label (carried over from /login).
  device: z.string().max(120).trim().optional(),
});

// --------------------------------- handlers ----------------------------------

/**
 * Step 1 of login. On success returns `{ token, user }`; when 2FA is enabled it
 * returns `{ twoFactorRequired: true, pendingToken }` and the client must call
 * /auth/2fa/verify to obtain the access token.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password, device } = req.body as z.infer<typeof mobileLoginSchema>;

  const user = await verifyCredentials(email, password);

  if (user.twoFactorEnabled) {
    res.json({ twoFactorRequired: true, pendingToken: signPendingToken(user.id) });
    return;
  }

  const { token } = await issueSession(req, user, device);
  res.json({ token, user: user.toJSON() });
}

/** Step 2 of login (only when 2FA is enabled): verify a TOTP / backup code. */
export async function verifyTwoFactor(req: Request, res: Response): Promise<void> {
  const { pendingToken, token, device } = req.body as z.infer<typeof mobileTwoFactorSchema>;

  let payload: PendingPayload;
  try {
    payload = verifyToken<PendingPayload>(pendingToken);
  } catch {
    throw new ApiError(401, 'Pending authentication expired');
  }
  if (!payload.pending2fa) throw new ApiError(400, 'Login already complete');

  const user = await User.findById(payload.sub);
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new ApiError(401, 'Two-factor authentication is not configured');
  }

  const ok = await verifyTwoFactorToken(user, token);
  if (!ok) throw new ApiError(401, 'Invalid two-factor code');

  await user.save(); // persist a consumed backup code if one was used
  const { token: accessToken } = await issueSession(req, user, device);
  res.json({ token: accessToken, user: user.toJSON() });
}

/** Revoke the current device's session (Bearer token becomes unusable). */
export async function logout(req: Request, res: Response): Promise<void> {
  if (req.user?.jti) {
    await Session.deleteOne({ jti: req.user.jti, user: req.user.sub });
  }
  res.json({ ok: true });
}
