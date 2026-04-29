import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Apple, Bot, AppWindow, Monitor, Terminal, AlertTriangle, Smartphone, Gift, Link2, Clipboard, ClipboardCheck, Lightbulb, Star, HelpCircle, Tv, ExternalLink, Plus, Download, CloudDownload, Check } from 'lucide-react'

/* ─── helpers ─── */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i]
}

/* ─── platform detection ─── */
function detectPlatform() {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  if (/Mac/i.test(ua)) return 'macos'
  if (/Win/i.test(ua)) return 'windows'
  if (/Linux/i.test(ua)) return 'linux'
  return 'unknown'
}

/* ─── copy hook ─── */
function useCopy() {
  const [copiedKey, setCopiedKey] = useState(null)
  const copy = useCallback((text, key) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }, [])
  return { copiedKey, copy }
}

/* ─── Platform icons ─── */
const platformIcons = {
  ios: <Apple className="w-5 h-5" />,
  android: <Bot className="w-5 h-5" />,
  windows: <AppWindow className="w-5 h-5" />,
  macos: <Monitor className="w-5 h-5" />,
  linux: <Terminal className="w-5 h-5" />,
  appleTV: <Tv className="w-5 h-5" />,
  androidTV: <Tv className="w-5 h-5" />,
}

const platformLabels = {
  ios: 'iOS / iPadOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  appleTV: 'Apple TV',
  androidTV: 'Android TV',
}

/* ─── SVG icon key to lucide icon ─── */
const svgKeyToIcon = {
  DownloadIcon: <Download className="w-5 h-5" />,
  CloudDownload: <CloudDownload className="w-5 h-5" />,
  Check: <Check className="w-5 h-5" />,
  ExternalLink: <ExternalLink className="w-4 h-4" />,
  Plus: <Plus className="w-4 h-4" />,
}

const svgColorMap = {
  cyan: 'text-cyan-600 dark:text-cyan-400',
  violet: 'text-violet-600 dark:text-violet-400',
  teal: 'text-teal-600 dark:text-teal-400',
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
}

