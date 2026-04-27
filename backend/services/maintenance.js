/**
 * Сервис maintenance-режима.
 * Кеширует флаг + сообщение из site_config на 30 секунд, чтобы не дёргать БД на каждый запрос.
 */
const db = require('../db')

const TTL_MS = 30 * 1000
let cache = { value: null, ts: 0 }

async function getStatus() {
  if (cache.value !== null && Date.now() - cache.ts < TTL_MS) {
    return cache.value
  }
  let value
  try {
    const r = await db.query('SELECT maintenance_mode, maintenance_message FROM site_config LIMIT 1')
    const row = r.rows[0] || {}
    value = {
      maintenance: !!row.maintenance_mode,
      message: row.maintenance_message || 'Ведутся технические работы',
    }
  } catch {
    // БД недоступна — считаем, что не в техработах (fail-open),
    // чтоб не отрезать сайт от пользователей, если упала только конфиг-таблица.
    value = { maintenance: false, message: '' }
  }
  cache = { value, ts: Date.now() }
  return value
}

function invalidate() {
  cache = { value: null, ts: 0 }
}

module.exports = { getStatus, invalidate }
