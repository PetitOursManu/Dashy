import { useEffect, useState } from 'react';

interface AvatarProps {
  email: string;
  /** Avatar image URL; falls back to initials if absent or it fails to load. */
  src?: string | null;
  className?: string;
}

/** Deterministic initials avatar, or an uploaded image when available. */
export function Avatar({ email, src, className = 'h-9 w-9 text-sm' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const initials = email.slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  const hue = 18 + (hash % 28); // warm orange band

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue},85%,62%), hsl(${hue - 12},80%,48%))`,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
