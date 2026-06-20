import mongoose, { Schema, type Types } from 'mongoose';

export interface IOpenEvent {
  app: Types.ObjectId;
  user: Types.ObjectId | null;
  at: Date;
}

const openEventSchema = new Schema<IOpenEvent>(
  {
    app: { type: Schema.Types.ObjectId, ref: 'HostedApp', required: true, index: true },
    // Null for anonymous opens via a public share link.
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

export const OpenEvent = mongoose.model<IOpenEvent>('OpenEvent', openEventSchema);
