import React, { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../../services/api'
import { CreditCard, Wallet, History } from 'lucide-react'

function formatDate(date) {
  try {
    return new Date(date).toLocaleString('ru-RU')
  } catch (_) {
    return '-'
  }
}

function operationLabel(op) {
  if (op.kind === 'wallet') {
    if (op.type === 'topup') return 'Пополнение баланса'
    if (op.type === 'purchase') return 'Оплата с баланса'
    if (op.type === 'refund') return 'Возврат на баланс'
    return op.description || 'Операция баланса'
  }

  if (op.payment_type === 'topup') return 'Пополнение через платежную систему'
  if (op.payment_source === 'balance') return 'Покупка с баланса'
  return 'Оплата подписки'
}

export default function BalanceSection() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [balance, setBalance] = useState(0)
  const [currency, setCurrency] = useState('RUB')
  const [walletTx, setWalletTx] = useState([])
  const [paymentHistory, setPaymentHistory] = useState([])
  const [topupAmount, setTopupAmount] = useState(500)
  const [topupLoading, setTopupLoading] = useState(false)
  const [paymentSystem, setPaymentSystem] = useState('platega')

  async function loadData() {
    try {
      setLoading(true)
      setError(null)

      const [balanceRes, historyRes] = await Promise.all([
        authFetch('/api/payments/balance'),
        authFetch('/api/payments/history'),
      ])

      if (!balanceRes.ok) throw new Error('Не удалось загрузить баланс')
      if (!historyRes.ok) throw new Error('Не удалось загрузить историю операций')

      const balanceData = await balanceRes.json()
      const historyData = await historyRes.json()

      setBalance(Number(balanceData.balance || 0))
      setCurrency(balanceData.currency || 'RUB')
      setWalletTx(Array.isArray(balanceData.transactions) ? balanceData.transactions : [])
      setPaymentHistory(Array.isArray(historyData) ? historyData : [])
    } catch (err) {
      setError(err.message || 'Ошибка загрузки раздела баланса')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const operations = useMemo(() => {
    const walletOperations = walletTx.map((tx) => ({
      id: `w-${tx.id}`,
      kind: 'wallet',
      type: tx.type,
      amount: Number(tx.amount || 0),
      direction: tx.direction,
      status: 'completed',
      created_at: tx.created_at,
      description: tx.description,
    }))

    const paymentOperations = paymentHistory.map((p) => ({
      id: `p-${p.id}`,
      kind: 'payment',
      payment_type: p.payment_type,
      payment_source: p.payment_source,
      amount: Number(p.amount || 0),
      status: p.status,
      created_at: p.created_at,
      description: p.plan_name || p.plan_description || '',
    }))

    return [...walletOperations, ...paymentOperations]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50)
  }, [walletTx, paymentHistory])

  async function handleTopup() {
    const amount = Number(topupAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Введите корректную сумму пополнения')
      return
    }

    if (paymentSystem !== 'platega') {
      setError('Выбранная платежная система недоступна')
      return
    }

    try {
      setTopupLoading(true)
      setError(null)
      const res = await authFetch('/api/payments/topup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка создания платежа на пополнение')

      if (!data.paymentUrl) throw new Error('Payment URL not received')
      window.location.href = data.paymentUrl
    } catch (err) {
      setError(err.message || 'Ошибка пополнения')
      setTopupLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="p-4 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
        <h3 className="text-xl sm:text-2xl font-bold text-sky-900 dark:text-white mb-6">Баланс</h3>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sky-700 dark:text-slate-400 dark:text-slate-400 py-8">Загрузка раздела баланса...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
              <div className="rounded-2xl border border-cyan-500/30 bg-[radial-gradient(circle_at_20%_15%,rgba(34,211,238,0.2),transparent_38%),rgba(2,6,23,0.85)] p-6">
                <div className="text-xs uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300 mb-2 inline-flex items-center gap-2"><Wallet className="w-4 h-4" /> Текущий баланс</div>
                <div className="text-4xl font-extrabold text-sky-900 dark:text-white">{balance.toFixed(2)} {currency === 'RUB' ? '₽' : currency}</div>
                <div className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-2">Средства можно использовать для оплаты подписок напрямую.</div>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-sky-50 dark:bg-slate-900/40 p-6">
                <div className="text-sm text-sky-700 dark:text-slate-300 mb-4 inline-flex items-center gap-2"><CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Пополнение баланса</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 block mb-1">Платежная система</label>
                    <select
                      value={paymentSystem}
                      onChange={(e) => setPaymentSystem(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-sky-100 dark:bg-slate-900 border border-sky-300 dark:border-slate-700 text-sky-900 dark:text-slate-100"
                    >
                      <option value="platega">Platega (активна)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 block mb-1">Сумма</label>
                    <input
                      type="number"
                      min="10"
                      step="10"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-sky-100 dark:bg-slate-900 border border-sky-300 dark:border-slate-700 text-sky-900 dark:text-slate-100"
                    />
                  </div>
                </div>
                <button
                  onClick={handleTopup}
                  disabled={topupLoading}
                  className="mt-4 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold disabled:opacity-50"
                >
                  {topupLoading ? 'Создание платежа...' : 'Пополнить баланс'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700/60 bg-sky-50 dark:bg-slate-900/40 p-6">
              <h4 className="text-lg font-semibold text-sky-900 dark:text-white mb-4 inline-flex items-center gap-2"><History className="w-4 h-4 text-cyan-700 dark:text-cyan-300" /> История операций</h4>
              {operations.length === 0 ? (
                <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">Операции отсутствуют.</div>
              ) : (
                <div className="space-y-2">
                  {operations.map((op) => (
                    <div key={op.id} className="rounded-lg border border-sky-200 dark:border-slate-700/50 bg-sky-50 dark:bg-slate-950/40 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="text-sm text-sky-900 dark:text-slate-100 font-medium">{operationLabel(op)}</div>
                        <div className="text-xs text-sky-700 dark:text-slate-400">{formatDate(op.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold ${op.direction === 'out' ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                          {op.direction === 'out' ? '-' : '+'}{Number(op.amount || 0).toFixed(2)} ₽
                        </div>
                        <div className="text-xs text-sky-700 dark:text-slate-400">{op.status || 'completed'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
