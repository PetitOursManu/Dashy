import mongoose, { Schema, type HydratedDocument } from 'mongoose';

export type ChatProvider = 'openrouter' | 'openai' | 'deepseek' | 'claude' | 'ollama';

export const CHAT_PROVIDERS: ChatProvider[] = [
  'openrouter',
  'openai',
  'deepseek',
  'claude',
  'ollama',
];

/**
 * Singleton configuration for the Dashy AI assistant. Exactly one document
 * exists (keyed by `singleton: true`). The provider API key is stored
 * AES-256-GCM encrypted (same scheme as TOTP secrets) and never serialized.
 */
export interface IChatConfig {
  singleton: true;
  enabled: boolean;
  provider: ChatProvider;
  // Named `modelName` (not `model`) to avoid colliding with Mongoose's
  // Document.model — exposed as `model` in JSON.
  modelName: string;
  // AES-256-GCM encrypted provider API key (null until configured).
  apiKeyEnc: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const chatConfigSchema = new Schema<IChatConfig>(
  {
    // Guarantees a single document.
    singleton: { type: Boolean, default: true, unique: true, immutable: true },
    enabled: { type: Boolean, default: false },
    provider: { type: String, enum: CHAT_PROVIDERS, default: 'openrouter' },
    modelName: { type: String, default: '', trim: true, maxlength: 120 },
    apiKeyEnc: { type: String, default: null },
  },
  { timestamps: true },
);

// Never leak the encrypted key; expose only whether one is set.
chatConfigSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const r = ret as unknown as Record<string, unknown>;
    delete r._id;
    delete r.singleton;
    r.model = r.modelName ?? '';
    delete r.modelName;
    r.hasApiKey = Boolean(r.apiKeyEnc);
    delete r.apiKeyEnc;
    return r;
  },
});

export type ChatConfigDoc = HydratedDocument<IChatConfig>;

export const ChatConfig = mongoose.model<IChatConfig>('ChatConfig', chatConfigSchema);

/** Fetch the singleton config, creating it with defaults on first access. */
export async function getChatConfig(): Promise<ChatConfigDoc> {
  const existing = await ChatConfig.findOne({ singleton: true });
  if (existing) return existing;
  return ChatConfig.create({ singleton: true });
}
