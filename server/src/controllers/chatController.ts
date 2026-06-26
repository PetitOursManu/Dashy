import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../middleware/error.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { User } from '../models/User.js';
import { ChatAlert } from '../models/ChatAlert.js';
import {
  getChatConfig,
  CHAT_PROVIDERS,
  type ChatProvider,
} from '../models/ChatConfig.js';
import { buildSystemPrompt, OFFTOPIC_REMINDER } from '../services/chatPrompt.js';
import {
  chatComplete,
  ProviderError,
  DEFAULT_MODELS,
  type ChatMessage,
} from '../services/chatProvider.js';
import { manifestSchema } from '../store/manifest.js';
import {
  createManagedCatalogue,
  addCatalogSource,
  addAppToManagedCatalogue,
} from '../store/manage.js';

// ----------------------------- validation schemas -----------------------------

export const updateConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.enum(CHAT_PROVIDERS as [ChatProvider, ...ChatProvider[]]).optional(),
    model: z.string().max(120).trim().optional(),
    // Empty string clears the stored key; a non-empty string replaces it;
    // omitting the field leaves the existing key untouched.
    apiKey: z.string().max(400).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

/** Admin-only Store actions the assistant may propose and the admin confirms. */
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_catalogue'), name: z.string().min(1).max(80) }),
  z.object({
    type: z.literal('add_source'),
    name: z.string().min(1).max(80),
    sourceType: z.enum(['local', 'remote']),
    location: z.string().min(1).max(2000),
  }),
  z.object({ type: z.literal('add_app'), source: z.string().min(1).max(80), manifest: manifestSchema }),
]);

const ACTION_RE = /\[\[ACTION\]\]\s*([\s\S]*?)\s*\[\[\/ACTION\]\]/;
const ACTION_RE_G = /\[\[ACTION\]\][\s\S]*?\[\[\/ACTION\]\]/g;

