/**
 * Cron: индикатор низкого баланса Yandex Cloud.
 *
 * Раз в N минут (по умолчанию 60) читает баланс billing-аккаунта у каждого
 * активного аккаунта YC, где задан порог (low_balance_threshold, ₽). Если баланс
 * упал ниже — шлёт админу уведомление в Telegram (admin_yc_low_balance) ОДИН раз
 * (флаг low_balance_notified). Когда баланс поднимается выше порога, флаг
 * сбрасывается, и следующее падение снова уведомит.
 *
 * Устроен как близнец cron/selectelBalance.js: те же поля, та же логика флага,
 * то же поведение при ошибках. Расхождение в поведении двух индикаторов баланса
 * потом обошлось бы дороже, чем дублирование кода.
 *
 * Ошибка сети или биллинга → аккаунт пропускается, состояние не трогаем.
 * Недоступный API — это не «баланс кончился», и уведомлять об этом нельзя.
 *
 * Выключить: YC_BALANCE_CHECK_ENABLED=false.
 */
const db = require('../db')
const billing = require('../services/yandexCloud/billing')
const { ycClient } = require('../services/yandexCloud/client')
const tgNotify = require('../services/telegramBot/notify')

const TICK_MINUTES = parseInt(process.env.YC_BALANCE_INTERVAL_MIN || '60', 10)
const ENABLED = process.env.YC_BALANCE_CHECK_ENABLED !== 'false'

const fmtRub = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Пора ли слать уведомление.
 *
 * Первый раз — при падении ниже порога. Дальше молчим, пока не пройдёт
 * интервал повтора (0 = не повторять, прежнее поведение). Отсчёт ведём от
 * времени ПОСЛЕДНЕЙ отправки, а не от начала падения: иначе после включения
 * повтора у давно минусового аккаунта разом ушла бы пачка «просроченных»
 * напоминаний.
 */
function shouldNotify(acc, now) {
  if (!acc.low_balance_notified) return true
  const repeatH = Number(acc.low_balance_repeat_hours) || 0
  if (repeatH <= 0) return false
  const last = acc.low_balance_notified_at ? new Date(acc.low_balance_notified_at).getTime() : null
  if (!last) return true          // повтор включили после того, как уведомили
  return now.getTime() - last >= repeatH * 3600 * 1000
}

async function checkOne(acc) {
  const threshold = Number(acc.low_balance_threshold)
  if (!threshold || threshold <= 0) return { skipped: true }
  if (!acc.billing_account_id) return { skipped: true, error: 'billing_account_id не задан' }

  let info
  try {
    const yc = await ycClient(acc.id)
    info = await billing.getBillingAccount(yc, acc.billing_account_id)
  } catch (e) {
    // Протухший OAuth, недоступный API, нет прав на биллинг — пропускаем.
    return { skipped: true, error: e.message }
  }

  const total = info?.balance
  if (total == null || !isFinite(Number(total))) return { skipped: true }

  // Порог задаётся в рублях; на аккаунте в другой валюте сравнение было бы
  // бессмысленным, поэтому такие просто пропускаем.
  if (info.currency && info.currency !== 'RUB') {
    return { skipped: true, error: `валюта ${info.currency}, порог задан в ₽` }
  }

  const now = new Date()
  const low = Number(total) < threshold

  if (low && shouldNotify(acc, now)) {
    await db.query(
      `UPDATE yc_accounts SET last_balance_rub=$2, balance_checked_at=$3,
              low_balance_notified=true, low_balance_notified_at=$3 WHERE id=$1`,
      [acc.id, total, now]
    )
    tgNotify.notifyAdmin('admin_yc_low_balance', {
      account: escapeHtml(acc.name),
      balance: fmtRub(total),
      threshold: fmtRub(threshold),
    }).catch(e => console.warn('[YC-balance] notify error:', e.message))
    return { changed: true, low: true, total }
  }

  if (!low && acc.low_balance_notified) {
    // Баланс восстановился — снимаем флаг, чтобы следующее падение уведомило.
    await db.query(
      `UPDATE yc_accounts SET last_balance_rub=$2, balance_checked_at=$3,
              low_balance_notified=false, low_balance_notified_at=NULL WHERE id=$1`,
      [acc.id, total, now]
    )
    return { changed: true, low: false, total }
  }

  await db.query(
    'UPDATE yc_accounts SET last_balance_rub=$2, balance_checked_at=$3 WHERE id=$1',
    [acc.id, total, now]
  )
  return { changed: false, low, total }
}

async function tick() {
  try {
    const { rows } = await db.query(
      `SELECT * FROM yc_accounts
        WHERE is_active = true AND billing_account_id IS NOT NULL
          AND low_balance_threshold IS NOT NULL AND low_balance_threshold > 0`
    )
    if (rows.length === 0) return

    const stats = { checked: 0, low: 0, changed: 0, skipped: 0 }
    for (const acc of rows) {
      try {
        const res = await checkOne(acc)
        if (res.skipped) {
          stats.skipped++
          if (res.error) console.warn(`[YC-balance] ${acc.name}: ${res.error}`)
        } else {
          stats.checked++
          if (res.low) stats.low++
          if (res.changed) stats.changed++
        }
      } catch (e) {
        console.warn(`[YC-balance] checkOne(${acc.name}) error:`, e.message)
      }
    }
    if (stats.changed > 0) {
      console.log(`[YC-balance cron] tick: checked=${stats.checked}, low=${stats.low}, changed=${stats.changed}, skipped=${stats.skipped}`)
    }
  } catch (e) {
    console.error('[YC-balance cron] tick error:', e.message)
  }
}

function start() {
  if (!ENABLED) {
    console.log('[YC-balance cron] отключён через YC_BALANCE_CHECK_ENABLED=false')
    return
  }
  // Со сдвигом относительно Selectel, чтобы два обхода биллинга не совпадали
  setTimeout(tick, 75 * 1000)
  setInterval(tick, TICK_MINUTES * 60 * 1000)
  console.log(`[YC-balance cron] запущен, интервал ${TICK_MINUTES} мин`)
}

module.exports = { start, tick, checkOne }
