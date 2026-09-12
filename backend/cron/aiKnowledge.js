/**
 * Пополнение базы знаний ассистента из переписки в тикетах.
 *
 * Ходит по тикетам бота и достаёт пары «вопрос клиента → ответ человека».
 * Ответы самого ассистента отсеиваются: учиться на себе — верный способ
 * закрепить собственную ошибку.
 *
 * Отдельно помечаются случаи, где оператор ответил ПОСЛЕ ассистента: это
 * прямое указание, что ассистент ошибся, а человек знал, как надо. Такие
 * примеры получают больший вес при подборе.
 *
 * Только чтение на стороне бота: список тикетов и карточки. Раз в 6 часов —
 * переписка не меняется так быстро, чтобы ходить чаще, а каждый прогон это
 * под сотню запросов к API бота.
 */
const db = require('../db')
const knowledge = require('../services/aiKnowledge')
const log = require('../services/logger').for('База знаний')

const TICK_MS = 6 * 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000

let timer = null
let running = false

async function tick() {
  if (running) return
  running = true
  try {
    // Сборщик привязан к настройке ассистента: выключен ассистент — не ходим
    // по API бота впустую.
    const cfg = await db.query('SELECT enabled FROM ai_assistant_settings LIMIT 1').catch(() => null)
    if (cfg && cfg.rows[0] && cfg.rows[0].enabled === false) return

    const accs = await db.query('SELECT * FROM bedolaga_accounts WHERE is_active = true ORDER BY id')
    for (const a of accs.rows) {
      const r = await knowledge.harvest(a, { limit: 100 })
      if (!r.ok) log.warn(`Аккаунт #${a.id}: сбор не удался — ${r.error}`)
    }
  } catch (err) {
    log.error('Прогон сборщика упал', err)
  } finally {
    running = false
  }
}

function start() {
  if (timer) return
  setTimeout(() => {
    tick().catch(() => {})
    timer = setInterval(() => tick().catch(() => {}), TICK_MS)
    if (timer.unref) timer.unref()
  }, FIRST_RUN_DELAY_MS)
  log.info(`Сбор базы знаний запущен, интервал ${TICK_MS / 3600000} ч`)
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { start, stop, tick }
