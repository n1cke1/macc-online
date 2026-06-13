import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0f172a',
        muted: '#64748b',
        line: '#e2e8f0',
        accent: '#0ea5e9',
      },
    },
  },
  plugins: [],
};

export default config;
