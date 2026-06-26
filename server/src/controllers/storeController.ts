import type { Request, Response } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../middleware/error.js';
import { storeUploadDir } from '../config/paths.js';
import { encrypt } from '../utils/crypto.js';
import { HostedApp } from '../models/HostedApp.js';
import { StoreCatalogSource } from '../models/StoreCatalogSource.js';
import { StoreInstalledApp } from '../models/StoreInstalledApp.js';
import { getStoreConfig } from '../models/StoreConfig.js';
import { serializeApp } from './appsController.js';
import { logActivity, emailOf } from '../services/activity.js';
import { getCatalog, findManifest } from '../store/catalog.js';
import { availableDrivers } from '../store/drivers/index.js';
import {
  installTile,
  installStatic,
  installDeploy,
  updateStatic,
  uninstall,
  redeployInstall,
  restartInstall,
} from '../store/install.js';
import { deleteCatalogFile, addApp, updateApp, removeApp } from '../store/managedCatalog.js';
import { createManagedCatalogue } from '../store/manage.js';

// ----------------------------- validation schemas -----------------------------

export const createSourceSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  type: z.enum(['local', 'remote']),
  location: z.string().min(1).max(2000).trim(),
  enabled: z.boolean().optional().default(true),
  ttlMinutes: z.number().int().min(0).max(7 * 24 * 60).optional().default(60),
});

export const updateSourceSchema = z
  .object({
    name: z.string().min(1).max(80).trim().optional(),
    location: z.string().min(1).max(2000).trim().optional(),
    enabled: z.boolean().optional(),
    ttlMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const createManagedSchema = z.object({
  name: z.string().min(1).max(80).trim(),
});

export const updateConfigSchema = z.object({
  coolifyEnabled: z.boolean().optional(),
  coolifyBaseUrl: z.string().max(2000).optional(),
  coolifyToken: z.string().max(500).optional(),
  coolifyProjectUuid: z.string().max(200).optional(),
  coolifyServerUuid: z.string().max(200).optional(),
  coolifyDestinationUuid: z.string().max(200).optional(),
  coolifyEnvUuid: z.string().max(200).optional(),
  portainerEnabled: z.boolean().optional(),
  portainerUrl: z.string().max(2000).optional(),
  portainerKey: z.string().max(500).optional(),
  portainerEndpointId: z.string().max(200).optional(),
  dockerEnabled: z.boolean().optional(),
  defaultDriver: z.string().max(40).optional(),
  wildcardEnabled: z.boolean().optional(),
  baseDomain: z.string().max(255).optional(),
});

const volumeSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9._-]+$/, 'invalid volume name').max(64),
  mountPath: z.string().min(1).max(255),
});

export const installSchema = z.object({
  source: z.string().min(1),
  manifestId: z.string().min(1),
  servingMode: z.enum(['path', 'subdomain']).optional(),
  driver: z.string().max(40).optional(),
  env: z.record(z.string()).optional().default({}),
  finalUrl: z.string().url().max(2000).optional(),
  // deploy-only: optional admin overrides applied before deploying.
  compose: z.string().max(100_000).optional(),
  volumes: z.array(volumeSchema).optional().default([]),
  serviceName: z.string().max(64).optional(),
});

export const redeploySchema = z.object({
  compose: z.string().max(100_000).optional(),
  env: z.record(z.string()).optional(),
  volumes: z.array(volumeSchema).optional(),
  serviceName: z.string().max(64).optional(),
});

// --------------------------------- catalog -----------------------------------

async function installedIndex(): Promise<Map<string, string>> {
  // key `${source}:${manifestId}` → installedVersion
  const installed = await StoreInstalledApp.find().select('sourceName manifestId installedVersion');
  return new Map(installed.map((i) => [`${i.sourceName}:${i.manifestId}`, i.installedVersion]));
}

export async function listCatalog(req: Request, res: Response): Promise<void> {
  const force = req.query.refresh === '1';
  const [catalog, idx] = await Promise.all([getCatalog(force), installedIndex()]);
  const apps = catalog.map((a) => {
    const installedVersion = idx.get(`${a.source}:${a.id}`);
    return {
      ...a,
      installed: installedVersion !== undefined,
      updateAvailable: installedVersion !== undefined && installedVersion !== a.version,
    };
  });
  res.json({ apps });
}

