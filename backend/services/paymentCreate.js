/**
 * Создание платежа за подписку — общая логика для веба (POST /api/payments/create)
 * и Telegram-бота. Пишет запись в `payments` с тем же форматом payload
 * (`userId|planId|period|paymentId`), поэтому вебхук Platega активирует подписку
 * одинаково независимо от точки входа.
 */
const db = require('../db')
const { createPayment } = require('./platega')

const PERIOD_LABELS = { monthly: 'месяц', quarterly: '3 месяца', yearly: 'год' }

async function getPlanAndAmount(planId, period) {
  const r = await db.query('SELECT * FROM plans WHERE id = $1 AND is_active = true AND is_trial = false', [planId])
  if (r.rows.length === 0) throw new Error('Тариф не найден или недоступен')
  const plan = r.rows[0]
  let amount = null
  if (period === 'monthly') amount = plan.price_monthly
  else if (period === 'quarterly') amount = plan.price_quarterly
  else if (period === 'yearly') amount = plan.price_yearly
  if (!amount || Number(amount) <= 0) throw new Error(`Тариф не поддерживает выбранный период`)
  return { plan, amount: Number(amount) }
}

/**
 * @returns {{ ok, error?, paymentId?, paymentUrl?, amount?, planName?, period?, expiresAt? }}
 */
async function createSubscriptionPayment(userId, planId, period) {
  if (!['monthly', 'quarterly', 'yearly'].includes(period)) {
    return { ok: false, error: 'Некорректный период оплаты' }
  }

  // Провайдер не настроен — это ошибка конфигурации, а не действий юзера.
  // Не показываем ему техническую причину, но кричим в лог, иначе поломка
  // выглядит как «кнопка не работает» и живёт незамеченной.
  const { platega } = await require('./paymentSettings').get()
  if (!platega.configured || !platega.enabled) {
    console.error(`\x1b[31m[Payments] Platega ${platega.configured ? 'отключена' : 'не настроена'} — оплата недоступна! Настройте в админке → Настройки → Платёжки\x1b[0m`)
    return { ok: false, error: 'Оплата временно недоступна. Мы уже разбираемся — напишите в поддержку.' }
  }

  let plan, amount
  try {
    ({ plan, amount } = await getPlanAndAmount(planId, period))
  } catch (e) {
    return { ok: false, error: e.message }
  }

  const ins = await db.query(
    `INSERT INTO payments
       (user_id, plan_id, amount, currency, period, payment_provider, status, payment_type, payment_source)
     VALUES ($1, $2, $3, 'RUB', $4, 'platega', 'pending', 'subscription', 'gateway')
     RETURNING id`,
    [userId, planId, amount, period]
  )
  const paymentId = ins.rows[0].id

  const description = `Оплата тарифа "${plan.name}" (${PERIOD_LABELS[period]})`
  const payload = `${userId}|${planId}|${period}|${paymentId}`

  let paymentData
  try {
    paymentData = await createPayment(amount, 'RUB', description, payload)
  } catch (e) {
    await db.query('UPDATE payments SET status = $1 WHERE id = $2', ['failed', paymentId]).catch(() => {})
    return { ok: false, error: 'Платёжный провайдер недоступен: ' + e.message }
  }

  const expiresInMs = (paymentData.expiresIn || 1800) * 1000
  const paymentExpiresAt = new Date(Date.now() + expiresInMs)
  await db.query(
    `UPDATE payments SET provider_payment_id = $1, payment_url = $2, payment_data = $3, expires_at = $4 WHERE id = $5`,
    [paymentData.transactionId, paymentData.redirectUrl, JSON.stringify(paymentData), paymentExpiresAt, paymentId]
  )

  return {
    ok: true, paymentId, paymentUrl: paymentData.redirectUrl,
    amount, planName: plan.name, period, expiresAt: paymentExpiresAt,
  }
}

module.exports = { createSubscriptionPayment, getPlanAndAmount, PERIOD_LABELS }
