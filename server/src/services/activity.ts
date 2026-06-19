import { Activity, type ActivityType } from '../models/Activity.js';
import { User } from '../models/User.js';

/** Best-effort activity logging — never blocks or fails the originating request. */
export function logActivity(type: ActivityType, actorEmail: string, message: string): void {
  Activity.create({ type, actorEmail, message }).catch((err) => {
    console.error('[activity] failed to log', err);
  });
}

/** Resolve a user's email from their id (for activity attribution). */
export async function emailOf(userId: string): Promise<string> {
  const user = await User.findById(userId).select('email');
  return user?.email ?? 'unknown';
}
