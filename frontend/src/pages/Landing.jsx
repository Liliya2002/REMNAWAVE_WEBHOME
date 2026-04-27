import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useSiteConfig } from '../contexts/SiteConfigContext'
import { Lock, Zap, Globe, Smartphone, XCircle, Target } from 'lucide-react'

export default function Landing() {
  const navigate = useNavigate()
  const { config } = useSiteConfig()

  // Динамические тексты из конфига (с фоллбэками)
  const heroTitle = config?.site_title || 'VPN нового поколения'
  const heroSubtitle = config?.site_description || 'для полной свободы интернета'

  return (
    <div className="w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Hero Section */}
      <section className="pt-16 sm:pt-24 lg:pt-32 pb-12 sm:pb-20 lg:pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-full mb-6 sm:mb-8 hover:border-blue-500/40 transition-colors">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
              <span className="text-xs sm:text-sm text-blue-300">Защита мирового уровня</span>
            </div>

            {/* Main Heading */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-4 sm:mb-6 leading-tight">
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-600 bg-clip-text text-transparent">
                {heroTitle}
              </span>
              <br />
              <span className="text-slate-300">{heroSubtitle}</span>
            </h1>

            {/* Subheading */}
            <p className="max-w-2xl mx-auto text-base sm:text-lg lg:text-xl text-slate-400 mb-6 sm:mb-8">
              Высокая скорость, шифрование AES-256, серверы в 150+ странах и поддержка всех устройств.
              Начните всего за <span className="text-blue-400 font-semibold">10 рублей</span>
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-10 sm:mb-16">
              <button
                onClick={() => navigate('/pricing')}
                className="px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-lg hover:shadow-xl hover:shadow-blue-500/50 transition-all duration-300 sm:transform sm:hover:scale-105"
              >
                Попробовать за 10 ₽
              </button>
              <button
                onClick={() => navigate('/pricing')}
                className="px-6 sm:px-8 py-3 sm:py-4 border border-slate-600 text-slate-300 font-bold rounded-lg hover:border-blue-500 hover:text-blue-300 transition-all duration-300"
              >
                Выбрать тариф
              </button>
            </div>

            {/* Metrics Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 py-6 sm:py-12 border-t border-b border-slate-800/50">
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  150+
                </div>
                <div className="text-xs sm:text-sm text-slate-400">Стран</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  10 Гбит/с
                </div>
                <div className="text-xs sm:text-sm text-slate-400">Макс скорость</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  &lt;20мс
                </div>
                <div className="text-xs sm:text-sm text-slate-400">Задержка</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  99.9%
                </div>
                <div className="text-sm text-slate-400">Доступность</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Почему выбирают нас</h2>
            <p className="text-slate-400">Лучшие технологии для вашей безопасности</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {[
              {
                icon: <Lock className="w-9 h-9 text-blue-400" />,
                title: 'Военное шифрование',
                description: 'AES-256 и OpenVPN/WireGuard защищают ваши данные от утечек'
              },
              {
                icon: <Zap className="w-9 h-9 text-yellow-400" />,
                title: 'Максимальная скорость',
                description: 'Серверы оптимизированы для работы без снижения пропускной способности'
              },
              {
                icon: <Globe className="w-9 h-9 text-green-400" />,
                title: 'Глобальные серверы',
                description: 'Подключайтесь через серверы в 150+ странах в один клик'
              },
              {
                icon: <Smartphone className="w-9 h-9 text-purple-400" />,
                title: 'Для всех устройств',
                description: 'iOS, Android, Windows, macOS, Linux и даже роутеры'
              },
              {
                icon: <XCircle className="w-9 h-9 text-red-400" />,
                title: 'No-logs политика',
                description: 'Никаких логов активности. Ваша приватность - приоритет'
              },
              {
                icon: '24/7',
                title: 'Поддержка 24/7',
                description: 'Ответим в Telegram за минуты. Помощь всегда рядом'
              }
            ].map((feature, i) => (
              <div
                key={i}
                className="p-5 sm:p-6 lg:p-8 bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50 rounded-xl hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/10 transition-all duration-300"
              >
                <div className="text-3xl sm:text-4xl mb-3 sm:mb-4">{typeof feature.icon === 'string' ? feature.icon : feature.icon}</div>
                <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-slate-100">{feature.title}</h3>
                <p className="text-sm sm:text-base text-slate-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Подключение за 2 минуты</h2>
            <p className="text-slate-400">Простой и быстрый процесс для новичков</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {[
              {
                num: '1',
                title: 'Выберите тариф',
                desc: 'Подберите подходящий план на нужный период'
              },
              {
                num: '2',
                title: 'Получите доступ',
                desc: 'Сразу после оплаты вышлем конфиг и инструкции'
              },
              {
                num: '3',
                title: 'Установите приложение',
                desc: 'Скачайте для вашего устройства за 30 секунд'
              },
              {
                num: '4',
                title: 'Подключитесь',
                desc: 'Один клик - и вы в безопасности'
              }
            ].map((step, i) => (
              <div key={i} className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center mb-4">
                    <span className="text-2xl font-bold text-white">{step.num}</span>
                  </div>
                  <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                  <p className="text-sm text-slate-400">{step.desc}</p>
                </div>
                {i < 3 && (
                  <div className="hidden md:block absolute top-8 -right-3 w-6 h-0.5 bg-gradient-to-r from-blue-500 to-transparent"></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Мы выгоднее конкурентов</h2>
            <p className="text-slate-400">Лучшие цены на рынке</p>
          </div>

          <div className="space-y-4">
            {[
              { service: 'ExpressVPN', price: '1012 ₽' },
              { service: 'Surfshark', price: '1078 ₽' },
              { service: 'atlasProxy', price: '915 ₽' },
              { service: 'Обычный VPN', price: '890 ₽' },
              { service: <><Target className="w-4 h-4 inline" /> Наш VPN</>, price: '190 ₽', highlight: true }
            ].map((item, i) => (
              <div
                key={i}
                className={`flex justify-between items-center p-4 rounded-lg border transition-all ${
                  item.highlight
                    ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-500/50'
                    : 'bg-slate-800/30 border-slate-700/30'
                }`}
              >
                <span className={item.highlight ? 'font-bold text-blue-300' : 'text-slate-300'}>
                  {item.service}
                </span>
                <span className={item.highlight ? 'font-bold text-lg text-blue-300' : 'text-slate-400'}>
                  {item.price}/мес
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4">Частые вопросы</h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: 'Это полноценный VPN?',
                a: 'Да, мы предоставляем полнофункциональный VPN с шифрованием AES-256 и поддержкой всех устройств'
              },
              {
                q: 'Сколько устройств можно подключить?',
                a: 'Зависит от тарифа. На основных тарифах - неограниченное количество'
              },
              {
                q: 'Есть ли логирование?',
                a: 'Нет. Мы придерживаемся strict no-logs политики и не собираем данные о вашей активности'
              },
              {
                q: 'Работает ли в России?',
                a: 'Да, наши серверы работают в России и более чем в 150 других странах'
              },
              {
                q: 'Как получить возврат?',
                a: 'Если вы не довольны сервисом, возмещаем 100% в течение 7 дней'
              }
            ].map((item, i) => (
              <details
                key={i}
                className="group p-4 bg-slate-800/30 border border-slate-700/30 rounded-lg cursor-pointer hover:border-blue-500/30 transition-colors"
              >
                <summary className="flex justify-between items-center font-semibold text-slate-200">
                  {item.q}
                  <span className="text-2xl group-open:rotate-180 transition-transform">+</span>
                </summary>
                <p className="mt-4 text-slate-400">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 sm:py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-blue-600 to-cyan-600">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 sm:mb-6">Готовы подключиться?</h2>
          <p className="text-base sm:text-lg text-blue-100 mb-6 sm:mb-8">Получите доступ к безопасному интернету всего за пару минут</p>
          <button
            onClick={() => navigate('/pricing')}
            className="px-6 sm:px-8 py-3 sm:py-4 bg-white text-blue-600 font-bold rounded-lg hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-300 sm:transform sm:hover:scale-110"
          >
            Начать за 10 ₽
          </button>
        </div>
      </section>
    </div>
  )
}