export async function refreshCatalog(_req: Request, res: Response): Promise<void> {
  await getCatalog(true);
  res.json({ ok: true });
}

// --------------------------------- sources -----------------------------------

export async function listSources(_req: Request, res: Response): Promise<void> {
  const sources = await StoreCatalogSource.find().sort({ createdAt: 1 });
  res.json({ sources: sources.map((s) => s.toJSON()) });
}

export async function createSource(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createSourceSchema>;
  if (await StoreCatalogSource.findOne({ name: body.name })) {
    throw new ApiError(409, 'A source with this name already exists');
  }
  const source = await StoreCatalogSource.create(body);
  res.status(201).json({ source: source.toJSON() });
}

export async function updateSource(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Source not found');
  const source = await StoreCatalogSource.findById(req.params.id);
  if (!source) throw new ApiError(404, 'Source not found');
  const updates = req.body as z.infer<typeof updateSourceSchema>;
  if (updates.name !== undefined) source.name = updates.name;
  if (updates.location !== undefined) source.location = updates.location;
  if (updates.enabled !== undefined) source.enabled = updates.enabled;
  if (updates.ttlMinutes !== undefined) source.ttlMinutes = updates.ttlMinutes;
  source.lastFetchedAt = null; // force a refetch on next read
  await source.save();
  res.json({ source: source.toJSON() });
}

export async function deleteSource(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Source not found');
  const source = await StoreCatalogSource.findByIdAndDelete(req.params.id);
  if (!source) throw new ApiError(404, 'Source not found');
  if (source.managed) await deleteCatalogFile(source);
  res.json({ ok: true });
}

// ----------------------------- managed catalogues -----------------------------

/** Find a managed source by id, or throw 404/400 as appropriate. */
async function getManagedSource(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Source not found');
  const source = await StoreCatalogSource.findById(id);
  if (!source) throw new ApiError(404, 'Source not found');
  if (!source.managed) throw new ApiError(400, 'This catalogue is read-only');
  return source;
}

export async function createManagedSource(req: Request, res: Response): Promise<void> {
  const { name } = req.body as z.infer<typeof createManagedSchema>;
  const source = await createManagedCatalogue(name);
  res.status(201).json({ source: source.toJSON() });
}

/** Force the source's cache to refresh on the next catalog read. */
async function bumpSource(id: string): Promise<void> {
  await StoreCatalogSource.findByIdAndUpdate(id, { lastFetchedAt: null });
}

export async function addCatalogApp(req: Request, res: Response): Promise<void> {
  const source = await getManagedSource(req.params.id);
  const manifest = await addApp(source, req.body);
  await bumpSource(source.id);
  res.status(201).json({ app: manifest });
}

export async function updateCatalogApp(req: Request, res: Response): Promise<void> {
  const source = await getManagedSource(req.params.id);
  const manifest = await updateApp(source, req.params.appId, req.body);
  await bumpSource(source.id);
  res.json({ app: manifest });
}

export async function deleteCatalogApp(req: Request, res: Response): Promise<void> {
  const source = await getManagedSource(req.params.id);
  await removeApp(source, req.params.appId);
  await bumpSource(source.id);
  res.json({ ok: true });
}

/** Store an uploaded bundle under a fresh token dir; returns its upload ref. */
async function storeBundle(file: Express.Multer.File): Promise<string> {
  const token = crypto.randomBytes(16).toString('hex');
  const dir = storeUploadDir(token);
  await fsp.mkdir(dir, { recursive: true });
  const isZip = path.extname(file.originalname).toLowerCase() === '.zip';
  // The stored name only drives the zip/single-file heuristic at install time.
  await fsp.rename(file.path, path.join(dir, isZip ? 'bundle.zip' : 'index.html'));
  return `store-upload:${token}`;
}

/**
 * Store an admin-uploaded static bundle (.html/.zip) and return a reference the
 * author can drop into a `static` manifest's `upload` field.
 */
export async function uploadStaticBundle(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) throw new ApiError(400, 'No file uploaded');
  const ref = await storeBundle(file);
  res.status(201).json({ ref, filename: file.originalname });
}

