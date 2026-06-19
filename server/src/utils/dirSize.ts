import fsp from 'node:fs/promises';
import path from 'node:path';

/** Recursively sum the byte size of all files under a directory. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // directory missing
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        total += (await fsp.stat(full)).size;
      } catch {
        /* file vanished mid-walk */
      }
    }
  }
  return total;
}
