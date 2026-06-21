import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export interface BackupCode {
  hash: string;
  used: boolean;
}

export interface IUser {
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  // --- Profile (self-editable, visible to admins) ---
  nickname: string;
  fullName: string;
  jobTitle: string;
  avatar: string | null;
  // --- Preferences ---
  language: string;
  theme: string;
  // Filename of the uploaded background image under BACKGROUNDS_DIR (for the
  // "image" theme), or null.
  background: string | null;
  // Whether the frosted-glass effect is enabled (image theme only).
  glass: boolean;
  // Image theme tint: true = dark surfaces/light text, false = light (default).
  glassDark: boolean;
  timezone: string;
  dateFormat: string;
  // Whether this user may use the Dashy AI assistant (admin-toggleable,
  // granted by default on user creation).
  chatEnabled: boolean;
  // Buffer of recent off-topic assistant requests (the user's messages), since
  // the last admin alert was raised. Cleared each time an alert fires.
  chatOffTopic: string[];
  // If set and in the future, the assistant is temporarily blocked for this
  // user (admin-imposed "time-out"). Null = no time-out.
  chatTimeoutUntil: Date | null;
  // Personal rich-text note (sanitized HTML), persisted across sessions.
  note: string;
  // Bumped to invalidate all existing sessions ("sign out everywhere").
  tokenVersion: number;
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

    // --- Profile ---
    nickname: { type: String, default: '', trim: true, maxlength: 60 },
    fullName: { type: String, default: '', trim: true, maxlength: 120 },
    jobTitle: { type: String, default: '', trim: true, maxlength: 120 },
    // Filename of the uploaded avatar under AVATARS_DIR, or null.
    avatar: { type: String, default: null },

    // --- Preferences ---
    language: { type: String, default: 'en', maxlength: 8 },
    theme: { type: String, default: 'light', maxlength: 16 },
    background: { type: String, default: null },
    glass: { type: Boolean, default: true },
    glassDark: { type: Boolean, default: false },
    timezone: { type: String, default: '', maxlength: 64 },
    dateFormat: { type: String, default: '', maxlength: 8 },

    // Access to the Dashy AI assistant — on by default for new users.
    chatEnabled: { type: Boolean, default: true },
    // Off-topic strike buffer (internal; never serialized).
    chatOffTopic: { type: [String], default: [] },
    // Admin-imposed assistant time-out (null = none).
    chatTimeoutUntil: { type: Date, default: null },
    // Personal rich-text note (sanitized HTML).
    note: { type: String, default: '', maxlength: 20_000 },

    // Session epoch — incrementing it invalidates all issued JWTs.
    tokenVersion: { type: Number, default: 0 },

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
    // Expose only whether an avatar exists, not the internal filename / counters.
    r.hasAvatar = Boolean(r.avatar);
    delete r.avatar;
    r.hasBackground = Boolean(r.background);
    delete r.background;
    r.glass = r.glass !== false;
    r.glassDark = r.glassDark === true;
    delete r.tokenVersion;
    // Default to enabled for documents created before this field existed.
    r.chatEnabled = r.chatEnabled !== false;
    delete r.chatOffTopic;
    delete r.chatTimeoutUntil;
    delete r.note;
    return r;
  },
});

export type UserDoc = HydratedDocument<IUser>;

export const User = mongoose.model<IUser>('User', userSchema);
