import { User } from '../models/User.js';
import { OpenEvent } from '../models/OpenEvent.js';
import { Notification } from '../models/Notification.js';
import { ProjectRequest } from '../models/ProjectRequest.js';
import { ChatAlert } from '../models/ChatAlert.js';
import { Session } from '../models/Session.js';

/**
 * Delete temporary accounts whose lifetime has elapsed, plus the rows that
 * reference them. Returns the number of accounts removed. Best-effort and safe
 * to call repeatedly (run at boot and on an interval).
 */
export async function purgeExpiredTempUsers(): Promise<number> {
  const expired = await User.find({
    role: 'temp',
    expiresAt: { $ne: null, $lte: new Date() },
  }).select('_id');
  if (expired.length === 0) return 0;

  const ids = expired.map((u) => u._id);
  await Promise.all([
    User.deleteMany({ _id: { $in: ids } }),
    OpenEvent.deleteMany({ user: { $in: ids } }),
    Notification.deleteMany({ user: { $in: ids } }),
    ProjectRequest.deleteMany({ user: { $in: ids } }),
    ChatAlert.deleteMany({ user: { $in: ids } }),
    Session.deleteMany({ user: { $in: ids } }),
  ]);
  return ids.length;
}

let timer: NodeJS.Timeout | null = null;

/** Start the periodic purge (every 15 min) plus an immediate sweep. */
export function startTempUserPurge(): void {
  if (timer) return;
  void purgeExpiredTempUsers().catch(() => {});
  timer = setInterval(() => void purgeExpiredTempUsers().catch(() => {}), 15 * 60_000);
  timer.unref?.();
}
