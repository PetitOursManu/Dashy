import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

/**
 * Raised when a user repeatedly tries to use the Dashy assistant for things
 * unrelated to Dashy. Shown to admins on the dashboard with the offending
 * messages so they can follow up.
 */
export interface IChatAlert {
  user: Types.ObjectId;
  // Denormalized for display even if the user is later deleted.
  userEmail: string;
  // The user messages that were flagged as off-topic.
  messages: string[];
  acknowledged: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const chatAlertSchema = new Schema<IChatAlert>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userEmail: { type: String, required: true },
    messages: { type: [String], default: [] },
    acknowledged: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

chatAlertSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    return r;
  },
});

export type ChatAlertDoc = HydratedDocument<IChatAlert>;

export const ChatAlert = mongoose.model<IChatAlert>('ChatAlert', chatAlertSchema);
