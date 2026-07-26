import { decrypt } from '../../utils/crypto.js';
import type { Driver, DeployContext, DeployResult } from './index.js';

function apiBase(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

/** Read the Coolify error body (if any) so the admin knows what to fix. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return body ? ` — ${body.slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

/** Deploy a raw docker-compose stack (no source build). */
async function deployCompose(ctx: DeployContext): Promise<DeployResult> {
  const c = ctx.config;
  try {
    const res = await fetch(`${apiBase(c.coolifyBaseUrl)}/api/v1/applications/dockercompose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${decrypt(c.coolifyTokenEnc as string)}`,
      },
      body: JSON.stringify({
        project_uuid: c.coolifyProjectUuid,
        server_uuid: c.coolifyServerUuid,
        destination_uuid: c.coolifyDestinationUuid,
        environment_uuid: c.coolifyEnvUuid || undefined,
        name: ctx.slug,
        docker_compose_raw: ctx.compose,
        instant_deploy: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, message: `Coolify API responded ${res.status}${await errorDetail(res)}` };
    }
    return { ok: true, message: 'Deployment triggered on Coolify.' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'request failed';
    return {
      ok: false,
      message: `Could not reach Coolify at ${apiBase(c.coolifyBaseUrl)} — ${reason}. Check the URL is correct and reachable from the Dashy container (scheme, DNS, TLS).`,
    };
  }
}

/**
 * Deploy from a public Git repo so a compose `build:` works — Coolify clones the
 * repo and builds it itself (Dashy never needs the source). Uses Coolify's
 * public-application API with the docker-compose build pack.
 *
 * NOTE: this path can't be exercised on a machine without Coolify — validate it
 * against your Coolify instance. Field names follow the Coolify v4 REST API.
 */
async function deployFromGit(ctx: DeployContext): Promise<DeployResult> {
  const c = ctx.config;
  try {
    const res = await fetch(`${apiBase(c.coolifyBaseUrl)}/api/v1/applications/public`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${decrypt(c.coolifyTokenEnc as string)}`,
      },
      body: JSON.stringify({
        project_uuid: c.coolifyProjectUuid,
        server_uuid: c.coolifyServerUuid,
        // Coolify accepts either the environment uuid or a name; fall back to the
        // conventional "production" environment when no uuid is configured.
        environment_uuid: c.coolifyEnvUuid || undefined,
        environment_name: c.coolifyEnvUuid ? undefined : 'production',
        git_repository: ctx.repo,
        git_branch: ctx.branch || 'main',
        build_pack: 'dockercompose',
        docker_compose_location: '/docker-compose.yml',
        ports_exposes: String(ctx.defaultPort || 80),
        name: ctx.slug,
        instant_deploy: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, message: `Coolify API responded ${res.status}${await errorDetail(res)}` };
    }
    return { ok: true, message: 'Git deployment triggered on Coolify (builds from source).' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'request failed';
    return {
      ok: false,
      message: `Could not reach Coolify at ${apiBase(c.coolifyBaseUrl)} — ${reason}. Check the URL is correct and reachable from the Dashy container (scheme, DNS, TLS).`,
    };
  }
}

/** Deploy a docker-compose app via the Coolify API. */
export const coolifyDriver: Driver = {
  id: 'coolify',
  label: 'Coolify',
  isAvailable: (c) =>
    c.coolifyEnabled &&
    Boolean(c.coolifyTokenEnc) &&
    Boolean(c.coolifyBaseUrl) &&
    Boolean(c.coolifyProjectUuid) &&
    Boolean(c.coolifyServerUuid) &&
    Boolean(c.coolifyDestinationUuid),
  // A source repo → Coolify builds from Git; otherwise a raw-compose deploy.
  async deploy(ctx) {
    return ctx.repo ? deployFromGit(ctx) : deployCompose(ctx);
  },
};
