/**
 * Синхронизация активаций промокодов Bedolaga в нашу базу.
 *
 * Зачем: Web Admin API бота отдаёт по каждому промокоду только 10 последних
 * активаций и не умеет их пагинировать. Регулярно опрашивая и складывая к себе,
 * со временем набираем историю глубже десяти записей.
 *
 * Настройки читаются на каждом тике (интервал меняется в админке без
 * перезапуска, как у vpsHealth).
 */
const db = require('../db')
const bedolaga = require('../services/bedolaga')

const TAG = '[Bedolaga-promo cron]'

async function settings() {
  const r = await db.query(
    `SELECT COALESCE(bedolaga_promo_sync_enabled, false)      AS enabled,
            COALESCE(bedolaga_promo_sync_interval_min, 60)    AS interval_min
       FROM site_config LIMIT 1`
  )
  const row = r.rows[0] || {}
  return {
    enabled: !!row.enabled,
    intervalMin: Math.min(Math.max(Number(row.interval_min) || 60, 5), 1440),
  }
}

async function tick() {
  try {
    const cfg = await settings()
    if (!cfg.enabled) return

    const accs = await db.query('SELECT * FROM bedolaga_accounts WHERE is_active = true ORDER BY id')
    for (const a of accs.rows) {
      try {
        const res = await bedolaga.syncPromoUses(db, a)
        if (!res.ok) {
          // Ошибку кладём в состояние, чтобы она была видна в админке,
          // а не только в логах контейнера.
          await db.query(
            `INSERT INTO bedolaga_promo_sync_state (account_id, last_run_at, status, error)
             VALUES ($1, NOW(), 'error', $2)
             ON CONFLICT (account_id) DO UPDATE
               SET last_run_at = NOW(), status = 'error', error = EXCLUDED.error`,
            [a.id, String(res.error).slice(0, 500)]
          )
          console.warn(`${TAG} ${a.name}: ${res.error}`)
          continue
        }
        const miss = res.missedNow ? `, ПОТЕРЯНО ${res.missedNow}` : ''
        console.log(`${TAG} ${a.name}: кодов ${res.codes}, новых активаций ${res.added}${miss}`)
      } catch (e) {
        console.error(`${TAG} ${a.name} ошибка:`, e.message)
      }
    }
  } catch (e) {
    console.error(`${TAG} tick error:`, e.message)
  }
}

let timer = null

async function schedule() {
  const cfg = await settings()
  if (timer) { clearInterval(timer); timer = null }
  if (!cfg.enabled) {
    console.log(`${TAG} отключён в настройках`)
    return
  }
  timer = setInterval(tick, cfg.intervalMin * 60 * 1000)
  console.log(`${TAG} интервал ${cfg.intervalMin} мин`)
}

function start() {
  // Первый прогон с задержкой — не мешаем старту backend'а
  setTimeout(tick, 45 * 1000)
  schedule().catch(err => console.error(`${TAG} schedule error:`, err.message))
}

// Вызывается после сохранения настроек в админке
function reschedule() {
  return schedule().catch(err => console.error(`${TAG} reschedule error:`, err.message))
}

module.exports = { start, tick, reschedule }
