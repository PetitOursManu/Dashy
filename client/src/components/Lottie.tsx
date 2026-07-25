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
        if (color) recolor(animationData, hexToRgb01(color));
        if (transparent) hideSolids(animationData);
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
        const t0 = performance.now();
        let last = -Infinity;
        const step = (now: number) => {
          raf = requestAnimationFrame(step);
          if (document.hidden || now - last < interval) return;
          last = now;
          const frame = (((now - t0) / 1000) * nativeFps * speed) % total;
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
  }, [src, color, transparent, cover, dpr, fps, loop, speed]);

  return <div ref={ref} className={className} aria-hidden="true" />;
}
