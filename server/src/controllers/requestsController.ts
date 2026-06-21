import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ProjectRequest } from '../models/ProjectRequest.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { ApiError } from '../middleware/error.js';
import { emailOf } from '../services/activity.js';

export const createRequestSchema = z.object({
  kind: z.enum(['idea', 'file']).default('idea'),
  message: z.string().min(1).max(2000),
});

export const requestStatusSchema = z.object({
  status: z.enum(['pending', 'resolved', 'dismissed']),
});

export const replyRequestSchema = z.object({
  message: z.string().min(1).max(1000),
});

// -------------------------------- user actions -------------------------------

/** User: send a project request (idea or file suggestion) to the admins. */
export async function createRequest(req: Request, res: Response): Promise<void> {
  const { kind, message } = req.body as z.infer<typeof createRequestSchema>;
  const user = await User.findById(req.user!.sub).select('email');
  if (!user) throw new ApiError(404, 'User not found');

  const request = await ProjectRequest.create({
    user: user._id,
    userEmail: user.email,
    kind,
    message,
  });
  res.status(201).json({ request: request.toJSON() });
}

/** User: my request history (newest first). */
export async function listMyRequests(req: Request, res: Response): Promise<void> {
  const requests = await ProjectRequest.find({ user: req.user!.sub })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json({ requests: requests.map((r) => r.toJSON()) });
}

// -------------------------------- admin actions ------------------------------

/**
 * Admin: list requests. By default returns everything except dismissed (the
 * quick dashboard view); `?status=all|pending|resolved|dismissed` lets the
 * dedicated Requests page show any subset.
 */
export async function listAdminRequests(req: Request, res: Response): Promise<void> {
  const status = String(req.query.status ?? '');
  const filter =
    status === 'all'
      ? {}
      : ['pending', 'resolved', 'dismissed'].includes(status)
        ? { status }
        : { status: { $ne: 'dismissed' } };

  const requests = await ProjectRequest.find(filter).sort({ createdAt: -1 }).limit(100);
  res.json({ requests: requests.map((r) => r.toJSON()) });
}

/** Admin: update a request's status (resolve / dismiss / reopen). */
export async function setRequestStatus(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Request not found');
  const request = await ProjectRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Request not found');

  const { status } = req.body as z.infer<typeof requestStatusSchema>;
  request.status = status;
  await request.save();
  res.json({ request: request.toJSON() });
}

/**
 * Admin: reply to a request — pushes a dashboard notification to the requester
 * and marks the request resolved.
 */
export async function replyToRequest(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Request not found');
  const request = await ProjectRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Request not found');

  const { message } = req.body as z.infer<typeof replyRequestSchema>;
  await Notification.create({
    user: request.user,
    userEmail: request.userEmail,
    kind: 'request-reply',
    message,
    createdByEmail: await emailOf(req.user!.sub),
  });

  request.status = 'resolved';
  await request.save();
  res.json({ request: request.toJSON() });
}
