import { z } from 'zod';
import { getChatConfig } from '../models/ChatConfig.js';
import { decrypt } from '../utils/crypto.js';
import { chatComplete } from './chatProvider.js';

/**
 * AI-assisted analysis of a `docker-compose` for a Store "deploy" app: proposes
 * persistent volumes and surfaces the environment variables the operator must
 * set (as dedicated fields). Reuses the same LLM provider as the Dashy assistant.
 * It only returns structured suggestions — Dashy applies volumes/env itself, so
 * the (error-prone) task of rewriting the compose is never asked of the model.
 */

// Mirrors the volume-name rule enforced by the install/redeploy schemas.
const VOLUME_NAME = /^[a-zA-Z0-9._-]+$/;

const deployAdviceSchema = z.object({
  needsPersistence: z.boolean().default(false),
  volumes: z
    .array(
      z.object({
        name: z.string().regex(VOLUME_NAME, 'invalid volume name').max(64),
        mountPath: z.string().min(1).max(255),
        reason: z.string().max(300).optional().default(''),
      }),
    )
    .max(20)
    .default([]),
  env: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        label: z.string().max(120).optional().default(''),
        default: z.string().max(2000).optional().default(''),
        secret: z.boolean().optional().default(false),
        required: z.boolean().optional().default(true),
      }),
    )
    .max(50)
    .default([]),
  notes: z.string().max(2000).optional().default(''),
});

export type DeployAdvice = z.infer<typeof deployAdviceSchema>;

/** Return the balanced `{...}` object starting at `start`, respecting strings. */
function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// C0 control characters (raw newlines/tabs inside string values break JSON.parse).
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F]', 'g');
const ADVICE_KEYS = ['needsPersistence', 'volumes', 'env', 'notes'];

/**
 * Extract and validate the advice JSON from the model's reply. Reasoning models
 * wrap the answer in prose / <think> blocks / ```fences and may add stray braces,
 * so we scan each `{`, taking the first balanced object that (a) parses and (b)
 * actually looks like our advice — repairing trailing commas and raw control
 * characters along the way.
 */
export function parseDeployAdvice(raw: string): DeployAdvice {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // drop reasoning blocks
    .replace(/```(?:json)?/gi, ''); // drop code fences

  for (let idx = text.indexOf('{'); idx !== -1; idx = text.indexOf('{', idx + 1)) {
    const obj = balancedObject(text, idx);
    if (!obj) break; // no closing brace (truncated output) → give up
    const cleaned = obj.replace(/,(\s*[}\]])/g, '$1').replace(CONTROL_CHARS, ' ');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      continue; // not this object — try the next `{`
    }
    // Skip stray objects from the reasoning that happen to be valid JSON.
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !ADVICE_KEYS.some((k) => k in (parsed as Record<string, unknown>))
    ) {
      continue;
    }
    return deployAdviceSchema.parse(parsed);
  }
  throw new Error('The assistant returned malformed JSON');
}

const SYSTEM_PROMPT = `You are a DevOps assistant embedded in "Dashy", a self-hosted app dashboard.
You are given a docker-compose file for a single app, optionally its Docker image
name, source repository URL and README. Do NOT rewrite the compose — Dashy applies
your suggestions itself. Your job:

1. Decide whether the app has data that should PERSIST across redeploys (databases,
   uploads, config, state). Set "needsPersistence" accordingly.
2. Propose named Docker volumes for each such path: a short lowercase "name"
   (matching ^[a-zA-Z0-9._-]+$), the container "mountPath", and a one-line "reason".
   Do NOT propose volumes for caches, tmp, or paths that are safe to lose.
3. Identify environment variables the operator must set, under "env" as fields
   ({key,label,default,secret,required}). Mark passwords/keys/tokens/secrets as
   "secret": true. Prefer real, documented variables — do not invent unlikely ones.
4. Use "notes" for anything important (e.g. if the compose should reference the env
   via "env_file: - .env").

Do not think out loud. Output ONLY strict, compact JSON on a single line — no prose,
no explanations, no markdown fences, no trailing commas — matching exactly:
{"needsPersistence":bool,"volumes":[{"name":str,"mountPath":str,"reason":str}],"env":[{"key":str,"label":str,"default":str,"secret":bool,"required":bool}],"notes":str}
If nothing should persist, return an empty "volumes" array.`;

export interface AnalyzeInput {
  compose: string;
  image?: string;
  repo?: string;
  readme?: string;
}

/** Run the LLM analysis and return validated advice. Throws on provider/parse errors. */
export async function analyzeDeploy(input: AnalyzeInput): Promise<DeployAdvice> {
  const cfg = await getChatConfig();
  if (!cfg.enabled || !cfg.apiKeyEnc) {
    throw new Error('The assistant is not configured');
  }

  const parts = [`docker-compose:\n${input.compose}`];
  if (input.image) parts.push(`Docker image: ${input.image}`);
  if (input.repo) parts.push(`Source repository: ${input.repo}`);
  if (input.readme) parts.push(`README (may be truncated):\n${input.readme.slice(0, 8000)}`);

  const reply = await chatComplete({
    provider: cfg.provider,
    model: cfg.modelName,
    apiKey: decrypt(cfg.apiKeyEnc),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
    // Generous: reasoning models spend part of the budget "thinking" before the
    // JSON, and a truncated reply can't be parsed.
    maxTokens: 3000,
  });

  return parseDeployAdvice(reply);
}
