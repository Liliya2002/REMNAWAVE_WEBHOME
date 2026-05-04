/**
 * HTML-снимок дефолтной главной страницы (frontend/src/pages/Landing.jsx).
 * Используется кнопкой "Импорт текущей главной" в админке: создаёт лендинг
 * с этим контентом, после чего админ редактирует тексты прямо в визуальном редакторе.
 *
 * Tailwind-классы применяются — лендинг рендерится внутри SPA, где Tailwind подключён.
 * Inline-стили нужны только там, где Tailwind недостаточно (градиентный текст, и т.п.).
 */

const DEFAULT_HOME_HTML = `<div class="w-full">

  <!-- Hero -->
  <section class="pt-16 sm:pt-24 lg:pt-32 pb-12 sm:pb-20 lg:pb-24 px-4 sm:px-6 lg:px-8">
    <div class="max-w-6xl mx-auto">
      <div class="text-center">
        <div class="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-blue-500/10 border border-blue-500/20 rounded-full mb-6 sm:mb-8">
          <span class="w-2 h-2 bg-blue-400 rounded-full"></span>
          <span class="text-xs sm:text-sm text-blue-700 dark:text-blue-300">Защита мирового уровня</span>
        </div>

        <h1 class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-4 sm:mb-6 leading-tight">
          <span style="background: linear-gradient(to right, #60a5fa, #22d3ee, #2563eb); -webkit-background-clip: text; background-clip: text; color: transparent;">VPN нового поколения</span>
          <br>
          <span class="text-sky-700 dark:text-slate-300">для полной свободы интернета</span>
        </h1>

        <p class="max-w-2xl mx-auto text-base sm:text-lg lg:text-xl text-sky-700 dark:text-slate-400 mb-6 sm:mb-8">
          Высокая скорость, шифрование AES-256, серверы в 150+ странах и поддержка всех устройств.
          Начните всего за <span class="text-blue-600 dark:text-blue-400 font-semibold">10 рублей</span>
        </p>

        <div class="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-10 sm:mb-16">
          <a href="/pricing" class="px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-lg hover:shadow-xl hover:shadow-blue-500/50 transition-all duration-300 inline-block">Попробовать за 10 ₽</a>
          <a href="/pricing" class="px-6 sm:px-8 py-3 sm:py-4 border border-slate-600 text-sky-700 dark:text-slate-300 font-bold rounded-lg hover:border-blue-500 hover:text-blue-300 transition-all duration-300 inline-block">Выбрать тариф</a>
        </div>

        <!-- Metrics -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 py-6 sm:py-12 border-t border-b border-sky-200 dark:border-slate-800/50">
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold" style="background: linear-gradient(to right, #60a5fa, #22d3ee); -webkit-background-clip: text; background-clip: text; color: transparent;">150+</div>
            <div class="text-xs sm:text-sm text-sky-700 dark:text-slate-400">Стран</div>
          </div>
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold" style="background: linear-gradient(to right, #60a5fa, #22d3ee); -webkit-background-clip: text; background-clip: text; color: transparent;">10 Гбит/с</div>
            <div class="text-xs sm:text-sm text-sky-700 dark:text-slate-400">Макс скорость</div>
          </div>
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold" style="background: linear-gradient(to right, #60a5fa, #22d3ee); -webkit-background-clip: text; background-clip: text; color: transparent;">&lt;20мс</div>
            <div class="text-xs sm:text-sm text-sky-700 dark:text-slate-400">Задержка</div>
          </div>
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold" style="background: linear-gradient(to right, #60a5fa, #22d3ee); -webkit-background-clip: text; background-clip: text; color: transparent;">99.9%</div>
            <div class="text-xs sm:text-sm text-sky-700 dark:text-slate-400">Доступность</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8">
    <div class="max-w-6xl mx-auto">
      <div class="text-center mb-10 sm:mb-16">
        <h2 class="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Почему выбирают нас</h2>
        <p class="text-sky-700 dark:text-slate-400">Лучшие технологии для вашей безопасности</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        <div class="p-5 sm:p-6 lg:p-8 bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/50 rounded-xl">
          <div class="text-3xl sm:text-4xl mb-3 sm:mb-4">🔒</div>
          <h3 class="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-sky-900 dark:text-slate-100">Военное шифрование</h3>
          <p class="text-sm sm:text-base text-sky-700 dark:text-slate-400">AES-256 и OpenVPN/WireGuard защищают ваши данные от утечек</p>
        </div>
        <div class="p-5 sm:p-6 lg:p-8 bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/50 rounded-xl">
          <div class="text-3xl sm:text-4xl mb-3 sm:mb-4">⚡</div>
          <h3 class="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-sky-900 dark:text-slate-100">Максимальная скорость</h3>
          <p class="text-sm sm:text-base text-sky-700 dark:text-slate-400">Серверы оптимизированы для работы без снижения пропускной способности</p>
        </div>
        <div class="p-5 sm:p-6 lg:p-8 bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/50 rounded-xl">
          <div class="text-3xl sm:text-4xl mb-3 sm:mb-4">🌍</div>
          <h3 class="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-sky-900 dark:text-slate-100">Глобальные серверы</h3>
          <p class="text-sm sm:text-base text-sky-700 dark:text-slate-400">Подключайтесь через серверы в 150+ странах в один клик</p>
        </div>
        <div class="p-5 sm:p-6 lg:p-8 bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/50 rounded-xl">
          <div class="text-3xl sm:text-4xl mb-3 sm:mb-4">📱</div>
          <h3 class="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-sky-900 dark:text-slate-100">Для всех устройств</h3>
          <p class="text-sm sm:text-base text-sky-700 dark:text-slate-400">iOS, Android, Windows, macOS, Linux и даже роутеры</p>
        </div>
        <div class="p-5 sm:p-6 lg:p-8 bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/50 rounded-xl">
          <div class="text-3xl sm:text-4xl mb-3 sm:mb-4">🚫</div>
          <h3 class="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-sky-900 dark:text-slate-100">No-logs политика</h3>
          <p class="text-sm sm:text-base text-sky-700 dark:text-slate-400">Никаких логов активности. Ваша приватность — приоритет</p>
        </div>
        <div class="p-5 sm:p-6 lg:p-8 bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/50 rounded-xl">
          <div class="text-3xl sm:text-4xl mb-3 sm:mb-4">24/7</div>
          <h3 class="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-sky-900 dark:text-slate-100">Поддержка 24/7</h3>
          <p class="text-sm sm:text-base text-sky-700 dark:text-slate-400">Ответим в Telegram за минуты. Помощь всегда рядом</p>
        </div>
      </div>
    </div>
  </section>

  <!-- How it works -->
  <section class="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8">
    <div class="max-w-6xl mx-auto">
      <div class="text-center mb-10 sm:mb-16">
        <h2 class="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Подключение за 2 минуты</h2>
        <p class="text-sky-700 dark:text-slate-400">Простой и быстрый процесс для новичков</p>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
        <div class="flex flex-col items-center text-center">
          <div class="w-16 h-16 rounded-full flex items-center justify-center mb-4" style="background: linear-gradient(to right, #3b82f6, #06b6d4);">
            <span class="text-2xl font-bold text-white">1</span>
          </div>
          <h3 class="text-lg font-bold mb-2">Выберите тариф</h3>
          <p class="text-sm text-sky-700 dark:text-slate-400">Подберите подходящий план на нужный период</p>
        </div>
        <div class="flex flex-col items-center text-center">
          <div class="w-16 h-16 rounded-full flex items-center justify-center mb-4" style="background: linear-gradient(to right, #3b82f6, #06b6d4);">
            <span class="text-2xl font-bold text-white">2</span>
          </div>
          <h3 class="text-lg font-bold mb-2">Получите доступ</h3>
          <p class="text-sm text-sky-700 dark:text-slate-400">Сразу после оплаты вышлем конфиг и инструкции</p>
        </div>
        <div class="flex flex-col items-center text-center">
          <div class="w-16 h-16 rounded-full flex items-center justify-center mb-4" style="background: linear-gradient(to right, #3b82f6, #06b6d4);">
            <span class="text-2xl font-bold text-white">3</span>
          </div>
          <h3 class="text-lg font-bold mb-2">Установите приложение</h3>
          <p class="text-sm text-sky-700 dark:text-slate-400">Скачайте для вашего устройства за 30 секунд</p>
        </div>
        <div class="flex flex-col items-center text-center">
          <div class="w-16 h-16 rounded-full flex items-center justify-center mb-4" style="background: linear-gradient(to right, #3b82f6, #06b6d4);">
            <span class="text-2xl font-bold text-white">4</span>
          </div>
          <h3 class="text-lg font-bold mb-2">Подключитесь</h3>
          <p class="text-sm text-sky-700 dark:text-slate-400">Один клик — и вы в безопасности</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Comparison -->
  <section class="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8">
    <div class="max-w-4xl mx-auto">
      <div class="text-center mb-10 sm:mb-16">
        <h2 class="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Мы выгоднее конкурентов</h2>
        <p class="text-sky-700 dark:text-slate-400">Лучшие цены на рынке</p>
      </div>

      <div class="space-y-4">
        <div class="flex justify-between items-center p-4 rounded-lg border bg-sky-100/60 dark:bg-slate-800/30 border-sky-200 dark:border-slate-700/30">
          <span class="text-sky-700 dark:text-slate-300">ExpressVPN</span>
          <span class="text-sky-700 dark:text-slate-400">1012 ₽/мес</span>
        </div>
        <div class="flex justify-between items-center p-4 rounded-lg border bg-sky-100/60 dark:bg-slate-800/30 border-sky-200 dark:border-slate-700/30">
          <span class="text-sky-700 dark:text-slate-300">Surfshark</span>
          <span class="text-sky-700 dark:text-slate-400">1078 ₽/мес</span>
        </div>
        <div class="flex justify-between items-center p-4 rounded-lg border bg-sky-100/60 dark:bg-slate-800/30 border-sky-200 dark:border-slate-700/30">
          <span class="text-sky-700 dark:text-slate-300">atlasProxy</span>
          <span class="text-sky-700 dark:text-slate-400">915 ₽/мес</span>
        </div>
        <div class="flex justify-between items-center p-4 rounded-lg border bg-sky-100/60 dark:bg-slate-800/30 border-sky-200 dark:border-slate-700/30">
          <span class="text-sky-700 dark:text-slate-300">Обычный VPN</span>
          <span class="text-sky-700 dark:text-slate-400">890 ₽/мес</span>
        </div>
        <div class="flex justify-between items-center p-4 rounded-lg border bg-blue-500/10 border-blue-500/50">
          <span class="font-bold text-blue-700 dark:text-blue-300">🎯 Наш VPN</span>
          <span class="font-bold text-lg text-blue-700 dark:text-blue-300">190 ₽/мес</span>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8">
    <div class="max-w-3xl mx-auto">
      <div class="text-center mb-10 sm:mb-16">
        <h2 class="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Частые вопросы</h2>
      </div>

      <div class="space-y-4">
        <details class="p-4 bg-sky-100/60 dark:bg-slate-800/30 border border-sky-200 dark:border-slate-700/30 rounded-lg">
          <summary class="font-semibold text-sky-700 dark:text-slate-200 cursor-pointer">Это полноценный VPN?</summary>
          <p class="mt-4 text-sky-700 dark:text-slate-400">Да, мы предоставляем полнофункциональный VPN с шифрованием AES-256 и поддержкой всех устройств</p>
        </details>
        <details class="p-4 bg-sky-100/60 dark:bg-slate-800/30 border border-sky-200 dark:border-slate-700/30 rounded-lg">
          <summary class="font-semibold text-sky-700 dark:text-slate-200 cursor-pointer">Сколько устройств можно подключить?</summary>
          <p class="mt-4 text-sky-700 dark:text-slate-400">Зависит от тарифа. На основных тарифах — неограниченное количество</p>
        </details>
        <details class="p-4 bg-sky-100/60 dark:bg-slate-800/30 border border-sky-200 dark:border-slate-700/30 rounded-lg">
          <summary class="font-semibold text-sky-700 dark:text-slate-200 cursor-pointer">Есть ли логирование?</summary>
          <p class="mt-4 text-sky-700 dark:text-slate-400">Нет. Мы придерживаемся strict no-logs политики и не собираем данные о вашей активности</p>
        </details>
        <details class="p-4 bg-sky-100/60 dark:bg-slate-800/30 border border-sky-200 dark:border-slate-700/30 rounded-lg">
          <summary class="font-semibold text-sky-700 dark:text-slate-200 cursor-pointer">Работает ли в России?</summary>
          <p class="mt-4 text-sky-700 dark:text-slate-400">Да, наши серверы работают в России и более чем в 150 других странах</p>
        </details>
        <details class="p-4 bg-sky-100/60 dark:bg-slate-800/30 border border-sky-200 dark:border-slate-700/30 rounded-lg">
          <summary class="font-semibold text-sky-700 dark:text-slate-200 cursor-pointer">Как получить возврат?</summary>
          <p class="mt-4 text-sky-700 dark:text-slate-400">Если вы не довольны сервисом, возмещаем 100% в течение 7 дней</p>
        </details>
      </div>
    </div>
  </section>

  <!-- Final CTA -->
  <section class="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8" style="background: linear-gradient(to right, #2563eb, #0891b2);">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="text-3xl sm:text-4xl font-bold text-white mb-4 sm:mb-6">Готовы подключиться?</h2>
      <p class="text-base sm:text-lg text-blue-100 mb-6 sm:mb-8">Получите доступ к безопасному интернету всего за пару минут</p>
      <a href="/pricing" class="px-6 sm:px-8 py-3 sm:py-4 bg-white text-blue-600 font-bold rounded-lg hover:shadow-2xl transition-all duration-300 inline-block">Начать за 10 ₽</a>
    </div>
  </section>

</div>`;

const DEFAULT_HOME_META = {
  title: 'Главная',
  meta_title: 'VPN нового поколения — для полной свободы интернета',
  meta_description: 'Высокая скорость, шифрование AES-256, серверы в 150+ странах и поддержка всех устройств. Начните за 10 рублей.',
  meta_keywords: 'vpn, безопасность, конфиденциальность, шифрование',
  schema_type: 'WebPage',
};

module.exports = { DEFAULT_HOME_HTML, DEFAULT_HOME_META };
