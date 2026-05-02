import React, { useEffect, useState, useCallback } from 'react'
import { Smartphone, Monitor, Apple, Globe, Trash2, RefreshCw, AlertTriangle } from 'lucide-react'
import { authFetch } from '../services/api'

function platformIcon(platform) {
  const p = String(platform || '').toLowerCase()
  if (p.includes('android')) return <Smartphone className="w-4 h-4" />
  if (p.includes('ios') || p.includes('mac')) return <Apple className="w-4 h-4" />
  if (p.includes('windows') || p.includes('linux')) return <Monitor className="w-4 h-4" />
  return <Globe className="w-4 h-4" />
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function DevicesSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await authFetch('/api/subscriptions/devices')
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || d.error || `HTTP ${res.status}`)
      setData(d)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (hwid) => {
    if (!confirm('Удалить устройство? Юзер на этом устройстве потеряет VPN-доступ до повторного подключения.')) return
    try {
      setRemoving(hwid)
      const res = await authFetch(`/api/subscriptions/devices/${encodeURIComponent(hwid)}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      load()
    } catch (err) {
      setError(err.message)
    } finally { setRemoving(null) }
  }

  if (!data?.hasSubscription) return null

  const count = data?.devices?.length || 0
  const limit = data?.limit
  const isAtLimit = limit != null && count >= limit
  const isOverLimit = limit != null && count > limit

  return (
    <div className="p-4 sm:p-6 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-900/60 dark:to-slate-950/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-sky-900 dark:text-white">Подключённые устройства</h3>
            <p className="text-xs text-sky-700 dark:text-slate-400">
              {limit != null
                ? `${count} / ${limit}${isOverLimit ? ' — превышен' : isAtLimit ? ' — лимит достигнут' : ''}`
                : `${count} ${count === 1 ? 'устройство' : 'устройств'} (без лимита)`}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg text-sky-700 dark:text-slate-400 hover:text-sky-900 dark:hover:text-white hover:bg-sky-100 dark:hover:bg-slate-800/60 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="break-all">{error}</div>
        </div>
      )}

      {(isAtLimit || isOverLimit) && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2 ${
          isOverLimit
            ? 'bg-red-500/10 border border-red-500/40 text-red-700 dark:text-red-300'
            : 'bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-300'
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            {isOverLimit
              ? 'Подключено больше устройств чем разрешено тарифом. Удалите ненужные.'
              : 'Достигнут лимит устройств тарифа. Чтобы подключить новое — удалите одно из существующих или смените тариф.'}
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="py-8 text-center text-sky-700 dark:text-slate-500 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Загрузка…
        </div>
      )}

      {!loading && count === 0 && (
        <div className="py-8 text-center text-sky-700 dark:text-slate-500 text-sm">
          <Globe className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Устройств пока не подключено</p>
          <p className="text-xs mt-1">Они появятся после первого подключения VPN</p>
        </div>
      )}

      {count > 0 && (
        <div className="space-y-2">
          {data.devices.map((d, i) => (
            <div
              key={d.hwid + i}
              className="flex items-start gap-3 p-3 rounded-xl bg-sky-100/50 dark:bg-slate-800/40 border border-sky-200 dark:border-slate-700/40"
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-cyan-700 dark:text-cyan-300 flex items-center justify-center shrink-0">
                {platformIcon(d.platform)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-sky-900 dark:text-slate-200 truncate">
                  {d.deviceModel || d.platform || 'Устройство'}
                </div>
                <div className="text-[11px] text-sky-700 dark:text-slate-400 truncate">
                  {[d.platform, d.osVersion].filter(Boolean).join(' · ')}
                </div>
                {d.userAgent && (
                  <div className="text-[10px] text-sky-700/70 dark:text-slate-500 truncate font-mono mt-0.5">{d.userAgent}</div>
                )}
                <div className="text-[10px] text-sky-700/60 dark:text-slate-600 mt-1">
                  Подключено: {fmtDate(d.createdAt)}
                </div>
              </div>
              <button
                onClick={() => remove(d.hwid)}
                disabled={removing === d.hwid}
                title="Удалить устройство"
                className="p-2 rounded-lg text-red-600/70 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/15 transition disabled:opacity-50"
              >
                <Trash2 className={`w-4 h-4 ${removing === d.hwid ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
