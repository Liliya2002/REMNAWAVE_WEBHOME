/**
 * planChange — логика расчёта стоимости смены тарифа (upgrade/downgrade/swap).
 *
 * Ключевые правила (согласованы с продакт-владельцем v0.1.5):
 *   1. Downgrade — больше дней без возврата на баланс.
 *      Конвертируем оставшийся «кредит» (refund-virtual) в дни нового, более дешёвого тарифа.
 *   2. Сохраняем traffic_used при смене тарифа (только лимит обновляется).
 *      Иначе можно качать по полной → менять тариф → качать ещё.
 *   3. Swap внутри одного tier'а разрешён. Если цены отличаются — пересчёт по тем же правилам.
 *
 * Период (period):
 *   - 'remaining' — apply на текущие оставшиеся дни (только разница за оставшийся срок)
 *   - 'monthly' / 'quarterly' / 'yearly' — оставшиеся дни + добавочный период
 *
 * Расчёт:
 *   daysLeft = ceil((expires_at - now) / 1 day)   // 0 если уже истекло
 *   dailyOld = price_monthly_old / 30
 *   dailyNew = price_monthly_new / 30
 *
 *   refund    = daysLeft × dailyOld    // виртуальный кредит за неисп. дни старого
 *   newCostA  = daysLeft × dailyNew    // стоимость на оставшийся срок на новом
 *
 *   --- UPGRADE / SAME-TIER (dailyNew >= dailyOld) ---
 *   payDifference = max(0, newCostA - refund)
 *   newDaysLeft   = daysLeft (срок не меняется при 'remaining')
 *
 *   --- DOWNGRADE (dailyNew < dailyOld) ---
 *   payDifference = 0  (никогда не доплачиваем при понижении)
 *   newDaysLeft   = floor(refund / dailyNew)  (больше дней)
 *
 *   --- ДОБАВОЧНЫЙ ПЕРИОД (period != 'remaining') ---
 *   addDays    = 30 / 91 / 365 в зависимости от period
 *   addCost    = price_period_new   (цена нового тарифа за этот период)
 *   payDifference += addCost
 *   newDaysLeft   += addDays
 *
 *   newExpiresAt  = now + newDaysLeft × 1 day
 */
const PERIOD_DAYS = {
  monthly:   30,
  quarterly: 91,
  yearly:    365,
}

const PERIOD_PRICE_KEY = {
  monthly:   'price_monthly',
  quarterly: 'price_quarterly',
  yearly:    'price_yearly',
}

function dailyPrice(plan) {
  // Базис — месячная цена. Если её нет (бывает у trial) → 0.
  const m = Number(plan?.price_monthly || 0)
  if (m > 0) return m / 30
  // Fallback: ежегодная / 365
  const y = Number(plan?.price_yearly || 0)
  if (y > 0) return y / 365
  const q = Number(plan?.price_quarterly || 0)
  if (q > 0) return q / 91
  return 0
}

