import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { HostedApp } from '../models/HostedApp.js';
import { User } from '../models/User.js';
import { OpenEvent } from '../models/OpenEvent.js';
import {
  StoreInstalledApp,
  type StoreInstalledAppDoc,
  type ServingMode,
} from '../models/StoreInstalledApp.js';
import type { StoreConfigDoc } from '../models/StoreConfig.js';
import { ApiError } from '../middleware/error.js';
import { slugify, withRandomSuffix } from '../utils/slug.js';
import { safeExtractZip, findEntryFile } from '../utils/zip.js';
import { STORE_APPS_DIR, STORE_DEPLOY_DIR, STORE_UPLOADS_DIR, TMP_DIR } from '../config/paths.js';
import { getDriver } from './drivers/index.js';
import type { Manifest } from './manifest.js';

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Defence in depth before using a value as a filesystem directory name. */
function assertSafeSlug(slug: string): void {
  if (!SAFE_SLUG.test(slug) || slug.includes('..')) {
    throw new ApiError(400, 'Invalid app slug');
  }
}

/** A slug unique across HostedApp cards and Store installs. */
async function uniqueStoreSlug(base: string): Promise<string> {
  const root = slugify(base) || 'app';
  const taken = async (s: string) =>
    (await HostedApp.exists({ slug: s })) || (await StoreInstalledApp.exists({ slug: s }));
  if (!(await taken(root))) return root;
  for (let i = 0; i < 6; i++) {
    const candidate = withRandomSuffix(root);
    if (!(await taken(candidate))) return candidate;
  }
  throw new ApiError(500, 'Could not allocate a slug');
}

async function createCard(opts: {
  name: string;
  description: string;
  externalUrl: string;
  ownerId: string;
  slug?: string;
}): Promise<InstanceType<typeof HostedApp>> {
  const slug = opts.slug ?? (await uniqueStoreSlug(opts.name));
  const app = await HostedApp.create({
    name: opts.name,
    description: opts.description,
    category: 'Store',
    slug,
    externalUrl: opts.externalUrl,
    owner: opts.ownerId,
  });
  return app;
}

// -------------------------------- tile ---------------------------------------

export async function installTile(
  manifest: Manifest,
  source: string,
  ownerId: string,
): Promise<StoreInstalledAppDoc> {
  if (!manifest.tile) throw new ApiError(422, 'Manifest has no tile config');
  const app = await createCard({
    name: manifest.name,
    description: manifest.description,
    externalUrl: manifest.tile.url,
    ownerId,
  });
  return StoreInstalledApp.create({
    manifestId: manifest.id,
    name: manifest.name,
    type: 'tile',
    sourceName: source,
    hostedApp: app._id,
    installedVersion: manifest.version,
  });
}

// -------------------------------- static -------------------------------------

const UPLOAD_TOKEN = /^store-upload:([a-f0-9]{8,})$/;

/** Read an uploaded bundle (zip or single file) from its token directory. */
async function readUploadedBundle(ref: string): Promise<{ buf: Buffer; name: string }> {
  const m = UPLOAD_TOKEN.exec(ref);
  if (!m) throw new ApiError(400, 'Invalid upload reference');
  const dir = path.resolve(STORE_UPLOADS_DIR, m[1]);
  const within = path.relative(path.resolve(STORE_UPLOADS_DIR), dir);
  if (within.startsWith('..') || path.isAbsolute(within)) {
    throw new ApiError(400, 'Invalid upload reference');
  }
  let files: string[];
  try {
    files = (await fsp.readdir(dir)).filter((f) => !f.startsWith('.'));
  } catch {
    throw new ApiError(404, 'Uploaded file is no longer available');
  }
  if (files.length === 0) throw new ApiError(404, 'Uploaded file is no longer available');
  const name = files[0];
  return { buf: await fsp.readFile(path.join(dir, name)), name };
}

/**
 * Materialise a static app's content into `STORE_APPS_DIR/<slug>/` and return the
 * entry file. The source is either a remote URL or an admin-uploaded bundle.
 */
