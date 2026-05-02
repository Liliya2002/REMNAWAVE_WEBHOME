/**
 * Cron: периодический скан access.log на нодах для детекции P2P/torrent.
 *
 * Интервал — settings.p2p_scan_interval_minutes (default 5).
 * Если settings.p2p_detect_enabled=false — tick'и пропускаются.
 *
 * Запускается из backend/index.js при старте процесса.
 */
const db = require('../db')
const { runScan } = require('../services/p2pDetector')

let timer = null
let currentInterval = 0

async function tick() {
  try {
    const result = await runScan()
    if (result?.ok && result.usersDetected > 0) {
      console.log(`[P2PDetector] scan ok: ${JSON.stringify(result)}`)
    }
  } catch (e) {
    console.error('[P2PDetector] tick error:', e.message)
  }
}

async function getIntervalMinutes() {
  try {
    const r = await db.query('SELECT p2p_scan_interval_minutes FROM traffic_guard_settings WHERE id=1')
    return r.rows[0]?.p2p_scan_interval_minutes || 5
  } catch {
    return 5
  }
}

async function reschedule() {
  const minutes = await getIntervalMinutes()
  if (minutes === currentInterval) return
  if (timer) clearInterval(timer)
  currentInterval = minutes
  timer = setInterval(tick, minutes * 60 * 1000)
  console.log(`[P2PDetector] rescheduled: tick every ${minutes} min`)
}

async function start() {
  await reschedule()
  setInterval(reschedule, 5 * 60 * 1000)
  console.log('[P2PDetector] watchdog started')
}

module.exports = { start, tick, runScan }
