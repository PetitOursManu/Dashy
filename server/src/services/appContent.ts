import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { appDir, versionDir, VERSIONS_DIR } from '../config/paths.js';
import { safeExtractZip, findEntryFile, ZipExtractionError } from '../utils/zip.js';
import { ApiError } from '../middleware/error.js';
import type { IAppVersion } from '../models/HostedApp.js';

/** Extract/copy an uploaded content file into `targetDir`; returns the entry file. */
export async function placeContent(
  contentFile: Express.Multer.File,
  targetDir: string,
): Promise<string> {
  const ext = path.extname(contentFile.originalname).toLowerCase();
  try {
    if (ext === '.zip') {
      const extracted = safeExtractZip(contentFile.path, targetDir);
      const entry = findEntryFile(extracted);
      if (!entry) throw new ApiError(422, 'No HTML entry file (index.html) found in the archive');
      return entry;
    }
    await fsp.copyFile(contentFile.path, path.join(targetDir, 'index.html'));
    return 'index.html';
  } catch (err) {
    if (err instanceof ZipExtractionError) throw new ApiError(422, err.message);
    throw err;
  }
}

async function children(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

async function moveItem(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fsp.cp(src, dest, { recursive: true });
      await fsp.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/** Move the app's current files into a fresh version snapshot directory. */
export async function snapshotCurrent(appId: string, entryFile: string): Promise<IAppVersion> {
  const vid = crypto.randomBytes(8).toString('hex');
  const dest = versionDir(appId, vid);
  await fsp.mkdir(dest, { recursive: true });
  const src = appDir(appId);
  for (const name of await children(src)) {
    await moveItem(path.join(src, name), path.join(dest, name));
  }
  return { vid, entryFile, createdAt: new Date() };
}

/** Remove everything inside an app's live directory. */
export async function clearAppDir(appId: string): Promise<void> {
  const src = appDir(appId);
  for (const name of await children(src)) {
    await fsp.rm(path.join(src, name), { recursive: true, force: true });
  }
}

/** Restore a snapshot's files into the live app directory (consumes the snapshot). */
export async function restoreVersion(appId: string, vid: string): Promise<void> {
  const from = versionDir(appId, vid);
  if (!fs.existsSync(from)) throw new ApiError(404, 'Version not found');
  await clearAppDir(appId);
  const root = appDir(appId);
  await fsp.mkdir(root, { recursive: true });
  for (const name of await children(from)) {
    await moveItem(path.join(from, name), path.join(root, name));
  }
  await fsp.rm(from, { recursive: true, force: true });
}

/** Delete a single version snapshot directory. */
export async function removeVersion(appId: string, vid: string): Promise<void> {
  await fsp.rm(versionDir(appId, vid), { recursive: true, force: true }).catch(() => {});
}

/** Delete all version snapshots for an app (on app deletion). */
export async function removeAllVersions(appId: string): Promise<void> {
  await fsp.rm(path.join(VERSIONS_DIR, appId), { recursive: true, force: true }).catch(() => {});
}
