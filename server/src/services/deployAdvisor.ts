import { z } from 'zod';
import { getChatConfig } from '../models/ChatConfig.js';
import { decrypt } from '../utils/crypto.js';
import { chatComplete } from './chatProvider.js';

/**
 * AI-assisted analysis of a `docker-compose` for a Store "deploy" app: proposes
 * persistent volumes and surfaces the environment variables the operator must
 * set (as dedicated fields), returning an updated compose. Reuses the same LLM
 * provider as the Dashy assistant.
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

/**
 * Extract and validate the model's JSON reply. Models often wrap JSON in prose
 * or ```json fences, so we strip fences and take the outermost object before
 * validating against the schema.
 */
export function parseDeployAdvice(raw: string): DeployAdvice {
  const cleaned = raw.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('The assistant did not return JSON');
  }
  // Tolerate a common LLM slip: trailing commas before } or ].
  const candidate = cleaned.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1');
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('The assistant returned malformed JSON');
  }
  return deployAdviceSchema.parse(parsed);
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

Respond with STRICT, COMPACT JSON only — no prose, no markdown fences, no trailing
commas — matching exactly this shape:
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
    maxTokens: 1024,
  });

  return parseDeployAdvice(reply);
}
