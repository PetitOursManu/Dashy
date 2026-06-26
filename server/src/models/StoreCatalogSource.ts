import mongoose, { Schema, type HydratedDocument } from 'mongoose';

export type CatalogSourceType = 'local' | 'remote';

/**
 * A catalogue source the Store pulls app manifests from. `local` points to a
 * JSON file/dir on the server; `remote` is an HTTP(S) URL to a JSON index.
 * Successfully validated manifests are cached here with a TTL.
 */
export interface IStoreCatalogSource {
  name: string;
  type: CatalogSourceType;
  location: string;
  /** Dashy owns this catalogue file and may edit it from the UI. */
  managed: boolean;
  enabled: boolean;
  ttlMinutes: number;
  // Last successfully fetched + validated manifests (raw objects).
  cachedApps: unknown[];
  lastFetchedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const storeCatalogSourceSchema = new Schema<IStoreCatalogSource>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ['local', 'remote'], required: true },
    location: { type: String, required: true, trim: true, maxlength: 2000 },
    managed: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    ttlMinutes: { type: Number, default: 60, min: 0, max: 7 * 24 * 60 },
    cachedApps: { type: [Schema.Types.Mixed], default: [] },
    lastFetchedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

storeCatalogSourceSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    // The cached manifests are returned via the dedicated catalog endpoint.
    r.appCount = Array.isArray(r.cachedApps) ? (r.cachedApps as unknown[]).length : 0;
    delete r.cachedApps;
    return r;
  },
});

export type StoreCatalogSourceDoc = HydratedDocument<IStoreCatalogSource>;

export const StoreCatalogSource = mongoose.model<IStoreCatalogSource>(
  'StoreCatalogSource',
  storeCatalogSourceSchema,
);
