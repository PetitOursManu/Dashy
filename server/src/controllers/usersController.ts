import type { Request, Response } from 'express';
import argon2 from 'argon2';
import mongoose, { type Types } from 'mongoose';
import { z } from 'zod';
import { User } from '../models/User.js';
import { HostedApp } from '../models/HostedApp.js';
import { ApiError } from '../middleware/error.js';
import { logActivity, emailOf } from '../services/activity.js';

// ----------------------------- validation schemas -----------------------------

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'user']).default('user'),
  allowedApps: z.array(z.string()).optional().default([]),
});

export const updateUserSchema = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    password: z.string().min(8).max(200).optional(),
    allowedApps: z.array(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

// --------------------------------- helpers -----------------------------------

/** Keep only ids that correspond to existing apps; return them as ObjectIds. */
async function resolveAllowedApps(ids: string[]): Promise<Types.ObjectId[]> {
  const valid = ids.filter((id) => mongoose.isValidObjectId(id));
  if (valid.length === 0) return [];
  const found = await HostedApp.find({ _id: { $in: valid } }).select('_id');
  return found.map((a) => a._id as Types.ObjectId);
}

// --------------------------------- handlers ----------------------------------

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await User.find().sort({ createdAt: 1 });
  res.json({ users: users.map((u) => u.toJSON()) });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const { email, password, role, allowedApps } = req.body as z.infer<typeof createUserSchema>;

  if (await User.findOne({ email })) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await User.create({
    email,
    passwordHash,
    role,
    allowedApps: await resolveAllowedApps(allowedApps),
  });

  logActivity('user.created', await emailOf(req.user!.sub), `created user ${user.email}`);
  res.status(201).json({ user: user.toJSON() });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

  const updates = req.body as z.infer<typeof updateUserSchema>;

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

  await user.save();
  res.json({ user: user.toJSON() });
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  if (req.params.id === req.user!.sub) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

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