/** Bump the patch component of a dotted version string (e.g. 1.2.3 → 1.2.4). */
function bumpPatch(version: string): string {
  const parts = (version || '0.0.0').split('.');
  const last = Number(parts[parts.length - 1]);
  if (Number.isFinite(last)) parts[parts.length - 1] = String(last + 1);
  return parts.join('.');
}

/**
 * Replace a managed-catalogue static app's content from an uploaded bundle,
 * bump its version in the catalogue, and re-materialise the served files.
 */
export async function updateInstalledContent(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Install not found');
  const installed = await StoreInstalledApp.findById(req.params.id);
  if (!installed) throw new ApiError(404, 'Install not found');
  if (installed.type !== 'static') throw new ApiError(400, 'Only static apps support content updates');

  const source = await StoreCatalogSource.findOne({ name: installed.sourceName });
  if (!source || !source.managed) {
    throw new ApiError(400, 'This app does not come from a managed catalogue');
  }
  const file = req.file;
  if (!file) throw new ApiError(400, 'A .html or .zip file is required');

  const current = await findManifest(installed.sourceName, installed.manifestId);
  if (!current) throw new ApiError(404, 'App no longer in the catalogue');

  const version = String(req.body?.version ?? '').trim() || bumpPatch(installed.installedVersion);
  const ref = await storeBundle(file);
  const newManifest = await updateApp(source, installed.manifestId, {
    id: current.id,
    name: current.name,
    description: current.description,
    icon: current.icon,
    author: current.author,
    version,
    type: 'static',
    static: { upload: ref, entrypoint: current.static?.entrypoint || 'index.html' },
  });
  await bumpSource(source.id);
  await updateStatic(installed, newManifest);
  installed.installedVersion = version;
  await installed.save();
  res.json({ ok: true, installed: installed.toJSON() });
}

// ---------------------------------- config -----------------------------------

export async function getConfig(_req: Request, res: Response): Promise<void> {
  const cfg = await getStoreConfig();
  res.json({ config: cfg.toJSON(), drivers: await availableDrivers(cfg) });
}

export async function updateConfig(req: Request, res: Response): Promise<void> {
  const cfg = await getStoreConfig();
  const u = req.body as z.infer<typeof updateConfigSchema>;

  if (u.coolifyEnabled !== undefined) cfg.coolifyEnabled = u.coolifyEnabled;
  if (u.coolifyBaseUrl !== undefined) cfg.coolifyBaseUrl = u.coolifyBaseUrl;
  if (u.coolifyToken !== undefined) cfg.coolifyTokenEnc = u.coolifyToken ? encrypt(u.coolifyToken) : null;
  if (u.coolifyProjectUuid !== undefined) cfg.coolifyProjectUuid = u.coolifyProjectUuid;
  if (u.coolifyServerUuid !== undefined) cfg.coolifyServerUuid = u.coolifyServerUuid;
  if (u.coolifyDestinationUuid !== undefined) cfg.coolifyDestinationUuid = u.coolifyDestinationUuid;
  if (u.coolifyEnvUuid !== undefined) cfg.coolifyEnvUuid = u.coolifyEnvUuid;

  if (u.portainerEnabled !== undefined) cfg.portainerEnabled = u.portainerEnabled;
  if (u.portainerUrl !== undefined) cfg.portainerUrl = u.portainerUrl;
  if (u.portainerKey !== undefined) cfg.portainerKeyEnc = u.portainerKey ? encrypt(u.portainerKey) : null;
  if (u.portainerEndpointId !== undefined) cfg.portainerEndpointId = u.portainerEndpointId;

  if (u.dockerEnabled !== undefined) cfg.dockerEnabled = u.dockerEnabled;
  if (u.defaultDriver !== undefined) cfg.defaultDriver = u.defaultDriver;
  if (u.wildcardEnabled !== undefined) cfg.wildcardEnabled = u.wildcardEnabled;
  if (u.baseDomain !== undefined) cfg.baseDomain = u.baseDomain;

  await cfg.save();
  res.json({ config: cfg.toJSON(), drivers: await availableDrivers(cfg) });
}

// -------------------------------- installed ----------------------------------

