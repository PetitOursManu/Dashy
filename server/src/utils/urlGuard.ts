import dns from 'node:dns/promises';
import net from 'node:net';
import { z } from 'zod';

/**
 * Guards for URLs that come from data rather than from a trusted operator —
 * catalogue manifests can be authored by a third party (a `remote` source), so
 * their URLs are untrusted input.
 *
 * Two distinct dangers are covered:
 *  - **Dangerous schemes.** `z.string().url()` happily accepts `javascript:` and
 *    `data:`; such a URL stored on a card is rendered as an `<a href>` and
 *    executes in Dashy's origin. Only http/https may ever reach the client.
 *  - **SSRF.** A URL fetched server-side can point at the loopback interface,
 *    the private LAN or a cloud metadata endpoint (169.254.169.254) and have its
 *    response handed back — so hosts resolving to non-public addresses are
 *    refused, and redirects are re-validated hop by hop.
 */

/** Zod string that must be an absolute http(s) URL (rejects javascript:, data:…). */
export const httpUrl = (max = 2000) =>
  z
    .string()
    .max(max)
    .refine(isHttpUrl, { message: 'must be an http(s) URL' });

/** Is this an absolute URL with an http/https scheme? */
export function isHttpUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/** Loopback / private / link-local / CGNAT / unspecified address? */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:127.0.0.1) — check the embedded address.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

/** Throws unless `url` is http(s) and resolves only to public addresses. */
export async function assertPublicHttpUrl(url: string): Promise<void> {
  if (!isHttpUrl(url)) throw new Error('Only http(s) URLs are allowed');
  const { hostname } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`Refusing to fetch a private address (${host})`);
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve ${host}`);
  }
  if (addresses.length === 0) throw new Error(`Could not resolve ${host}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to fetch ${host} — it resolves to a private address`);
    }
  }
}

/**
 * `fetch` for untrusted URLs: validates the target (and every redirect hop)
 * against {@link assertPublicHttpUrl}, so a redirect can't smuggle the request
 * onto the loopback interface or the LAN.
 */
export async function fetchPublicUrl(
  url: string,
  opts: { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, maxRedirects = 3 } = opts;
  let target = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(target);
    const res = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    target = new URL(location, target).toString();
  }
  throw new Error('Too many redirects');
}
