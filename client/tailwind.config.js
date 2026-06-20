/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Accent ("ember") — backed by CSS variables so a theme can swap the
        // whole accent (e.g. orange → violet) by overriding the channels.
        ember: {
          50: 'rgb(var(--ember-50) / <alpha-value>)',
          100: 'rgb(var(--ember-100) / <alpha-value>)',
          200: 'rgb(var(--ember-200) / <alpha-value>)',
          300: 'rgb(var(--ember-300) / <alpha-value>)',
          400: 'rgb(var(--ember-400) / <alpha-value>)',
          500: 'rgb(var(--ember-500) / <alpha-value>)',
          600: 'rgb(var(--ember-600) / <alpha-value>)',
          700: 'rgb(var(--ember-700) / <alpha-value>)',
          800: 'rgb(var(--ember-800) / <alpha-value>)',
          900: 'rgb(var(--ember-900) / <alpha-value>)',
          950: 'rgb(var(--ember-950) / <alpha-value>)',
        },
        // Warm neutrals — cream / greige / taupe ("sand").
        sand: {
          50: '#faf7f3',
          100: '#f4ede5',
          200: '#e8ddd1',
          300: '#d6c5b4',
          400: '#b8a392',
          500: '#988373',
          600: '#79675a',
          700: '#5f5149',
          800: '#3f3631',
          900: '#272320',
          950: '#181512',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(95, 60, 35, 0.22)',
        card: '0 2px 14px -6px rgba(95, 60, 35, 0.14)',
        glow: '0 8px 24px -8px rgb(var(--ember-500) / 0.45)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
      },
    },
  },
  plugins: [],
};
