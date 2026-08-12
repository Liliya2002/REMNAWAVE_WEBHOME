/**
 * Параметры мониторинга VPS: БД → .env (fallback).
 *
 * Раньше интервал health-check и прочее задавались только переменными
 * окружения, а значит менялись лишь через доступ к серверу и перезапуск.
 * Теперь они редактируются в админке (Настройки → VPS → Параметры мониторинга).
 *
 * NULL в колонке = «брать из .env», поэтому существующие установки работают
 * без переноса значений.
 *
 * Кэш короткий (15 с): кроны читают настройки на каждом тике, а после
 * сохранения в админке кэш сбрасывается и таймеры перепланируются.
 */
const db = require('../db')

const TTL_MS = 15000
let cache = null

// Значения по умолчанию совпадают с прежними константами в кронах —
// поведение без настройки не меняется.
const DEFAULTS = {
  health_enabled:      process.env.VPS_HEALTH_CHECK_ENABLED !== 'false',
  health_interval_min: parseInt(process.env.VPS_HEALTH_INTERVAL_MIN || '10', 10),
  health_ping_port:    parseInt(process.env.VPS_HEALTH_PING_PORT || '22', 10),
  health_check_nodes:  parseInt(process.env.VPS_HEALTH_CHECK_NODES || '3', 10),
  health_parallelism:  parseInt(process.env.VPS_HEALTH_PARALLELISM || '2', 10),
  expiry_notify_hour:  parseInt(process.env.VPS_EXPIRY_NOTIFY_HOUR_UTC || '10', 10),
  default_ssh_port:    22,
}

// Границы: защищают от значений, которые сломают работу или зальют
// внешний сервис проверок запросами.
const LIMITS = {
  health_interval_min: [1, 1440],
  health_ping_port:    [1, 65535],
  health_check_nodes:  [1, 10],
  health_parallelism:  [1, 20],
  expiry_notify_hour:  [0, 23],
  default_ssh_port:    [1, 65535],
}

function clamp(key, value) {
  const lim = LIMITS[key]
  if (!lim || value == null) return value
  return Math.min(lim[1], Math.max(lim[0], value))
}

async function get({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.ts < TTL_MS) return cache.data

  let row = null
  try {
    const r = await db.query('SELECT * FROM vps_settings WHERE id = 1')
    row = r.rows[0] || null
  } catch { /* таблицы может не быть — работаем на .env */ }

  const data = { ...DEFAULTS, source: {} }
  for (const key of Object.keys(DEFAULTS)) {
    const v = row ? row[key] : null
    if (v !== null && v !== undefined) {
      data[key] = typeof DEFAULTS[key] === 'boolean' ? !!v : clamp(key, Number(v))
      data.source[key] = 'db'
    } else {
      data.source[key] = 'env'
    }
  }
  data.updated_at = row?.updated_at || null

  cache = { ts: Date.now(), data }
  return data
}

function invalidate() { cache = null }

module.exports = { get, invalidate, DEFAULTS, LIMITS }
