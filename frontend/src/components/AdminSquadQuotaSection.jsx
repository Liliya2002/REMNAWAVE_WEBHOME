import React, { useEffect, useState, useCallback } from 'react'
import { Server, Lock, Unlock, RefreshCw, Plus, Gift, RotateCcw, AlertCircle, History } from 'lucide-react'
import { authFetch } from '../services/api'

function fmtGb(bytes) {
  return (Number(bytes || 0) / (1024 ** 3)).toFixed(2)
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function AdminSquadQuotaSection({ userId, subscription }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(null) // squad_uuid currently acted on
  const [giftFor, setGiftFor] = useState(null) // squad object for gift modal

  const load = useCallback(async () => {
    if (!userId || !subscription?.id) return
    setLoading(true)
    try {
      const res = await authFetch(`/api/admin/users/${userId}/subscription/${subscription.id}/squad-states`)
      const json = await res.json()
      if (res.ok) setData(json)
    } finally { setLoading(false) }
  }, [userId, subscription?.id])

  useEffect(() => { load() }, [load])

  const act = async (squadUuid, action) => {
    setActing(squadUuid)
    try {
      const url = `/api/admin/users/${userId}/subscription/${subscription.id}/squad/${squadUuid}/${action}`
      const res = await authFetch(url, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) alert(j.error || 'Ошибка')
      else load()
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="bg-gradient-to-br from-violet-500/5 to-slate-900/60 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center">
            <Server className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Squad Quotas</h3>
            <p className="text-xs text-slate-400">
              Период: <code className="font-mono text-slate-300">{data?.period_key || '—'}</code>
              {data?.states && ` · ${data.states.length} серверов`}
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-5 space-y-3">
        {loading && !data && (
          <div className="text-center py-6 text-slate-500 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> Загрузка…
          </div>
        )}

        {data && data.states?.length === 0 && (
          <div className="text-center py-4 text-slate-500 text-sm">
            <AlertCircle className="w-5 h-5 mx-auto mb-1" />
            Нет данных squad-quota за этот период (возможно cron ещё не отработал или squad-quota не включена)
          </div>
        )}

        {data?.states?.map(state => {
          const totalGb = Number(state.base_limit_gb || 0) + Number(state.extra_gb || 0)
          const usedGb = Number(state.used_bytes || 0) / (1024 ** 3)
          const pct = totalGb > 0 ? Math.min(100, (usedGb / totalGb) * 100) : 0
          const isDisabled = state.is_disabled
          const barColor = isDisabled ? 'bg-slate-500'
            : pct >= 100 ? 'bg-red-500'
            : pct >= 80 ? 'bg-amber-500'
            : 'bg-gradient-to-r from-emerald-500 to-cyan-500'

          return (
            <div key={state.id} className={`p-3 rounded-xl border ${isDisabled ? 'border-red-500/40 bg-red-500/5' : 'border-slate-700/40 bg-slate-800/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                {isDisabled ? <Lock className="w-3.5 h-3.5 text-red-400" /> : <Unlock className="w-3.5 h-3.5 text-emerald-400" />}
                <span className="text-sm font-medium text-slate-200 truncate flex-1">{state.squad_name || state.squad_uuid.slice(0, 12)}</span>
                {isDisabled && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/30 text-red-200">disabled</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 font-mono mb-1">
                {usedGb.toFixed(2)} / {totalGb.toFixed(2)} ГБ
                {state.extra_gb > 0 && <span className="text-emerald-400 ml-1">(+{Number(state.extra_gb).toFixed(2)})</span>}
                <span className="float-right">{pct.toFixed(0)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-900/60 rounded-full overflow-hidden mb-2">
                <div className={`h-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[10px] text-slate-500 mb-2">
                {state.last_synced_at && <span>Sync: {fmtDate(state.last_synced_at)}</span>}
                {state.disabled_at && <span> · Disabled: {fmtDate(state.disabled_at)}</span>}
                {state.reactivated_at && <span> · Reactivated: {fmtDate(state.reactivated_at)}</span>}
              </div>
              <div className="flex flex-wrap gap-1">
                {isDisabled && (
                  <button
                    onClick={() => act(state.squad_uuid, 'reactivate')}
                    disabled={acting === state.squad_uuid}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 disabled:opacity-50"
                  >
                    <Unlock className="w-3 h-3" /> Восстановить
                  </button>
                )}
                <button
                  onClick={() => { if (confirm('Сбросить used_bytes счётчик за этот период?')) act(state.squad_uuid, 'reset') }}
                  disabled={acting === state.squad_uuid}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" /> Сброс счётчика
                </button>
                <button
                  onClick={() => setGiftFor(state)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-300"
                >
                  <Gift className="w-3 h-3" /> Подарить ГБ
                </button>
              </div>
            </div>
          )
        })}

        {/* Purchase history */}
        {data?.purchases?.length > 0 && (
          <div className="pt-3 border-t border-slate-800/60">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2 flex items-center gap-1">
              <History className="w-3 h-3" /> Покупки доп. трафика ({data.purchases.length})
            </div>
            <div className="space-y-1 text-xs">
              {data.purchases.slice(0, 8).map(p => (
                <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-800/30">
                  {p.source === 'admin_gift'
                    ? <Gift className="w-3 h-3 text-violet-400" />
                    : <Plus className="w-3 h-3 text-cyan-400" />
                  }
                  <span className="text-slate-300 flex-1 truncate">{p.squad_name || p.squad_uuid.slice(0, 12)}</span>
                  <span className="text-emerald-400 font-mono">+{Number(p.gb_amount).toFixed(2)} ГБ</span>
                  {p.source === 'user_purchase' && <span className="text-slate-400 font-mono text-[10px]">{Number(p.amount_paid).toFixed(0)} ₽</span>}
                  {p.source === 'admin_gift' && <span className="text-violet-400 text-[10px]">{p.granted_by_login || 'admin'}</span>}
                  <span className="text-slate-500 text-[10px]">{fmtDate(p.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {giftFor && (
        <GiftTrafficModal
          state={giftFor}
          userId={userId}
          subscriptionId={subscription.id}
          onClose={() => setGiftFor(null)}
          onSuccess={() => { setGiftFor(null); load() }}
        />
      )}
    </div>
  )
}

function GiftTrafficModal({ state, userId, subscriptionId, onClose, onSuccess }) {
  const [gb, setGb] = useState(10)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    setSubmitting(true); setError(null)
    try {
      const res = await authFetch(`/api/admin/users/${userId}/subscription/${subscriptionId}/squad/${state.squad_uuid}/gift`, {
        method: 'POST',
        body: JSON.stringify({ gb_amount: gb, notes }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      onSuccess?.()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/70 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-white">Подарить трафик</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm text-slate-300">
            Сервер: <b>{state.squad_name || state.squad_uuid.slice(0, 12)}</b>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Сколько ГБ подарить</label>
            <input
              type="number" min="0.1" step="0.1" max="1000"
              value={gb}
              onChange={e => setGb(Math.max(0.1, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/60 rounded-lg text-sm text-slate-200"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Заметка (опционально)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Например: компенсация за downtime"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/60 rounded-lg text-sm text-slate-200 resize-none"
            />
          </div>
          {error && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">{error}</div>}
        </div>
        <div className="px-5 py-4 border-t border-slate-700/60 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-300 bg-slate-800/60 border border-slate-700/60">Отмена</button>
          <button
            onClick={submit}
            disabled={submitting || gb <= 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white disabled:opacity-50"
          >
            <Gift className="w-4 h-4" />
            Подарить {gb} ГБ
          </button>
        </div>
      </div>
    </div>
  )
}
