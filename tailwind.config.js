/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/remote/**/*.{html,mjs}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#e8eaed', dim: '#9aa1ac', faint: '#6b727e' },
        surface: { 0: '#0c0d10', 1: '#151619', 2: '#1c1e23', 3: '#26282e' },
        line: '#2a2d34',
        brand: { DEFAULT: '#4f8cff', 600: '#3b78f0', 700: '#2f66d6' },
        good: '#31c48d', bad: '#f45b6c', warn: '#f6c445',
      },
      borderRadius: { xl2: '1.1rem' },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
