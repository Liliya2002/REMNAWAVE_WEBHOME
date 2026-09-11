/**
 * ИИ-планировщик рассылок.
 *
 * Крон только запускает анализ. Ничего не отправляет: в режиме prepare ИИ
 * создаёт карточку-предложение, а решение остаётся за человеком.
 *
 * Интервал берётся из настроек и перечитывается на каждом тике — менять его
 * в админке можно без перезапуска.
 */
const db = require('../db')
const broadcasts = require('../services/broadcasts')
const broadcastAi = require('../services/broadcastAi')

const TAG = '[Broadcast-AI cron]'
const TICK_MS = 15 * 60 * 1000        // как часто СМОТРИМ, не как часто анализируем
const DISPATCH_MS = 60 * 1000         // очередь автопилота — раз в минуту

/**
 * Очередь автопилота. Смотрим чаще, чем анализируем: окно отмены задаётся
 * минутами, и проверять его раз в 15 минут значило бы отправлять с
 * опозданием до четверти часа.
 */
async function dispatchTick() {
  try {
    const r = await broadcastAi.dispatchDue()
    if (r && r.sent) console.log(`${TAG} автопилот отправил рассылок: ${r.sent}`)
  } catch (e) {
    console.error(`${TAG} диспетчер:`, e.message)
  }
}

async function tick() {
  try {
    const s = await broadcasts.getSettings({ force: true })
    if (s.ai_mode === 'off') return

    const hours = Number(s.ai_interval_hours) || 24
    if (s.ai_last_run_at) {
      const passed = (Date.now() - new Date(s.ai_last_run_at).getTime()) / 3600000
      if (passed < hours) return
    }

    const { rows } = await db.query('SELECT * FROM bedolaga_accounts WHERE is_active ORDER BY id')
    for (const acc of rows) {
      const r = await broadcastAi.runOnce(acc)
      console.log(`${TAG} ${acc.name}: ${r.outcome}${r.detail ? ' — ' + r.detail : ''}`)
    }

    // Отметку времени ставим в любом случае, даже если предложение не создано:
    // иначе при «повода нет» анализ пошёл бы на каждом тике и жёг запросы.
    await db.query('UPDATE broadcast_settings SET ai_last_run_at = NOW() WHERE id = 1')
  } catch (e) {
    console.error(`${TAG} сбой:`, e.message)
  }
}

function start() {
  broadcasts.getSettings().then(s => {
    console.log(`${TAG} режим: ${s.ai_mode}${s.ai_dry_run ? ', ХОЛОСТОЙ' : ''}, интервал ${s.ai_interval_hours} ч`)
  }).catch(() => {})
  setInterval(tick, TICK_MS)
  setTimeout(tick, 60000)             // не на самом старте — дать подняться остальному
  setInterval(dispatchTick, DISPATCH_MS)
}

module.exports = { start, tick, dispatchTick }
