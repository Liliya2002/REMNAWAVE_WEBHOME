import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CloudCog, Cpu, Database, HardDrive, MapPin, RefreshCw, Server, ShieldCheck } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export default function AdminHostingOrder() {
  const [offers, setOffers] = useState([])
  const [lastSync, setLastSync] = useState(null)
  const [sourceConfigured, setSourceConfigured] = useState(false)
  const [sourceUrl, setSourceUrl] = useState(null)
  const [health, setHealth] = useState(null)
  const [autoSync, setAutoSync] = useState({ enabled: false, everyMinutes: 0 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)

  const headers = useMemo(() => {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  useEffect(() => {
    loadCatalog()
    loadHealth()

    const healthTimer = setInterval(loadHealth, 15000)
    const catalogTimer = setInterval(loadCatalog, 30000)

    return () => {
      clearInterval(healthTimer)
      clearInterval(catalogTimer)
    }
  }, [])

  async function loadCatalog() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/admin/hosting/catalog`, { headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки каталога')
      setOffers(data.offers || [])
      setLastSync(data.lastSync || null)
      setSourceConfigured(!!data.sourceConfigured)
      setSourceUrl(data.sourceUrl || null)
      setAutoSync(data.autoSync || { enabled: false, everyMinutes: 0 })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadHealth() {
    try {
      const res = await fetch(`${API}/api/admin/hosting/health`, { headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка проверки источника')
      setHealth(data)
    } catch (_) {
      setHealth({ reachable: false, message: 'Не удалось получить статус health' })
    }
  }

  async function syncCatalog() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/admin/hosting/sync`, { method: 'POST', headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка синхронизации')
      setOffers(data.offers || [])
      await loadCatalog()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.08),transparent_38%),rgba(2,6,23,0.75)] p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-100 flex items-center gap-2">
              <CloudCog className="w-6 h-6 text-cyan-300" />
              <span>Заказать Хостинг</span>
            </h3>
            <p className="text-sm text-slate-400 mt-2 max-w-3xl">
              Раздел подготовлен для интеграции с отдельным сервером-каталогом хостинга. Здесь будут доступны тарифы VPS,
              статусы поставщиков и в будущем оформление заказов.
            </p>
          </div>
          <button
            onClick={syncCatalog}
            disabled={!sourceConfigured || syncing}
            className="px-5 py-2.5 rounded-xl font-bold inline-flex items-center gap-2 bg-gradient-to-r from-cyan-400 to-slate-200 text-slate-900 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Синхронизация...' : 'Принудительно синхронизировать'}</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/60 p-3">
            <div className="text-slate-500 mb-1">Источник данных</div>
            <div className="text-slate-200 font-medium break-all">{sourceConfigured ? (sourceUrl || 'Настроен') : 'Не настроен'}</div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/60 p-3">
            <div className="text-slate-500 mb-1">Последняя синхронизация</div>
            <div className="text-slate-200 font-medium">{lastSync?.created_at ? new Date(lastSync.created_at).toLocaleString('ru-RU') : 'Нет данных'}</div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/60 p-3">
            <div className="text-slate-500 mb-1">Записей в каталоге</div>
            <div className="text-slate-200 font-medium">{offers.length}</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/60 p-3 text-sm">
          <div className="text-slate-500 mb-2">Авто-проверка и авто-синхронизация</div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`px-2 py-1 rounded-md border ${health?.reachable ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
              Источник: {health?.reachable ? 'доступен' : 'недоступен'}
            </span>
            <span className={`px-2 py-1 rounded-md border ${health?.checks?.urlConfigured ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-300'}`}>
              URL: {health?.checks?.urlConfigured ? 'ok' : 'missing'}
            </span>
            <span className={`px-2 py-1 rounded-md border ${health?.checks?.tokenConfigured ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
              TOKEN: {health?.checks?.tokenConfigured ? 'ok' : 'optional/missing'}
            </span>
            <span className={`px-2 py-1 rounded-md border ${health?.checks?.urlProtocolValid ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-300'}`}>
              URL schema: {health?.checks?.urlProtocolValid ? 'ok' : 'invalid'}
            </span>
            <span className={`px-2 py-1 rounded-md border ${autoSync?.enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-600 bg-slate-800/50 text-slate-300'}`}>
              Auto-sync: {autoSync?.enabled ? `каждые ${autoSync?.everyMinutes || 0} мин` : 'off'}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-2">{health?.message || 'Проверка статуса выполняется автоматически'}</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 p-5">
        <h4 className="text-lg font-bold text-slate-100 mb-4">Каталог VPS с главного сервера</h4>

        {loading ? (
          <div className="text-slate-400 text-sm">Загрузка каталога...</div>
        ) : offers.length === 0 ? (
          <div className="text-slate-500 text-sm">Каталог пока пуст. После настройки источника он заполнится автоматически.</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {offers.map(offer => (
              <div key={offer.id || offer.offer_key} className="rounded-xl border border-slate-700/60 bg-slate-900/45 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-slate-100 font-semibold">{offer.title}</div>
                    <div className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{offer.location || 'Локация не указана'}</span>
                    </div>
                  </div>
                  <div className="text-cyan-300 font-bold">{offer.price_monthly} {offer.currency}/мес</div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-700/50 px-2 py-1.5 text-slate-300 inline-flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-cyan-300" /> {offer.cpu || 0} vCPU
                  </div>
                  <div className="rounded-lg border border-slate-700/50 px-2 py-1.5 text-slate-300 inline-flex items-center gap-1">
                    <Database className="w-3.5 h-3.5 text-cyan-300" /> {offer.ram_gb || 0} GB RAM
                  </div>
                  <div className="rounded-lg border border-slate-700/50 px-2 py-1.5 text-slate-300 inline-flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5 text-cyan-300" /> {offer.disk_gb || 0} GB SSD
                  </div>
                  <div className="rounded-lg border border-slate-700/50 px-2 py-1.5 text-slate-300 inline-flex items-center gap-1">
                    <Server className="w-3.5 h-3.5 text-cyan-300" /> {offer.provider || 'Provider'}
                  </div>
                </div>

                <div className="mt-3 text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{offer.stock_status || 'unknown'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 p-5">
        <h4 className="text-lg font-bold text-slate-100 mb-3 inline-flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-cyan-300" />
          <span>Подготовка к будущему проекту на отдельном сервере</span>
        </h4>
        <div className="text-sm text-slate-300 space-y-2">
          <p>1. Внешний сервис должен отдавать каталог по HTTPS API с токеном.</p>
          <p>2. Текущий проект кэширует офферы в локальной БД и не зависит от доступности источника в момент просмотра.</p>
          <p>3. Для будущего шага можно добавить endpoint заказа: создание заявки, провижининг и выдача данных VPS в Управление VPS.</p>
          <p>4. Рекомендуемый контракт источника: id/title/cpu/ram_gb/disk_gb/location/price_monthly/currency/stock_status/provider.</p>
        </div>
      </div>
    </div>
  )
}
