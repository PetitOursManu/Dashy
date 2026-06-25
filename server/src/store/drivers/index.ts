import type { StoreConfigDoc } from '../../models/StoreConfig.js';
import { manualDriver } from './manual.js';
import { dockerDriver } from './docker.js';
import { coolifyDriver } from './coolify.js';
import { portainerDriver } from './portainer.js';

export interface DeployContext {
  slug: string;
  compose: string;
  env: Record<string, string>;
  defaultPort: number;
  config: StoreConfigDoc;
}

export interface DeployResult {
  ok: boolean;
  message: string;
}

export interface Driver {
  id: string;
  label: string;
  isAvailable(config: StoreConfigDoc): boolean | Promise<boolean>;
  deploy(ctx: DeployContext): Promise<DeployResult>;
}

// Manual is last (universal fallback); the others are capability-gated.
const ALL: Driver[] = [dockerDriver, coolifyDriver, portainerDriver, manualDriver];

/** The drivers usable right now, given the current Store config + host. */
export async function availableDrivers(config: StoreConfigDoc): Promise<{ id: string; label: string }[]> {
  const out: { id: string; label: string }[] = [];
  for (const d of ALL) {
    if (await d.isAvailable(config)) out.push({ id: d.id, label: d.label });
  }
  return out;
}

export function getDriver(id: string): Driver | null {
  return ALL.find((d) => d.id === id) ?? null;
}
