import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

/**
 * A pending "Sign in with Kosmy Board" flow, kept server-side between the
 * launch and the callback. Keyed by `state`, which the browser also holds in
 * a short-lived HttpOnly cookie, so a flow is bound to the browser that
 * started it. Records expire after 10 minutes (TTL index) and are consumed
 * atomically, so a `state` can only ever be used once.
 */
export interface IKosmyFlow {
  state: string;
  nonce: string;
  verifier: string;
  /** Issuer the flow was started for. */
  iss: string;
  /** Same-origin path to land on after sign-in. */
  target: string;
  /** "login" opens a session; "link" attaches the Board account to `uid`. */
  mode: 'login' | 'link';
  uid: Types.ObjectId | null;
  /** Link mode: set by the callback once the ID token is verified. */
  sub: string | null;
  /** Link mode: true once the callback has consumed the `state`. */
  used: boolean;
  createdAt: Date;
}

const kosmyFlowSchema = new Schema<IKosmyFlow>(
  {
    state: { type: String, required: true, unique: true },
    nonce: { type: String, required: true },
    verifier: { type: String, required: true },
    iss: { type: String, required: true },
    target: { type: String, required: true },
    mode: { type: String, enum: ['login', 'link'], required: true },
    uid: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sub: { type: String, default: null },
    used: { type: Boolean, default: false },
    // MongoDB purges expired flows on its own (TTL monitor, ~every minute);
    // the code also checks the age explicitly.
    createdAt: { type: Date, default: Date.now, expires: 600 },
  },
  { versionKey: false },
);

export type KosmyFlowDoc = HydratedDocument<IKosmyFlow>;
export const KosmyFlow = mongoose.model<IKosmyFlow>('KosmyFlow', kosmyFlowSchema);
