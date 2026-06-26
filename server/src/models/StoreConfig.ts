import mongoose, { Schema, type HydratedDocument } from 'mongoose';

/**
 * Singleton Store configuration: deploy-driver credentials (encrypted at rest,
 * never serialized) and the wildcard-DNS settings for static apps. Tokens are
 * backend-only and are never read from a manifest.
 */
export interface IStoreConfig {
  singleton: true;
  // Coolify driver
  coolifyEnabled: boolean;
  coolifyBaseUrl: string;
  coolifyTokenEnc: string | null;
  coolifyProjectUuid: string;
  coolifyServerUuid: string;
  coolifyDestinationUuid: string;
  coolifyEnvUuid: string;
  // Portainer driver
  portainerEnabled: boolean;
  portainerUrl: string;
  portainerKeyEnc: string | null;
  portainerEndpointId: string;
  // Docker-direct driver (availability is auto-detected via the socket)
  dockerEnabled: boolean;
  // Default driver to preselect when several are available
  defaultDriver: string;
  // Wildcard DNS for static apps
  wildcardEnabled: boolean;
  baseDomain: string;
  createdAt: Date;
  updatedAt: Date;
}

const storeConfigSchema = new Schema<IStoreConfig>(
  {
    singleton: { type: Boolean, default: true, unique: true, immutable: true },
    coolifyEnabled: { type: Boolean, default: false },
    coolifyBaseUrl: { type: String, default: '', trim: true },
    coolifyTokenEnc: { type: String, default: null },
    coolifyProjectUuid: { type: String, default: '', trim: true },
    coolifyServerUuid: { type: String, default: '', trim: true },
    coolifyDestinationUuid: { type: String, default: '', trim: true },
    coolifyEnvUuid: { type: String, default: '', trim: true },
    portainerEnabled: { type: Boolean, default: false },
    portainerUrl: { type: String, default: '', trim: true },
    portainerKeyEnc: { type: String, default: null },
    portainerEndpointId: { type: String, default: '', trim: true },
    dockerEnabled: { type: Boolean, default: true },
    defaultDriver: { type: String, default: '' },
    wildcardEnabled: { type: Boolean, default: false },
    baseDomain: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

storeConfigSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    delete r.singleton;
    r.hasCoolifyToken = Boolean(r.coolifyTokenEnc);
    r.hasPortainerKey = Boolean(r.portainerKeyEnc);
    delete r.coolifyTokenEnc;
    delete r.portainerKeyEnc;
    return r;
  },
});

export type StoreConfigDoc = HydratedDocument<IStoreConfig>;

export const StoreConfig = mongoose.model<IStoreConfig>('StoreConfig', storeConfigSchema);

export async function getStoreConfig(): Promise<StoreConfigDoc> {
  const existing = await StoreConfig.findOne({ singleton: true });
  if (existing) return existing;
  return StoreConfig.create({ singleton: true });
}
