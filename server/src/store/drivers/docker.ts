import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STORE_DEPLOY_DIR } from '../../config/paths.js';
import type { Driver } from './index.js';

const exec = promisify(execFile);
const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

/** Deploy directly on the host via `docker compose` (requires the socket). */
export const dockerDriver: Driver = {
  id: 'docker',
  label: 'Docker (direct)',
  isAvailable: (cfg) => cfg.dockerEnabled && fs.existsSync(SOCKET),
  async deploy(ctx) {
    const dir = path.join(STORE_DEPLOY_DIR, ctx.slug);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'docker-compose.yml'), ctx.compose, 'utf8');
    if (Object.keys(ctx.env).length > 0) {
      const envFile = Object.entries(ctx.env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      await fsp.writeFile(path.join(dir, '.env'), envFile, 'utf8');
    }
    try {
      await exec('docker', ['compose', '-f', 'docker-compose.yml', 'up', '-d'], {
        cwd: dir,
        timeout: 120_000,
      });
      return { ok: true, message: 'Stack started with Docker Compose.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'docker compose failed' };
    }
  },
};