/** Extract a valid admin action proposal from a reply, if present. */
function extractProposal(reply: string): z.infer<typeof actionSchema> | null {
  const m = ACTION_RE.exec(reply);
  if (!m) return null;
  try {
    const parsed = actionSchema.safeParse(JSON.parse(m[1]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// --------------------------------- helpers -----------------------------------

/** Whether the assistant is usable for the given user right now. */
async function chatAvailability(userId: string): Promise<boolean> {
  const cfg = await getChatConfig();
  if (!cfg.enabled || !cfg.apiKeyEnc) return false;
  const user = await User.findById(userId).select('chatEnabled chatTimeoutUntil');
  if (!user || user.chatEnabled === false) return false;
  if (user.chatTimeoutUntil && user.chatTimeoutUntil.getTime() > Date.now()) return false;
  return true;
}

// --------------------------------- handlers ----------------------------------

/** Lightweight status check the chat widget uses to decide whether to render. */
export async function status(req: Request, res: Response): Promise<void> {
  const [available, user] = await Promise.all([
    chatAvailability(req.user!.sub),
    User.findById(req.user!.sub).select('chatEnabled'),
  ]);
  // Contacting an admin (project requests) is allowed whenever the user has
  // assistant access, even if the AI provider isn't configured or they're
  // currently timed out.
  res.json({ available, canRequest: user?.chatEnabled !== false });
}

/** Admin: read the current assistant configuration (key never returned). */
export async function getConfig(_req: Request, res: Response): Promise<void> {
  const cfg = await getChatConfig();
  res.json({
    config: cfg.toJSON(),
    providers: CHAT_PROVIDERS,
    defaultModels: DEFAULT_MODELS,
  });
}

/** Admin: update provider / model / key / enabled flag. */
export async function updateConfig(req: Request, res: Response): Promise<void> {
  const updates = req.body as z.infer<typeof updateConfigSchema>;
  const cfg = await getChatConfig();

  if (updates.provider !== undefined) cfg.provider = updates.provider;
  if (updates.model !== undefined) cfg.modelName = updates.model;
  if (updates.enabled !== undefined) cfg.enabled = updates.enabled;
  if (updates.apiKey !== undefined) {
    cfg.apiKeyEnc = updates.apiKey ? encrypt(updates.apiKey) : null;
  }

  // Can't enable the assistant without a key to call the provider with.
  if (cfg.enabled && !cfg.apiKeyEnc) {
    throw new ApiError(400, 'Set an API key before enabling the assistant');
  }

  await cfg.save();
  res.json({ config: cfg.toJSON() });
}

/** Admin: probe the saved provider/model/key with a tiny request. */
export async function testConfig(_req: Request, res: Response): Promise<void> {
  const cfg = await getChatConfig();
  if (!cfg.apiKeyEnc) throw new ApiError(400, 'No API key configured');

  try {
    const reply = await chatComplete({
      provider: cfg.provider,
      model: cfg.modelName,
      apiKey: decrypt(cfg.apiKeyEnc),
      system: 'You are a connection test. Reply with the single word: OK.',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16,
    });
    res.json({ ok: true, reply });
  } catch (err) {
    if (err instanceof ProviderError) throw new ApiError(err.status, err.message);
    throw new ApiError(502, 'Connection test failed');
  }
}

/** User: send the conversation and get the assistant's reply. */
export async function chat(req: Request, res: Response): Promise<void> {
  const cfg = await getChatConfig();
  if (!cfg.enabled || !cfg.apiKeyEnc) {
    throw new ApiError(503, 'The assistant is not available');
  }

  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.chatEnabled === false) {
    throw new ApiError(403, 'The assistant is not enabled for your account');
  }
  if (user.chatTimeoutUntil && user.chatTimeoutUntil.getTime() > Date.now()) {
    throw new ApiError(403, 'The assistant is temporarily unavailable for your account');
  }

  const { messages } = req.body as z.infer<typeof chatSchema>;
  const system = await buildSystemPrompt(user);

  let reply: string;
  try {
    reply = await chatComplete({
      provider: cfg.provider,
      model: cfg.modelName,
      apiKey: decrypt(cfg.apiKeyEnc),
      system,
      messages: messages as ChatMessage[],
    });
  } catch (err) {
    if (err instanceof ProviderError) throw new ApiError(err.status, err.message);
    throw new ApiError(502, 'The assistant could not respond');
  }

  // Admins can have the assistant propose a Store action (create catalogue /
  // source / app). Parse it from the reply, then strip the block from the
  // visible text. The proposal does nothing until confirmed via POST /action.
  const proposal = user.role === 'admin' ? extractProposal(reply) : null;
  reply = reply.replace(ACTION_RE_G, '').trim();

  // The model prepends a marker when it declines an off-topic request. Strip it
  // from the visible reply, count the strike, and after 3 raise an admin alert
  // plus a gentle reminder to the user.
  const offTopic = /\[\[\s*OFFTOPIC\s*\]\]/i.test(reply);
  reply = reply.replace(/\[\[\s*OFFTOPIC\s*\]\]/gi, '').replace(/^\s+/, '');

  if (offTopic) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) user.chatOffTopic.push(lastUser.content);
    if (user.chatOffTopic.length >= 3) {
      await ChatAlert.create({
        user: user._id,
        userEmail: user.email,
        messages: user.chatOffTopic.slice(-3),
      });
      user.chatOffTopic = [];
      const reminder = OFFTOPIC_REMINDER[user.language] ?? OFFTOPIC_REMINDER.en;
      reply = reply ? `${reply}\n\n${reminder}` : reminder;
    }
    await user.save();
  }

  res.json({ reply, proposal: proposal ?? undefined });
}

/** Admin: execute a Store action the assistant proposed (after confirmation). */
export async function runAction(req: Request, res: Response): Promise<void> {
  const action = req.body as z.infer<typeof actionSchema>;
  if (action.type === 'add_catalogue') {
    const source = await createManagedCatalogue(action.name);
    res.status(201).json({ ok: true, kind: 'catalogue', name: source.name });
    return;
  }
  if (action.type === 'add_source') {
    const source = await addCatalogSource({
      name: action.name,
      type: action.sourceType,
      location: action.location,
    });
    res.status(201).json({ ok: true, kind: 'source', name: source.name });
    return;
  }
  const { source, manifest } = await addAppToManagedCatalogue(action.source, action.manifest);
  res.status(201).json({ ok: true, kind: 'app', name: manifest.name, source: source.name });
}

/** Admin: list unacknowledged assistant-misuse alerts (newest first). */
export async function listAlerts(_req: Request, res: Response): Promise<void> {
  const alerts = await ChatAlert.find({ acknowledged: false }).sort({ createdAt: -1 }).limit(50);
  res.json({ alerts: alerts.map((a) => a.toJSON()) });
}

/** Admin: dismiss an alert. */
export async function ackAlert(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Alert not found');
  const alert = await ChatAlert.findById(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');
  alert.acknowledged = true;
  await alert.save();
  res.json({ ok: true });
}
