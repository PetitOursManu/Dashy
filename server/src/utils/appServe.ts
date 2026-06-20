import path from 'node:path';
import { appDir } from '../config/paths.js';

/**
 * Resolve a requested sub-path to an absolute file inside an app's directory,
 * rejecting anything that escapes it (path traversal / null bytes). Returns
 * null when the path is unsafe.
 */
export function resolveWithinApp(appId: string, requested: string): string | null {
  const decoded = decodeURIComponent(requested).replace(/\\/g, '/');
  if (decoded.includes('\0')) return null;
  const base = appDir(appId);
  const target = path.resolve(base, '.' + path.sep + decoded);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}
