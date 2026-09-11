import React from 'react'
import { authFetch } from '../services/api'

export default function PeriodSelectionModal({
  plan,
  paymentLoading,
  balance = 0,
  onSelectGateway,
  onSelectBalance,
  onClose,
}) {
  const [selectedPeriod, setSelectedPeriod] = React.useState('monthly')

  // Промокод: строка в поле, применённая скидка и ошибка проверки — раздельно.
  // applied хранит ответ сервера целиком, чтобы показывать ровно те суммы,
  // которые посчитал бэкенд, а не пересчитывать их на клиенте.
  const [promoInput, setPromoInput] = React.useState('')
  const [applied, setApplied] = React.useState(null)
  const [promoError, setPromoError] = React.useState(null)
  const [promoBusy, setPromoBusy] = React.useState(false)

  const periodOptions = [
    plan.price_monthly ? { key: 'monthly', title: '1 месяц', hint: 'Оплата ежемесячно', price: Number(plan.price_monthly) } : null,
    plan.price_quarterly ? {
      key: 'quarterly',
      title: '3 месяца',
      hint: `Экономия ${Math.round((plan.price_monthly * 3 - plan.price_quarterly) / (plan.price_monthly * 3) * 100)}%`,
      price: Number(plan.price_quarterly),
      badge: 'Выгодно',
    } : null,
    plan.price_yearly ? {
      key: 'yearly',
      title: '12 месяцев',
      hint: `Экономия ${Math.round((plan.price_monthly * 12 - plan.price_yearly) / (plan.price_monthly * 12) * 100)}%`,
      price: Number(plan.price_yearly),
      badge: 'Лучше всего',
    } : null,
  ].filter(Boolean)

  const selected = periodOptions.find(o => o.key === selectedPeriod) || periodOptions[0]

  /**
   * Проверка кода на сервере. Сумму не передаём — бэкенд берёт цену тарифа
   * сам, иначе подобранным телом запроса можно было бы выманить любую скидку.
   */
  async function checkPromo(code, period, { silent = false } = {}) {
    const value = String(code || '').trim()
    if (!value) return
    setPromoBusy(true)
    if (!silent) setPromoError(null)
    try {
      const res = await authFetch('/api/promo/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value, plan_id: plan.id, period }),
      })
      const data = await res.json()
      if (!res.ok) {
        setApplied(null)
        setPromoError(data.error || 'Промокод недоступен')
        return
      }
      setApplied(data)
      setPromoError(null)
    } catch (e) {
      if (e.message !== 'Unauthorized' && e.message !== 'No token') {
        setApplied(null)
        setPromoError('Не удалось проверить промокод')
      }
    } finally {
      setPromoBusy(false)
    }
  }

  /**
   * Смена периода перепроверяет уже применённый код: у кода бывают
   * ограничения по периоду и минимальной сумме, и без перепроверки экран
   * показывал бы скидку, которую сервер при оплате не примет.
   */
  function pickPeriod(key) {
    setSelectedPeriod(key)
    if (applied) checkPromo(applied.code, key, { silent: true })
  }

  function dropPromo() {
    setApplied(null)
    setPromoInput('')
    setPromoError(null)
  }

  // Цена к оплате: со скидкой, если код применён к ТЕКУЩЕМУ периоду.
  const basePrice = Number(selected?.price || 0)
  const payPrice = applied ? Number(applied.final_amount) : basePrice
  const canPayWithBalance = selected ? Number(balance || 0) >= payPrice : false
  const promoCode = applied ? applied.code : null

  const money = v => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl my-8">
        <h3 className="text-2xl font-bold mb-2">Выберите период</h3>
        <p className="text-slate-400 text-sm mb-6">{plan.name}</p>
        <div className="mb-4 text-xs rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-cyan-200">
          Баланс: <span className="font-bold">{Number(balance || 0).toFixed(2)} ₽</span>
        </div>

        <div className="space-y-3 mb-6">
          {periodOptions.map((option) => (
            <button
              key={option.key}
              onClick={() => pickPeriod(option.key)}
              disabled={paymentLoading}
              className={`w-full p-4 rounded-lg border transition-all text-left disabled:opacity-50 relative ${selectedPeriod === option.key ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 hover:border-blue-500 hover:bg-blue-500/10 bg-slate-800/50'}`}
            >
              {option.badge && (
                <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                  {option.badge}
                </div>
              )}
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold text-white">{option.title}</div>
                  <div className="text-xs text-slate-400">{option.hint}</div>
                </div>
                <div className="text-xl font-bold text-blue-400">{option.price} ₽</div>
              </div>
            </button>
          ))}
        </div>

        {/* ── Промокод ── */}
        <div className="mb-4">
          {!applied ? (
            <>
              <div className="flex gap-2">
                <input
                  autoComplete="off"
                  spellCheck={false}
                  value={promoInput}
                  onChange={e => { setPromoInput(e.target.value); setPromoError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') checkPromo(promoInput, selectedPeriod) }}
                  placeholder="Промокод"
                  disabled={paymentLoading}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-700 text-white text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans focus:border-violet-500 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => checkPromo(promoInput, selectedPeriod)}
                  disabled={promoBusy || paymentLoading || !promoInput.trim()}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-40 whitespace-nowrap"
                >
                  {promoBusy ? '…' : 'Применить'}
                </button>
              </div>
              {promoError && <div className="mt-2 text-xs text-red-400">{promoError}</div>}
            </>
          ) : (
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-violet-200 font-mono truncate">{applied.code}</div>
                  <div className="text-xs text-violet-300/80">
                    скидка {money(applied.discount)} ₽
                  </div>
                </div>
                <button
                  onClick={dropPromo}
                  disabled={paymentLoading}
                  className="text-xs text-slate-400 hover:text-slate-200 underline shrink-0"
                >
                  убрать
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Итог показываем только когда есть что показывать: без скидки цена
            уже видна на кнопках периода. */}
        {applied && (
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-sm text-slate-400">К оплате</span>
            <span>
              <span className="text-slate-500 line-through mr-2">{money(applied.original_amount)} ₽</span>
              <span className="text-2xl font-bold text-emerald-400">{money(payPrice)} ₽</span>
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 mb-4">
          <button
            onClick={() => selected && onSelectBalance?.(selected.key, promoCode)}
            disabled={paymentLoading || !selected || !canPayWithBalance}
            className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded-lg hover:opacity-90 transition-all disabled:opacity-50 font-semibold"
          >
            {paymentLoading ? 'Обработка...' : `Оплатить с баланса (${money(payPrice)} ₽)`}
          </button>
          {!canPayWithBalance && selected && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Недостаточно средств на балансе для выбранного периода.
            </div>
          )}
          <button
            onClick={() => selected && onSelectGateway?.(selected.key, promoCode)}
            disabled={paymentLoading || !selected}
            className="w-full px-4 py-3 border border-slate-600 text-slate-200 rounded-lg hover:border-blue-500 hover:text-blue-300 transition-all disabled:opacity-50 font-semibold"
          >
            {paymentLoading
              ? 'Обработка...'
              : payPrice === 0 ? 'Активировать по промокоду' : 'Оплатить картой'}
          </button>
        </div>

        <button
          onClick={onClose}
          disabled={paymentLoading}
          className="w-full px-4 py-3 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-all disabled:opacity-50 font-semibold"
        >
          {paymentLoading ? 'Обработка платежа...' : 'Отмена'}
        </button>
      </div>
    </div>
  )
}
