import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root data directory. In Docker this is mounted as a persistent volume at
 * `/data`. Locally it resolves to `<repo>/server/data`.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');

/** Where each hosted app's files live: `<DATA_DIR>/apps/<id>/`. */
export const APPS_DIR = path.join(DATA_DIR, 'apps');

/** Where preview images are stored: `<DATA_DIR>/previews/`. */
export const PREVIEWS_DIR = path.join(DATA_DIR, 'previews');

/** Where user avatars are stored: `<DATA_DIR>/avatars/`. */
export const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

/** Temp dir for in-flight uploads before they are validated/moved. */
export const TMP_DIR = path.join(DATA_DIR, 'tmp');

/** Directory containing the built frontend (served in production). */
export const CLIENT_DIST_DIR = path.resolve(__dirname, '../../public');

export function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, APPS_DIR, PREVIEWS_DIR, AVATARS_DIR, TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Absolute path to a hosted app's directory. */
export function appDir(appId: string): string {
  return path.join(APPS_DIR, appId);
}
