import fsp from 'node:fs/promises';
import path from 'node:path';
import { StoreCatalogSource, type StoreCatalogSourceDoc } from '../models/StoreCatalogSource.js';
import { extractManifests, type Manifest } from './manifest.js';

export interface CatalogApp extends Manifest {
  source: string;
}

async function loadLocal(location: string): Promise<unknown> {
  const stat = await fsp.stat(location);
  if (stat.isDirectory()) {
    const files = (await fsp.readdir(location)).filter((f) => f.toLowerCase().endsWith('.json'));
    const apps: unknown[] = [];
    for (const f of files) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(location, f), 'utf8'));
        apps.push(...extractManifests(data).apps);
      } catch (err) {
        console.warn(`[store] could not read ${f}:`, err instanceof Error ? err.message : err);
      }
    }
    return { apps };
  }
  return JSON.parse(await fsp.readFile(location, 'utf8'));
}

async function loadRemote(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Fetch + validate one source's manifests, caching the result. Never throws. */
async function refreshSource(src: StoreCatalogSourceDoc): Promise<void> {
  try {
    const raw = src.type === 'local' ? await loadLocal(src.location) : await loadRemote(src.location);
    const { apps, rejected } = extractManifests(raw);
    src.cachedApps = apps;
    src.lastFetchedAt = new Date();
    src.lastError = rejected.length ? `${rejected.length} manifest(s) rejected` : null;
    if (rejected.length) {
      console.warn(`[store] source "${src.name}" rejected ${rejected.length}:`, rejected.join(' | '));
    }
    await src.save();
  } catch (err) {
    src.lastError = err instanceof Error ? err.message : 'fetch failed';
    src.lastFetchedAt = new Date();
    await src.save();
    console.error(`[store] source "${src.name}" failed:`, src.lastError);
  }
}

/** Refresh sources whose cache is stale (or all of them when `force`). */
export async function refreshAll(force = false): Promise<void> {
  const sources = await StoreCatalogSource.find({ enabled: true });
  await Promise.all(
    sources.map((s) => {
      const ttlMs = (s.ttlMinutes || 0) * 60_000;
      const fresh =
        !force &&
        s.lastFetchedAt &&
        Date.now() - s.lastFetchedAt.getTime() < ttlMs &&
        (Array.isArray(s.cachedApps) ? s.cachedApps.length > 0 || s.lastError === null : false);
      return fresh ? Promise.resolve() : refreshSource(s);
    }),
  );
}

/** The merged catalogue across all enabled sources, each app tagged with its source. */
export async function getCatalog(force = false): Promise<CatalogApp[]> {
  await refreshAll(force);
  const sources = await StoreCatalogSource.find({ enabled: true }).sort({ createdAt: 1 });
  const out: CatalogApp[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    for (const app of (s.cachedApps as Manifest[]) ?? []) {
      const key = `${s.name}:${app.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...app, source: s.name });
    }
  }
  return out;
}

/** Look up a single manifest from the (cached) catalogue by source + id. */
export async function findManifest(source: string, id: string): Promise<CatalogApp | null> {
  const catalog = await getCatalog(false);
  return catalog.find((a) => a.source === source && a.id === id) ?? null;
}
