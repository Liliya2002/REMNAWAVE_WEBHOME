/**
 * Cron: периодическая деактивация истёкших подписок и уведомления.
 *
 * - Раз в N минут (по умолчанию 5) находит подписки с истёкшим expires_at и is_active=true
 *   и проставляет is_active=false. На каждую такую подписку шлёт уведомление пользователю.
 * - Раз в час (в начале часа) находит подписки, истекающие в ближайшие 3 дня, и шлёт
 *   уведомление "скоро истечёт" — но не чаще одного раза на подписку (флаг expiry_notice_sent_at).
 *
 * Запускается из backend/index.js при старте процесса.
 */
const db = require('../db')
const { notifySubscriptionExpired, notifySubscriptionExpiring } = require('../services/notifications')

const TICK_MINUTES = parseInt(process.env.CRON_EXPIRE_INTERVAL_MIN || '5', 10)

let lastWarnTickHour = -1

async function deactivateExpired() {
  const { rows } = await db.query(
    `UPDATE subscriptions
       SET is_active = false, updated_at = NOW()
     WHERE is_active = true
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()
     RETURNING id, user_id, plan_name`
  )

  for (const sub of rows) {
    try {
      await notifySubscriptionExpired(sub.user_id, { planName: sub.plan_name })
    } catch (e) {
      console.error('[Cron] notifySubscriptionExpired failed:', e.message)
    }
  }

  if (rows.length > 0) {
    console.log(`[Cron] Деактивировано подписок: ${rows.length}`)
  }
  return rows.length
}

async function notifyExpiringSoon() {
  // Каждый раз шлём только тем, кому ещё не слали уведомление об истечении в этом цикле подписки.
  const { rows } = await db.query(
    `SELECT id, user_id, plan_name, expires_at
       FROM subscriptions
      WHERE is_active = true
        AND expires_at IS NOT NULL
        AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '3 days'
        AND (expiry_notice_sent_at IS NULL OR expiry_notice_sent_at < created_at)`
  )

  for (const sub of rows) {
    const daysLeft = Math.max(1, Math.ceil((new Date(sub.expires_at) - new Date()) / 86400000))
    try {
      await notifySubscriptionExpiring(sub.user_id, { planName: sub.plan_name, daysLeft })
      await db.query(`UPDATE subscriptions SET expiry_notice_sent_at = NOW() WHERE id = $1`, [sub.id])
    } catch (e) {
      console.error('[Cron] notifySubscriptionExpiring failed:', e.message)
    }
  }

  if (rows.length > 0) {
    console.log(`[Cron] Отправлено уведомлений "скоро истечёт": ${rows.length}`)
  }
  return rows.length
}

async function tick() {
  try {
    await deactivateExpired()
    // Уведомление "скоро истечёт" — раз в час, в первые 5 минут часа,
    // чтобы не спамить юзеров каждые 5 минут.
    const h = new Date().getHours()
    if (h !== lastWarnTickHour) {
      lastWarnTickHour = h
      await notifyExpiringSoon()
    }
  } catch (e) {
    console.error('[Cron] tick error:', e.message)
  }
}

function start() {
  // Схема (колонка expiry_notice_sent_at) создаётся миграцией 0022_subscription_expiry_notice.
  // Сразу прогоняем на старте
  tick()
  setInterval(tick, TICK_MINUTES * 60 * 1000)
  console.log(`[Cron] Subscription expiry checker запущен, интервал ${TICK_MINUTES} мин.`)
}

module.exports = { start, deactivateExpired, notifyExpiringSoon }
