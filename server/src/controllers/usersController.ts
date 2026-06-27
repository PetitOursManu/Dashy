import type { Request, Response } from 'express';
import argon2 from 'argon2';
import mongoose, { type Types } from 'mongoose';
import { z } from 'zod';
import { User } from '../models/User.js';
import { HostedApp } from '../models/HostedApp.js';
import { OpenEvent } from '../models/OpenEvent.js';
import { ChatAlert } from '../models/ChatAlert.js';
import { Notification } from '../models/Notification.js';
import { ApiError } from '../middleware/error.js';
import { logActivity, emailOf } from '../services/activity.js';

// ----------------------------- validation schemas -----------------------------

const ROLES = ['admin', 'subadmin', 'user', 'temp'] as const;
// Up to a year, in hours — covers the days/hours picker on the client.
const durationHours = z.number().int().min(1).max(24 * 365);

export const createUserSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).max(200),
    role: z.enum(ROLES).default('user'),
    allowedApps: z.array(z.string()).optional().default([]),
    // Assistant access is granted by default for new users.
    chatEnabled: z.boolean().optional().default(true),
    // Required for `temp` accounts: lifetime in hours.
    durationHours: durationHours.optional(),
  })
  .refine((v) => v.role !== 'temp' || (v.durationHours ?? 0) > 0, {
    message: 'A duration is required for a temporary account',
    path: ['durationHours'],
  });

export const updateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    password: z.string().min(8).max(200).optional(),
    allowedApps: z.array(z.string()).optional(),
    chatEnabled: z.boolean().optional(),
    // Extend (or set) a temporary account's lifetime from now.
    durationHours: durationHours.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

type Role = (typeof ROLES)[number];

/** A semi-admin may only ever touch regular / temporary accounts. */
function assertCanManage(actorRole: Role, targetRole: Role): void {
  if (actorRole === 'admin') return;
  if (targetRole === 'admin' || targetRole === 'subadmin') {
    throw new ApiError(403, 'You cannot manage administrator accounts');
  }
}

const expiryFromHours = (h: number): Date => new Date(Date.now() + h * 3_600_000);

export const chatTimeoutSchema = z.object({
  // Minutes to time out the assistant; 0 or null clears the time-out.
  minutes: z.number().int().min(0).max(60 * 24 * 30).nullable(),
});

// --------------------------------- helpers -----------------------------------

/** Keep only ids that correspond to existing apps; return them as ObjectIds. */
async function resolveAllowedApps(ids: string[]): Promise<Types.ObjectId[]> {
  const valid = ids.filter((id) => mongoose.isValidObjectId(id));
  if (valid.length === 0) return [];
  const found = await HostedApp.find({ _id: { $in: valid } }).select('_id');
  return found.map((a) => a._id as Types.ObjectId);
}

// --------------------------------- handlers ----------------------------------

