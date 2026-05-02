import React, { useEffect, useState, useCallback } from 'react'
import { Server, RefreshCw, Plus, AlertCircle, Lock, Unlock, Activity } from 'lucide-react'
import { authFetch } from '../services/api'
import TopupTrafficModal from './TopupTrafficModal'

const COUNTRY_FLAGS = {
  RU: '🇷🇺', DE: '🇩🇪', US: '🇺🇸', NL: '🇳🇱', FI: '🇫🇮', SG: '🇸🇬',
  GB: '🇬🇧', FR: '🇫🇷', JP: '🇯🇵', CA: '🇨🇦', AU: '🇦🇺', KR: '🇰🇷',
  SE: '🇸🇪', CH: '🇨🇭', PL: '🇵🇱', TR: '🇹🇷', AE: '🇦🇪', IN: '🇮🇳',
  BR: '🇧🇷', HK: '🇭🇰', TW: '🇹🇼', UA: '🇺🇦', KZ: '🇰🇿', CZ: '🇨🇿', GE: '🇬🇪',
}

function fmtGb(gb) {
  return Number(gb || 0).toFixed(2)
}

export default function SquadUsageSection({ subscription }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [topupFor, setTopupFor] = useState(null) // { squad_uuid, squad_name, price_per_gb }

  const load = useCallback(async () => {
    if (!subscription?.id) return
    setLoading(true)
    try {
      const res = await authFetch(`/api/subscriptions/${subscription.id}/squad-usage`)
      const json = await res.json()
      if (res.ok) setData(json)
    } finally { setLoading(false) }
  }, [subscription?.id])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return (
      <div className="text-xs text-sky-700 dark:text-slate-400 flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Загрузка лимитов по серверам…
      </div>
    )
  }

  if (!data || !data.enabled) {
    // Squad-quota система выключена — не показываем секцию
    return null
  }
  if (!data.items || data.items.length === 0) {
    return null
  }

  const allDisabled = data.items.every(it => it.is_disabled || it.total_limit_gb <= 0)
  const hasDisabled = data.items.some(it => it.is_disabled)

  return (
    <div className="mt-4 pt-4 border-t border-sky-200 dark:border-slate-800/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <h4 className="text-sm font-semibold text-sky-900 dark:text-slate-200">Лимиты по серверам</h4>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{data.period_key}</span>
        </div>
        <button onClick={load} className="text-slate-500 hover:text-cyan-500 dark:hover:text-cyan-300 p-1">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {hasDisabled && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Часть серверов отключена — лимит трафика исчерпан</div>
            <div className="opacity-80">Серверы автоматически восстановятся в начале нового периода. Купите дополнительные ГБ чтобы вернуть доступ сейчас.</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {data.items.map(it => {
          const pct = it.used_percent
          const noLimit = it.total_limit_gb <= 0
          const barColor = it.is_disabled ? 'bg-slate-500'
            : pct >= 100 ? 'bg-red-500'
            : pct >= 80 ? 'bg-amber-500'
            : 'bg-gradient-to-r from-cyan-500 to-blue-500'
          return (
            <div
              key={it.squad_uuid}
              className={`p-3 rounded-xl border ${
                it.is_disabled
                  ? 'border-red-500/40 bg-red-500/5'
                  : pct >= 80
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-sky-200 dark:border-slate-700/50 bg-sky-50/50 dark:bg-slate-800/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {it.is_disabled
                    ? <Lock className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    : <Unlock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  }
                  <span className="text-sm font-medium text-sky-900 dark:text-slate-200 truncate">{it.squad_name}</span>
                </div>
                {it.is_disabled && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/30 text-red-700 dark:text-red-200">disabled</span>
                )}
              </div>

              {noLimit ? (
                <div className="text-[11px] text-sky-700 dark:text-slate-400">
                  <Activity className="w-3 h-3 inline mr-1" />
                  Без per-squad лимита
                </div>
              ) : (
                <>
                  <div className="text-[11px] text-sky-700 dark:text-slate-400 mb-1 font-mono">
                    {fmtGb(it.used_gb)} / {fmtGb(it.total_limit_gb)} ГБ
                    {it.extra_gb > 0 && <span className="text-emerald-600 dark:text-emerald-400 ml-1">(+{fmtGb(it.extra_gb)} куплено)</span>}
                    <span className="float-right">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-sky-100 dark:bg-slate-900/60 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  {it.topup_enabled && (
                    <button
                      onClick={() => setTopupFor(it)}
                      className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 transition"
                    >
                      <Plus className="w-3 h-3" />
                      Купить +ГБ
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {topupFor && (
        <TopupTrafficModal
          subscription={subscription}
          squadInfo={topupFor}
          topupMode={data.topup_mode}
          onClose={() => setTopupFor(null)}
          onSuccess={() => { setTopupFor(null); load() }}
        />
      )}
    </div>
  )
}
