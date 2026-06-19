/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Warm accent — peach → coral → terracotta ("ember").
        ember: {
          50: '#fff5ef',
          100: '#ffe7d6',
          200: '#feccac',
          300: '#fbaa78',
          400: '#f6824a',
          500: '#ef6a2e',
          600: '#db5421',
          700: '#b6411d',
          800: '#91361e',
          900: '#76301c',
          950: '#40140a',
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
        glow: '0 8px 24px -8px rgba(239, 106, 46, 0.45)',
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