async function fetchStatic(
  source: { source_url?: string; upload?: string },
  slug: string,
  entrypoint: string,
): Promise<string> {
  assertSafeSlug(slug);
  const dir = path.join(STORE_APPS_DIR, slug);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });

  let buf: Buffer;
  let name: string; // file name / URL, for the .zip extension heuristic
  let contentType = '';
  if (source.upload) {
    const bundle = await readUploadedBundle(source.upload);
    buf = bundle.buf;
    name = bundle.name;
  } else {
    name = source.source_url ?? '';
    const res = await fetch(name, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new ApiError(502, `Could not download app (HTTP ${res.status})`);
    contentType = res.headers.get('content-type') ?? '';
    buf = Buffer.from(await res.arrayBuffer());
  }

  const isZip =
    name.toLowerCase().endsWith('.zip') ||
    contentType.includes('zip') ||
    (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b);

  if (isZip) {
    const tmp = path.join(TMP_DIR, `store-${crypto.randomBytes(8).toString('hex')}.zip`);
    await fsp.writeFile(tmp, buf);
    try {
      const extracted = safeExtractZip(tmp, dir);
      const entry =
        (entrypoint && extracted.includes(entrypoint) && entrypoint) || findEntryFile(extracted);
      if (!entry) throw new ApiError(422, 'No HTML entry file found in the archive');
      return entry;
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }

  // Single file → store under a safe entrypoint name.
  const safeEntry = path.basename(entrypoint || 'index.html').replace(/[^a-zA-Z0-9._-]/g, '') || 'index.html';
  await fsp.writeFile(path.join(dir, safeEntry), buf);
  return safeEntry;
}

export async function installStatic(
  manifest: Manifest,
  source: string,
  opts: { servingMode: ServingMode; ownerId: string; config: StoreConfigDoc },
): Promise<StoreInstalledAppDoc> {
  if (!manifest.static) throw new ApiError(422, 'Manifest has no static config');

  const mode: ServingMode =
    opts.servingMode === 'subdomain' && opts.config.wildcardEnabled && opts.config.baseDomain
      ? 'subdomain'
      : 'path';

  const slug = await uniqueStoreSlug(manifest.id);
  await fetchStatic(manifest.static, slug, manifest.static.entrypoint);

  const externalUrl =
    mode === 'subdomain'
      ? `https://${slug}.${opts.config.baseDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`
      : `/store-apps/${slug}/`;

  const app = await createCard({
    name: manifest.name,
    description: manifest.description,
    externalUrl,
    ownerId: opts.ownerId,
    slug,
  });

  return StoreInstalledApp.create({
    manifestId: manifest.id,
    name: manifest.name,
    type: 'static',
    sourceName: source,
    hostedApp: app._id,
    installedVersion: manifest.version,
    slug,
    servingMode: mode,
  });
}

/** Re-download a static app's content and bump its installed version. */
export async function updateStatic(
  installed: StoreInstalledAppDoc,
  manifest: Manifest,
): Promise<void> {
  if (installed.type !== 'static' || !installed.slug || !manifest.static) {
    throw new ApiError(400, 'Not a static install');
  }
  await fetchStatic(manifest.static, installed.slug, manifest.static.entrypoint);
  installed.installedVersion = manifest.version;
  await installed.save();
}

// -------------------------------- deploy -------------------------------------

export interface DeployInstallOptions {
  driverId: string;
  env: Record<string, string>;
  finalUrl: string;
  ownerId: string;
  config: StoreConfigDoc;
}

export async function installDeploy(
  manifest: Manifest,
  source: string,
  opts: DeployInstallOptions,
): Promise<{ installed: StoreInstalledAppDoc; driverMessage: string }> {
  if (!manifest.deploy) throw new ApiError(422, 'Manifest has no deploy config');

  const driver = getDriver(opts.driverId);
  if (!driver) throw new ApiError(400, 'Unknown deploy driver');
  if (!(await driver.isAvailable(opts.config))) {
    throw new ApiError(400, 'This deploy driver is not available');
  }
  if (!opts.finalUrl) throw new ApiError(400, 'A resulting app URL is required to create the tile');

  const slug = await uniqueStoreSlug(manifest.id);
  const result = await driver.deploy({
    slug,
    compose: manifest.deploy.docker_compose,
    env: opts.env,
    defaultPort: manifest.deploy.default_port,
    config: opts.config,
  });
  if (!result.ok) throw new ApiError(502, `Deploy failed: ${result.message}`);

  const app = await createCard({
    name: manifest.name,
    description: manifest.description,
    externalUrl: opts.finalUrl,
    ownerId: opts.ownerId,
    slug,
  });

  const installed = await StoreInstalledApp.create({
    manifestId: manifest.id,
    name: manifest.name,
    type: 'deploy',
    sourceName: source,
    hostedApp: app._id,
    installedVersion: manifest.version,
    slug,
    deployDriver: opts.driverId,
  });
  return { installed, driverMessage: result.message };
}

// ------------------------------- uninstall -----------------------------------

/** Remove the install: its card, any on-disk static files, and the record. */
export async function uninstall(installed: StoreInstalledAppDoc): Promise<void> {
  if (installed.hostedApp) {
    const app = await HostedApp.findById(installed.hostedApp);
    if (app) {
      await app.deleteOne();
      await User.updateMany(
        { $or: [{ allowedApps: app._id }, { favorites: app._id }] },
        { $pull: { allowedApps: app._id, favorites: app._id } },
      );
      await OpenEvent.deleteMany({ app: app._id });
    }
  }
  if (installed.type === 'static' && installed.slug && SAFE_SLUG.test(installed.slug)) {
    await fsp.rm(path.join(STORE_APPS_DIR, installed.slug), { recursive: true, force: true });
  }
  if (installed.type === 'deploy' && installed.slug && SAFE_SLUG.test(installed.slug)) {
    await fsp.rm(path.join(STORE_DEPLOY_DIR, installed.slug), { recursive: true, force: true }).catch(
      () => {},
    );
  }
  await installed.deleteOne();
}

/** Serve a static store app's file, resolving safely within its directory. */
export function resolveStoreFile(slug: string, requested: string): string | null {
  if (!SAFE_SLUG.test(slug)) return null;
  const baseDir = path.resolve(STORE_APPS_DIR, slug);
  const rel = requested.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('..')) return null;
  const target = path.resolve(baseDir, rel || 'index.html');
  const within = path.relative(baseDir, target);
  if (within.startsWith('..') || path.isAbsolute(within)) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return target;
}
