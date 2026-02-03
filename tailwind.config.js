/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary:   { DEFAULT: '#5A3FFF', dark: '#A99CFF' },
        secondary: { DEFAULT: '#F5B759', dark: '#FFDCA3' },
        accent:    { DEFAULT: '#FF3366', dark: '#FF5C8A' },
        bg: {
          main:    '#F8F8FB',
          section: '#F1F0F7',
          card:    '#FFFFFF',
          dark:    '#181825',
          sectionDark: '#232336',
          cardDark: '#232336',
        },
        text: {
          primary:   '#232336',
          secondary: '#5A5A6A',
          muted:     '#A3A3B3',
          dark:      '#F8F8FB',
          secondaryDark: '#B3B3C6',
          mutedDark: '#7A7A8C',
        },
        button: {
          primary:   '#5A3FFF',
          hover:     '#4831D4',
          active:    '#3A25A2',
          secondary: '#F5B759',
          disabled:  '#E0E0E6',
          primaryDark:   '#A99CFF',
          hoverDark:     '#7C6AE6',
          activeDark:    '#5A3FFF',
          secondaryDark: '#FFDCA3',
          disabledDark:  '#39394A',
        }
      }
    }
  },
  plugins: [],
}
