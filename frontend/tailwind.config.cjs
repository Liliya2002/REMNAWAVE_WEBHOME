module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Светлая тема — по умолчанию. Тёмная активируется классом 'dark' на <html>.
  // ThemeContext добавляет/убирает этот класс. Админка всегда форсит 'dark'.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#6366F1',
          light: '#A78BFA'
        },
        neon: '#06B6D4',
        background: '#0B1020',
        surface: '#0F1724'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      }
    },
  },
  plugins: [],
}
