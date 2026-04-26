/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      colors: {
        av: {
          green:  '#00c896',
          amber:  '#f0b429',
          blue:   '#4da6ff',
          dark:   '#0d1220',
          darker: '#080d18',
        },
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
}
