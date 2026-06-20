import mongoose, { Schema, type HydratedDocument } from 'mongoose';

export type ActivityType =
  | 'app.imported'
  | 'app.updated'
  | 'app.deleted'
  | 'user.created'
  | 'user.deleted'
  | 'twofactor.enabled';

export interface IActivity {
  type: ActivityType;
  actorEmail: string;
  message: string;
  at: Date;
}

const activitySchema = new Schema<IActivity>(
  {
    type: { type: String, required: true },
    actorEmail: { type: String, required: true },
    message: { type: String, required: true },
    at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

activitySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    return r;
  },
});

export type ActivityDoc = HydratedDocument<IActivity>;
export const Activity = mongoose.model<IActivity>('Activity', activitySchema);
