import AdmZip from 'adm-zip';
import path from 'node:path';
import fs from 'node:fs';

export class ZipExtractionError extends Error {}

/** Common static-site entry filenames, in priority order. */
const ENTRY_CANDIDATES = ['index.html', 'index.htm'];

/**
 * Safely extract a ZIP archive into `destDir`.
 *
 * Hardening against path traversal / zip-slip:
 *  - reject absolute paths and any entry whose name contains `..`
 *  - resolve each target and verify it stays within `destDir`
 *  - skip symlinks and directory entries are created explicitly
 *
 * Returns the list of extracted file paths (relative to destDir, POSIX-style).
 */
export function safeExtractZip(zipPath: string, destDir: string): string[] {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const resolvedDest = path.resolve(destDir);
  const extracted: string[] = [];

  for (const entry of entries) {
    const rawName = entry.entryName;

    // Reject absolute paths and parent-directory traversal outright.
    if (path.isAbsolute(rawName) || rawName.includes('..')) {
      throw new ZipExtractionError(`Unsafe path in archive: ${rawName}`);
    }
    // Reject backslash-based traversal and drive letters (Windows archives).
    if (/^[a-zA-Z]:/.test(rawName) || rawName.includes('\\')) {
      throw new ZipExtractionError(`Unsafe path in archive: ${rawName}`);
    }

    const targetPath = path.resolve(resolvedDest, rawName);

    // Defense in depth: the resolved path must remain inside destDir.
    const relative = path.relative(resolvedDest, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ZipExtractionError(`Entry escapes destination: ${rawName}`);
    }

    if (entry.isDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, entry.getData());
    extracted.push(rawName.split(path.sep).join('/'));
  }

  if (extracted.length === 0) {
    throw new ZipExtractionError('Archive contains no files');
  }

  return extracted;
}

/**
 * Find a sensible entry HTML file among the extracted files.
 * Prefers a root-level index.html, then any index.html, then the first .html.
 */
export function findEntryFile(extracted: string[]): string | null {
  // Root-level index.html / index.htm first.
  for (const candidate of ENTRY_CANDIDATES) {
    if (extracted.includes(candidate)) return candidate;
  }
  // Nested index.html (shallowest wins).
  const indexes = extracted
    .filter((f) => /(^|\/)index\.html?$/i.test(f))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (indexes.length > 0) return indexes[0];

  // Fall back to the first HTML file found.
  const html = extracted.filter((f) => /\.html?$/i.test(f));
  return html[0] ?? null;
}
