import mongoose, { Schema, type HydratedDocument } from 'mongoose';

/**
 * Singleton settings for "Sign in with Kosmy Board" (OpenID Connect).
 * The client secret is stored AES-256-GCM encrypted (same scheme as TOTP
 * secrets) and is never serialized: the admin UI only learns whether one is set.
 */
export interface IKosmyBoardConfig {
  singleton: true;
  /** Issuer URL, without trailing slash (e.g. https://board.example.com/oidc). */
  issuer: string;
  clientId: string;
  clientSecretEnc: string | null;
  /** Create a regular account for an unknown Kosmy Board `sub` (off by default). */
  autoCreate: boolean;
  /**
   * Also ask for Dashy's own 2FA code after a Kosmy Board sign-in, for users
   * who enabled it. Off by default: the Board has its own 2FA.
   */
  requireDashy2fa: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const kosmyBoardConfigSchema = new Schema<IKosmyBoardConfig>(
  {
    singleton: { type: Boolean, default: true, unique: true, immutable: true },
    issuer: { type: String, default: '', trim: true, maxlength: 500 },
    clientId: { type: String, default: '', trim: true, maxlength: 200 },
    clientSecretEnc: { type: String, default: null },
    autoCreate: { type: Boolean, default: false },
    requireDashy2fa: { type: Boolean, default: false },
  },
  { timestamps: true },
);

kosmyBoardConfigSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    delete r.id;
    delete r.singleton;
    r.hasClientSecret = Boolean(r.clientSecretEnc);
    delete r.clientSecretEnc;
    return r;
  },
});

export type KosmyBoardConfigDoc = HydratedDocument<IKosmyBoardConfig>;

export const KosmyBoardConfig = mongoose.model<IKosmyBoardConfig>(
  'KosmyBoardConfig',
  kosmyBoardConfigSchema,
);

/** Fetch the singleton config, creating it with defaults on first access. */
export async function getKosmyBoardConfig(): Promise<KosmyBoardConfigDoc> {
  const existing = await KosmyBoardConfig.findOne({ singleton: true });
  if (existing) return existing;
  try {
    return await KosmyBoardConfig.create({ singleton: true });
  } catch {
    // Lost a creation race with a concurrent request.
    return (await KosmyBoardConfig.findOne({ singleton: true }))!;
  }
}
