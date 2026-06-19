import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export interface BackupCode {
  hash: string;
  used: boolean;
}

export interface IUser {
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  backupCodes: BackupCode[];
  // Apps a regular user may open. Admins implicitly have access to every app,
  // so this list is only consulted for non-admin users.
  allowedApps: Types.ObjectId[];
  // Apps the user has starred (shown first / filterable on the dashboard).
  favorites: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A backup code: stored only as an argon2 hash, with a `used` flag so a code
 * can be consumed exactly once.
 */
const backupCodeSchema = new Schema<BackupCode>(
  {
    hash: { type: String, required: true },
    used: { type: Boolean, default: false },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // argon2id hash of the password — never the plaintext.
    passwordHash: { type: String, required: true },

    role: { type: String, enum: ['admin', 'user'], default: 'user' },

    // --- TOTP 2FA ---
    twoFactorEnabled: { type: Boolean, default: false },
    // AES-256-GCM encrypted TOTP secret (null until setup begins).
    twoFactorSecret: { type: String, default: null },
    // Hashed, single-use backup codes.
    backupCodes: { type: [backupCodeSchema], default: [] },

    // Per-user app access (ignored for admins, who see everything).
    allowedApps: {
      type: [{ type: Schema.Types.ObjectId, ref: 'HostedApp' }],
      default: [],
      index: true,
    },

    // Per-user starred apps.
    favorites: {
      type: [{ type: Schema.Types.ObjectId, ref: 'HostedApp' }],
      default: [],
    },
  },
  { timestamps: true },
);

// Expose `id` (string) instead of `_id`, and never leak sensitive fields.
userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    delete r.passwordHash;
    delete r.twoFactorSecret;
    delete r.backupCodes;
    return r;
  },
});

export type UserDoc = HydratedDocument<IUser>;

export const User = mongoose.model<IUser>('User', userSchema);
