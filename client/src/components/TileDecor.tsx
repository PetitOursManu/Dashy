import { useTheme } from '../context/ThemeContext';
import { Lottie } from './Lottie';

export type DecorVariant =
  | 'rings'
  | 'dots'
  | 'waves'
  | 'blob'
  | 'sphere'
  | 'storage'
  | 'bell';

/**
 * Subtle, theme-aware decorative motif for a dashboard tile. Render it as a
 * child of a `relative overflow-hidden` container, behind the content. Colors
 * use the accent (ember) variables, so they follow the active theme.
 */
/**
 * In the "noir" theme each tile variant maps to a distinct animated Lottie,
 * tinted cyan, so the dashboard feels alive and varied on black. `transparent`
 * strips a clip's opaque dark backdrop; `cover` lets wide clips bleed across
 * the tile. All are fps-capped for performance.
 */
const NOIR_DECOR: Record<
  DecorVariant,
  { src: string; transparent?: boolean; cover?: boolean; fps: number; className: string }
> = {
  rings: { src: '/lottie/circular-dots.json', transparent: true, fps: 20, className: '-right-6 -top-6 h-32 w-32' },
  dots: { src: '/lottie/grid.json', transparent: true, cover: true, fps: 20, className: 'inset-x-0 -bottom-3 h-24 w-full' },
  waves: { src: '/lottie/wavy.json', cover: true, fps: 15, className: 'inset-x-0 -bottom-3 h-20 w-full' },
  blob: { src: '/lottie/orbit.json', fps: 20, className: '-bottom-10 -right-10 h-44 w-44' },
  sphere: { src: '/lottie/orbit.json', fps: 20, className: '-bottom-10 -right-10 h-44 w-44' },
  storage: { src: '/lottie/grid.json', transparent: true, cover: true, fps: 20, className: 'inset-x-0 -bottom-3 h-24 w-full' },
  bell: { src: '/lottie/dots.json', fps: 20, className: '-right-2 -top-2 h-24 w-24' },
};

export function TileDecor({ variant = 'rings' }: { variant?: DecorVariant }) {
  const { theme } = useTheme();
  const base = 'pointer-events-none absolute select-none';

  if (theme === 'noir') {
    const d = NOIR_DECOR[variant] ?? NOIR_DECOR.rings;
    return (
      <Lottie
        src={d.src}
        color="#22d3ee"
        transparent={d.transparent}
        cover={d.cover}
        fps={d.fps}
        className={`${base} opacity-40 ${d.className}`}
      />
    );
  }

  if (variant === 'sphere') {
    return (
      <span
        aria-hidden="true"
        className={`${base} -right-12 -top-16 h-48 w-48 rounded-full`}
        style={{
          background:
            'radial-gradient(circle at 32% 32%, rgba(255,255,255,0.14), transparent 55%), radial-gradient(circle, rgb(var(--ember-500) / 0.22), transparent 70%)',
        }}
      />
    );
  }

  if (variant === 'storage') {
    // Stacked-disks cylinder (the classic "storage" symbol), in the corner.
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 80 84"
        className={`${base} -bottom-5 -right-4 h-36 w-36 text-ember-500/20`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <ellipse cx="40" cy="18" rx="26" ry="9" />
        <path d="M14 18 V 62" />
        <path d="M66 18 V 62" />
        <path d="M14 62 A 26 9 0 0 0 66 62" />
        <path d="M14 35 A 26 9 0 0 0 66 35" opacity="0.7" />
        <path d="M14 48 A 26 9 0 0 0 66 48" opacity="0.7" />
      </svg>
    );
  }

  if (variant === 'bell') {
    // A bell with a little notification bubble, in the corner.
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 80 84"
        className={`${base} -bottom-4 -right-3 h-36 w-36 text-ember-500/20`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M58 46c0-23-9-29-18-29s-18 6-18 29c0 8-5 11-5 11h46s-5-3-5-11" />
        <path d="M34 68a6 6 0 0 0 12 0" />
        <circle cx="60" cy="20" r="11" fill="currentColor" stroke="none" opacity="0.5" />
      </svg>
    );
  }

  if (variant === 'blob') {
    return (
      <span
        aria-hidden="true"
        className={`${base} -bottom-12 -right-10 h-36 w-36 rounded-full bg-ember-400/15 blur-2xl`}
      />
    );
  }

  if (variant === 'dots') {
    const dots = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        dots.push(<circle key={`${r}-${c}`} cx={10 + c * 22} cy={10 + r * 22} r="2.4" />);
      }
    }
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 120 120"
        className={`${base} -right-2 -top-2 h-24 w-24 text-ember-500/20`}
        fill="currentColor"
      >
        {dots}
      </svg>
    );
  }

  if (variant === 'waves') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 220 90"
        className={`${base} -bottom-3 right-0 h-20 w-44 text-ember-500/15`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M0 45 Q 27 22 55 45 T 110 45 T 165 45 T 220 45" />
        <path d="M0 62 Q 27 39 55 62 T 110 62 T 165 62 T 220 62" opacity="0.6" />
      </svg>
    );
  }

  // rings
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 160 160"
      className={`${base} -right-7 -top-9 h-40 w-40 text-ember-500/15`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle cx="118" cy="50" r="20" />
      <circle cx="118" cy="50" r="38" />
      <circle cx="118" cy="50" r="56" />
    </svg>
  );
}
