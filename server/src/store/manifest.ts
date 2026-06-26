import { z } from 'zod';

/** A catalogue app id must be a safe lowercase slug (also used as a dir name). */
const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a lowercase slug ([a-z0-9-])');

const envVarSchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().max(200).optional().default(''),
  default: z.string().nullable().optional().default(null),
  secret: z.boolean().optional().default(false),
});

const volumeMountSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'volume name must be [a-zA-Z0-9._-]'),
  mountPath: z.string().min(1).max(255),
});

export const manifestSchema = z
  .object({
    id: slug,
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional().default(''),
    icon: z.string().max(2000).optional().default(''),
    author: z.string().max(120).optional().default(''),
    version: z.string().max(40).optional().default('0.0.0'),
    type: z.enum(['tile', 'deploy', 'static']),
    tile: z
      .object({
        url: z.string().url().max(2000),
        widget: z.record(z.unknown()).optional(),
      })
      .optional(),
    deploy: z
      .object({
        docker_compose: z.string().min(1).max(100_000),
        required_env: z.array(envVarSchema).optional().default([]),
        volumes: z.array(volumeMountSchema).optional().default([]),
        default_port: z.number().int().positive().max(65535).optional().default(8080),
      })
      .optional(),
    static: z
      .object({
        source_url: z.string().url().max(2000).optional(),
        // Reference to an admin-uploaded bundle stored by Dashy (local-only).
        upload: z
          .string()
          .regex(/^store-upload:[a-f0-9]{8,}$/)
          .optional(),
        entrypoint: z.string().max(255).optional().default('index.html'),
      })
      .optional(),
  })
  .superRefine((m, ctx) => {
    if (m.type === 'tile' && !m.tile)
      ctx.addIssue({ code: 'custom', message: 'tile config is required for type "tile"' });
    if (m.type === 'deploy' && !m.deploy)
      ctx.addIssue({ code: 'custom', message: 'deploy config is required for type "deploy"' });
    if (m.type === 'static') {
      if (!m.static) {
        ctx.addIssue({ code: 'custom', message: 'static config is required for type "static"' });
      } else {
        const hasUrl = Boolean(m.static.source_url);
        const hasUpload = Boolean(m.static.upload);
        if (hasUrl === hasUpload) {
          ctx.addIssue({
            code: 'custom',
            path: ['static'],
            message: 'static needs exactly one of "source_url" or "upload"',
          });
        }
      }
    }
  });

export type Manifest = z.infer<typeof manifestSchema>;

export type ParsedManifest =
  | { ok: true; data: Manifest }
  | { ok: false; error: string };

/** Validate a single manifest object. Never throws. */
export function parseManifest(raw: unknown): ParsedManifest {
  const res = manifestSchema.safeParse(raw);
  if (res.success) return { ok: true, data: res.data };
  return {
    ok: false,
    error: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  };
}

/**
 * Accept either a bare array of manifests or an index object `{ apps: [...] }`.
 * Returns only the valid manifests, plus the count of rejected ones.
 */
export function extractManifests(raw: unknown): { apps: Manifest[]; rejected: string[] } {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { apps?: unknown[] }).apps)
      ? ((raw as { apps: unknown[] }).apps as unknown[])
      : [];
  const apps: Manifest[] = [];
  const rejected: string[] = [];
  for (const item of list) {
    const parsed = parseManifest(item);
    if (parsed.ok) apps.push(parsed.data);
    else rejected.push(parsed.error);
  }
  return { apps, rejected };
}
