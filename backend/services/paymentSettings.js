/**
 * Настройки платёжных систем: БД → .env (fallback).
 *
 * Раньше ключи Platega жили только в .env, из-за чего их нельзя было поменять
 * без доступа к серверу, а забытая настройка тихо ломала оплату. Теперь они
 * редактируются в админке и хранятся в payment_settings (секрет зашифрован).
 *
 * .env остаётся запасным вариантом: если в БД пусто (или таблицы ещё нет),
 * используются PLATEGA_MERCHANT_ID / PLATEGA_SECRET — существующие установки
 * продолжают работать без переноса.
 *
 * Результат кэшируется на 30 секунд; после сохранения кэш сбрасывается сразу.
 */
const db = require('../db')
const { decrypt } = require('./encryption')

const TTL_MS = 30000
let cache = null       // { ts, data }

const DEFAULT_API_URL = 'https://app.platega.io'

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
}

async function readRow() {
  try {
    const { rows } = await db.query('SELECT * FROM payment_settings WHERE id = 1')
    return rows[0] || null
  } catch {
    // Таблицы может не быть (миграция не применена) — работаем на .env.
    return null
  }
}

/**
 * @returns {{ platega: { enabled, merchantId, secret, paymentMethod, apiUrl,
 *             successUrl, failedUrl, configured, source } }}
 */
async function get({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.ts < TTL_MS) return cache.data

  const row = await readRow()

  let merchantId = row?.platega_merchant_id || ''
  let secret = ''
  if (row?.platega_secret) {
    try { secret = decrypt(row.platega_secret) } catch { secret = '' }
  }

  // Fallback на переменные окружения, если в БД пусто.
  let source = 'db'
  if (!merchantId || !secret) {
    const envM = process.env.PLATEGA_MERCHANT_ID || ''
    const envS = process.env.PLATEGA_SECRET || ''
    if (envM && envS) { merchantId = merchantId || envM; secret = secret || envS; source = 'env' }
  }

  const data = {
    platega: {
      enabled: row ? row.platega_enabled !== false : true,
      merchantId,
      secret,
      paymentMethod: row?.platega_payment_method ?? 2,
      apiUrl: (row?.platega_api_url || DEFAULT_API_URL).replace(/\/$/, ''),
      successUrl: row?.success_url || `${frontendUrl()}/payment/success`,
      failedUrl: row?.failed_url || `${frontendUrl()}/payment/failed`,
      configured: !!(merchantId && secret),
      source: (merchantId && secret) ? source : 'none',
    },
  }
  cache = { ts: Date.now(), data }
  return data
}

function invalidate() { cache = null }

module.exports = { get, invalidate, DEFAULT_API_URL, frontendUrl }
