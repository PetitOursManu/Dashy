import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load .env from the repository root (one level above /server) when present,
// then fall back to a local .env. In Docker the variables are injected directly.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const booleanFromString = z
  .string()
  .transform((v) => v.toLowerCase() === 'true' || v === '1')
  .pipe(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),

  ALLOW_REGISTRATION: booleanFromString.default('false'),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),

  // --- SSO (Dashy as identity provider for other self-hosted apps) ---
  // Shared HS256 secret for signing SSO tokens. MUST differ from JWT_SECRET.
  // Leave unset to disable the "Sign in with Dashy" endpoint entirely.
  SSO_SHARED_SECRET: z.string().min(32).optional(),
  // Comma-separated allow-list of exact callback URLs permitted as redirect_uri.
  SSO_ALLOWED_REDIRECTS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Fail fast: a misconfigured server must never start.
  console.error(`\n[config] Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';

/** Parsed SSO callback allow-list (exact-match). */
export const ssoRedirects: string[] = (env.SSO_ALLOWED_REDIRECTS ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

/** SSO is only active when a dedicated secret AND at least one callback exist. */
export const ssoEnabled: boolean = Boolean(env.SSO_SHARED_SECRET && ssoRedirects.length > 0);
