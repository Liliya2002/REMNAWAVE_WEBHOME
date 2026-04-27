const express = require('express')
const axios = require('axios')
const db = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')

const router = express.Router()

const REMOTE_CATALOG_URL = process.env.HOSTING_CATALOG_URL || ''
const REMOTE_CATALOG_TOKEN = process.env.HOSTING_CATALOG_TOKEN || ''
const AUTO_SYNC_ENABLED = String(process.env.HOSTING_CATALOG_AUTO_SYNC_ENABLED || 'true').toLowerCase() === 'true'
const AUTO_SYNC_MINUTES = Math.max(1, Number(process.env.HOSTING_CATALOG_AUTO_SYNC_MINUTES || 15) || 15)
const AUTO_SYNC_INTERVAL_MS = AUTO_SYNC_MINUTES * 60 * 1000

let autoSyncInitialized = false
let autoSyncInProgress = false

function getCatalogHeaders() {
  const headers = {}
  if (REMOTE_CATALOG_TOKEN) {
    headers.Authorization = `Bearer ${REMOTE_CATALOG_TOKEN}`
    headers['x-api-key'] = REMOTE_CATALOG_TOKEN
  }
  return headers
}

function getParameterChecks() {
  const checks = {
    urlConfigured: !!REMOTE_CATALOG_URL,
    tokenConfigured: !!REMOTE_CATALOG_TOKEN,
    urlProtocolValid: false,
    autoSyncEnabled: AUTO_SYNC_ENABLED,
    autoSyncMinutes: AUTO_SYNC_MINUTES,
  }

  if (REMOTE_CATALOG_URL) {
    try {
      const url = new URL(REMOTE_CATALOG_URL)
      checks.urlProtocolValid = url.protocol === 'http:' || url.protocol === 'https:'
    } catch (_) {
      checks.urlProtocolValid = false
    }
  }

  return checks
}

function normalizeOffers(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.offers || payload?.items || payload?.data || []

  return (Array.isArray(list) ? list : []).map((item, idx) => {
    const offerKey = String(item.id || item.uuid || item.slug || `offer-${idx}`)
    const cpu = Number(item.cpu || item.vcpu || item.cores || 0) || 0
    const ramGb = Number(item.ram_gb || item.ram || item.memory_gb || 0) || 0
    const diskGb = Number(item.disk_gb || item.disk || item.storage_gb || 0) || 0
    const bandwidthTb = Number(item.bandwidth_tb || item.traffic_tb || 0) || 0
    const priceMonthly = Number(item.price_monthly || item.monthly_price || item.price || 0) || 0

    return {
      offer_key: offerKey,
      title: String(item.title || item.name || 'VPS Offer'),
      location: String(item.location || item.region || ''),
      provider: String(item.provider || item.vendor || ''),
      cpu,
      ram_gb: ramGb,
      disk_gb: diskGb,
      bandwidth_tb: bandwidthTb,
      price_monthly: priceMonthly,
      currency: String(item.currency || 'USD'),
      stock_status: String(item.stock_status || item.status || 'unknown'),
      is_active: item.is_active !== false,
      source_updated_at: item.updated_at ? new Date(item.updated_at) : null,
      raw: item,
    }
  })
}

