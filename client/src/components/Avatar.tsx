interface AvatarProps {
  email: string;
  className?: string;
}

/** Deterministic initials avatar with a warm gradient derived from the email. */
export function Avatar({ email, className = 'h-9 w-9 text-sm' }: AvatarProps) {
  const initials = email.slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  const hue = 18 + (hash % 28); // keep it in the warm orange band
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
