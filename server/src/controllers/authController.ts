import type { Request, Response } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { User, type UserDoc } from '../models/User.js';
import { Session } from '../models/Session.js';
import { env } from '../config/env.js';
import { AVATARS_DIR, BACKGROUNDS_DIR } from '../config/paths.js';
import { ApiError } from '../middleware/error.js';
import { encrypt, decrypt, generateBackupCodes } from '../utils/crypto.js';
import { sanitizeNoteHtml } from '../utils/sanitizeHtml.js';
import { logActivity } from '../services/activity.js';
import { verifyCredentials, issueSession, verifyTwoFactorToken } from '../services/auth.js';
import {
  COOKIE_NAME,
  cookieOptions,
  signPendingToken,
  verifyToken,
  type PendingPayload,
  type JwtPayload,
} from '../utils/jwt.js';

const ACCESS_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// ----------------------------- validation schemas -----------------------------

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const twoFactorVerifySchema = z.object({
  // 6-digit TOTP code OR a backup code like "a1b2-c3d4".
  token: z.string().min(6).max(20),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const disable2faSchema = z.object({
  password: z.string().min(1).max(200),
});

export const noteSchema = z.object({
  content: z.string().max(20_000),
});

export const profileSchema = z
  .object({
    nickname: z.string().max(60).trim().optional(),
    fullName: z.string().max(120).trim().optional(),
    jobTitle: z.string().max(120).trim().optional(),
    language: z.enum(['en', 'fr', 'es', 'de', 'it', 'zh', 'ru']).optional(),
    theme: z.enum(['light', 'dark', 'violet', 'image']).optional(),
    glass: z.boolean().optional(),
    glassDark: z.boolean().optional(),
    timezone: z.string().max(64).optional(),
    dateFormat: z.enum(['', 'dmy', 'mdy', 'iso']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

// --------------------------------- helpers -----------------------------------

/** Create a session record + set the signed access-token cookie. */
async function setAuthCookie(req: Request, res: Response, user: UserDoc): Promise<void> {
  const { token } = await issueSession(req, user);
  res.cookie(COOKIE_NAME, token, cookieOptions(ACCESS_COOKIE_MAX_AGE));
}

async function hashBackupCodes(codes: string[]): Promise<{ hash: string; used: boolean }[]> {
  return Promise.all(
    codes.map(async (code) => ({ hash: await argon2.hash(code), used: false })),
  );
}

// --------------------------------- handlers ----------------------------------

export async function register(req: Request, res: Response): Promise<void> {
  if (!env.ALLOW_REGISTRATION) {
    throw new ApiError(403, 'Registration is disabled');
  }
  const { email, password } = req.body as z.infer<typeof credentialsSchema>;

  const existing = await User.findOne({ email });
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  // First registered user becomes admin only if no users exist yet.
  const isFirst = (await User.estimatedDocumentCount()) === 0;
  const user = await User.create({
    email,
    passwordHash,
    role: isFirst ? 'admin' : 'user',
  });

  await setAuthCookie(req, res, user);
  res.status(201).json({ user: user.toJSON() });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as z.infer<typeof credentialsSchema>;

  const user = await verifyCredentials(email, password);

  if (user.twoFactorEnabled) {
    const pending = signPendingToken(user.id);
    res.cookie(COOKIE_NAME, pending, cookieOptions(5 * 60 * 1000));
    res.json({ twoFactorRequired: true });
    return;
  }

  await setAuthCookie(req, res, user);
  res.json({ user: user.toJSON() });
}

/** Complete login by verifying a TOTP token or a backup code. */
export async function verifyTwoFactorLogin(req: Request, res: Response): Promise<void> {
  const pendingToken = req.cookies?.[COOKIE_NAME];
  if (!pendingToken) throw new ApiError(401, 'No pending authentication');

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

  const { token } = req.body as z.infer<typeof twoFactorVerifySchema>;
  const ok = await verifyTwoFactorToken(user, token);
  if (!ok) throw new ApiError(401, 'Invalid two-factor code');

  await user.save(); // persist a consumed backup code if one was used
  await setAuthCookie(req, res, user);
  res.json({ user: user.toJSON() });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ user: user.toJSON() });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = verifyToken<JwtPayload>(token);
      if (payload.jti) await Session.deleteOne({ jti: payload.jti });
    } catch {
      /* token already invalid — nothing to revoke */
    }
  }
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
}

/** List the current user's active sessions (most recent first). */
export async function listSessions(req: Request, res: Response): Promise<void> {
  const sessions = await Session.find({ user: req.user!.sub }).sort({ lastSeenAt: -1 });
  res.json({
    sessions: sessions.map((s) => ({ ...s.toJSON(), current: s.jti === req.user!.jti })),
  });
}

/** Revoke a single session (logs out that device). */
export async function revokeSession(req: Request, res: Response): Promise<void> {
  const session = await Session.findOne({ _id: req.params.id, user: req.user!.sub });
  if (!session) throw new ApiError(404, 'Session not found');
  const isCurrent = session.jti === req.user!.jti;
  await session.deleteOne();
  if (isCurrent) res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true, current: isCurrent });
}

/** Update the current user's own profile + preferences. */
export async function updateProfile(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');

  const updates = req.body as z.infer<typeof profileSchema>;
  if (updates.nickname !== undefined) user.nickname = updates.nickname;
  if (updates.fullName !== undefined) user.fullName = updates.fullName;
  if (updates.jobTitle !== undefined) user.jobTitle = updates.jobTitle;
  if (updates.language !== undefined) user.language = updates.language;
  if (updates.theme !== undefined) user.theme = updates.theme;
  if (updates.glass !== undefined) user.glass = updates.glass;
  if (updates.glassDark !== undefined) user.glassDark = updates.glassDark;
  if (updates.timezone !== undefined) user.timezone = updates.timezone;
  if (updates.dateFormat !== undefined) user.dateFormat = updates.dateFormat;

  await user.save();
  res.json({ user: user.toJSON() });
}

