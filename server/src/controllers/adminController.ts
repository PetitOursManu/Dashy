import type { Request, Response } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { HostedApp } from '../models/HostedApp.js';
import { ApiError } from '../middleware/error.js';
import { appDir, TMP_DIR } from '../config/paths.js';
import { slugify, withRandomSuffix } from '../utils/slug.js';
import { safeExtractZip, ZipExtractionError } from '../utils/zip.js';
import { logActivity, emailOf } from '../services/activity.js';

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!(await HostedApp.exists({ slug: base }))) return base;
  for (let i = 0; i < 5; i++) {
    const candidate = withRandomSuffix(base);
    if (!(await HostedApp.exists({ slug: candidate }))) return candidate;
  }
  return withRandomSuffix(base);
}

/** Export every hosted app (files + metadata) as a downloadable .zip. */
export async function exportBackup(_req: Request, res: Response): Promise<void> {
  const apps = await HostedApp.find().sort({ createdAt: 1 });
  const zip = new AdmZip();

  const manifestApps = apps.map((app) => {
    const dir = appDir(app.id);
    if (fs.existsSync(dir)) zip.addLocalFolder(dir, `apps/${app.slug}`);
    return {
      name: app.name,
      description: app.description,
      slug: app.slug,
      entryFile: app.entryFile,
      category: app.category,
      openCount: app.openCount,
      createdAt: app.createdAt,
    };
  });

  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify(
        { dashyBackupVersion: 1, exportedAt: new Date().toISOString(), apps: manifestApps },
        null,
        2,
      ),
    ),
  );

  const date = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="dashy-backup-${date}.zip"`);
  res.send(zip.toBuffer());
}

interface ManifestApp {
  name?: unknown;
  description?: unknown;
  slug?: unknown;
  entryFile?: unknown;
  category?: unknown;
  openCount?: unknown;
}

/** Restore hosted apps from a backup .zip (creates new apps, never overwrites). */
export async function importBackup(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new ApiError(400, 'No backup file uploaded');

  const tmp = path.join(TMP_DIR, `restore-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await fsp.mkdir(tmp, { recursive: true });
    try {
      safeExtractZip(req.file.path, tmp);
    } catch (err) {
      if (err instanceof ZipExtractionError) throw new ApiError(422, err.message);
      throw err;
    }

    const manifestPath = path.join(tmp, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new ApiError(400, 'Invalid backup: manifest.json is missing');
    }
    let manifest: { apps?: ManifestApp[] };
    try {
      manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    } catch {
      throw new ApiError(400, 'Invalid backup: manifest.json is not valid JSON');
    }
    if (!Array.isArray(manifest.apps)) {
      throw new ApiError(400, 'Invalid backup manifest');
    }

    let restored = 0;
    for (const a of manifest.apps) {
      if (typeof a.name !== 'string' || typeof a.slug !== 'string') continue;
      const srcDir = path.join(tmp, 'apps', a.slug);

      const app = new HostedApp({
        name: a.name.slice(0, 120),
        description: typeof a.description === 'string' ? a.description.slice(0, 2000) : '',
        category: typeof a.category === 'string' ? a.category.slice(0, 40) : null,
        slug: await uniqueSlug(a.name),
        entryFile: typeof a.entryFile === 'string' ? a.entryFile : 'index.html',
        owner: req.user!.sub,
        openCount: typeof a.openCount === 'number' && a.openCount >= 0 ? a.openCount : 0,
      });

      const destDir = appDir(app.id);
      await fsp.mkdir(destDir, { recursive: true });
      if (fs.existsSync(srcDir)) await fsp.cp(srcDir, destDir, { recursive: true });
      await app.save();
      restored++;
    }

    logActivity('app.imported', await emailOf(req.user!.sub), `restored ${restored} app(s) from backup`);
    res.json({ restored });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(req.file.path, { force: true }).catch(() => {});
  }
}
