import React, { useEffect, useMemo, useState } from 'react'
import { BarChart2, RefreshCw } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export default function LandingViewsPanel({ landingId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [error, setError] = useState(null)

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${API}/api/admin/landings/${landingId}/views?days=${days}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка загрузки')
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [days, landingId])

  // Bar chart: нормализуем по максимуму
  const max = useMemo(() => Math.max(1, ...(data?.daily || []).map(d => d.count)), [data])

  return (
    <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-cyan-400" /> Просмотры
        </h3>
        <div className="flex items-center gap-2">
          {[7, 30, 90, 365].map(n => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                days === n
                  ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300'
                  : 'bg-slate-800/40 border border-slate-700/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              {n}д
            </button>
          ))}
          <button
            onClick={load}
            className="ml-1 p-1.5 rounded-md hover:bg-slate-700/60 text-slate-400 hover:text-white transition"
            title="Обновить"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-red-400 text-sm mb-3">{error}</div>}

      {loading && !data ? (
        <div className="flex items-center justify-center py-10">
          <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      ) : data ? (
        <>
          <div className="flex items-baseline gap-3 mb-4">
            <div className="text-4xl font-bold text-cyan-300">{data.total.toLocaleString('ru-RU')}</div>
            <div className="text-xs text-slate-500">просмотров за {days} дней</div>
          </div>
          {data.daily.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-8">Просмотров пока нет</div>
          ) : (
            <div className="flex items-end gap-1 h-40 border-b border-slate-700/40 pb-1">
              {data.daily.map(row => (
                <div
                  key={row.day}
                  title={`${new Date(row.day).toLocaleDateString('ru-RU')}: ${row.count}`}
                  className="flex-1 min-w-0 group relative"
                >
                  <div
                    className="bg-gradient-to-t from-cyan-500/60 to-cyan-400/80 hover:from-cyan-400 hover:to-cyan-300 rounded-t transition-all"
                    style={{ height: `${(row.count / max) * 100}%`, minHeight: row.count > 0 ? '2px' : '0' }}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between text-[10px] text-slate-500 mt-1">
            <span>{data.daily[0] ? new Date(data.daily[0].day).toLocaleDateString('ru-RU') : ''}</span>
            <span>{data.daily.at(-1) ? new Date(data.daily.at(-1).day).toLocaleDateString('ru-RU') : ''}</span>
          </div>
        </>
      ) : null}
    </div>
  )
}
