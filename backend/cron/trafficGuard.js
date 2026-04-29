/**
 * Cron: периодическая проверка превышений per-node лимитов трафика.
 * Интервал берётся из traffic_guard_settings.cron_interval_minutes (default 15).
 * Если settings.enabled=false — tick'и просто пропускаются (без падений).
 *
 * Запускается из backend/index.js при старте процесса.
 */
const db = require('../db')
const { runCheck } = require('../services/trafficGuard')

let timer = null
let currentInterval = 0

async function tick() {
  try {
    const result = await runCheck()
    if (result?.ok) {
      if (result.usersChecked > 0) {
        console.log(`[TrafficGuard] check ok: ${JSON.stringify(result)}`)
      }
    }
  } catch (e) {
    console.error('[TrafficGuard] tick error:', e.message)
  }
}

async function getIntervalMinutes() {
  try {
    const r = await db.query('SELECT cron_interval_minutes FROM traffic_guard_settings WHERE id=1')
    return r.rows[0]?.cron_interval_minutes || 15
  } catch {
    return 15
  }
}

async function reschedule() {
  const minutes = await getIntervalMinutes()
  if (minutes === currentInterval) return
  if (timer) clearInterval(timer)
  currentInterval = minutes
  timer = setInterval(tick, minutes * 60 * 1000)
  console.log(`[TrafficGuard] rescheduled: tick every ${minutes} min`)
}

async function start() {
  await reschedule()
  // Перепроверяем интервал раз в 5 минут — если админ поменял в настройках, подхватим
  setInterval(reschedule, 5 * 60 * 1000)
  console.log('[TrafficGuard] watchdog started')
}

module.exports = { start, tick, runCheck }
