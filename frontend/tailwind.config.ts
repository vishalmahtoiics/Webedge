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
    },
  },
  plugins: [],
} satisfies Config;
