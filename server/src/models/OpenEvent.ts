import mongoose, { Schema, type Types } from 'mongoose';

export interface IOpenEvent {
  app: Types.ObjectId;
  user: Types.ObjectId;
  at: Date;
}

const openEventSchema = new Schema<IOpenEvent>(
  {
    app: { type: Schema.Types.ObjectId, ref: 'HostedApp', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

export const OpenEvent = mongoose.model<IOpenEvent>('OpenEvent', openEventSchema);