/** Get the current user's personal note. */
export async function getNote(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub).select('note');
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ content: user.note ?? '' });
}

/** Save the current user's personal note (sanitized rich text). */
export async function updateNote(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  const { content } = req.body as z.infer<typeof noteSchema>;
  user.note = sanitizeNoteHtml(content);
  await user.save();
  res.json({ content: user.note });
}

/** Sign out of every device by invalidating all issued tokens + sessions. */
export async function logoutAll(req: Request, res: Response): Promise<void> {
  await User.updateOne({ _id: req.user!.sub }, { $inc: { tokenVersion: 1 } });
  await Session.deleteMany({ user: req.user!.sub });
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
}

// ------------------------------- avatar --------------------------------------

export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new ApiError(400, 'No image uploaded');
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');

  const old = user.avatar;
  user.avatar = path.basename(req.file.filename);
  await user.save();
  if (old) {
    await fsp.rm(path.join(AVATARS_DIR, path.basename(old)), { force: true }).catch(() => {});
  }
  res.json({ user: user.toJSON() });
}

export async function deleteAvatar(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.avatar) {
    await fsp
      .rm(path.join(AVATARS_DIR, path.basename(user.avatar)), { force: true })
      .catch(() => {});
    user.avatar = null;
    await user.save();
  }
  res.json({ user: user.toJSON() });
}

// ----------------------------- background image ------------------------------

export async function uploadBackground(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new ApiError(400, 'No image uploaded');
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');

  const old = user.background;
  user.background = path.basename(req.file.filename);
  await user.save();
  if (old) {
    await fsp.rm(path.join(BACKGROUNDS_DIR, path.basename(old)), { force: true }).catch(() => {});
  }
  res.json({ user: user.toJSON() });
}

export async function deleteBackground(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.background) {
    await fsp
      .rm(path.join(BACKGROUNDS_DIR, path.basename(user.background)), { force: true })
      .catch(() => {});
    user.background = null;
    await user.save();
  }
  res.json({ user: user.toJSON() });
}

/** Serve the current user's own background image. */
export async function getBackground(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub).select('background');
  if (!user || !user.background) throw new ApiError(404, 'No background');
  const file = path.join(BACKGROUNDS_DIR, path.basename(user.background));
  if (!fs.existsSync(file)) throw new ApiError(404, 'No background');
  res.set('Cache-Control', 'private, max-age=60');
  res.sendFile(file);
}

/** Serve any team member's avatar image (auth required). */
export async function getAvatar(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.params.id).select('avatar');
  if (!user || !user.avatar) throw new ApiError(404, 'No avatar');
  const file = path.join(AVATARS_DIR, path.basename(user.avatar));
  if (!fs.existsSync(file)) throw new ApiError(404, 'No avatar');
  res.set('Cache-Control', 'private, max-age=60');
  res.sendFile(file);
}

// ------------------------------- 2FA management ------------------------------

/** Begin 2FA setup: generate a secret + backup codes, return QR + secret. */
export async function setupTwoFactor(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.twoFactorEnabled) {
    throw new ApiError(400, 'Two-factor authentication is already enabled');
  }

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.email, 'Dashy', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  const backupCodes = generateBackupCodes(10);

  // Store the (encrypted) secret and hashed backup codes, but keep 2FA disabled
  // until the user proves they can generate a valid code via /enable.
  user.twoFactorSecret = encrypt(secret);
  user.backupCodes = await hashBackupCodes(backupCodes);
  await user.save();

  res.json({
    secret, // base32, shown once for manual entry
    otpauth,
    qrDataUrl,
    backupCodes, // plaintext, shown once
  });
}

/** Confirm and enable 2FA by verifying a token against the pending secret. */
export async function enableTwoFactor(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.twoFactorEnabled) {
    throw new ApiError(400, 'Two-factor authentication is already enabled');
  }
  if (!user.twoFactorSecret) {
    throw new ApiError(400, 'Start 2FA setup before enabling');
  }

  const { token } = req.body as z.infer<typeof twoFactorVerifySchema>;
  const secret = decrypt(user.twoFactorSecret);
  if (!/^\d{6}$/.test(token.trim()) || !authenticator.verify({ token: token.trim(), secret })) {
    throw new ApiError(401, 'Invalid verification code');
  }

  user.twoFactorEnabled = true;
  await user.save();
  logActivity('twofactor.enabled', user.email, 'enabled two-factor authentication');
  res.json({ ok: true, twoFactorEnabled: true });
}

/** Disable 2FA (requires the account password as confirmation). */
export async function disableTwoFactor(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');

  const { password } = req.body as z.infer<typeof disable2faSchema>;
  if (!(await argon2.verify(user.passwordHash, password))) {
    throw new ApiError(401, 'Incorrect password');
  }

  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  user.backupCodes = [];
  await user.save();
  res.json({ ok: true, twoFactorEnabled: false });
}

/** Regenerate backup codes (requires 2FA to be enabled). */
export async function regenerateBackupCodes(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  if (!user.twoFactorEnabled) {
    throw new ApiError(400, 'Enable two-factor authentication first');
  }

  const backupCodes = generateBackupCodes(10);
  user.backupCodes = await hashBackupCodes(backupCodes);
  await user.save();
  res.json({ backupCodes });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');

  const { currentPassword, newPassword } = req.body as z.infer<typeof passwordChangeSchema>;
  if (!(await argon2.verify(user.passwordHash, currentPassword))) {
    throw new ApiError(401, 'Current password is incorrect');
  }

  user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await user.save();
  res.json({ ok: true });
}
