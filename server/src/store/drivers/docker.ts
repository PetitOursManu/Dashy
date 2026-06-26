import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STORE_DEPLOY_DIR } from '../../config/paths.js';
import type { Driver, DeployContext, VolumeMount } from './index.js';

const exec = promisify(execFile);
const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

/** Is a `docker` CLI binary resolvable on PATH (needed to run `docker compose`)? */
function hasDockerCli(): boolean {
  const candidates = ['/usr/bin/docker', '/usr/local/bin/docker'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'docker'));
  }
  return candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

export interface DockerDiagnostics {
  /** Whether Dashy itself appears to run inside a container. */
  inContainer: boolean;
  /** Whether the Docker daemon socket is visible from here. */
  socketPresent: boolean;
  /** Whether the `docker` CLI is installed in this image. */
  cliPresent: boolean;
}

/** Report what's missing for the direct-Docker driver to work, for admin UX. */
export function dockerDiagnostics(): DockerDiagnostics {
  return {
    inContainer: fs.existsSync('/.dockerenv'),
    socketPresent: fs.existsSync(SOCKET),
    cliPresent: hasDockerCli(),
  };
}

/** Best-effort: the name of the first service declared in a compose file. */
function firstService(compose: string): string {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*services\s*:/.test(l));
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i++) {
      const m = /^(\s+)([a-zA-Z0-9._-]+)\s*:\s*$/.exec(lines[i]);
      if (m) return m[2];
    }
  }
  return 'app';
}

/** Build a docker-compose override that attaches named persistent volumes. */
function overrideYaml(serviceName: string, volumes: VolumeMount[]): string | null {
  const safe = volumes.filter((v) => SAFE_NAME.test(v.name) && v.mountPath.trim());
  if (safe.length === 0) return null;
  const svc = safe.map((v) => `      - ${v.name}:${v.mountPath}`).join('\n');
  const named = safe.map((v) => `  ${v.name}:`).join('\n');
  return `services:\n  ${serviceName}:\n    volumes:\n${svc}\nvolumes:\n${named}\n`;
}

/** Write compose, env and the volumes override into the stack directory. */
async function writeStack(dir: string, ctx: DeployContext): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'docker-compose.yml'), ctx.compose, 'utf8');

  const envFile = Object.entries(ctx.env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  await fsp.writeFile(path.join(dir, '.env'), envFile, 'utf8');

  const overridePath = path.join(dir, 'docker-compose.override.yml');
  const override = overrideYaml(ctx.serviceName || firstService(ctx.compose), ctx.volumes ?? []);
  if (override) await fsp.writeFile(overridePath, override, 'utf8');
  else await fsp.rm(overridePath, { force: true }).catch(() => {});
}

async function composeUp(dir: string): Promise<void> {
  await exec('docker', ['compose', 'up', '-d'], { cwd: dir, timeout: 120_000 });
}

/** Deploy directly on the host via `docker compose` (requires the socket). */
export const dockerDriver: Driver = {
  id: 'docker',
  label: 'Docker (direct)',
  manage: true,
  // Needs the daemon socket AND a docker CLI to actually run `docker compose`.
  isAvailable: (cfg) => cfg.dockerEnabled && fs.existsSync(SOCKET) && hasDockerCli(),
  async deploy(ctx) {
    const dir = path.join(STORE_DEPLOY_DIR, ctx.slug);
    try {
      await writeStack(dir, ctx);
      await composeUp(dir);
      return { ok: true, message: 'Stack started with Docker Compose.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'docker compose failed' };
    }
  },
  async redeploy(ctx) {
    const dir = path.join(STORE_DEPLOY_DIR, ctx.slug);
    try {
      await writeStack(dir, ctx);
      await composeUp(dir);
      return { ok: true, message: 'Stack redeployed with your changes.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'docker compose failed' };
    }
  },
  async restart(slug) {
    const dir = path.join(STORE_DEPLOY_DIR, slug);
    try {
      await exec('docker', ['compose', 'restart'], { cwd: dir, timeout: 120_000 });
      return { ok: true, message: 'Stack restarted.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'docker compose restart failed' };
    }
  },
};
