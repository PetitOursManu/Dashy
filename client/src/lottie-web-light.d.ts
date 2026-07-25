// The SVG-only "light" build of lottie-web has no bundled types; it exposes the
// same player surface as the full build (minus expressions/eval), so we reuse
// the main package's LottiePlayer type.
declare module 'lottie-web/build/player/lottie_light' {
  import type { LottiePlayer } from 'lottie-web';
  const lottie: LottiePlayer;
  export default lottie;
}
