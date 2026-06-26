import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export interface IShare {
  token: string | null;
  passwordHash: string | null;
  expiresAt: Date | null;
  createdAt: Date | null;
}

export interface IAppVersion {
  vid: string;
  entryFile: string;
  createdAt: Date;
}

export interface IHostedApp {
  name: string;
  description: string;
  slug: string;
  entryFile: string;
  previewImage: string | null;
  category: string | null;
  // When set, the card links to this URL instead of the locally hosted files
  // (used by Store installs: tile / deploy result / static app).
  externalUrl: string | null;
  owner: Types.ObjectId;
  openCount: number;
  lastOpenedAt: Date | null;
  // Public-share settings (created by an admin). token=null means not shared.
  share: IShare;
  // Snapshotted previous versions (newest first) that can be rolled back to.
  versions: IAppVersion[];
  createdAt: Date;
  updatedAt: Date;
}

const shareSchema = new Schema<IShare>(
  {
    token: { type: String, default: null, index: true },
    passwordHash: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: null },
  },
  { _id: false },
);

const hostedAppSchema = new Schema<IHostedApp>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },

    // URL-safe unique identifier used in `/hosted/<slug>/`.
    slug: { type: String, required: true, unique: true, index: true },

    // Entry HTML file relative to the app directory (default `index.html`).
    entryFile: { type: String, default: 'index.html' },

    // Filename of the preview image stored under PREVIEWS_DIR, or null.
    previewImage: { type: String, default: null },

    // Optional free-text category used for grouping/filtering on the dashboard.
    category: { type: String, default: null, trim: true, maxlength: 40 },

    // External / Store-served URL (null for normally hosted apps).
    externalUrl: { type: String, default: null },

    // Owner (the admin who imported the app).
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Usage tracking (incremented when the app's root is opened).
    openCount: { type: Number, default: 0 },
    lastOpenedAt: { type: Date, default: null },

    // Public sharing (admin-only).
    share: {
      type: shareSchema,
      default: () => ({ token: null, passwordHash: null, expiresAt: null, createdAt: null }),
    },

    // Previous content snapshots (for rollback).
    versions: {
      type: [
        new Schema<IAppVersion>(
          {
            vid: { type: String, required: true },
            entryFile: { type: String, required: true },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

// Expose `id` (string) instead of `_id` for the frontend.
hostedAppSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    if (r.share && typeof r.share === 'object') {
      delete (r.share as Record<string, unknown>).passwordHash;
    }
    return r;
  },
});

export type HostedAppDoc = HydratedDocument<IHostedApp>;

export const HostedApp = mongoose.model<IHostedApp>('HostedApp', hostedAppSchema);
