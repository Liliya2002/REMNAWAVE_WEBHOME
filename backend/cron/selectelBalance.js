/**
 * Cron: индикатор низкого баланса Selectel.
 *
 * Раз в N минут (по умолчанию 60) читает баланс каждого активного аккаунта
 * Selectel, у которого задан порог (low_balance_threshold, ₽). Если баланс упал
 * ниже порога — шлёт админу уведомление в Telegram (admin_selectel_low_balance)
 * ОДИН раз (флаг low_balance_notified). Когда баланс снова поднимается выше
 * порога — флаг сбрасывается, чтобы алерт мог сработать при следующем падении.
 *
 * Сетевые ошибки/недоступность billing → аккаунт пропускается (состояние и
 * баланс не меняются), чтобы не было ложных срабатываний.
 *
 * Выключить: SELECTEL_BALANCE_CHECK_ENABLED=false.
 */
const db = require('../db')
const selectel = require('../services/selectel')
const tgNotify = require('../services/telegramBot/notify')

const TICK_MINUTES = parseInt(process.env.SELECTEL_BALANCE_INTERVAL_MIN || '60', 10)
const ENABLED = process.env.SELECTEL_BALANCE_CHECK_ENABLED !== 'false'

const fmtRub = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function checkOne(acc) {
  const threshold = Number(acc.low_balance_threshold)
  if (!threshold || threshold <= 0) return { skipped: true }

  const r = await selectel.getBalance(acc)
  if (!r.ok) return { skipped: true, error: r.error }        // сеть/ошибка — состояние не трогаем
  const total = selectel.balanceTotalRub(r.balance)
  if (total == null) return { skipped: true }

  const now = new Date()
  const low = total < threshold

  if (low && !acc.low_balance_notified) {
    await db.query(
      'UPDATE selectel_accounts SET last_balance_rub=$2, balance_checked_at=$3, low_balance_notified=true WHERE id=$1',
      [acc.id, total, now]
    )
    tgNotify.notifyAdmin('admin_selectel_low_balance', {
      account: escapeHtml(acc.name),
      balance: fmtRub(total),
      threshold: fmtRub(threshold),
    }).catch(e => console.warn('[Selectel-balance] notify error:', e.message))
    return { changed: true, low: true, total }
  }

  if (!low && acc.low_balance_notified) {
    // Баланс восстановился — снимаем флаг (следующее падение снова уведомит).
    await db.query(
      'UPDATE selectel_accounts SET last_balance_rub=$2, balance_checked_at=$3, low_balance_notified=false WHERE id=$1',
      [acc.id, total, now]
    )
    return { changed: true, low: false, total }
  }

  // Без смены состояния — просто фиксируем баланс и время.
  await db.query(
    'UPDATE selectel_accounts SET last_balance_rub=$2, balance_checked_at=$3 WHERE id=$1',
    [acc.id, total, now]
  )
  return { changed: false, low, total }
}

async function tick() {
  try {
    const { rows } = await db.query(
      `SELECT * FROM selectel_accounts
        WHERE is_active = true AND api_key IS NOT NULL
          AND low_balance_threshold IS NOT NULL AND low_balance_threshold > 0`
    )
    if (rows.length === 0) return
    const stats = { checked: 0, low: 0, changed: 0, skipped: 0 }
    for (const acc of rows) {
      try {
        const res = await checkOne(acc)
        if (res.skipped) stats.skipped++
        else { stats.checked++; if (res.low) stats.low++; if (res.changed) stats.changed++ }
      } catch (e) {
        console.warn(`[Selectel-balance] checkOne(${acc.name}) error:`, e.message)
      }
    }
    if (stats.changed > 0) {
      console.log(`[Selectel-balance cron] tick: checked=${stats.checked}, low=${stats.low}, changed=${stats.changed}, skipped=${stats.skipped}`)
    }
  } catch (e) {
    console.error('[Selectel-balance cron] tick error:', e.message)
  }
}

function start() {
  if (!ENABLED) {
    console.log('[Selectel-balance cron] отключён через SELECTEL_BALANCE_CHECK_ENABLED=false')
    return
  }
  setTimeout(tick, 45 * 1000)
  setInterval(tick, TICK_MINUTES * 60 * 1000)
  console.log(`[Selectel-balance cron] запущен, интервал ${TICK_MINUTES} мин`)
}

module.exports = { start, tick }
