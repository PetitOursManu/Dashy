import argon2 from 'argon2';
import { User } from '../models/User.js';
import { env } from '../config/env.js';

/**
 * On first start, create the admin account from ADMIN_EMAIL / ADMIN_PASSWORD
 * if (and only if) the users collection is empty.
 */
export async function seedAdmin(): Promise<void> {
  const count = await User.estimatedDocumentCount();
  if (count > 0) return;

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.warn(
      '[seed] Users collection is empty but ADMIN_EMAIL / ADMIN_PASSWORD are not set — no admin created.',
    );
    return;
  }

  const passwordHash = await argon2.hash(env.ADMIN_PASSWORD, { type: argon2.argon2id });
  await User.create({
    email: env.ADMIN_EMAIL,
    passwordHash,
    role: 'admin',
  });
  console.log(`[seed] Created admin account for ${env.ADMIN_EMAIL}`);
}
