import React, { useEffect, useMemo, useState } from 'react'
import { Activity, TrendingUp, AlertTriangle } from 'lucide-react'
import { authFetch } from '../services/api'

const PERIOD_OPTIONS = [
  { id: 7, label: '7 дней' },
  { id: 30, label: '30 дней' },
  { id: 90, label: '90 дней' },
]

function fmtBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`
}

function fmtDateShort(s) {
  const d = new Date(s)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export default function TrafficChart() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await authFetch(`/api/subscriptions/traffic-history?days=${days}`)
        if (res.ok) {
          const d = await res.json()
          if (!cancelled) setData(d)
        } else if (!cancelled) {
          setError('Не удалось загрузить историю')
        }
      } catch (e) {
        if (!cancelled && e.message !== 'Unauthorized' && e.message !== 'No token') {
          setError('Ошибка сети')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [days])

  // Готовим точки для графика: дельты потребления по дням.
  // Snapshot хранит cumulative used_bytes; за день показываем разницу.
  const buckets = useMemo(() => {
    if (!data?.points?.length) return []
    const pts = data.points
    const out = []
    let prevUsed = pts[0].usedBytes
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      // delta может быть отрицательной (если limit ресетнули) — показываем 0
      const delta = i === 0 ? p.usedBytes : Math.max(0, p.usedBytes - prevUsed)
      prevUsed = p.usedBytes
      out.push({ date: p.date, delta, total: p.usedBytes, limit: p.limitBytes })
    }
    return out
  }, [data])

  const maxDelta = useMemo(() => {
    if (!buckets.length) return 0
    return Math.max(...buckets.map(b => b.delta), 1)
  }, [buckets])

  const lastPoint = buckets[buckets.length - 1]
  const firstPoint = buckets[0]
  const totalInPeriod = useMemo(() => {
    return buckets.reduce((s, b) => s + b.delta, 0)
  }, [buckets])

  const limitBytes = data?.subscription
    ? (data.subscription.trafficLimitGb || 0) * 1024 * 1024 * 1024
    : 0
  const currentUsedBytes = lastPoint?.total ?? (data?.subscription
    ? Number(data.subscription.trafficUsedGb || 0) * 1024 * 1024 * 1024
    : 0)
  const usedPercent = limitBytes > 0
    ? Math.min(100, Math.round((currentUsedBytes / limitBytes) * 100))
    : 0
  const projectedExhaustionDays = useMemo(() => {
    if (!buckets.length || limitBytes <= 0) return null
    const avgDaily = totalInPeriod / Math.max(1, buckets.length)
    const remaining = limitBytes - currentUsedBytes
    if (avgDaily <= 0 || remaining <= 0) return null
    return Math.ceil(remaining / avgDaily)
  }, [buckets, totalInPeriod, limitBytes, currentUsedBytes])

  return (
    <div className="p-4 sm:p-6 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-900/60 dark:to-slate-950/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Activity className="w-5 h-5 text-sky-900 dark:text-white" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-sky-900 dark:text-white">Потребление трафика</h3>
            <p className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400">
              {data?.subscription?.planName ? `Тариф: ${data.subscription.planName}` : 'Снимки обновляются раз в сутки'}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p.id}
              onClick={() => setDays(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                days === p.id
                  ? 'bg-violet-500/20 border-violet-500/50 text-violet-700 dark:text-violet-300'
                  : 'bg-sky-100/60 dark:bg-slate-800/40 border-sky-200 dark:border-slate-700/50 text-sky-700 dark:text-slate-400 dark:text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="p-3 bg-sky-100/60 dark:bg-slate-800/40 border border-slate-700/40 rounded-lg">
          <div className="text-[11px] text-sky-700 dark:text-slate-400 uppercase font-medium">Использовано</div>
          <div className="text-base sm:text-lg font-bold text-sky-900 dark:text-slate-100 mt-0.5">{fmtBytes(currentUsedBytes)}</div>
        </div>
        <div className="p-3 bg-sky-100/60 dark:bg-slate-800/40 border border-slate-700/40 rounded-lg">
          <div className="text-[11px] text-sky-700 dark:text-slate-400 uppercase font-medium">Лимит</div>
          <div className="text-base sm:text-lg font-bold text-sky-900 dark:text-slate-100 mt-0.5">{limitBytes > 0 ? fmtBytes(limitBytes) : '∞'}</div>
        </div>
        <div className="p-3 bg-sky-100/60 dark:bg-slate-800/40 border border-slate-700/40 rounded-lg">
          <div className="text-[11px] text-sky-700 dark:text-slate-400 uppercase font-medium">За период</div>
          <div className="text-base sm:text-lg font-bold text-sky-900 dark:text-slate-100 mt-0.5">{fmtBytes(totalInPeriod)}</div>
        </div>
        <div className="p-3 bg-sky-100/60 dark:bg-slate-800/40 border border-slate-700/40 rounded-lg">
          <div className="text-[11px] text-sky-700 dark:text-slate-400 uppercase font-medium flex items-center gap-1"><TrendingUp className="w-3 h-3" /> В среднем/день</div>
          <div className="text-base sm:text-lg font-bold text-sky-900 dark:text-slate-100 mt-0.5">
            {buckets.length ? fmtBytes(totalInPeriod / buckets.length) : '—'}
          </div>
        </div>
      </div>

      {/* Limit bar */}
      {limitBytes > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5 text-xs">
            <span className="text-sky-700 dark:text-slate-400 dark:text-slate-400">{usedPercent}% от лимита</span>
            {projectedExhaustionDays != null && (
              <span className="text-sky-700 dark:text-slate-400">
                При текущем темпе хватит на ~{projectedExhaustionDays} дн.
              </span>
            )}
          </div>
          <div className="w-full h-2.5 bg-sky-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                usedPercent > 80 ? 'bg-gradient-to-r from-red-500 to-orange-500'
                : usedPercent > 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-500'
                : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
              }`}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="relative">
        {loading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-slate-600 border-t-violet-400 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="h-48 flex flex-col items-center justify-center text-sky-700 dark:text-slate-400 gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500/60" />
            <p className="text-sm">{error}</p>
          </div>
        ) : !buckets.length ? (
          <div className="h-48 flex flex-col items-center justify-center text-sky-700 dark:text-slate-400 gap-2">
            <Activity className="w-8 h-8 opacity-30" />
            <p className="text-sm">Снимков ещё нет</p>
            <p className="text-xs">Первые данные появятся в ближайшие 24 часа</p>
          </div>
        ) : (
          <>
            <div className="h-48 flex items-end gap-1 px-1">
              {buckets.map((b, i) => {
                const heightPct = (b.delta / maxDelta) * 100
                return (
                  <div
                    key={b.date}
                    className="group relative flex-1 flex flex-col justify-end min-w-0"
                    title={`${fmtDateShort(b.date)}: ${fmtBytes(b.delta)}`}
                  >
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-violet-500/80 to-fuchsia-400/80 hover:from-violet-400 hover:to-fuchsia-300 transition-all"
                      style={{ height: `${Math.max(heightPct, b.delta > 0 ? 2 : 0)}%` }}
                    />
                    <div className="hidden group-hover:block absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-sky-100 dark:bg-slate-900 border border-sky-300 dark:border-slate-700 rounded text-[11px] whitespace-nowrap z-10">
                      <div className="text-sky-700 dark:text-slate-200 font-medium">{fmtBytes(b.delta)}</div>
                      <div className="text-sky-700 dark:text-slate-400">{fmtDateShort(b.date)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-sky-700 dark:text-slate-400">
              <span>{firstPoint && fmtDateShort(firstPoint.date)}</span>
              <span>{lastPoint && fmtDateShort(lastPoint.date)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
