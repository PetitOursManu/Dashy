import { useEffect, useRef } from 'react';
import type { AnimationItem } from 'lottie-web';
// Canvas renderer (no eval → stays within the app's strict CSP). Canvas is far
// cheaper than SVG for these animations: one GPU-friendly paint per frame
// instead of a huge live DOM tree that the browser must reflow/repaint.
import lottie from 'lottie-web/build/player/lottie_light_canvas';

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// Colours darker than this read as "background" in our monochrome sources.
const DARK = 0.15;

// Set a solid fill/stroke colour object (`c`) to `rgb`, keeping its alpha. When
// `dropDark` is on, a near-black colour is treated as background: return false
// so the caller can hide the whole fill instead of tinting it accent.
function tintSolid(c: { k: unknown }, rgb: [number, number, number], dropDark: boolean): boolean {
  const k = c.k as unknown;
  if (Array.isArray(k) && typeof k[0] === 'number') {
    if (dropDark && luminance(k[0] as number, k[1] as number, k[2] as number) < DARK) return false;
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
  return true;
}

// Recolour a gradient's stops to a monochrome accent ramp: each stop keeps its
// original luminance (so light→dark depth survives) but takes the accent hue.
function tintGradient(g: unknown, rgb: [number, number, number]): void {
  const grad = g as { p?: number; k?: { k?: unknown } };
  const stops = grad.k?.k;
  if (!grad.p || !Array.isArray(stops) || typeof stops[0] !== 'number') return;
  for (let i = 0; i < grad.p; i++) {
    const b = i * 4; // [offset, r, g, b] per colour stop
    if (b + 3 >= stops.length) break;
    const l = luminance(stops[b + 1] as number, stops[b + 2] as number, stops[b + 3] as number);
    stops[b + 1] = rgb[0] * l;
    stops[b + 2] = rgb[1] * l;
    stops[b + 3] = rgb[2] * l;
  }
}

function hide(obj: Record<string, unknown>): void {
  const o = obj.o as Record<string, unknown> | undefined;
  if (o) o.k = 0;
  else obj.o = { a: 0, k: 0 };
}

/**
 * Recolour a Lottie tree to the accent and, when `dropDark`, strip its opaque
 * dark backdrop (solid layers + near-black fills) so it overlays cleanly. This
 * one pass handles fills, strokes and gradients, luminance-aware.
 */
function process(node: unknown, rgb: [number, number, number], dropDark: boolean): void {
  if (Array.isArray(node)) {
    for (const n of node) process(n, rgb, dropDark);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  if (dropDark && obj.ty === 1) {
    // Full-frame solid layer — `hd` makes lottie-web skip it entirely.
    obj.hd = true;
    if (obj.ks && typeof obj.ks === 'object') {
      (obj.ks as Record<string, unknown>).o = { a: 0, k: 0, ix: 11 };
    }
  } else if ((obj.ty === 'fl' || obj.ty === 'st') && obj.c && typeof obj.c === 'object') {
    const kept = tintSolid(obj.c as { k: unknown }, rgb, dropDark && obj.ty === 'fl');
    if (!kept) hide(obj); // near-black fill → background: make it invisible
  } else if ((obj.ty === 'gf' || obj.ty === 'gs') && obj.g) {
    tintGradient(obj.g, rgb);
  }

  for (const key of Object.keys(obj)) process(obj[key], rgb, dropDark);
}

interface LottieProps {
  /** Path under /public, e.g. "/lottie/loader.json". */
  src: string;
  /** Optional hex colour to recolor the (monochrome) artwork. */
  color?: string;
  /** Drop opaque background "solid" layers so the artwork overlays cleanly. */
  transparent?: boolean;
  /** Cover (fill + crop) the container instead of fitting inside it. */
  cover?: boolean;
  /**
   * Canvas pixel-density cap. Lower = cheaper (fewer pixels to compute + upload
   * to the GPU); 0.5 is plenty for a soft, low-opacity full-screen backdrop.
   * Omit for crisp small animations.
   */
  dpr?: number;
  /**
   * Cap the render rate (frames/second) for decorative animations. lottie
   * otherwise renders at the file's native rate (25–60 fps) *forever*, which
   * pins the main thread and the GPU compositor. 12–15 fps is imperceptible for
   * slow ambient motion and cuts the per-second cost by 2–4×.
   */
  fps?: number;
  /**
   * Ping-pong playback: play forward then reverse, so a clip that isn't authored
   * as a seamless loop never shows a jump at the wrap. Only applies when `fps`
   * is set (self-driven). Leave off for clips that already loop cleanly.
   */
  bounce?: boolean;
  className?: string;
  loop?: boolean;
  speed?: number;
}

export function Lottie({
  src,
  color,
  transparent = false,
  cover = false,
  dpr,
  fps,
  bounce = false,
  className,
  loop = true,
  speed = 1,
}: LottieProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let anim: AnimationItem | null = null;
    let cancelled = false;
    let raf = 0;
    const paused = reduceMotion();
    // When throttling we drive frames ourselves, so lottie must not autoplay.
    const selfDriven = !paused && fps != null;

    void loadData(src).then((data) => {
      if (cancelled || !ref.current) return;
      let animationData: LottieJson = data;
      if (color || transparent) {
        // Clone so the cached original stays reusable by other tints.
        animationData = structuredClone(data);
        // No accent given but still stripping the backdrop → tint to white (a
        // no-op hue for our light artwork) so `process` can run its one pass.
        process(animationData, color ? hexToRgb01(color) : [1, 1, 1], transparent);
      }
      anim = lottie.loadAnimation({
        container: ref.current,
        renderer: 'canvas',
        loop,
        // Honour "reduce motion" (static frame) and self-driven throttling.
        autoplay: !paused && !selfDriven,
        animationData,
        rendererSettings: {
          clearCanvas: true,
          progressiveLoad: false,
          preserveAspectRatio: cover ? 'xMidYMid slice' : 'xMidYMid meet',
          ...(dpr ? { dpr } : {}),
        },
      });
      anim.setSpeed(speed);
      if (paused) {
        anim.goToAndStop(0, true);
      } else if (selfDriven) {
        // Advance the timeline from wall-clock, but only actually render every
        // 1000/fps ms — the rAF wake itself is cheap, the lottie render is not.
        const interval = 1000 / (fps as number);
        const nativeFps = anim.frameRate || 30;
        const total = anim.totalFrames || nativeFps;
        // Ping-pong spans a double timeline (0→total→0) folded into a triangle
        // wave, so non-seamless clips reverse at the ends instead of jumping.
        const period = bounce ? total * 2 : total;
        const t0 = performance.now();
        let last = -Infinity;
        const step = (now: number) => {
          raf = requestAnimationFrame(step);
          if (document.hidden || now - last < interval) return;
          last = now;
          const pos = (((now - t0) / 1000) * nativeFps * speed) % period;
          const frame = bounce && pos > total ? period - pos : pos;
          anim?.goToAndStop(frame, true);
        };
        raf = requestAnimationFrame(step);
      }
    });

    // Stop burning CPU while the tab is in the background (autoplay path only;
    // the self-driven loop already no-ops on document.hidden).
    const onVisibility = () => {
      if (!anim || paused || selfDriven) return;
      if (document.hidden) anim.pause();
      else anim.play();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      anim?.destroy();
    };
  }, [src, color, transparent, cover, dpr, fps, bounce, loop, speed]);

  return <div ref={ref} className={className} aria-hidden="true" />;
}
