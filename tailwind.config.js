/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/remote/**/*.{html,mjs}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // greyscale only — the one bright is white, used for the active state
        ink: { DEFAULT: '#ededed', dim: '#8c8c8c', faint: '#565658' },
        surface: { 0: '#0a0a0b', 1: '#101012', 2: '#17171a', 3: '#202024' },
        line: '#2a2a2e',
        accent: '#ffffff',
      },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
