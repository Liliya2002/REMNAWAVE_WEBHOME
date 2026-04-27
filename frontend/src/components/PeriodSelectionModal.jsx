import React from 'react'

export default function PeriodSelectionModal({
  plan,
  paymentLoading,
  balance = 0,
  onSelectGateway,
  onSelectBalance,
  onClose,
}) {
  const [selectedPeriod, setSelectedPeriod] = React.useState('monthly')

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
  const canPayWithBalance = selected ? Number(balance || 0) >= Number(selected.price || 0) : false

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl">
        <h3 className="text-2xl font-bold mb-2">Выберите период</h3>
        <p className="text-slate-400 text-sm mb-6">{plan.name}</p>
        <div className="mb-4 text-xs rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-cyan-200">
          Баланс: <span className="font-bold">{Number(balance || 0).toFixed(2)} ₽</span>
        </div>
        
        <div className="space-y-3 mb-6">
          {periodOptions.map((option) => (
            <button
              key={option.key}
              onClick={() => setSelectedPeriod(option.key)}
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

        <div className="grid grid-cols-1 gap-2 mb-4">
          <button
            onClick={() => selected && onSelectBalance?.(selected.key)}
            disabled={paymentLoading || !selected || !canPayWithBalance}
            className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded-lg hover:opacity-90 transition-all disabled:opacity-50 font-semibold"
          >
            {paymentLoading ? 'Обработка...' : `Оплатить с баланса (${selected?.price || 0} ₽)`}
          </button>
          {!canPayWithBalance && selected && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Недостаточно средств на балансе для выбранного периода.
            </div>
          )}
          <button
            onClick={() => selected && onSelectGateway?.(selected.key)}
            disabled={paymentLoading || !selected}
            className="w-full px-4 py-3 border border-slate-600 text-slate-200 rounded-lg hover:border-blue-500 hover:text-blue-300 transition-all disabled:opacity-50 font-semibold"
          >
            {paymentLoading ? 'Обработка...' : 'Оплатить картой'}
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
