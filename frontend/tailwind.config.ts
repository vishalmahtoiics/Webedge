import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        harbor: '#0F1A2A',
        edge: '#3FC1C9',
        primary: { DEFAULT: '#0A7285', hover: '#085E6E', soft: '#E7F3F5' },
        canvas: '#F5F7FA',
        ink: { DEFAULT: '#142033', muted: '#566175', subtle: '#656F82' },
        line: { DEFAULT: '#E4E8EE', strong: '#CDD4DE', input: '#7E8A9C' },
        state: { success: '#177444', warning: '#A15C07', danger: '#B42318', info: '#2D5BD3' },
      },
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'] },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.99)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        // Short. Motion here is feedback that something arrived, not
        // decoration — anything long enough to notice is long enough to wait
        // for, on a page someone opens forty times a day.
        'rise-in': 'rise-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 140ms ease-out both',
        'sheet-in': 'sheet-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