export async function listInstalled(_req: Request, res: Response): Promise<void> {
  const [installed, catalog, sources] = await Promise.all([
    StoreInstalledApp.find().sort({ createdAt: -1 }),
    getCatalog(false),
    StoreCatalogSource.find().select('name managed'),
  ]);
  const catVersion = new Map(catalog.map((a) => [`${a.source}:${a.id}`, a.version]));
  const srcByName = new Map(sources.map((s) => [s.name, s]));
  res.json({
    installed: installed.map((i) => {
      const latest = catVersion.get(`${i.sourceName}:${i.manifestId}`);
      const src = srcByName.get(i.sourceName);
      return {
        ...i.toJSON(),
        latestVersion: latest ?? null,
        updateAvailable: latest !== undefined && latest !== i.installedVersion,
        managedSource: Boolean(src?.managed),
        sourceId: src ? src.id : null,
      };
    }),
  });
}

export async function install(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof installSchema>;
  const manifest = await findManifest(body.source, body.manifestId);
  if (!manifest) throw new ApiError(404, 'App not found in the catalogue');

  const ownerId = req.user!.sub;
  let cardId: mongoose.Types.ObjectId | null = null;
  let driverMessage: string | undefined;

  if (manifest.type === 'tile') {
    const installed = await installTile(manifest, body.source, ownerId);
    cardId = installed.hostedApp;
  } else if (manifest.type === 'static') {
    const cfg = await getStoreConfig();
    const installed = await installStatic(manifest, body.source, {
      servingMode: body.servingMode === 'subdomain' ? 'subdomain' : 'path',
      ownerId,
      config: cfg,
    });
    cardId = installed.hostedApp;
  } else {
    const cfg = await getStoreConfig();
    const { installed, driverMessage: msg } = await installDeploy(manifest, body.source, {
      driverId: body.driver || 'manual',
      env: body.env ?? {},
      finalUrl: body.finalUrl ?? '',
      ownerId,
      config: cfg,
      compose: body.compose,
      volumes: body.volumes,
      serviceName: body.serviceName,
    });
    cardId = installed.hostedApp;
    driverMessage = msg;
  }

  logActivity('app.imported', await emailOf(ownerId), `installed "${manifest.name}" from Store`);

  const app = cardId ? await HostedApp.findById(cardId) : null;
  res.status(201).json({
    ok: true,
    driverMessage,
    app: app ? serializeApp(app) : null,
  });
}

export async function updateInstalled(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Install not found');
  const installed = await StoreInstalledApp.findById(req.params.id);
  if (!installed) throw new ApiError(404, 'Install not found');
  if (installed.type !== 'static') throw new ApiError(400, 'Only static apps can be updated');

  const manifest = await findManifest(installed.sourceName, installed.manifestId);
  if (!manifest) throw new ApiError(404, 'App no longer in the catalogue');
  await updateStatic(installed, manifest);
  res.json({ ok: true, installed: installed.toJSON() });
}

export async function redeployApp(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Install not found');
  const installed = await StoreInstalledApp.findById(req.params.id);
  if (!installed) throw new ApiError(404, 'Install not found');
  if (installed.type !== 'deploy') throw new ApiError(400, 'Only deploy apps can be redeployed');

  const u = req.body as z.infer<typeof redeploySchema>;
  if (u.compose !== undefined) installed.compose = u.compose;
  if (u.env !== undefined) installed.deployEnv = new Map(Object.entries(u.env));
  if (u.volumes !== undefined) installed.volumes = u.volumes;
  if (u.serviceName !== undefined) installed.serviceName = u.serviceName;
  await installed.save();

  const message = await redeployInstall(installed, await getStoreConfig());
  res.json({ ok: true, message, installed: installed.toJSON() });
}

export async function restartApp(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Install not found');
  const installed = await StoreInstalledApp.findById(req.params.id);
  if (!installed) throw new ApiError(404, 'Install not found');
  if (installed.type !== 'deploy') throw new ApiError(400, 'Only deploy apps can be restarted');
  const message = await restartInstall(installed, await getStoreConfig());
  res.json({ ok: true, message });
}

export async function uninstallApp(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Install not found');
  const installed = await StoreInstalledApp.findById(req.params.id);
  if (!installed) throw new ApiError(404, 'Install not found');
  await uninstall(installed);
  res.json({ ok: true });
}
