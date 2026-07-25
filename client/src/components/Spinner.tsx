import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Lottie } from './Lottie';

/** Tiny inline SVG spinner — used inside buttons where a full Lottie is overkill. */
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-current ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

/** Reads the active theme's accent (--ember-500) as a #hex, refreshed on theme change. */
function readAccentHex(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ember-500').trim();
  const p = v.split(/\s+/).map(Number);
  if (p.length === 3 && p.every((n) => !Number.isNaN(n))) {
    return '#' + p.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  }
  return '#ef6a2e';
}

/**
 * The app-wide loading indicator: the animated Lottie "hypercube", tinted with
 * the active theme's accent so it works on every background (orange, violet,
 * cyan on black, …). Use this for page- and section-level loading states.
 */
export function Loader({ className = 'h-16 w-16' }: { className?: string }) {
  const { theme } = useTheme();
  // The anti-flash script in index.html sets the theme class before paint, so
  // the accent var is already correct on first render for the persisted theme.
  const [color, setColor] = useState<string>(readAccentHex);

  useEffect(() => {
    setColor(readAccentHex());
  }, [theme]);

  return <Lottie src="/lottie/loader.json" color={color} className={className} />;
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader className="h-24 w-24" />
    </div>
  );
}
