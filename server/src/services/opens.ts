import type { Types } from 'mongoose';
import { HostedApp } from '../models/HostedApp.js';
import { OpenEvent } from '../models/OpenEvent.js';

/**
 * Record an app "open" (entry navigation). Fire-and-forget. `userId` is null
 * for anonymous opens through a public share link.
 */
export function recordOpen(appId: Types.ObjectId, userId?: string | null): void {
  HostedApp.updateOne(
    { _id: appId },
    { $inc: { openCount: 1 }, $set: { lastOpenedAt: new Date() } },
  ).catch(() => {});
  OpenEvent.create({ app: appId, user: userId ?? null }).catch(() => {});
}
