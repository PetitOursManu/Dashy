import { decrypt } from '../../utils/crypto.js';
import type { Driver } from './index.js';

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
  async deploy(ctx) {
    const c = ctx.config;
    try {
      const res = await fetch(
        `${c.coolifyBaseUrl.replace(/\/$/, '')}/api/v1/applications/dockercompose`,
        {
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
        },
      );
      if (!res.ok) {
        return { ok: false, message: `Coolify API responded ${res.status}` };
      }
      return { ok: true, message: 'Deployment triggered on Coolify.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Coolify request failed' };
    }
  },
};