async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hosting_offers_cache (
      id SERIAL PRIMARY KEY,
      offer_key VARCHAR(255) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      location VARCHAR(255) DEFAULT '',
      provider VARCHAR(255) DEFAULT '',
      cpu INTEGER DEFAULT 0,
      ram_gb NUMERIC(10,2) DEFAULT 0,
      disk_gb NUMERIC(10,2) DEFAULT 0,
      bandwidth_tb NUMERIC(10,2) DEFAULT 0,
      price_monthly NUMERIC(12,2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'USD',
      stock_status VARCHAR(50) DEFAULT 'unknown',
      is_active BOOLEAN DEFAULT true,
      source_updated_at TIMESTAMP NULL,
      raw JSONB DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS hosting_sync_logs (
      id SERIAL PRIMARY KEY,
      status VARCHAR(20) NOT NULL,
      message TEXT DEFAULT '',
      fetched_count INTEGER DEFAULT 0,
      changed_count INTEGER DEFAULT 0,
      source_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
}

async function writeSyncLog({ status, message, fetchedCount = 0, changedCount = 0 }) {
  await db.query(
    `INSERT INTO hosting_sync_logs (status, message, fetched_count, changed_count, source_url)
     VALUES ($1, $2, $3, $4, $5)`,
    [status, message || '', fetchedCount, changedCount, REMOTE_CATALOG_URL || '']
  )
}

async function fetchRemoteCatalog() {
  if (!REMOTE_CATALOG_URL) {
    throw new Error('HOSTING_CATALOG_URL не настроен')
  }

  const res = await axios.get(REMOTE_CATALOG_URL, {
    timeout: 15000,
    headers: getCatalogHeaders(),
  })

  return normalizeOffers(res.data)
}

async function upsertOffers(offers) {
  let changed = 0

  for (const offer of offers) {
    const result = await db.query(
      `INSERT INTO hosting_offers_cache (
         offer_key, title, location, provider, cpu, ram_gb, disk_gb, bandwidth_tb,
         price_monthly, currency, stock_status, is_active, source_updated_at, raw, last_synced_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
       ON CONFLICT (offer_key)
       DO UPDATE SET
         title = EXCLUDED.title,
         location = EXCLUDED.location,
         provider = EXCLUDED.provider,
         cpu = EXCLUDED.cpu,
         ram_gb = EXCLUDED.ram_gb,
         disk_gb = EXCLUDED.disk_gb,
         bandwidth_tb = EXCLUDED.bandwidth_tb,
         price_monthly = EXCLUDED.price_monthly,
         currency = EXCLUDED.currency,
         stock_status = EXCLUDED.stock_status,
         is_active = EXCLUDED.is_active,
         source_updated_at = EXCLUDED.source_updated_at,
         raw = EXCLUDED.raw,
         last_synced_at = NOW(),
         updated_at = NOW()
       RETURNING id`,
      [
        offer.offer_key,
        offer.title,
        offer.location,
        offer.provider,
        offer.cpu,
        offer.ram_gb,
        offer.disk_gb,
        offer.bandwidth_tb,
        offer.price_monthly,
        offer.currency,
        offer.stock_status,
        offer.is_active,
        offer.source_updated_at,
        JSON.stringify(offer.raw || {}),
      ]
    )

    if (result.rows.length > 0) changed += 1
  }

  return changed
}

async function runCatalogSync(reason = 'manual') {
  if (!REMOTE_CATALOG_URL) {
    throw new Error('HOSTING_CATALOG_URL не настроен')
  }

  if (autoSyncInProgress) {
    return { skipped: true, reason: 'sync_in_progress' }
  }

  autoSyncInProgress = true
  try {
    await ensureTables()

    const offers = await fetchRemoteCatalog()
    const changedCount = await upsertOffers(offers)

    await writeSyncLog({
      status: 'success',
      message: `Синхронизация выполнена успешно (${reason})`,
      fetchedCount: offers.length,
      changedCount,
    })

    return {
      skipped: false,
      fetchedCount: offers.length,
      changedCount,
    }
  } catch (err) {
    await writeSyncLog({
      status: 'error',
      message: `${err.message} (${reason})`,
      fetchedCount: 0,
      changedCount: 0,
    }).catch(() => {})
    throw err
  } finally {
    autoSyncInProgress = false
  }
}

function initAutoSync() {
  if (autoSyncInitialized || !AUTO_SYNC_ENABLED) return
  autoSyncInitialized = true

  // Отложенный старт, чтобы дать приложению и БД подняться после перезапуска.
  setTimeout(() => {
    runCatalogSync('startup').catch((err) => {
      console.error('[AdminHosting] startup auto-sync error:', err.message)
    })
  }, 10000)

  setInterval(() => {
    runCatalogSync('interval').catch((err) => {
      console.error('[AdminHosting] interval auto-sync error:', err.message)
    })
  }, AUTO_SYNC_INTERVAL_MS)
}

router.use(verifyToken, verifyAdmin)

initAutoSync()

router.get('/health', async (req, res) => {
  const checks = getParameterChecks()

  try {
    if (!checks.urlConfigured) {
      return res.status(200).json({
        sourceConfigured: false,
        reachable: false,
        statusCode: null,
        message: 'HOSTING_CATALOG_URL не настроен',
        checks,
      })
    }

    if (!checks.urlProtocolValid) {
      return res.status(200).json({
        sourceConfigured: true,
        reachable: false,
        statusCode: null,
        message: 'HOSTING_CATALOG_URL задан некорректно',
        checks,
      })
    }

    const pingRes = await axios.get(REMOTE_CATALOG_URL, {
      timeout: 5000,
      headers: getCatalogHeaders(),
      validateStatus: () => true,
    })

    const reachable = pingRes.status >= 200 && pingRes.status < 500

    res.status(200).json({
      sourceConfigured: true,
      reachable,
      statusCode: pingRes.status,
      message: reachable
        ? 'Источник каталога отвечает'
        : 'Источник каталога недоступен',
      checks,
    })
  } catch (err) {
    res.status(200).json({
      sourceConfigured: !!REMOTE_CATALOG_URL,
      reachable: false,
      statusCode: null,
      message: err.message || 'Ошибка проверки источника каталога',
      checks,
    })
  }
})

router.get('/catalog', async (req, res) => {
  try {
    await ensureTables()

    const syncRes = await db.query(
      `SELECT status, message, fetched_count, changed_count, source_url, created_at
       FROM hosting_sync_logs
       ORDER BY id DESC
       LIMIT 1`
    )

    const lastSync = syncRes.rows[0] || null
    const staleMs = AUTO_SYNC_INTERVAL_MS + 60 * 1000
    const isSyncStale = !lastSync?.created_at || (Date.now() - new Date(lastSync.created_at).getTime() > staleMs)

    if (AUTO_SYNC_ENABLED && REMOTE_CATALOG_URL && isSyncStale) {
      runCatalogSync('catalog-request').catch((err) => {
        console.error('[AdminHosting] request auto-sync error:', err.message)
      })
    }

    const offersRes = await db.query(
      `SELECT id, offer_key, title, location, provider, cpu, ram_gb, disk_gb, bandwidth_tb,
              price_monthly, currency, stock_status, is_active, source_updated_at, last_synced_at, updated_at
       FROM hosting_offers_cache
       WHERE is_active = true
       ORDER BY price_monthly ASC, cpu DESC, ram_gb DESC`
    )

    res.json({
      offers: offersRes.rows,
      sourceConfigured: !!REMOTE_CATALOG_URL,
      sourceUrl: REMOTE_CATALOG_URL || null,
      lastSync: syncRes.rows[0] || null,
      autoSync: {
        enabled: AUTO_SYNC_ENABLED,
        everyMinutes: AUTO_SYNC_MINUTES,
      },
    })
  } catch (err) {
    console.error('[AdminHosting] catalog error:', err.message)
    res.status(500).json({ error: 'Ошибка загрузки каталога хостинга' })
  }
})

router.post('/sync', async (req, res) => {
  try {
    const syncResult = await runCatalogSync('manual')

    const offersRes = await db.query(
      `SELECT id, offer_key, title, location, provider, cpu, ram_gb, disk_gb, bandwidth_tb,
              price_monthly, currency, stock_status, is_active, source_updated_at, last_synced_at, updated_at
       FROM hosting_offers_cache
       WHERE is_active = true
       ORDER BY price_monthly ASC, cpu DESC, ram_gb DESC`
    )

    res.json({
      success: true,
      offers: offersRes.rows,
      fetchedCount: syncResult.fetchedCount || 0,
      changedCount: syncResult.changedCount || 0,
    })
  } catch (err) {
    console.error('[AdminHosting] sync error:', err.message)
    res.status(502).json({ error: err.message || 'Ошибка синхронизации с удаленным сервером' })
  }
})

module.exports = router
