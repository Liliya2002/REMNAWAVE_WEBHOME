import React, { useState } from 'react'
import { Ticket, CheckCircle2, AlertCircle } from 'lucide-react'
import { authFetch } from '../services/api'

/**
 * Активация промокода, не связанного с оплатой: «дни подписки» и «на баланс».
 * Скидочные коды сюда не вводятся — они применяются в форме оплаты, и сервер
 * ответит на них понятным отказом.
 *
 * Ввод не нормализуем на клиенте: регистр и дефисы приводит бэкенд, и правило
 * должно жить в одном месте — иначе фронт и сервер разойдутся в том, какой
 * код считать одинаковым.
 */
export default function PromoRedeem({ onRedeemed }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(null)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e?.preventDefault()
    const value = code.trim()
    if (!value || busy) return

    setBusy(true); setOk(null); setErr(null)
    try {
      const res = await authFetch('/api/promo/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Не удалось активировать промокод'); return }

      setOk(data.message || 'Промокод активирован')
      setCode('')
      onRedeemed?.(data)
    } catch (e2) {
      if (e2.message !== 'Unauthorized' && e2.message !== 'No token') setErr('Ошибка сети')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-sky-200 dark:border-slate-700/60 bg-sky-50 dark:bg-slate-900/40 p-6"
    >
      <div className="text-sm text-sky-700 dark:text-slate-300 mb-4 inline-flex items-center gap-2">
        <Ticket className="w-4 h-4 text-violet-600 dark:text-violet-400" /> Промокод
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={e => { setCode(e.target.value); setOk(null); setErr(null) }}
          placeholder="Введите код"
          className="flex-1 px-3 py-2 rounded-lg bg-sky-100 dark:bg-slate-900 border border-sky-300 dark:border-slate-700 text-sky-900 dark:text-slate-100 font-mono uppercase placeholder:normal-case placeholder:font-sans"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="px-5 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? 'Проверяем…' : 'Активировать'}
        </button>
      </div>

      {ok && (
        <div className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {ok}
        </div>
      )}
      {err && (
        <div className="mt-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      <div className="mt-3 text-xs text-sky-700 dark:text-slate-500">
        Коды со скидкой вводятся при оплате тарифа, а не здесь.
        Начисленные дни применяются в разделе «Подписка».
      </div>
    </form>
  )
}
