import { decrypt } from '../../utils/crypto.js';
import type { Driver } from './index.js';

/** Deploy a compose stack via the Portainer API (string method). */
export const portainerDriver: Driver = {
  id: 'portainer',
  label: 'Portainer',
  isAvailable: (c) =>
    c.portainerEnabled &&
    Boolean(c.portainerKeyEnc) &&
    Boolean(c.portainerUrl) &&
    Boolean(c.portainerEndpointId),
  async deploy(ctx) {
    const c = ctx.config;
    try {
      const base = c.portainerUrl.replace(/\/$/, '');
      const url = `${base}/api/stacks?type=2&method=string&endpointId=${encodeURIComponent(
        c.portainerEndpointId,
      )}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': decrypt(c.portainerKeyEnc as string),
        },
        body: JSON.stringify({
          name: ctx.slug,
          stackFileContent: ctx.compose,
          env: Object.entries(ctx.env).map(([name, value]) => ({ name, value })),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        return { ok: false, message: `Portainer API responded ${res.status}` };
      }
      return { ok: true, message: 'Stack created on Portainer.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Portainer request failed' };
    }
  },
};