function daysBetween(later, earlier) {
  const ms = new Date(later).getTime() - new Date(earlier).getTime()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

/**
 * Вычисляет стоимость смены тарифа и новую дату истечения.
 *
 * @param {Object} args
 * @param {Object} args.subscription — { id, plan_id, plan_name, expires_at, traffic_limit_gb, traffic_used_gb, ... }
 * @param {Object} args.currentPlan  — current plan row (или null если plan_id потерян)
 * @param {Object} args.targetPlan   — target plan row (must be active, не trial)
 * @param {string} args.period       — 'remaining' | 'monthly' | 'quarterly' | 'yearly'
 * @returns {Object} полный preview расчёта
 */
function calculateChange({ subscription, currentPlan, targetPlan, period = 'remaining' }) {
  if (!subscription) throw new Error('subscription required')
  if (!targetPlan)   throw new Error('targetPlan required')
  if (targetPlan.is_trial) {
    return { ok: false, error: 'Cannot change to trial plan' }
  }
  if (!targetPlan.is_active) {
    return { ok: false, error: 'Target plan is not active' }
  }
  if (currentPlan && targetPlan.id === currentPlan.id && period === 'remaining') {
    return { ok: false, error: 'Same plan and no period — nothing to change' }
  }

  const now = new Date()
  const daysLeft = subscription.expires_at ? daysBetween(subscription.expires_at, now) : 0

  const dailyOld = currentPlan ? dailyPrice(currentPlan) : 0
  const dailyNew = dailyPrice(targetPlan)

  // Тип операции
  const oldTier = currentPlan?.tier ?? 0
  const newTier = targetPlan.tier ?? 0
  let type
  if (!currentPlan)             type = 'renew'        // подписка без plan — новый старт
  else if (newTier > oldTier)   type = 'upgrade'
  else if (newTier < oldTier)   type = 'downgrade'
  else                          type = 'swap'         // тот же tier, разные планы

  // Виртуальный «кредит» от текущего тарифа за неиспользованные дни
  const refundCredit = +(daysLeft * dailyOld).toFixed(2)
  const newCostForRemaining = +(daysLeft * dailyNew).toFixed(2)

  // Базовая «доплата за оставшиеся дни» для upgrade/swap (downgrade всегда даёт 0)
  const isCheaper = dailyNew < dailyOld - 0.001
  let payDifference = 0
  let newDaysLeft = daysLeft

  if (isCheaper) {
    // Downgrade или дешёвый swap — конвертируем кредит в больше дней
    payDifference = 0
    newDaysLeft = dailyNew > 0 ? Math.floor(refundCredit / dailyNew) : daysLeft
  } else {
    // Upgrade или дорогой swap — доплачиваем разницу за оставшийся срок
    payDifference = Math.max(0, +(newCostForRemaining - refundCredit).toFixed(2))
    newDaysLeft = daysLeft
  }

  // Добавочный период
  let addDays = 0
  let addCost = 0
  if (period !== 'remaining') {
    addDays = PERIOD_DAYS[period]
    if (!addDays) {
      return { ok: false, error: `Invalid period: ${period}` }
    }
    const priceKey = PERIOD_PRICE_KEY[period]
    addCost = Number(targetPlan[priceKey] || 0)
    if (!addCost) {
      return { ok: false, error: `Target plan has no price for period ${period}` }
    }
    payDifference = +(payDifference + addCost).toFixed(2)
    newDaysLeft += addDays
  }

  // Если новая дата вышла в прошлое (теоретически) — fallback на now
  const newExpiresAt = new Date(now.getTime() + newDaysLeft * 24 * 60 * 60 * 1000)

  // Warnings
  const warnings = []
  if (daysLeft <= 0)   warnings.push('Подписка уже истекла — расчёт начинается с сегодняшнего дня')
  if (daysLeft > 0 && daysLeft < 1) warnings.push('До истечения меньше суток — выгоднее дождаться окончания')
  if (isCheaper && daysLeft > 0 && period === 'remaining' && dailyNew === 0) {
    warnings.push('У целевого тарифа нет цены — пропорциональный downgrade невозможен')
  }

  return {
    ok: true,
    type,
    period,
    daysLeft,
    addDays,
    newDaysLeft,
    newExpiresAt: newExpiresAt.toISOString(),
    refundCredit,
    newCostForRemaining,
    addCost,
    payDifference,
    isCheaper,
    warnings,
    currentPlan: currentPlan ? { id: currentPlan.id, name: currentPlan.name, tier: currentPlan.tier, price_monthly: currentPlan.price_monthly, traffic_gb: currentPlan.traffic_gb } : null,
    targetPlan: {
      id: targetPlan.id,
      name: targetPlan.name,
      tier: targetPlan.tier,
      tier_label: targetPlan.tier_label,
      price_monthly: targetPlan.price_monthly,
      price_quarterly: targetPlan.price_quarterly,
      price_yearly: targetPlan.price_yearly,
      traffic_gb: targetPlan.traffic_gb,
      squad_uuids: targetPlan.squad_uuids,
    },
  }
}

module.exports = { calculateChange, dailyPrice, daysBetween, PERIOD_DAYS, PERIOD_PRICE_KEY }
