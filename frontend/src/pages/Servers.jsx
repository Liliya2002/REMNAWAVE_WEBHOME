import React, { useEffect, useState } from 'react'
import { Globe, Search } from 'lucide-react'

/* ─── helpers ─── */
const flagUrl = (code) => {
  if (!code) return null
  return `https://flagcdn.com/w80/${code.toLowerCase()}.png`
}

function FlagIcon({ code, size = 40 }) {
  const url = flagUrl(code)
  if (!url) return <Globe className="w-6 h-6 text-slate-400" />
  return (
    <img
      src={url}
      alt={code}
      width={size}
      height={Math.round(size * 0.75)}
      className="rounded-sm object-cover"
      onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'block') }}
    />
  )
}

const countryName = (code) => {
  const map = {
    RU: 'Россия', US: 'США', DE: 'Германия', NL: 'Нидерланды',
    FI: 'Финляндия', FR: 'Франция', GB: 'Великобритания', JP: 'Япония',
    SG: 'Сингапур', KR: 'Южная Корея', CA: 'Канада', AU: 'Австралия',
    TR: 'Турция', AE: 'ОАЭ', IN: 'Индия', BR: 'Бразилия',
    PL: 'Польша', SE: 'Швеция', CH: 'Швейцария', HK: 'Гонконг',
    UA: 'Украина', KZ: 'Казахстан', LT: 'Литва', LV: 'Латвия',
    EE: 'Эстония', CZ: 'Чехия', AT: 'Австрия', IT: 'Италия',
    ES: 'Испания', MD: 'Молдова', RO: 'Румыния', BG: 'Болгария'
  }
  return map[code?.toUpperCase()] || code || 'Неизвестно'
}

const cleanServerName = (name) => {
  if (!name) return name
  return name.replace(/^((?:[\u{1F1E6}-\u{1F1FF}]{2})\s*)+/u, '').trim()
}

/* ─── карточка сервера ─── */
function ServerCard({ server }) {
  const rawName = server.name || server.city || `Server ${server.id}`
  const name = cleanServerName(rawName)
  const country = server.country_code || server.countryCode
  const isOnline = server.is_connected !== false
  const protocols = server.protocols?.length
    ? server.protocols
    : ['VLESS', 'Trojan']

  return (
    <div className={`
      group relative overflow-hidden
      p-5 rounded-2xl border transition-all duration-300
      ${isOnline
        ? 'bg-gradient-to-br from-slate-800/60 to-slate-900/80 border-slate-700/50 hover:border-cyan-500/40 hover:shadow-lg hover:shadow-cyan-500/5'
        : 'bg-gradient-to-br from-slate-900/60 to-slate-950/80 border-slate-800/40 opacity-60'
      }
    `}>
      {/* Фоновый свет при ховере */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-cyan-500/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative flex items-center gap-4">
        {/* Флаг */}
        <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center overflow-hidden shadow-inner">
          <FlagIcon code={country} size={40} />
          <Globe className="w-6 h-6 text-slate-400 hidden" />
        </div>

        {/* Инфо */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="text-lg font-bold text-white truncate">{name}</h3>
            <span className="relative flex-shrink-0">
              <span className={`block w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-500'}`} />
              {isOnline && (
                <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-40" />
              )}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">{countryName(country)}</p>
        </div>

        {/* Статус бейдж */}
        <div className={`
          flex-shrink-0 px-3 py-1 rounded-lg text-xs font-semibold
          ${isOnline
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }
        `}>
          {isOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Протоколы */}
      <div className="relative mt-4 pt-3 border-t border-slate-700/30">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Протокол</span>
          <div className="flex gap-1.5">
            {protocols.map((p, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/15"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── страница ─── */
export default function Servers() {
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchServers() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/servers`)
        if (res.ok) {
          const data = await res.json()
          setServers(data.servers || [])
        }
      } catch (err) {
        console.error('Error fetching servers:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchServers()
  }, [])

  const onlineCount = servers.length

  if (loading) {
    return (
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 bg-slate-800 rounded-lg" />
          <div className="h-5 w-96 bg-slate-800/60 rounded" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-36 bg-slate-800/40 rounded-2xl border border-slate-700/30" />
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Заголовок */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
          Серверы
        </h2>
        <p className="mt-2 text-slate-400">Выберите сервер для подключения к VPN</p>
      </div>

      {/* Счётчики */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-400 font-bold text-lg">{onlineCount}</span>
            <span className="text-slate-400 text-sm">онлайн</span>
          </div>
        </div>
      </div>

      {/* Список серверов */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {servers.length > 0 ? (
          servers.map(s => <ServerCard key={s.id || s.uuid} server={s} />)
        ) : (
          <div className="col-span-full p-8 text-center bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/40 rounded-2xl">
            <Search className="w-10 h-10 text-slate-500 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">
              Серверы недоступны. Проверьте конфигурацию API.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
