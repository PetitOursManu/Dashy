import crypto from 'node:crypto';

/**
 * Turn an arbitrary name into a URL-safe slug. Strips accents, lowercases,
 * collapses non-alphanumerics into single hyphens, and trims hyphens.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'app';
}

/** Append a short random suffix to guarantee uniqueness. */
export function withRandomSuffix(slug: string): string {
  const suffix = crypto.randomBytes(3).toString('hex'); // 6 hex chars
  return `${slug}-${suffix}`;
}
