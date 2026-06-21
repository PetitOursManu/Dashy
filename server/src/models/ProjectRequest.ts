import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export type RequestKind = 'idea' | 'file';
export type RequestStatus = 'pending' | 'resolved' | 'dismissed';

/**
 * A request a user sends to the admins through the Dashy assistant — to suggest
 * a new project (an idea, or a file/site they'd like added). Admins see these
 * in the dashboard Notifications tile; the requester keeps a history on their
 * own dashboard.
 */
export interface IProjectRequest {
  user: Types.ObjectId;
  userEmail: string;
  kind: RequestKind;
  message: string;
  status: RequestStatus;
  // Hidden from the admin views once archived (the requester still keeps it).
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const projectRequestSchema = new Schema<IProjectRequest>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userEmail: { type: String, required: true },
    kind: { type: String, enum: ['idea', 'file'], default: 'idea' },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['pending', 'resolved', 'dismissed'],
      default: 'pending',
      index: true,
    },
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

projectRequestSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    return r;
  },
});

export type ProjectRequestDoc = HydratedDocument<IProjectRequest>;

export const ProjectRequest = mongoose.model<IProjectRequest>(
  'ProjectRequest',
  projectRequestSchema,
);
