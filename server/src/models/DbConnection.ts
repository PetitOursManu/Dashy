import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';
import type { DbEngine, SslMode } from '../db-drivers/types.js';

/**
 * Stored database connection for one HostedApp (the DB Explorer target). At
 * most one connection per app. The password is encrypted at rest with the same
 * AES-256-GCM helper used for TOTP secrets and Store driver tokens
 * (utils/crypto.ts, key = ENCRYPTION_KEY); host/user/database are backend-only.
 *
 * The serialized form NEVER leaks a secret: the frontend only sees the engine
 * type, the source, the SSL mode, whether a password is set, and the last 4
 * characters of the host (for visual confirmation) — exactly the "configured /
 * detected" surface the spec requires.
 */
export interface IDbConnection {
  appId: Types.ObjectId;
  type: DbEngine;
  source: 'manual' | 'auto';
  host: string;
  port: number;
  user: string;
  database: string;
  passwordEnc: string | null;
  sslMode: SslMode;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const dbConnectionSchema = new Schema<IDbConnection>(
  {
    appId: {
      type: Schema.Types.ObjectId,
      ref: 'HostedApp',
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['postgresql', 'mysql', 'mongodb', 'sqlite', 'redis'],
      required: true,
    },
    source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    host: { type: String, default: '', trim: true },
    port: { type: Number, default: 0 },
    user: { type: String, default: '', trim: true },
    database: { type: String, default: '', trim: true },
    // AES-256-GCM ciphertext (iv:tag:ciphertext) — never the plaintext.
    passwordEnc: { type: String, default: null },
    sslMode: { type: String, enum: ['disable', 'require'], default: 'disable' },
    lastTestedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

dbConnectionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    // Derive only the non-sensitive surface, then strip everything secret.
    r.hasPassword = Boolean(r.passwordEnc);
    r.hostHint = typeof r.host === 'string' && r.host.length > 0 ? r.host.slice(-4) : '';
    delete r.host;
    delete r.user;
    delete r.database;
    delete r.passwordEnc;
    return r;
  },
});

export type DbConnectionDoc = HydratedDocument<IDbConnection>;

export const DbConnection = mongoose.model<IDbConnection>('DbConnection', dbConnectionSchema);
