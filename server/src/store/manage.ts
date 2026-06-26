import { ApiError } from '../middleware/error.js';
import { StoreCatalogSource, type StoreCatalogSourceDoc } from '../models/StoreCatalogSource.js';
import { slugify, withRandomSuffix } from '../utils/slug.js';
import { createCatalogFile, addApp } from './managedCatalog.js';
import type { Manifest } from './manifest.js';

/** Create a Dashy-managed catalogue (a writable local catalogue file). */
export async function createManagedCatalogue(name: string): Promise<StoreCatalogSourceDoc> {
  if (await StoreCatalogSource.findOne({ name })) {
    throw new ApiError(409, 'A source with this name already exists');
  }
  let slug = slugify(name);
  let file: string;
  for (let i = 0; ; i++) {
    try {
      file = await createCatalogFile(slug);
      break;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && i < 6) {
        slug = withRandomSuffix(slugify(name));
        continue;
      }
      throw err;
    }
  }
  return StoreCatalogSource.create({
    name,
    type: 'local',
    managed: true,
    location: file,
    ttlMinutes: 0,
  });
}

/** Register a read-only catalogue source (local path or remote URL). */
export async function addCatalogSource(input: {
  name: string;
  type: 'local' | 'remote';
  location: string;
}): Promise<StoreCatalogSourceDoc> {
  if (await StoreCatalogSource.findOne({ name: input.name })) {
    throw new ApiError(409, 'A source with this name already exists');
  }
  return StoreCatalogSource.create({ ...input, ttlMinutes: 60 });
}

/** Add an app (already-validated manifest input) to a managed catalogue by name. */
export async function addAppToManagedCatalogue(
  sourceName: string,
  manifest: unknown,
): Promise<{ source: StoreCatalogSourceDoc; manifest: Manifest }> {
  const source = await StoreCatalogSource.findOne({ name: sourceName });
  if (!source) throw new ApiError(404, 'Catalogue not found');
  if (!source.managed) throw new ApiError(400, 'That catalogue is read-only');
  const added = await addApp(source, manifest);
  source.lastFetchedAt = null;
  await source.save();
  return { source, manifest: added };
}
