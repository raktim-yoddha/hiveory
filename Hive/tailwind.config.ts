import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    // Sibling workspace packages ship React UI with Tailwind classes; scan them
    // too or their utilities (text sizes, spacing) get purged and render huge.
    '../TaskComb/src/**/*.{ts,tsx}',
    '../TaskComb/dist/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        bee: {
          // canvas / backdrop
          canvas: '#14100e',
          canvasHi: '#1c1613',
          // glass surfaces
          surface: '#241f1c',
          surfaceHi: '#2b2420',
          // borders
          border: '#3d2e1f',
          borderHi: '#4a3826',
          // warm accents (muted honey/gold — no neon)
          gold: '#c9a227',
          goldHi: '#d4b84a',
          goldDim: '#9a7206',
          honey: '#e8c547',
          amber: '#b8860b',
          // text
          text: '#f5f0e6',
          textDim: '#c9b896',
          textMuted: '#8a7b5c',
          // muted semantic
          ok: '#8fae7a',
          warn: '#d0a43f',
          err: '#c66b5a',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'Geist Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      backdropBlur: {
        glass: '14px',
        glassHi: '22px',
      },
      boxShadow: {
        // soft, warm, low-opacity depth
        glass: '0 8px 24px -12px rgba(0,0,0,0.55), inset 0 1px 0 0 rgba(245,240,230,0.04)',
        glassHi: '0 18px 48px -16px rgba(0,0,0,0.65), inset 0 1px 0 0 rgba(245,240,230,0.06)',
        glow: '0 0 0 1px rgba(201,162,39,0.18), 0 0 22px -6px rgba(201,162,39,0.28)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.14s ease-out',
        'scale-in': 'scale-in 0.14s ease-out',
      },
    },
  },
  plugins: [],
};
export default config;
