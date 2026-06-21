import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

/**
 * A message pushed by an admin to a specific user's dashboard. The user must
 * acknowledge it (which sets `readAt`) before it disappears for them. Admins
 * track delivery + read receipts in the dashboard "Notifications" tile.
 *
 * `kind` is intentionally open-ended so future notification types can reuse
 * this collection. These records are deliberately NOT logged as Activity, so
 * they never show up in the "Recent activity" feed.
 */
export interface INotification {
  user: Types.ObjectId;
  // Denormalized so the admin list still reads if the user is later removed.
  userEmail: string;
  kind: string;
  message: string;
  // For replies to a project request: the user's original request text, so the
  // notification carries its own context ("you asked X → here's the answer").
  requestMessage: string;
  createdByEmail: string;
  readAt: Date | null;
  // Hidden from the admin tile once the admin dismisses it.
  dismissedByAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userEmail: { type: String, required: true },
    kind: { type: String, default: 'admin-message' },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    requestMessage: { type: String, default: '' },
    createdByEmail: { type: String, default: '' },
    readAt: { type: Date, default: null },
    dismissedByAdmin: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

notificationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    return r;
  },
});

export type NotificationDoc = HydratedDocument<INotification>;

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
