import type { Request, Response } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HostedApp } from '../models/HostedApp.js';
import { User } from '../models/User.js';
import { OpenEvent } from '../models/OpenEvent.js';
import { ApiError } from '../middleware/error.js';
import { assertCanAccessApp } from '../services/access.js';
import { logActivity, emailOf } from '../services/activity.js';
import {
  placeContent,
  snapshotCurrent,
  restoreVersion,
  removeVersion,
  removeAllVersions,
} from '../services/appContent.js';
import { appDir, PREVIEWS_DIR } from '../config/paths.js';
import { slugify, withRandomSuffix } from '../utils/slug.js';
import { safeExtractZip, findEntryFile, ZipExtractionError } from '../utils/zip.js';

// ----------------------------- validation schemas -----------------------------

export const importMetaSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(2000).trim().optional().default(''),
  category: z.string().max(40).trim().optional(),
});

export const updateAppSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(2000).trim().optional(),
  entryFile: z.string().min(1).max(255).optional(),
  // Empty string clears the category.
  category: z.string().max(40).trim().optional(),
});

type ImportFiles = {
  content?: Express.Multer.File[];
  preview?: Express.Multer.File[];
};

// --------------------------------- helpers -----------------------------------

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!(await HostedApp.exists({ slug: base }))) return base;
  // Collisions are rare; a random suffix guarantees uniqueness.
  for (let i = 0; i < 5; i++) {
    const candidate = withRandomSuffix(base);
    if (!(await HostedApp.exists({ slug: candidate }))) return candidate;
  }
  throw new ApiError(500, 'Could not generate a unique slug');
}

async function removeAppFiles(app: { id: string; previewImage?: string | null }): Promise<void> {
  await fsp.rm(appDir(app.id), { recursive: true, force: true });
  if (app.previewImage) {
    await fsp.rm(path.join(PREVIEWS_DIR, path.basename(app.previewImage)), { force: true });
  }
}

export function serializeApp(app: InstanceType<typeof HostedApp>, favorites?: Set<string>) {
  const json = app.toJSON();
  const share = app.share?.token
    ? {
        token: app.share.token,
        url: `/share/${app.share.token}/`,
        expiresAt: app.share.expiresAt,
        hasPassword: Boolean(app.share.passwordHash),
      }
    : null;
  return {
    ...json,
    url: `/hosted/${app.slug}/`,
    previewUrl: `/api/apps/${app.id}/preview`,
    isFavorite: favorites?.has(app.id) ?? false,
    share,
  };
}

/** Deterministic gradient + initials placeholder for apps without a preview. */
function placeholderSvg(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},55%,32%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360},60%,18%)"/>
    </linearGradient>
  </defs>
  <rect width="480" height="270" fill="url(#g)"/>
  <text x="240" y="135" dominant-baseline="central" text-anchor="middle"
    font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="96" font-weight="700"
    fill="rgba(255,255,255,0.92)">${initials || '◆'}</text>
