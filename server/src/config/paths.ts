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

/** Where user background images are stored: `<DATA_DIR>/backgrounds/`. */
export const BACKGROUNDS_DIR = path.join(DATA_DIR, 'backgrounds');

/** Where previous app versions are snapshotted: `<DATA_DIR>/versions/<appId>/<vid>/`. */
export const VERSIONS_DIR = path.join(DATA_DIR, 'versions');

/** Where Store `static` apps are installed: `<DATA_DIR>/store-apps/<slug>/`. */
export const STORE_APPS_DIR = path.join(DATA_DIR, 'store-apps');

/** Where Store `deploy` compose files are written: `<DATA_DIR>/store-deploy/<slug>/`. */
export const STORE_DEPLOY_DIR = path.join(DATA_DIR, 'store-deploy');

/** Where Dashy-managed catalogue files live: `<DATA_DIR>/catalogs/<slug>.json`. */
export const CATALOGS_DIR = path.join(DATA_DIR, 'catalogs');

/** Temp dir for in-flight uploads before they are validated/moved. */
export const TMP_DIR = path.join(DATA_DIR, 'tmp');

/** Directory containing the built frontend (served in production). */
export const CLIENT_DIST_DIR = path.resolve(__dirname, '../../public');

export function ensureDataDirs(): void {
  for (const dir of [
    DATA_DIR,
    APPS_DIR,
    PREVIEWS_DIR,
    AVATARS_DIR,
    BACKGROUNDS_DIR,
    VERSIONS_DIR,
    STORE_APPS_DIR,
    STORE_DEPLOY_DIR,
    CATALOGS_DIR,
    TMP_DIR,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Absolute path to a Dashy-managed catalogue file. */
export function catalogFile(slug: string): string {
  return path.join(CATALOGS_DIR, `${slug}.json`);
}

/** Absolute path to a hosted app's directory. */
export function appDir(appId: string): string {
  return path.join(APPS_DIR, appId);
}

/** Absolute path to a snapshotted version's directory. */
export function versionDir(appId: string, vid: string): string {
  return path.join(VERSIONS_DIR, appId, vid);
}
