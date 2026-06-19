import type { Types } from 'mongoose';
import { User } from '../models/User.js';
import { ApiError } from '../middleware/error.js';
import type { JwtPayload } from '../utils/jwt.js';

/**
 * Whether the authenticated user may open/read a given app. Admins always can;
 * regular users only if the app id is in their `allowedApps`.
 */
export async function userCanAccessApp(
  reqUser: JwtPayload,
  appId: Types.ObjectId | string,
): Promise<boolean> {
  if (reqUser.role === 'admin') return true;
  const exists = await User.exists({ _id: reqUser.sub, allowedApps: appId });
  return exists !== null;
}

export async function assertCanAccessApp(
  reqUser: JwtPayload,
  appId: Types.ObjectId | string,
): Promise<void> {
  if (!(await userCanAccessApp(reqUser, appId))) {
    throw new ApiError(403, 'You do not have access to this app');
  }
}
