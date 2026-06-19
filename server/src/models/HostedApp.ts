import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export interface IHostedApp {
  name: string;
  description: string;
  slug: string;
  entryFile: string;
  previewImage: string | null;
  category: string | null;
  owner: Types.ObjectId;
  openCount: number;
  lastOpenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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

    // Owner (the admin who imported the app).
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Usage tracking (incremented when the app's root is opened).
    openCount: { type: Number, default: 0 },
    lastOpenedAt: { type: Date, default: null },
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
    return r;
  },
});

export type HostedAppDoc = HydratedDocument<IHostedApp>;

export const HostedApp = mongoose.model<IHostedApp>('HostedApp', hostedAppSchema);
