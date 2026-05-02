/**
 * Cron: периодический sync per-squad usage + enforce политики (disable/reactivate).
 * Интервал — settings.squad_quota_interval_minutes (default 10).
 */
const db = require('../db')
const { runScan } = require('../services/squadQuota')

let timer = null
let currentInterval = 0

async function tick() {
  try {
    await runScan()
  } catch (err) {
    console.error('[SquadQuota] tick error:', err.message)
  }
}

async function getIntervalMinutes() {
  try {
    const r = await db.query('SELECT squad_quota_interval_minutes FROM traffic_guard_settings WHERE id=1')
    return r.rows[0]?.squad_quota_interval_minutes || 10
  } catch { return 10 }
}

async function reschedule() {
  const minutes = await getIntervalMinutes()
  if (minutes === currentInterval) return
  if (timer) clearInterval(timer)
  currentInterval = minutes
  timer = setInterval(tick, minutes * 60 * 1000)
  console.log(`[SquadQuota] rescheduled: tick every ${minutes} min`)
}

async function start() {
  await reschedule()
  setInterval(reschedule, 5 * 60 * 1000)
  console.log('[SquadQuota] watchdog started')
}

module.exports = { start, tick, runScan }
