import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export interface ISession {
  user: Types.ObjectId;
  jti: string; // unique token id embedded in the JWT
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastSeenAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true, index: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

sessionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    delete r.jti;
    delete r.user;
    return r;
  },
});

export type SessionDoc = HydratedDocument<ISession>;
export const Session = mongoose.model<ISession>('Session', sessionSchema);
