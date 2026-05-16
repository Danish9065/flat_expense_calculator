/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#FF5656',
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B',
        background: '#050505',
        card: '#0D0D0D',
        muted: '#171717',
        'muted-foreground': '#A3A3A3',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
