import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { HostedApp } from '../models/HostedApp.js';
import { User } from '../models/User.js';
import { Notification } from '../models/Notification.js';
import { ProjectRequest } from '../models/ProjectRequest.js';
import { StoreInstalledApp } from '../models/StoreInstalledApp.js';
import { ApiError } from '../middleware/error.js';
import { serializeApp } from './appsController.js';
import { chatAvailability } from './chatController.js';

/** Bumped when the mobile contract changes in a breaking way. */
export const MOBILE_API_VERSION = 1;

const SERVER_NAME = 'Dashy';

function serverMeta() {
  return { name: SERVER_NAME, allowRegistration: env.ALLOW_REGISTRATION };
}

/**
 * Public discovery endpoint (no auth): lets the mobile app validate a server URL
 * and learn the API version + enabled features before showing the login screen.
 */
export async function info(_req: Request, res: Response): Promise<void> {
  res.json({
    apiVersion: MOBILE_API_VERSION,
    server: serverMeta(),
    features: { twoFactor: true, store: true, notifications: true, requests: true, chat: true },
  });
}

/**
 * Aggregated snapshot to hydrate the app in a single round-trip: profile,
 * accessible apps, favorites, personal note, unread notifications and the user's
 * requests. Staff (admin + semi-admin) additionally get an `admin` block with
 * Store installs and headline stats. Full-fidelity admin data lives at the
 * dedicated /store/* and /stats/* endpoints.
 */
export async function sync(req: Request, res: Response): Promise<void> {
  const me = await User.findById(req.user!.sub);
  if (!me) throw new ApiError(404, 'User not found');

  const favorites = new Set(me.favorites.map(String));
  const isStaff = req.user!.role === 'admin' || req.user!.role === 'subadmin';

  // Staff see every app; regular/temporary users only the ones assigned to them.
  const apps = isStaff
    ? await HostedApp.find().sort({ createdAt: -1 })
    : await HostedApp.find({ _id: { $in: me.allowedApps } }).sort({ createdAt: -1 });

  const [notifications, requests, chatAvailable] = await Promise.all([
    Notification.find({ user: me._id, readAt: null }).sort({ createdAt: 1 }),
    ProjectRequest.find({ user: me._id }).sort({ createdAt: -1 }).limit(50),
    chatAvailability(me.id),
  ]);

  const payload: Record<string, unknown> = {
    apiVersion: MOBILE_API_VERSION,
    serverTime: new Date().toISOString(),
    server: serverMeta(),
    user: me.toJSON(),
    note: me.note ?? '',
    apps: apps.map((a) => serializeApp(a, favorites)),
    favorites: [...favorites],
    notifications: notifications.map((n) => ({
      id: n.id,
      message: n.message,
      requestMessage: n.requestMessage || null,
      createdAt: n.createdAt,
    })),
    requests: requests.map((r) => r.toJSON()),
    // Whether the AI assistant is usable right now (provider configured + user
    // allowed + not timed out) and whether the user may still contact an admin.
    chat: { available: chatAvailable, canRequest: me.chatEnabled !== false },
  };

  if (isStaff) {
    const [installed, totalApps, totalUsers, pendingRequests] = await Promise.all([
      StoreInstalledApp.find().sort({ createdAt: -1 }),
      HostedApp.estimatedDocumentCount(),
      User.estimatedDocumentCount(),
      ProjectRequest.countDocuments({ status: 'pending', archived: false }),
    ]);
    payload.admin = {
      store: { installed: installed.map((i) => i.toJSON()) },
      stats: { totalApps, totalUsers, pendingRequests },
    };
  }

  res.json(payload);
}
