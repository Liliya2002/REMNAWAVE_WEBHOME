/**
 * Цена тарифа за период.
 *
 * Вынесено из routes/payments.js: тем же расчётом пользуется предпросмотр
 * промокода (routes/promo.js), а тянуть роут из роута — плохая связность.
 * Цена должна считаться в одном месте, иначе предпросмотр однажды покажет
 * одну сумму, а счёт выставится на другую.
 */
const db = require('../db')

// Ниже этой суммы шлюз платёж не проведёт (у СБП есть свой минимум). Скидка
// легко уводит заказ в такую зону, поэтому нужен явный порог: точное значение
// Platega в документации не публикует — ПРОВЕРИТЬ на проде, пока берём тот же
// минимум, что действует для пополнения баланса.
const MIN_GATEWAY_AMOUNT = 10

const PERIODS = ['monthly', 'quarterly', 'yearly']

const PERIOD_LABELS = {
  monthly: 'месяц',
  quarterly: '3 месяца',
  yearly: 'год',
}

/**
 * @throws если тариф не найден, отключён, пробный или не продаётся на период
 * @returns {{plan: object, amount: number}}
 */
async function getPlanAndAmount(planId, period) {
  const planResult = await db.query(
    'SELECT * FROM plans WHERE id = $1 AND is_active = true',
    [planId]
  )

  if (planResult.rows.length === 0) {
    throw new Error('Plan not found or inactive')
  }

  const plan = planResult.rows[0]
  if (plan.is_trial) {
    throw new Error('Cannot create payment for trial plan')
  }

  let amount = null
  switch (period) {
    case 'monthly':
      amount = plan.price_monthly
      break
    case 'quarterly':
      amount = plan.price_quarterly
      break
    case 'yearly':
      amount = plan.price_yearly
      break
    default:
      amount = null
  }

  if (!amount || Number(amount) <= 0) {
    throw new Error(`This plan does not support ${period} payments`)
  }

  return { plan, amount: Number(amount) }
}

module.exports = { getPlanAndAmount, PERIODS, PERIOD_LABELS, MIN_GATEWAY_AMOUNT }
