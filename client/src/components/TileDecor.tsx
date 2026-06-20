export type DecorVariant = 'rings' | 'dots' | 'waves' | 'blob' | 'sphere';

/**
 * Subtle, theme-aware decorative motif for a dashboard tile. Render it as a
 * child of a `relative overflow-hidden` container, behind the content. Colors
 * use the accent (ember) variables, so they follow the active theme.
 */
export function TileDecor({ variant = 'rings' }: { variant?: DecorVariant }) {
  const base = 'pointer-events-none absolute select-none';

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
