import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const PORT_RANGE_START = 8000;
const PORT_RANGE_END = 9999;

export interface PortRemap {
  from: number;
  to: number;
}

/** Host ports currently published by running containers (best-effort). */
export async function getUsedHostPorts(): Promise<Set<number>> {
  try {
    const { stdout } = await exec('docker', ['ps', '--format', '{{.Ports}}'], { timeout: 10_000 });
    const used = new Set<number>();
    // Matches "0.0.0.0:3000->3000/tcp", ":::3000->3000/tcp", etc.
    for (const m of stdout.matchAll(/:(\d+)->/g)) used.add(Number(m[1]));
    return used;
  } catch {
    return new Set();
  }
}

/** Keep `preferred` if free, otherwise the first free port in a high range. */
export function pickFreePort(used: Set<number>, preferred: number): number {
  if (preferred > 0 && !used.has(preferred)) return preferred;
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p)) return p;
  }
  return preferred; // give up — let Docker surface the conflict
}

// A published-ports list entry: `- "HOST:CONTAINER"`, `- HOST:CONTAINER`, or
// `- "IP:HOST:CONTAINER"`, with an optional `/tcp` suffix. Volumes never match
// (their container side is a path, not a number).
const PORT_LINE = /^(\s*-\s*["']?)(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d+):(\d+)((?:\/\w+)?["']?\s*)$/;

/**
 * Rewrite any published host port that's already in use to a free one. Pure and
 * testable. Returns the (possibly) rewritten compose plus the list of remaps.
 */
export function remapPorts(
  compose: string,
  used: Set<number>,
): { compose: string; remap: PortRemap[] } {
  const claimed = new Set(used);
  const remap: PortRemap[] = [];
  const lines = compose.split(/\r?\n/).map((line) => {
    const m = PORT_LINE.exec(line);
    if (!m) return line;
    const [, pre, ip, hostStr, container, post] = m;
    const host = Number(hostStr);
    if (!claimed.has(host)) {
      claimed.add(host);
      return line;
    }
    const free = pickFreePort(claimed, 0);
    claimed.add(free);
    remap.push({ from: host, to: free });
    return `${pre}${ip ? `${ip}:` : ''}${free}:${container}${post}`;
  });
  return { compose: lines.join('\n'), remap };
}

/** Detect busy host ports and rewrite the compose (Docker driver helper). */
export async function resolvePortConflicts(
  compose: string,
): Promise<{ compose: string; remap: PortRemap[] }> {
  return remapPorts(compose, await getUsedHostPorts());
}

/** Apply a port remap to a URL's port (used to fix the resulting tile URL). */
export function remapUrlPort(url: string, remap: PortRemap[]): string {
  try {
    const u = new URL(url);
    const hit = remap.find((r) => r.from === Number(u.port));
    if (!hit) return url;
    u.port = String(hit.to);
    return u.toString();
  } catch {
    return url;
  }
}
