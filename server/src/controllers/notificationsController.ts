import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { ApiError } from '../middleware/error.js';
import { emailOf } from '../services/activity.js';

export const createNotificationSchema = z.object({
  userId: z.string().min(1),
  message: z.string().min(1).max(1000),
});

// ------------------------------- admin actions -------------------------------

/** Admin: push a text notification to a user's dashboard. */
export async function createNotification(req: Request, res: Response): Promise<void> {
  const { userId, message } = req.body as z.infer<typeof createNotificationSchema>;
  if (!mongoose.isValidObjectId(userId)) throw new ApiError(404, 'User not found');

  const target = await User.findById(userId).select('email');
  if (!target) throw new ApiError(404, 'User not found');

  const notification = await Notification.create({
    user: target._id,
    userEmail: target.email,
    message,
    createdByEmail: await emailOf(req.user!.sub),
  });
  res.status(201).json({ notification: notification.toJSON() });
}

/** Admin: list notifications for the dashboard tile (newest activity first). */
export async function listAdminNotifications(_req: Request, res: Response): Promise<void> {
  const notifications = await Notification.find({ dismissedByAdmin: false })
    .sort({ updatedAt: -1 })
    .limit(50);
  res.json({ notifications: notifications.map((n) => n.toJSON()) });
}

/** Admin: remove a notification from the dashboard tile. */
export async function dismissNotification(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Notification not found');
  const n = await Notification.findById(req.params.id);
  if (!n) throw new ApiError(404, 'Notification not found');
  n.dismissedByAdmin = true;
  await n.save();
  res.json({ ok: true });
}

// -------------------------------- user actions -------------------------------

/** User: my unread dashboard notifications. */
export async function listMyNotifications(req: Request, res: Response): Promise<void> {
  const notifications = await Notification.find({ user: req.user!.sub, readAt: null }).sort({
    createdAt: 1,
  });
  res.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      message: n.message,
      requestMessage: n.requestMessage || null,
      createdAt: n.createdAt,
    })),
  });
}

/** User: acknowledge (read) a notification — the only way it disappears. */
export async function readNotification(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Notification not found');
  const n = await Notification.findOne({ _id: req.params.id, user: req.user!.sub });
  if (!n) throw new ApiError(404, 'Notification not found');
  if (!n.readAt) {
    n.readAt = new Date();
    await n.save();
  }
  res.json({ ok: true });
}
