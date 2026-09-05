/** @type {import('tailwindcss').Config} */
// The phone remote is styled as a DOS text-mode program: a 16-colour palette,
// one monospaced face, square corners and double-line boxes. The component
// classes in remote.mjs stay generic (surface, ink, line, accent); the look
// lives here and in tw.input.css.
module.exports = {
  content: ['./src/remote/**/*.{html,mjs}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#ffffff', dim: '#aaaaaa', faint: '#5555ff' },
        surface: { 0: '#0000aa', 1: '#0000aa', 2: '#000055', 3: '#aaaaaa' },
        line: '#aaaaaa',
        accent: '#ffff55',
        cyan: '#55ffff',
        warn: '#ff5555',
      },
      fontFamily: { sans: ['"VT323"', '"Perfect DOS VGA 437"', 'ui-monospace', 'Menlo', 'monospace'] },
    },
    borderRadius: {
      none: '0', sm: '0', DEFAULT: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0', full: '9999px',
    },
    boxShadow: { none: 'none', DEFAULT: '6px 6px 0 #000000', sm: '4px 4px 0 #000000', md: '6px 6px 0 #000000', lg: '6px 6px 0 #000000', xl: '8px 8px 0 #000000', '2xl': '8px 8px 0 #000000', inner: 'none' },
  },
  plugins: [],
};
