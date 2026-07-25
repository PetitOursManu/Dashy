import { useTheme } from '../context/ThemeContext';
import { Lottie } from './Lottie';

/**
 * Full-screen animated backdrop for the "noir" theme: the LineWaves Lottie,
 * tinted a dim cyan and pinned behind the whole app at low opacity so it reads
 * as ambient motion rather than decoration. Renders nothing in other themes.
 */
export function NoirBackground() {
  const { theme } = useTheme();
  if (theme !== 'noir') return null;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Lottie
        src="/lottie/bg-waves.json"
        color="#22d3ee"
        transparent
        cover
        dpr={1}
        speed={0.6}
        className="h-full w-full opacity-[0.18]"
      />
    </div>
  );
}
