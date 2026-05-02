import React, { useEffect, useMemo, useState } from 'react'
import {
  X, Check, ArrowRight, ArrowUp, ArrowDown, ArrowLeftRight, AlertCircle,
  Loader2, Wallet, CreditCard, Zap, ChevronRight, ChevronLeft,
} from 'lucide-react'
import { authFetch } from '../services/api'

const PERIOD_OPTIONS = [
  { id: 'remaining', label: 'Только разница за оставшиеся дни', desc: 'Срок не меняется' },
  { id: 'monthly',   label: '+30 дней с пересчётом',          desc: 'Месяц нового тарифа сверху' },
  { id: 'quarterly', label: '+91 день с пересчётом',           desc: 'Квартал нового тарифа сверху' },
  { id: 'yearly',    label: '+365 дней с пересчётом',          desc: 'Год нового тарифа сверху' },
]

const TIER_COLORS = {
  0: 'from-slate-500 to-slate-600',
  1: 'from-cyan-500 to-blue-500',
  2: 'from-blue-500 to-violet-500',
  3: 'from-violet-500 to-fuchsia-500',
  4: 'from-amber-500 to-orange-500',
}

function tierGradient(t) {
  return TIER_COLORS[t] || 'from-slate-500 to-slate-600'
}

function fmtPrice(v) {
  if (v == null) return '—'
  return `${Number(v).toFixed(0)} ₽`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function ChangePlanModal({ subscription, currentPlan, onClose, onSuccess, adminMode = false, userId = null }) {
  const [step, setStep] = useState(1) // 1 — выбор плана, 2 — период, 3 — оплата
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [targetPlan, setTargetPlan] = useState(null)
  const [period, setPeriod] = useState('remaining')
  const [calc, setCalc] = useState(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [calcError, setCalcError] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState('balance')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const calcUrl = adminMode
    ? `/api/admin/users/${userId}/subscription/${subscription.id}/calculate-change`
    : '/api/subscriptions/calculate-change'

  const applyUrl = adminMode
    ? `/api/admin/users/${userId}/subscription/${subscription.id}/change`
    : '/api/subscriptions/change'

  // Шаг 1 — загрузка тарифов
  useEffect(() => {
    (async () => {
      setPlansLoading(true)
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans`)
        const data = await res.json()
        const filtered = (data.plans || [])
          .filter(p => p.is_active && !p.is_trial)
          .sort((a, b) => (a.tier - b.tier) || (a.sort_order - b.sort_order) || (a.price_monthly - b.price_monthly))
        setPlans(filtered)
      } finally { setPlansLoading(false) }
    })()
  }, [])

  // Шаг 2/3 — пересчёт preview при изменении target/period
  useEffect(() => {
    if (!targetPlan?.id) return
    let cancelled = false
    ;(async () => {
      setCalcLoading(true); setCalcError(null)
      try {
        const body = adminMode
          ? { target_plan_id: targetPlan.id, period }
          : { subscription_id: subscription.id, target_plan_id: targetPlan.id, period }
        const res = await authFetch(calcUrl, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) setCalc(data)
      } catch (err) {
        if (!cancelled) setCalcError(err.message)
      } finally {
        if (!cancelled) setCalcLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [targetPlan, period, subscription.id])

  // Применение
  const apply = async () => {
    if (!targetPlan?.id) {
      setSubmitError('Сначала выберите тариф')
      return
    }
    setSubmitting(true); setSubmitError(null)
    try {
      const body = adminMode
        ? { target_plan_id: targetPlan.id, period }
        : { subscription_id: subscription.id, target_plan_id: targetPlan.id, period, payment_method: paymentMethod }
      const res = await authFetch(applyUrl, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.payment?.paymentUrl) {
        window.location.href = data.payment.paymentUrl
        return
      }
      onSuccess?.(data)
    } catch (err) {
      setSubmitError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-700/70 rounded-2xl shadow-2xl shadow-cyan-500/10 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-sky-200 dark:border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-sky-900 dark:text-white">Сменить тариф</h3>
              <p className="text-xs text-sky-700 dark:text-slate-400">
                Текущий: <b>{currentPlan?.name || subscription.plan_name}</b> · до {fmtDate(subscription.expires_at)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-sky-900 dark:hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {/* Stepper */}
        <div className="px-5 py-3 border-b border-sky-200 dark:border-slate-800/60 flex items-center gap-2 text-xs">
          {[1, 2, 3].map((s) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 ${step >= s ? 'text-cyan-600 dark:text-cyan-300' : 'text-slate-500'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step > s ? 'bg-emerald-500 text-white' : step === s ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                }`}>{step > s ? <Check className="w-3 h-3" /> : s}</span>
                <span className="font-medium">{s === 1 ? 'Тариф' : s === 2 ? 'Период' : 'Оплата'}</span>
              </div>
              {s < 3 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* STEP 1 — выбор тарифа */}
          {step === 1 && (
            <div className="space-y-3">
              {plansLoading && (
                <div className="flex items-center justify-center py-12 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка тарифов…
                </div>
              )}
              {!plansLoading && plans.length === 0 && (
                <div className="text-center py-10 text-slate-500 text-sm">Нет доступных тарифов</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {plans.map(p => {
                  const isCurrent = currentPlan && p.id === currentPlan.id
                  const isSelected = targetPlan?.id === p.id
                  const tierDiff = currentPlan ? (p.tier - currentPlan.tier) : 0
                  return (
                    <button
                      key={p.id}
                      onClick={() => !isCurrent && setTargetPlan(p)}
                      disabled={isCurrent}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/5 shadow-lg shadow-cyan-500/20'
                          : isCurrent
                            ? 'border-emerald-500/40 bg-emerald-500/5 cursor-not-allowed opacity-70'
                            : 'border-sky-200 dark:border-slate-700/60 bg-sky-50/50 dark:bg-slate-800/30 hover:border-cyan-500/60 hover:bg-cyan-500/5'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${tierGradient(p.tier)} flex items-center justify-center text-white text-[11px] font-bold`}>
                            {p.tier}
                          </div>
                          {isCurrent && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">текущий</span>}
                          {!isCurrent && tierDiff > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/20 text-blue-700 dark:text-blue-300 flex items-center gap-0.5"><ArrowUp className="w-2.5 h-2.5" />upgrade</span>}
                          {!isCurrent && tierDiff < 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center gap-0.5"><ArrowDown className="w-2.5 h-2.5" />downgrade</span>}
                          {!isCurrent && tierDiff === 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-500/20 text-slate-600 dark:text-slate-300 flex items-center gap-0.5"><ArrowLeftRight className="w-2.5 h-2.5" />swap</span>}
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-cyan-500" />}
                      </div>
                      <div className="font-bold text-sky-900 dark:text-white text-base">{p.name}</div>
                      {p.tier_label && <div className="text-[10px] uppercase tracking-wide text-slate-500">{p.tier_label}</div>}
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-xl font-bold text-cyan-600 dark:text-cyan-400">{fmtPrice(p.price_monthly)}</span>
                        <span className="text-xs text-slate-500">/ мес</span>
                      </div>
                      <div className="mt-1 text-xs text-sky-700 dark:text-slate-400">
                        {p.traffic_gb} ГБ · {Array.isArray(p.squad_uuids) ? p.squad_uuids.length : 0} серверов
                      </div>
                      {p.description && <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{p.description}</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* STEP 2 — период */}
          {step === 2 && targetPlan && (
            <div className="space-y-3">
              <div className="text-sm text-sky-700 dark:text-slate-400 mb-3">
                Выберите как изменить срок подписки:
              </div>
              {PERIOD_OPTIONS.map(opt => (
                <label
                  key={opt.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    period === opt.id
                      ? 'border-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/5'
                      : 'border-sky-200 dark:border-slate-700/60 bg-sky-50/30 dark:bg-slate-800/30 hover:border-cyan-500/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="period"
                    value={opt.id}
                    checked={period === opt.id}
                    onChange={() => setPeriod(opt.id)}
                    className="mt-0.5 accent-cyan-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sky-900 dark:text-slate-200">{opt.label}</div>
                    <div className="text-xs text-sky-700 dark:text-slate-400 mt-0.5">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* STEP 3 — расчёт + оплата */}
          {step === 3 && targetPlan && (
            <div className="space-y-4">
              {calcLoading && (
                <div className="flex items-center justify-center py-8 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Считаю…
                </div>
              )}
              {calcError && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                  {calcError}
                </div>
              )}
              {calc?.ok && (
                <div className="space-y-3">
                  {/* Тип операции */}
                  <div className={`px-4 py-3 rounded-xl border text-sm ${
                    calc.type === 'upgrade'   ? 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-200' :
                    calc.type === 'downgrade' ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-200' :
                    calc.type === 'swap'      ? 'bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-200' :
                                                'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-200'
                  }`}>
                    <div className="font-semibold mb-1 capitalize">
                      {calc.type === 'upgrade' && '⬆ Upgrade'}
                      {calc.type === 'downgrade' && '⬇ Downgrade'}
                      {calc.type === 'swap' && '↔ Swap (тот же уровень)'}
                      {calc.type === 'renew' && '↻ Активация'}
                      : {calc.currentPlan?.name || '—'} → <b>{calc.targetPlan.name}</b>
                    </div>
                    {calc.warnings.length > 0 && (
                      <ul className="text-xs space-y-0.5 mt-2 opacity-80">
                        {calc.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                      </ul>
                    )}
                  </div>

                  {/* Расчёт */}
                  <div className="rounded-xl border border-sky-200 dark:border-slate-700/60 overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-sky-200 dark:divide-slate-800/60">
                        <tr>
                          <td className="px-4 py-2 text-sky-700 dark:text-slate-400">Осталось дней на текущем</td>
                          <td className="px-4 py-2 text-right font-mono text-sky-900 dark:text-slate-200">{calc.daysLeft}</td>
                        </tr>
                        {calc.refundCredit > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-sky-700 dark:text-slate-400">Кредит за неиспользованные дни</td>
                            <td className="px-4 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">−{calc.refundCredit.toFixed(2)} ₽</td>
                          </tr>
                        )}
                        {calc.newCostForRemaining > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-sky-700 dark:text-slate-400">Стоимость нового на оставшийся срок</td>
                            <td className="px-4 py-2 text-right font-mono text-sky-900 dark:text-slate-200">+{calc.newCostForRemaining.toFixed(2)} ₽</td>
                          </tr>
                        )}
                        {calc.addCost > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-sky-700 dark:text-slate-400">Добавочный период (+{calc.addDays} дн.)</td>
                            <td className="px-4 py-2 text-right font-mono text-sky-900 dark:text-slate-200">+{calc.addCost.toFixed(2)} ₽</td>
                          </tr>
                        )}
                        <tr className="bg-sky-50 dark:bg-slate-800/40">
                          <td className="px-4 py-3 font-bold text-sky-900 dark:text-white">К оплате</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-2xl text-cyan-600 dark:text-cyan-400">{calc.payDifference.toFixed(2)} ₽</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-sky-700 dark:text-slate-400">Срок после смены</td>
                          <td className="px-4 py-2 text-right font-mono text-sky-900 dark:text-slate-200">
                            {fmtDate(calc.newExpiresAt)} ({calc.newDaysLeft} дн.)
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Admin-mode notice */}
                  {adminMode && calc.payDifference > 0 && (
                    <div className="px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/30 text-sm text-violet-700 dark:text-violet-200">
                      <Check className="w-4 h-4 inline mr-1" />
                      Админ-режим: смена применится <b>бесплатно</b> для пользователя — без списания средств
                    </div>
                  )}

                  {/* Способ оплаты */}
                  {!adminMode && calc.payDifference > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Способ оплаты</div>
                      <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        paymentMethod === 'balance'
                          ? 'border-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/5'
                          : 'border-sky-200 dark:border-slate-700/60 bg-sky-50/30 dark:bg-slate-800/30'
                      } ${!calc.canPayFromBalance ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <input
                          type="radio"
                          name="pm"
                          value="balance"
                          checked={paymentMethod === 'balance'}
                          onChange={() => setPaymentMethod('balance')}
                          disabled={!calc.canPayFromBalance}
                          className="accent-cyan-500"
                        />
                        <Wallet className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                        <div className="flex-1">
                          <div className="font-medium text-sky-900 dark:text-slate-200">С баланса</div>
                          <div className="text-xs text-sky-700 dark:text-slate-400">Доступно: {calc.balance.toFixed(2)} ₽{!calc.canPayFromBalance ? ' — недостаточно' : ''}</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        paymentMethod === 'gateway'
                          ? 'border-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/5'
                          : 'border-sky-200 dark:border-slate-700/60 bg-sky-50/30 dark:bg-slate-800/30'
                      }`}>
                        <input
                          type="radio"
                          name="pm"
                          value="gateway"
                          checked={paymentMethod === 'gateway'}
                          onChange={() => setPaymentMethod('gateway')}
                          className="accent-cyan-500"
                        />
                        <CreditCard className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                        <div className="flex-1">
                          <div className="font-medium text-sky-900 dark:text-slate-200">Картой через Platega</div>
                          <div className="text-xs text-sky-700 dark:text-slate-400">Перенаправление в платёжный шлюз</div>
                        </div>
                      </label>
                    </div>
                  )}

                  {calc.payDifference === 0 && (
                    <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-700 dark:text-emerald-200">
                      <Check className="w-4 h-4 inline mr-1" />
                      Смена бесплатна — применится сразу
                    </div>
                  )}
                </div>
              )}
              {submitError && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                  {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-sky-200 dark:border-slate-700/60 flex justify-between gap-2">
          <button
            onClick={() => step === 1 ? onClose() : setStep(step - 1)}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm text-sky-700 dark:text-slate-300 hover:text-sky-900 dark:hover:text-white bg-sky-100 dark:bg-slate-800/60 hover:bg-sky-200 dark:hover:bg-slate-800 border border-sky-200 dark:border-slate-700/60 inline-flex items-center gap-1.5"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {step === 1 ? 'Отмена' : 'Назад'}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 && !targetPlan}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Далее
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={apply}
              disabled={submitting || calcLoading || !calc?.ok}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-40"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {adminMode
                ? 'Применить смену (admin)'
                : (calc?.payDifference === 0 ? 'Применить бесплатно' : `Подтвердить и оплатить ${calc?.payDifference?.toFixed(0) || '?'} ₽`)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
