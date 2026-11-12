/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        surface: '#161b22',
        surfaceLight: '#21262d',
        borderDark: '#30363d',
        bullish: '#00c087',
        bearish: '#f6465d',
        accent: '#f0b90b', // Binance yellow
      }
    },
  },
  plugins: [],
}
