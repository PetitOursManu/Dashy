import { useEffect, useRef } from 'react';
import type { AnimationItem } from 'lottie-web';
// SVG-only build: smaller, and no `eval`/expressions (keeps us within the app's
// strict CSP, which does not allow 'unsafe-eval').
import lottie from 'lottie-web/build/player/lottie_light';

/**
 * Reusable Lottie player. The animation JSON lives in /public/lottie and is
 * fetched once (then cached), so it never bloats the JS bundle. When a `color`
 * is given the artwork is recolored on the fly — our source animations are
 * monochrome (black / white / light-grey), which lets a single file adapt to
 * whatever the active theme needs (e.g. an accent-tinted loader).
 */

type LottieJson = Record<string, unknown>;

const cache = new Map<string, Promise<LottieJson>>();

function loadData(src: string): Promise<LottieJson> {
  let p = cache.get(src);
  if (!p) {
    p = fetch(src).then((r) => r.json() as Promise<LottieJson>);
    cache.set(src, p);
  }
  return p;
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Rewrite every fill/stroke colour in a Lottie tree to `rgb` (0–1 channels),
// preserving each shape's original alpha.
function setColor(c: { k: unknown }, rgb: [number, number, number]): void {
  const k = c.k as unknown;
  if (Array.isArray(k) && typeof k[0] === 'number') {
    const a = k.length > 3 ? (k[3] as number) : 1;
    c.k = [...rgb, a];
  } else if (Array.isArray(k)) {
    for (const kf of k as Array<{ s?: unknown }>) {
      if (Array.isArray(kf.s) && typeof kf.s[0] === 'number') {
        const a = kf.s.length > 3 ? (kf.s[3] as number) : 1;
        kf.s = [...rgb, a];
      }
    }
  }
}

// Hide full-frame "solid" layers (ty:1) — some source files ship an opaque
// background solid we don't want when overlaying the animation on the page.
function hideSolids(node: unknown): void {
  if (Array.isArray(node)) {
    for (const n of node) hideSolids(n);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.ty === 1) {
      // `hd` (hidden) makes lottie-web skip the layer entirely.
      obj.hd = true;
      if (obj.ks && typeof obj.ks === 'object') {
        (obj.ks as Record<string, unknown>).o = { a: 0, k: 0, ix: 11 };
      }
    }
    for (const key of Object.keys(obj)) hideSolids(obj[key]);
  }
}

function recolor(node: unknown, rgb: [number, number, number]): void {
  if (Array.isArray(node)) {
    for (const n of node) recolor(n, rgb);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (key === 'c' && v && typeof v === 'object' && 'k' in (v as object)) {
        setColor(v as { k: unknown }, rgb);
      } else {
        recolor(v, rgb);
      }
    }
  }
}

interface LottieProps {
  /** Path under /public, e.g. "/lottie/loader.json". */
  src: string;
  /** Optional hex colour to recolor the (monochrome) artwork. */
  color?: string;
  /** Drop opaque background "solid" layers so the artwork overlays cleanly. */
  transparent?: boolean;
  className?: string;
  loop?: boolean;
  speed?: number;
}

export function Lottie({
  src,
  color,
  transparent = false,
  className,
  loop = true,
  speed = 1,
}: LottieProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let anim: AnimationItem | null = null;
    let cancelled = false;

    void loadData(src).then((data) => {
      if (cancelled || !ref.current) return;
      let animationData: LottieJson = data;
      if (color || transparent) {
        // Clone so the cached original stays reusable by other tints.
        animationData = structuredClone(data);
        if (color) recolor(animationData, hexToRgb01(color));
        if (transparent) hideSolids(animationData);
      }
      anim = lottie.loadAnimation({
        container: ref.current,
        renderer: 'svg',
        loop,
        autoplay: true,
        animationData,
      });
      anim.setSpeed(speed);
    });

    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [src, color, transparent, loop, speed]);

  return <div ref={ref} className={className} aria-hidden="true" />;
}