</svg>`;
}

// --------------------------------- handlers ----------------------------------

export async function listApps(req: Request, res: Response): Promise<void> {
  const me = await User.findById(req.user!.sub).select('allowedApps favorites');
  const favorites = new Set((me?.favorites ?? []).map(String));

  // Admins see every app; regular users only the ones assigned to them.
  const apps =
    req.user!.role === 'admin'
      ? await HostedApp.find().sort({ createdAt: -1 })
      : await HostedApp.find({ _id: { $in: me?.allowedApps ?? [] } }).sort({ createdAt: -1 });

  res.json({ apps: apps.map((a) => serializeApp(a, favorites)) });
}

export async function getApp(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');
  await assertCanAccessApp(req.user!, app._id);
  const me = await User.findById(req.user!.sub).select('favorites');
  const favorites = new Set((me?.favorites ?? []).map(String));
  res.json({ app: serializeApp(app, favorites) });
}

export async function toggleFavorite(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');
  await assertCanAccessApp(req.user!, app._id);

  const me = await User.findById(req.user!.sub);
  if (!me) throw new ApiError(404, 'User not found');

  const id = app.id as string;
  const has = me.favorites.some((f) => String(f) === id);
  me.favorites = has
    ? me.favorites.filter((f) => String(f) !== id)
    : [...me.favorites, app._id];
  await me.save();

  res.json({ id, isFavorite: !has });
}

export async function importApp(req: Request, res: Response): Promise<void> {
  const meta = importMetaSchema.parse(req.body);
  const files = req.files as ImportFiles | undefined;
  const contentFile = files?.content?.[0];
  const previewFile = files?.preview?.[0];

  if (!contentFile) {
    throw new ApiError(400, 'A .html file or .zip archive is required');
  }

  const slug = await uniqueSlug(meta.name);
  // Build the document first so we have a stable id for the directory name.
  const app = new HostedApp({
    name: meta.name,
    description: meta.description,
    category: meta.category || null,
    slug,
    owner: req.user!.sub,
    previewImage: previewFile ? path.basename(previewFile.filename) : null,
  });

  const targetDir = appDir(app.id);
  const ext = path.extname(contentFile.originalname).toLowerCase();

  try {
    fs.mkdirSync(targetDir, { recursive: true });

    if (ext === '.zip') {
      const extracted = safeExtractZip(contentFile.path, targetDir);
      const entry = findEntryFile(extracted);
      if (!entry) {
        throw new ApiError(422, 'No HTML entry file (index.html) found in the archive');
      }
      app.entryFile = entry;
    } else {
      // Standalone HTML → store as index.html.
      await fsp.copyFile(contentFile.path, path.join(targetDir, 'index.html'));
      app.entryFile = 'index.html';
    }

    await app.save();
  } catch (err) {
    // Roll back any partial filesystem/document state.
    await removeAppFiles({ id: app.id, previewImage: app.previewImage });
    if (err instanceof ZipExtractionError) {
      throw new ApiError(422, err.message);
    }
    throw err;
  } finally {
    // Always clean up the temp upload.
    await fsp.rm(contentFile.path, { force: true }).catch(() => {});
  }

  logActivity('app.imported', await emailOf(req.user!.sub), `imported "${app.name}"`);
  res.status(201).json({ app: serializeApp(app) });
}

export async function updateApp(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');

  const updates = updateAppSchema.parse(req.body);

  // Validate entryFile actually exists inside the app directory.
  if (updates.entryFile) {
    const safeName = updates.entryFile.replace(/\\/g, '/');
    if (safeName.includes('..') || path.isAbsolute(safeName)) {
      throw new ApiError(400, 'Invalid entry file path');
    }
    const target = path.resolve(appDir(app.id), safeName);
    const rel = path.relative(appDir(app.id), target);
    if (rel.startsWith('..') || !fs.existsSync(target)) {
      throw new ApiError(400, 'Entry file does not exist in this app');
    }
    app.entryFile = safeName;
  }

  if (updates.name !== undefined) app.name = updates.name;
  if (updates.description !== undefined) app.description = updates.description;
  if (updates.category !== undefined) app.category = updates.category || null;

  // Optional preview replacement (multipart single 'preview' file).
  const previewFile = req.file;
  if (previewFile) {
    const old = app.previewImage;
    app.previewImage = path.basename(previewFile.filename);
    if (old) {
      await fsp.rm(path.join(PREVIEWS_DIR, path.basename(old)), { force: true }).catch(() => {});
    }
  }

  await app.save();
  res.json({ app: serializeApp(app) });
}

const MAX_VERSIONS = 10;

/** Replace an app's content (keeping its URL/stats), snapshotting the old version. */
export async function updateContent(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');
  const contentFile = req.file;
  if (!contentFile) throw new ApiError(400, 'A .html file or .zip archive is required');

  try {
    const snapshot = await snapshotCurrent(app.id, app.entryFile);
    try {
      const entry = await placeContent(contentFile, appDir(app.id));
      app.versions.unshift(snapshot);
      app.entryFile = entry;
      while (app.versions.length > MAX_VERSIONS) {
        const old = app.versions.pop();
        if (old) await removeVersion(app.id, old.vid);
      }
      await app.save();
    } catch (err) {
      // Keep the app serving its previous content if the new upload is invalid.
      await restoreVersion(app.id, snapshot.vid).catch(() => {});
      throw err;
    }
  } finally {
    await fsp.rm(contentFile.path, { force: true }).catch(() => {});
  }

  logActivity('app.updated', await emailOf(req.user!.sub), `updated "${app.name}"`);
  res.json({ app: serializeApp(app) });
}

/** Roll an app back to a snapshotted version (snapshotting the current one first). */
export async function rollbackVersion(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');
  const target = app.versions.find((v) => v.vid === req.params.vid);
  if (!target) throw new ApiError(404, 'Version not found');

  const snapshot = await snapshotCurrent(app.id, app.entryFile);
  await restoreVersion(app.id, target.vid);
  app.versions = app.versions.filter((v) => v.vid !== target.vid);
  app.versions.unshift(snapshot);
  app.entryFile = target.entryFile;
  while (app.versions.length > MAX_VERSIONS) {
    const old = app.versions.pop();
    if (old) await removeVersion(app.id, old.vid);
  }
  await app.save();

  logActivity('app.updated', await emailOf(req.user!.sub), `rolled back "${app.name}"`);
  res.json({ app: serializeApp(app) });
}

export async function deleteApp(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');

  const name = app.name;
  await app.deleteOne();
  await removeAppFiles({ id: app.id, previewImage: app.previewImage });
  await removeAllVersions(app.id);
  // Drop the now-dangling references from users' access + favorite lists.
  await User.updateMany(
    { $or: [{ allowedApps: app._id }, { favorites: app._id }] },
    { $pull: { allowedApps: app._id, favorites: app._id } },
  );
  await OpenEvent.deleteMany({ app: app._id });

  logActivity('app.deleted', await emailOf(req.user!.sub), `deleted "${name}"`);
  res.json({ ok: true });
}

export async function getPreview(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');
  await assertCanAccessApp(req.user!, app._id);

  if (app.previewImage) {
    const file = path.join(PREVIEWS_DIR, path.basename(app.previewImage));
    if (fs.existsSync(file)) {
      res.sendFile(file);
      return;
    }
  }

  // Auto-generated placeholder.
  res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(placeholderSvg(app.name));
}
