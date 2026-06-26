import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ApiError } from '../middleware/error.js';
import { CATALOGS_DIR, catalogFile } from '../config/paths.js';
import { parseManifest, type Manifest } from './manifest.js';
import type { StoreCatalogSourceDoc } from '../models/StoreCatalogSource.js';

/** A managed catalogue file slug — also the file name, so it must be safe. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve a managed source's file, asserting it stays inside CATALOGS_DIR. */
function managedPath(source: StoreCatalogSourceDoc): string {
  if (!source.managed || source.type !== 'local') {
    throw new ApiError(400, 'This catalogue is read-only');
  }
  const target = path.resolve(source.location);
  const within = path.relative(path.resolve(CATALOGS_DIR), target);
  if (within.startsWith('..') || path.isAbsolute(within) || within.includes('..')) {
    throw new ApiError(400, 'Invalid managed catalogue path');
  }
  return target;
}

/** Create an empty managed catalogue file. Fails if it already exists. */
export async function createCatalogFile(slug: string): Promise<string> {
  if (!SAFE_SLUG.test(slug)) throw new ApiError(400, 'Invalid catalogue name');
  await fsp.mkdir(CATALOGS_DIR, { recursive: true });
  const file = catalogFile(slug);
  if (fs.existsSync(file)) throw new ApiError(409, 'A catalogue file with this name already exists');
  await writeApps(file, []);
  return file;
}

/** Remove a managed catalogue's file (best-effort). */
export async function deleteCatalogFile(source: StoreCatalogSourceDoc): Promise<void> {
  let file: string;
  try {
    file = managedPath(source);
  } catch {
    return; // not a managed file we own — nothing to delete
  }
  await fsp.rm(file, { force: true }).catch(() => {});
}

/** Read the apps array from a managed catalogue file. */
async function readApps(file: string): Promise<Manifest[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    throw new ApiError(500, 'Could not read the catalogue file');
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { apps?: unknown[] }).apps)
      ? ((raw as { apps: unknown[] }).apps as unknown[])
      : [];
  const apps: Manifest[] = [];
  for (const item of list) {
    const parsed = parseManifest(item);
    if (parsed.ok) apps.push(parsed.data);
  }
  return apps;
}

/** Atomically write the apps array as a `{ "apps": [...] }` index file. */
async function writeApps(file: string, apps: Manifest[]): Promise<void> {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ apps }, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

/** Validate raw manifest input, returning a clean Manifest or throwing 422. */
function validate(input: unknown): Manifest {
  const parsed = parseManifest(input);
  if (!parsed.ok) throw new ApiError(422, parsed.error);
  return parsed.data;
}

export async function addApp(source: StoreCatalogSourceDoc, input: unknown): Promise<Manifest> {
  const file = managedPath(source);
  const manifest = validate(input);
  const apps = await readApps(file);
  if (apps.some((a) => a.id === manifest.id)) {
    throw new ApiError(409, `An app with id "${manifest.id}" already exists in this catalogue`);
  }
  apps.push(manifest);
  await writeApps(file, apps);
  return manifest;
}

export async function updateApp(
  source: StoreCatalogSourceDoc,
  appId: string,
  input: unknown,
): Promise<Manifest> {
  const file = managedPath(source);
  const manifest = validate(input);
  const apps = await readApps(file);
  const idx = apps.findIndex((a) => a.id === appId);
  if (idx === -1) throw new ApiError(404, 'App not found in this catalogue');
  // If the id changed, the new one must not collide with another entry.
  if (manifest.id !== appId && apps.some((a) => a.id === manifest.id)) {
    throw new ApiError(409, `An app with id "${manifest.id}" already exists in this catalogue`);
  }
  apps[idx] = manifest;
  await writeApps(file, apps);
  return manifest;
}

export async function removeApp(source: StoreCatalogSourceDoc, appId: string): Promise<void> {
  const file = managedPath(source);
  const apps = await readApps(file);
  const next = apps.filter((a) => a.id !== appId);
  if (next.length === apps.length) throw new ApiError(404, 'App not found in this catalogue');
  await writeApps(file, next);
}
