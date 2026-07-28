import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeExtractZip } from '../utils/zip.js';

/**
 * Fetches a public GitHub repository's source so a compose `build:` directive
 * can find its Dockerfile + code. Only `codeload.github.com` is contacted, and
 * the host is built from the parsed owner/name — never from a user-supplied host
 * — so this can't be turned into an SSRF primitive.
 */

const GITHUB_REPO_RE =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^/\s#?]+))?\/?$/i;
const MAX_ZIP_BYTES = 200 * 1024 * 1024; // 200 MB

export interface RepoRef {
  owner: string;
  name: string;
  branch: string | null;
}

/** Parse a github.com repo URL into owner/name/branch, or null if unsupported. */
export function parseGitHubRepo(repo: string): RepoRef | null {
  const m = GITHUB_REPO_RE.exec(repo.trim());
  if (!m) return null;
  // owner/name go into a URL path unencoded — restrict them to GitHub's own
  // charset so they can't inject a query string or extra path segments.
  const SAFE = /^[A-Za-z0-9._-]+$/;
  if (!SAFE.test(m[1]) || !SAFE.test(m[2])) return null;
  return { owner: m[1], name: m[2], branch: m[3] ?? null };
}

/** The single top-level folder GitHub zipballs wrap everything in, if any. */
export function topFolder(entries: string[]): string | null {
  const tops = new Set(entries.map((e) => e.split('/')[0]).filter(Boolean));
  return tops.size === 1 ? [...tops][0] : null;
}

async function downloadZip(url: string, dest: string): Promise<boolean> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_ZIP_BYTES) throw new Error('Repository archive too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_ZIP_BYTES) throw new Error('Repository archive too large');
  await fsp.writeFile(dest, buf);
  return true;
}

/**
 * Download `repo` (optionally at `branchHint`) and lay its source out flat in
 * `destDir` (the GitHub `<repo>-<ref>/` wrapper folder is stripped). Tries the
 * given branch, else `main` then `master`. Throws on failure.
 */
export async function fetchRepoSource(
  repo: string,
  branchHint: string | undefined,
  destDir: string,
): Promise<void> {
  const ref = parseGitHubRepo(repo);
  if (!ref) {
    throw new Error('Only public github.com repositories are supported as a build source');
  }
  const branches = branchHint ? [branchHint] : ref.branch ? [ref.branch] : ['main', 'master'];

  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'dashy-src-'));
  const zipPath = path.join(staging, 'repo.zip');
  try {
    let downloaded = false;
    for (const b of branches) {
      const url = `https://codeload.github.com/${ref.owner}/${ref.name}/zip/refs/heads/${encodeURIComponent(b)}`;
      if (await downloadZip(url, zipPath)) {
        downloaded = true;
        break;
      }
    }
    if (!downloaded) {
      throw new Error(`Could not download ${ref.owner}/${ref.name} (branch not found)`);
    }

    const extractDir = path.join(staging, 'extract');
    await fsp.mkdir(extractDir, { recursive: true });
    const entries = safeExtractZip(zipPath, extractDir);
    const top = topFolder(entries);
    const srcRoot = top ? path.join(extractDir, top) : extractDir;

    await fsp.mkdir(destDir, { recursive: true });
    await fsp.cp(srcRoot, destDir, { recursive: true });
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