export async function listUsers(req: Request, res: Response): Promise<void> {
  // A semi-admin only sees the accounts they may manage (regular + temporary).
  const filter = req.user!.role === 'admin' ? {} : { role: { $in: ['user', 'temp'] } };
  const users = await User.find(filter).sort({ createdAt: 1 });
  res.json({ users: users.map((u) => u.toJSON()) });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const { email, password, role, allowedApps, chatEnabled, durationHours } = req.body as z.infer<
    typeof createUserSchema
  >;
  assertCanManage(req.user!.role as Role, role);

  if (await User.findOne({ email })) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await User.create({
    email,
    passwordHash,
    role,
    allowedApps: await resolveAllowedApps(allowedApps),
    chatEnabled,
    expiresAt: role === 'temp' ? expiryFromHours(durationHours!) : null,
  });

  logActivity('user.created', await emailOf(req.user!.sub), `created ${role} ${user.email}`);
  res.status(201).json({ user: user.toJSON() });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

  const actorRole = req.user!.role as Role;
  // A semi-admin can't touch a staff account, nor promote anyone to staff.
  assertCanManage(actorRole, user.role as Role);
  const updates = req.body as z.infer<typeof updateUserSchema>;
  if (updates.role) assertCanManage(actorRole, updates.role);

  // Prevent demoting the last administrator (would lock everyone out of admin).
  if (updates.role && updates.role !== user.role && user.role === 'admin') {
    const admins = await User.countDocuments({ role: 'admin' });
    if (admins <= 1) {
      throw new ApiError(400, 'Cannot change the role of the last administrator');
    }
    user.role = updates.role;
  } else if (updates.role) {
    user.role = updates.role;
  }

  if (updates.allowedApps) {
    user.allowedApps = await resolveAllowedApps(updates.allowedApps);
  }

  if (updates.password) {
    user.passwordHash = await argon2.hash(updates.password, { type: argon2.argon2id });
  }

  if (updates.chatEnabled !== undefined) {
    user.chatEnabled = updates.chatEnabled;
  }

  // Keep `expiresAt` consistent with the (possibly new) role: extend a temp from
  // now when a duration is given, and clear it for any non-temp role.
  if (user.role === 'temp') {
    if (updates.durationHours) user.expiresAt = expiryFromHours(updates.durationHours);
  } else {
    user.expiresAt = null;
  }

  await user.save();
  res.json({ user: user.toJSON() });
}

/**
 * Admin: a user's Dashy history — most-used apps, assistant misuse count and
 * recent flagged messages, 2FA status, current assistant time-out, and recent
 * dashboard notifications sent to them (with read receipts).
 */
export async function userHistory(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'User not found');
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  assertCanManage(req.user!.role as Role, user.role as Role);

  const [topAppsAgg, alertCount, recentAlerts, notifications] = await Promise.all([
    OpenEvent.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { user: user._id } },
      { $group: { _id: '$app', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    ChatAlert.countDocuments({ user: user._id }),
    ChatAlert.find({ user: user._id }).sort({ createdAt: -1 }).limit(3),
    Notification.find({ user: user._id }).sort({ createdAt: -1 }).limit(8),
  ]);

  // Resolve app names for the top-used apps.
  const apps = await HostedApp.find({ _id: { $in: topAppsAgg.map((t) => t._id) } }).select('name');
  const nameById = new Map(apps.map((a) => [String(a._id), a.name]));
  const topApps = topAppsAgg.map((t) => ({
    id: String(t._id),
    name: nameById.get(String(t._id)) ?? '(deleted app)',
    opens: t.count,
  }));

  const now = Date.now();
  const timedOut = user.chatTimeoutUntil ? user.chatTimeoutUntil.getTime() > now : false;

  res.json({
    twoFactorEnabled: user.twoFactorEnabled,
    chatEnabled: user.chatEnabled !== false,
    chatTimeoutUntil: timedOut ? user.chatTimeoutUntil : null,
    botAlertCount: alertCount,
    recentBotMessages: recentAlerts.flatMap((a) => a.messages).slice(0, 6),
    topApps,
    notifications: notifications.map((n) => ({
      id: n.id,
      message: n.message,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  });
}

/** Admin: time out (or clear) the assistant for a user. */
export async function setChatTimeout(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'User not found');
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  assertCanManage(req.user!.role as Role, user.role as Role);

  const { minutes } = req.body as z.infer<typeof chatTimeoutSchema>;
  user.chatTimeoutUntil =
    minutes && minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  await user.save();
  res.json({ chatTimeoutUntil: user.chatTimeoutUntil });
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  if (req.params.id === req.user!.sub) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  assertCanManage(req.user!.role as Role, user.role as Role);

  if (user.role === 'admin') {
    const admins = await User.countDocuments({ role: 'admin' });
    if (admins <= 1) {
      throw new ApiError(400, 'Cannot delete the last administrator');
    }
  }

  const email = user.email;
  await user.deleteOne();
  logActivity('user.deleted', await emailOf(req.user!.sub), `deleted user ${email}`);
  res.json({ ok: true });
}
