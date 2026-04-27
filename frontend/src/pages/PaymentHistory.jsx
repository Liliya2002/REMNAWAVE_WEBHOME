import React, { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'

export default function PaymentHistory() {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  const loadPayments = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/payments/history`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )

      if (!res.ok) throw new Error('Failed to load payments')
      const data = await res.json()
      setPayments(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPayments()
  }, [])

  const filtered = filter === 'all'
    ? payments
    : payments.filter(p => p.status === filter)

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-600 text-white'
      case 'pending':
        return 'bg-yellow-600 text-white'
      case 'failed':
        return 'bg-red-600 text-white'
      case 'expired':
        return 'bg-slate-500 text-white'
      default:
        return 'bg-slate-600 text-white'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'completed':
        return '✓ Оплачено'
      case 'pending':
        return '○ Ожидает оплаты'
      case 'failed':
        return '✕ Ошибка'
      case 'expired':
        return '— Истекло'
      case 'refunded':
        return '↩ Возврат'
      default:
        return status
    }
  }

  const getPeriodText = (period) => {
    switch (period) {
      case 'monthly': return '1 месяц'
      case 'quarterly': return '3 месяца'
      case 'yearly': return '1 год'
      default: return period
    }
  }

  const getPaymentTypeText = (payment) => {
    if (payment.payment_type === 'topup') return 'Пополнение баланса'
    if (payment.payment_source === 'balance') return 'Оплата с баланса'
    return 'Оплата подписки'
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-slate-700 rounded-xl p-6">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><CreditCard className="w-6 h-6 text-blue-400" /> История платежей</h2>

        {/* Фильтры */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg transition font-medium ${
              filter === 'all'
                ? 'bg-primary text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Все платежи ({payments.length})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-4 py-2 rounded-lg transition font-medium ${
              filter === 'completed'
                ? 'bg-green-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Выполнено ({payments.filter(p => p.status === 'completed').length})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded-lg transition font-medium ${
              filter === 'pending'
                ? 'bg-yellow-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            В ожидании ({payments.filter(p => p.status === 'pending').length})
          </button>
          <button
            onClick={() => setFilter('failed')}
            className={`px-4 py-2 rounded-lg transition font-medium ${
              filter === 'failed'
                ? 'bg-red-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Ошибки ({payments.filter(p => p.status === 'failed').length})
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-slate-400">Загрузка платежей...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            {payments.length === 0 ? 'У вас еще нет платежей' : 'Платежи не найдены'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((payment) => (
              <div
                key={payment.id}
                className="flex flex-col md:flex-row md:items-center md:justify-between p-4 bg-slate-800 hover:bg-slate-750 rounded-lg border border-slate-700 transition"
              >
                <div className="flex-1 mb-3 md:mb-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(payment.status)}`}>
                      {getStatusText(payment.status)}
                    </span>
                    <span className="text-white font-semibold">{payment.plan_name || 'Баланс'}</span>
                  </div>
                  <div className="text-slate-400 text-sm">
                    {payment.plan_description || getPaymentTypeText(payment)}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-slate-500">
                    {payment.period && (
                      <span>
                        Период: <span className="text-slate-300">{getPeriodText(payment.period)}</span>
                      </span>
                    )}
                    <span>
                      Тип: <span className="text-slate-300">{getPaymentTypeText(payment)}</span>
                    </span>
                    <span>
                      ID: <span className="text-slate-300">#{payment.id}</span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-col md:flex-col md:items-end gap-2">
                  <div className="text-2xl font-bold text-white">
                    {Number(payment.amount || 0).toFixed(0)} {payment.currency || '₽'}
                  </div>
                  <div className="flex gap-3 text-xs text-slate-400">
                    <div>
                      Создан:
                      <div className="text-slate-300 font-medium">
                        {new Date(payment.created_at).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                    {payment.paid_at && (
                      <div>
                        Оплачен:
                        <div className="text-slate-300 font-medium">
                          {new Date(payment.paid_at).toLocaleDateString('ru-RU')}
                        </div>
                      </div>
                    )}
                  </div>
                  {payment.status === 'pending' && payment.payment_url && (
                    <a
                      href={payment.payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-semibold text-sm hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all"
                    >
                      <CreditCard className="w-4 h-4 inline" /> Оплатить
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Статистика */}
        {!loading && payments.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-700">
            <div className="text-center">
              <div className="text-slate-400 text-sm mb-1">Всего потрачено</div>
              <div className="text-2xl font-bold text-white">
                {payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + Number(p.amount || 0), 0).toFixed(0)} ₽
              </div>
            </div>
            <div className="text-center">
              <div className="text-slate-400 text-sm mb-1">Успешных платежей</div>
              <div className="text-2xl font-bold text-white">
                {payments.filter(p => p.status === 'completed').length}
              </div>
            </div>
            <div className="text-center">
              <div className="text-slate-400 text-sm mb-1">Ожидают оплаты</div>
              <div className="text-2xl font-bold text-yellow-400">
                {payments.filter(p => p.status === 'pending').length}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
