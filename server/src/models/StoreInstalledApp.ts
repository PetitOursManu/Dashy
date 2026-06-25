import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export type StoreAppType = 'tile' | 'deploy' | 'static';
export type ServingMode = 'path' | 'subdomain';

/**
 * Record of an app installed from the Store. Links to the HostedApp card it
 * produced. For `static` apps it also tracks the on-disk slug, serving mode and
 * the installed version (compared against the catalogue for update badges).
 */
export interface IStoreInstalledApp {
  manifestId: string;
  name: string;
  type: StoreAppType;
  sourceName: string;
  hostedApp: Types.ObjectId | null;
  installedVersion: string;
  // static only:
  slug: string | null;
  servingMode: ServingMode | null;
  // deploy only:
  deployDriver: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const storeInstalledAppSchema = new Schema<IStoreInstalledApp>(
  {
    manifestId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['tile', 'deploy', 'static'], required: true },
    sourceName: { type: String, default: '' },
    hostedApp: { type: Schema.Types.ObjectId, ref: 'HostedApp', default: null, index: true },
    installedVersion: { type: String, default: '0.0.0' },
    slug: { type: String, default: null },
    servingMode: { type: String, enum: ['path', 'subdomain'], default: null },
    deployDriver: { type: String, default: null },
  },
  { timestamps: true },
);

storeInstalledAppSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    return r;
  },
});

export type StoreInstalledAppDoc = HydratedDocument<IStoreInstalledApp>;

export const StoreInstalledApp = mongoose.model<IStoreInstalledApp>(
  'StoreInstalledApp',
  storeInstalledAppSchema,
);