/* ─── Main Component ─── */
export default function Connect() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [setupGuide, setSetupGuide] = useState(null)
  const [activePlatform, setActivePlatform] = useState(() => detectPlatform())
  const [activeApp, setActiveApp] = useState(0)
  const { copiedKey, copy } = useCopy()

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const token = localStorage.getItem('token')
        const headers = { 'Authorization': `Bearer ${token}` }
        const apiUrl = import.meta.env.VITE_API_URL || ''

        const [configRes, guideRes] = await Promise.all([
          fetch(`${apiUrl}/api/subscriptions/config`, { headers }),
          fetch(`${apiUrl}/api/subscriptions/setup-guide`, { headers })
        ])

        if (!configRes.ok) {
          const err = await configRes.json().catch(() => ({}))
          throw new Error(err.error || 'Ошибка загрузки конфигурации')
        }
        const json = await configRes.json()
        setData(json)

        if (guideRes.ok) {
          const guideJson = await guideRes.json()
          setSetupGuide(guideJson)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchConfig()
  }, [])

  /* ─── Loading ─── */
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <svg className="animate-spin h-10 w-10 text-blue-500" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-sky-700 dark:text-slate-400 dark:text-slate-400">Загрузка конфигурации…</span>
        </div>
      </div>
    )
  }

  /* ─── Error ─── */
  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-16">
        <div className="p-5 sm:p-8 bg-red-500/10 border border-red-500/50 rounded-2xl text-center">
          <div className="text-5xl mb-4"><AlertTriangle className="w-12 h-12 text-red-600 dark:text-red-400 mx-auto" /></div>
          <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-2">Не удалось загрузить конфиг</h2>
          <p className="text-red-700 dark:text-red-300/80 mb-6">{error}</p>
          <Link to="/dashboard" className="inline-block px-6 py-3 bg-sky-200 dark:bg-slate-800 border border-sky-300 dark:border-slate-700 text-sky-700 dark:text-slate-300 rounded-lg hover:bg-slate-700 transition-all">
            ← Назад в личный кабинет
          </Link>
        </div>
      </div>
    )
  }

  const { subscription: sub, userInfo } = data

  // Traffic calculations
  const trafficUsed = userInfo.download + userInfo.upload
  const trafficTotal = userInfo.total
  const trafficPercent = trafficTotal > 0 ? Math.min(Math.round((trafficUsed / trafficTotal) * 100), 100) : 0

  // Expiry
  const expiresAt = userInfo.expire ? new Date(userInfo.expire * 1000) : sub.expiresAt ? new Date(sub.expiresAt) : null
  const daysLeft = expiresAt ? Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24)) : null

  // QR code URL
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&bgcolor=0F1724&color=60A5FA&data=${encodeURIComponent(sub.subscriptionUrl)}`

  // Setup guide platforms
  const guidePlatforms = setupGuide ? Object.keys(setupGuide.platforms).filter(p => setupGuide.platforms[p]?.apps?.length > 0) : []
  const currentPlatformData = setupGuide?.platforms?.[activePlatform]
  const currentApps = currentPlatformData?.apps || []
  const currentAppData = currentApps[activeApp] || currentApps[0]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 space-y-8">

      {/* ── Back + Title ── */}
      <div>
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-sky-700 dark:text-slate-400 dark:text-slate-400 hover:text-slate-200 transition-colors mb-4">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
          Личный кабинет
        </Link>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-sky-900 dark:text-white flex items-center gap-3">
          <Smartphone className="w-8 h-8 text-blue-600 dark:text-blue-400" /> Подключение VPN
        </h1>
        <p className="text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-2">Настройте VPN-клиент за пару минут</p>
      </div>

      {/* ── Status Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Plan */}
        <div className="p-5 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-2xl">
          <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 mb-1">Тариф</div>
          <div className="text-xl font-bold text-sky-900 dark:text-white">
            {sub.plan === 'FREE_TRIAL' ? <><Gift className="w-5 h-5 inline" /> Тестовый</> : sub.plan}
          </div>
          <div className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-1">
            {sub.isActive
              ? <span className="text-green-600 dark:text-green-400">● Активна</span>
              : <span className="text-red-600 dark:text-red-400">● Неактивна</span>
            }
          </div>
        </div>

        {/* Days left */}
        <div className={`p-5 rounded-2xl border ${
          daysLeft !== null && daysLeft <= 7
            ? 'bg-gradient-to-br from-orange-900/20 to-red-900/20 border-orange-500/30'
            : 'bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border-sky-200 dark:border-slate-700/50'
        }`}>
          <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 mb-1">Осталось дней</div>
          <div className={`text-3xl font-extrabold ${
            daysLeft !== null && daysLeft <= 7 ? 'text-orange-600 dark:text-orange-400' : 'text-sky-900 dark:text-white'
          }`}>
            {daysLeft !== null ? (daysLeft > 0 ? daysLeft : '0') : '—'}
          </div>
          {expiresAt && (
            <div className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-1">
              до {expiresAt.toLocaleDateString('ru-RU')}
            </div>
          )}
        </div>

        {/* Traffic */}
        <div className="p-5 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
          <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 mb-1">Трафик</div>
          <div className="text-lg font-bold text-sky-900 dark:text-white">
            {formatBytes(trafficUsed)} <span className="text-sky-700 dark:text-slate-400 text-sm font-normal">/ {formatBytes(trafficTotal)}</span>
          </div>
          <div className="mt-2 w-full h-2 bg-sky-100 dark:bg-slate-900 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                trafficPercent > 80 ? 'bg-gradient-to-r from-red-500 to-red-400'
                : trafficPercent > 50 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400'
                : 'bg-gradient-to-r from-blue-500 to-cyan-400'
              }`}
              style={{ width: `${trafficPercent}%` }}
            />
          </div>
          <div className="text-xs text-sky-700 dark:text-slate-400 mt-1">{trafficPercent}%</div>
        </div>
      </div>

      {/* ── Subscription URL + QR ── */}
      <div className="p-6 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
        <h2 className="text-xl font-bold text-sky-900 dark:text-white mb-1 flex items-center gap-2"><Link2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> Ссылка подписки</h2>
        <p className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 mb-5">Скопируйте и вставьте в VPN-клиент или отсканируйте QR-код</p>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* URL + button */}
          <div className="flex-1 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 px-4 py-3 bg-slate-900/70 border border-sky-300 dark:border-slate-700 rounded-xl overflow-x-auto">
                <code className="text-sm text-blue-600 dark:text-blue-400 font-mono whitespace-nowrap select-all">{sub.subscriptionUrl}</code>
              </div>
              <button
                onClick={() => copy(sub.subscriptionUrl, 'sub-url')}
                className={`px-5 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
                  copiedKey === 'sub-url'
                    ? 'bg-green-500/20 border border-green-500/50 text-green-600 dark:text-green-400'
                    : 'bg-blue-500/20 border border-blue-500/50 text-blue-600 dark:text-blue-400 hover:bg-blue-500/30'
                }`}
              >
                {copiedKey === 'sub-url' ? <><ClipboardCheck className="w-4 h-4 inline" /> Скопировано</> : <><Clipboard className="w-4 h-4 inline" /> Копировать</>}
              </button>
            </div>

            {/* Quick import hint */}
            <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
              <div className="text-xs text-blue-700 dark:text-blue-300 font-semibold mb-1 flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> Быстрый импорт</div>
              <p className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400">
                Большинство клиентов автоматически импортируют конфигурацию при вставке ссылки подписки. 
                Просто скопируйте ссылку и добавьте её как подписку в вашем VPN-приложении.
              </p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 bg-sky-50 rounded-2xl">
              <img
                src={qrUrl}
                alt="QR код подписки"
                className="w-[180px] h-[180px]"
                loading="lazy"
              />
            </div>
            <span className="text-xs text-sky-700 dark:text-slate-400">Отсканируйте камерой телефона</span>
          </div>
        </div>
      </div>

      {/* ── Platform instructions (from RemnaWave) ── */}
      {setupGuide && guidePlatforms.length > 0 && (
      <div className="p-6 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
        <h2 className="text-xl font-bold text-sky-900 dark:text-white mb-5 flex items-center gap-2"><Smartphone className="w-5 h-5 text-blue-600 dark:text-blue-400" /> Инструкция по настройке</h2>

        {/* Platform tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {guidePlatforms.map(platform => (
            <button
              key={platform}
              onClick={() => { setActivePlatform(platform); setActiveApp(0) }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activePlatform === platform
                  ? 'bg-blue-500/20 border border-blue-500/50 text-blue-600 dark:text-blue-400'
                  : 'bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 text-sky-700 dark:text-slate-400 dark:text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {platformIcons[platform] || <Smartphone className="w-5 h-5" />} {platformLabels[platform] || platform}
            </button>
          ))}
        </div>

        {/* App selector (if multiple apps for platform) */}
        {currentApps.length > 1 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-sky-700 dark:text-slate-300 mb-3">Выберите приложение</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {currentApps.map((app, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveApp(idx)}
                  className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-left hover:scale-[1.02] ${
                    activeApp === idx
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : 'bg-sky-100/60 dark:bg-slate-800/30 border-sky-200 dark:border-slate-700/50 hover:border-slate-600'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    activeApp === idx ? 'bg-blue-500/20' : 'bg-slate-700/50'
                  }`}>
                    {platformIcons[activePlatform] || <Smartphone className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-sky-900 dark:text-white">{app.name}</div>
                    {app.featured && (
                      <div className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1"><Star className="w-3 h-3" /> Рекомендуем</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* App name header (single app) */}
        {currentApps.length === 1 && currentAppData && (
          <div className="flex items-center gap-3 mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              {platformIcons[activePlatform] || <Smartphone className="w-5 h-5" />}
            </div>
            <div>
              <div className="text-sm font-semibold text-sky-900 dark:text-white">{currentAppData.name}</div>
              {currentAppData.featured && (
                <div className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1"><Star className="w-3 h-3" /> Рекомендованное приложение</div>
              )}
            </div>
          </div>
        )}

        {/* Setup steps from RemnaWave blocks */}
        {currentAppData && currentAppData.blocks && (
          <div className="space-y-4">
            {currentAppData.blocks.map((block, i) => {
              const iconColor = svgColorMap[block.svgIconColor] || 'text-blue-600 dark:text-blue-400'
              return (
                <div key={i} className="p-5 bg-sky-50 dark:bg-slate-900/40 border border-sky-200 dark:border-slate-700/30 rounded-xl">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-400 shrink-0`}>
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <h4 className={`text-base font-semibold ${iconColor}`}>
                        {block.title?.ru || block.title?.en || `Шаг ${i + 1}`}
                      </h4>
                      {(block.description?.ru || block.description?.en) && (
                        <p className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-1 leading-relaxed">
                          {block.description?.ru || block.description?.en}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Buttons */}
                  {block.buttons && block.buttons.length > 0 && (
                    <div className="flex flex-wrap gap-2 ml-11">
                      {block.buttons.map((btn, bi) => {
                        // Заменяем {{SUBSCRIPTION_LINK}} на реальную ссылку подписки
                        const link = (btn.link || '').replace('{{SUBSCRIPTION_LINK}}', setupGuide.subscriptionLink || sub.subscriptionUrl)
                        const isExternal = btn.type === 'external'
                        const isSubLink = btn.type === 'subscriptionLink'

                        return (
                          <a
                            key={bi}
                            href={link}
                            target={isExternal ? '_blank' : '_self'}
                            rel={isExternal ? 'noopener noreferrer' : undefined}
                            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                              isSubLink
                                ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-blue-500/30'
                                : 'bg-sky-100 dark:bg-slate-800/50 border border-sky-300 dark:border-slate-700 text-sky-700 dark:text-slate-300 hover:bg-slate-700/50 hover:text-white'
                            }`}
                          >
                            {svgKeyToIcon[btn.svgIconKey] || <ExternalLink className="w-4 h-4" />}
                            {btn.text?.ru || btn.text?.en || 'Открыть'}
                          </a>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* ── Troubleshooting ── */}
      <div className="p-6 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
        <h2 className="text-xl font-bold text-sky-900 dark:text-white mb-4 flex items-center gap-2"><HelpCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" /> Не работает?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-sky-50 dark:bg-slate-900/40 rounded-xl border border-sky-200 dark:border-slate-700/30">
            <div className="text-sm font-semibold text-sky-700 dark:text-slate-300 mb-2">Нет подключения</div>
            <p className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400">Попробуйте переключиться на другой сервер. Обновите подписку в клиенте (pull-to-refresh или кнопка обновления).</p>
          </div>
          <div className="p-4 bg-sky-50 dark:bg-slate-900/40 rounded-xl border border-sky-200 dark:border-slate-700/30">
            <div className="text-sm font-semibold text-sky-700 dark:text-slate-300 mb-2">Низкая скорость</div>
            <p className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400">Выберите ближайший к вам сервер. Попробуйте другой протокол (VLESS / Trojan) если доступен.</p>
          </div>
          <div className="p-4 bg-sky-50 dark:bg-slate-900/40 rounded-xl border border-sky-200 dark:border-slate-700/30">
            <div className="text-sm font-semibold text-sky-700 dark:text-slate-300 mb-2">Конфиги не загружаются</div>
            <p className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400">Убедитесь, что подписка активна и не истекла. Проверьте интернет-соединение без VPN.</p>
          </div>
          <div className="p-4 bg-sky-50 dark:bg-slate-900/40 rounded-xl border border-sky-200 dark:border-slate-700/30">
            <div className="text-sm font-semibold text-sky-700 dark:text-slate-300 mb-2">Нужна помощь?</div>
            <p className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400">Напишите в поддержку через Telegram. Мы поможем с настройкой на любом устройстве.</p>
          </div>
        </div>
      </div>

    </div>
  )
}
