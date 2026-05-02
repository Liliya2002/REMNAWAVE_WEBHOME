import React, { useEffect, useMemo, useState } from 'react'
import { X, Plus, Wallet, CreditCard, Loader2, AlertCircle, Check, Zap } from 'lucide-react'
import { authFetch } from '../services/api'

const PACKS = [10, 25, 50, 100, 250]

export default function TopupTrafficModal({ subscription, squadInfo, topupMode = 'flexible', onClose, onSuccess }) {
  const [gb, setGb] = useState(10)
  const [paymentMethod, setPaymentMethod] = useState('balance')
  const [balance, setBalance] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const pricePerGb = Number(squadInfo?.topup_price_per_gb || 0)
  const total = useMemo(() => +(gb * pricePerGb).toFixed(2), [gb, pricePerGb])

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/payments/balance')
        const d = await res.json()
        if (res.ok) setBalance(Number(d.balance || 0))
      } catch {}
    })()
  }, [])

  const apply = async () => {
    setSubmitting(true); setError(null)
    try {
      const res = await authFetch(`/api/subscriptions/${subscription.id}/squad-topup`, {
        method: 'POST',
        body: JSON.stringify({
          squad_uuid: squadInfo.squad_uuid,
          gb_amount: gb,
          payment_method: paymentMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl
        return
      }
      onSuccess?.(data)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const balanceShort = balance != null ? balance.toFixed(2) + ' ₽' : '…'
  const insufficientBalance = balance != null && balance < total

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/70 rounded-2xl shadow-2xl shadow-cyan-500/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-sky-200 dark:border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
              <Plus className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-sky-900 dark:text-white">Купить трафик</h3>
              <p className="text-xs text-sky-700 dark:text-slate-400 truncate max-w-[260px]">{squadInfo.squad_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-sky-900 dark:hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* GB selector */}
          <div>
            <label className="block text-xs text-sky-700 dark:text-slate-400 mb-2">Сколько ГБ?</label>
            {topupMode === 'packs' ? (
              <div className="grid grid-cols-5 gap-1.5">
                {PACKS.map(p => (
                  <button
                    key={p}
                    onClick={() => setGb(p)}
                    className={`py-2 rounded-lg text-sm font-medium border-2 transition ${
                      gb === p
                        ? 'border-cyan-500 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                        : 'border-sky-200 dark:border-slate-700/60 bg-sky-50/50 dark:bg-slate-800/30 text-sky-900 dark:text-slate-300 hover:border-cyan-500/50'
                    }`}
                  >
                    {p} ГБ
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1" max="500" step="1"
                  value={gb}
                  onChange={e => setGb(Number(e.target.value))}
                  className="flex-1 accent-cyan-500"
                />
                <input
                  type="number" min="1" max="1000"
                  value={gb}
                  onChange={e => setGb(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                  className="w-20 px-2 py-1.5 rounded-lg text-sm bg-sky-50/50 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/60 text-sky-900 dark:text-slate-200 text-center"
                />
                <span className="text-xs text-sky-700 dark:text-slate-400">ГБ</span>
              </div>
            )}
          </div>

          {/* Price */}
          <div className="px-4 py-3 rounded-xl bg-sky-50 dark:bg-slate-800/40 border border-sky-200 dark:border-slate-700/40 flex items-baseline justify-between">
            <span className="text-sm text-sky-700 dark:text-slate-400">К оплате:</span>
            <span className="text-2xl font-bold font-mono text-cyan-600 dark:text-cyan-400">
              {total.toFixed(2)} ₽
            </span>
          </div>
          <div className="text-[11px] text-sky-700 dark:text-slate-500 -mt-2">
            Цена: {pricePerGb.toFixed(2)} ₽/ГБ
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Способ оплаты</div>
            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
              paymentMethod === 'balance'
                ? 'border-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/5'
                : 'border-sky-200 dark:border-slate-700/60 bg-sky-50/30 dark:bg-slate-800/30'
            } ${insufficientBalance ? 'opacity-50' : ''}`}>
              <input
                type="radio" name="pm" value="balance"
                checked={paymentMethod === 'balance'}
                onChange={() => setPaymentMethod('balance')}
                disabled={insufficientBalance}
                className="accent-cyan-500"
              />
              <Wallet className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              <div className="flex-1">
                <div className="font-medium text-sky-900 dark:text-slate-200 text-sm">С баланса</div>
                <div className="text-xs text-sky-700 dark:text-slate-400">
                  Доступно: {balanceShort}{insufficientBalance ? ' — недостаточно' : ''}
                </div>
              </div>
            </label>
            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
              paymentMethod === 'gateway'
                ? 'border-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/5'
                : 'border-sky-200 dark:border-slate-700/60 bg-sky-50/30 dark:bg-slate-800/30'
            }`}>
              <input
                type="radio" name="pm" value="gateway"
                checked={paymentMethod === 'gateway'}
                onChange={() => setPaymentMethod('gateway')}
                className="accent-cyan-500"
              />
              <CreditCard className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              <div className="flex-1">
                <div className="font-medium text-sky-900 dark:text-slate-200 text-sm">Картой через Platega</div>
                <div className="text-xs text-sky-700 dark:text-slate-400">Перенаправление в платёжный шлюз</div>
              </div>
            </label>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-sky-200 dark:border-slate-700/60 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-sky-700 dark:text-slate-300 hover:text-sky-900 dark:hover:text-white bg-sky-100 dark:bg-slate-800/60 border border-sky-200 dark:border-slate-700/60">
            Отмена
          </button>
          <button
            onClick={apply}
            disabled={submitting || gb < 1 || total <= 0}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Купить {gb} ГБ за {total.toFixed(0)} ₽
          </button>
        </div>
      </div>
    </div>
  )
}
