/**
 * Admin traffic — агрегация трафика наших пользователей по нодам RemnaWave.
 *
 *   GET /api/admin/traffic/by-node?period=24h|7d|30d
 *
 * Логика:
 *   1. Достаём из нашей БД uuid'ы юзеров с подписками (только наши, не все 3000+ в RW)
 *   2. Параллельно (concurrency 5) дёргаем GET /api/bandwidth-stats/users/{uuid}?start&end
 *      RemnaWave 2.7+ возвращает {series:[{uuid, name, total, data}], topNodes, ...}
 *   3. Один запрос к /api/bandwidth-stats/nodes для итогов по нодам
 *   4. Склеиваем в матрицу [{ userUuid, username, perNode:{nodeUuid:bytes}, totalBytes }]
 *   5. Кеш 60 сек на каждый период
 *
 * Только админ.
 */
const express = require('express')
const router = express.Router()
const db = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')
const remnwave = require('../services/remnwave')

router.use(verifyToken, verifyAdmin)

const CACHE_TTL_MS = 60 * 1000
const cache = new Map() // period -> { data, fetchedAt }

const PERIODS = {
  '24h': 1,    // в днях
  '7d':  7,
  '30d': 30,
}

const CONCURRENCY = 5

function getDateRange(period) {
  const days = PERIODS[period] || 1
  const today = new Date()
  const end = today.toISOString().slice(0, 10) // YYYY-MM-DD
  const startDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)
  const start = startDate.toISOString().slice(0, 10)
  return { start, end }
}

// Параллельная обработка с лимитом concurrency
async function pmap(items, mapper, concurrency = CONCURRENCY) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      try {
        results[i] = await mapper(items[i], i)
      } catch (err) {
        results[i] = { __error: err.message }
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

router.get('/by-node', async (req, res) => {
  const period = String(req.query.period || '24h').toLowerCase()
  if (!PERIODS[period]) {
    return res.status(400).json({ error: 'Invalid period', allowed: Object.keys(PERIODS) })
  }

  const now = Date.now()
  const cached = cache.get(period)
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true, fetchedAt: new Date(cached.fetchedAt).toISOString() })
  }

  try {
    const { start, end } = getDateRange(period)

    // 1. Наши юзеры с подписками
    const usersResult = await db.query(`
      SELECT
        s.remnwave_user_uuid AS uuid,
        s.remnwave_username AS username,
        COALESCE(u.email, s.remnwave_username) AS display_name,
        u.id AS user_id
      FROM subscriptions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.remnwave_user_uuid IS NOT NULL
        AND s.remnwave_user_uuid <> ''
      GROUP BY s.remnwave_user_uuid, s.remnwave_username, u.email, u.id
    `)
    const ourUsers = usersResult.rows

    // 2. Глобальный трафик по нодам — для последней строки таблицы и узнавания списка нод
    const nodesStats = await remnwave.getNodesBandwidthStats(start, end)
      .catch(err => {
        console.error('[admin-traffic] getNodesBandwidthStats error:', err.message)
        return null
      })

    const nodeMeta = (nodesStats?.series || []).map(s => ({
      uuid: s.uuid,
      name: s.name || '—',
      countryCode: s.countryCode || '',
      color: s.color,
    }))
    const totalPerNode = {}
    for (const s of (nodesStats?.series || [])) {
      totalPerNode[s.uuid] = Number(s.total || 0)
    }

    // 3. Параллельно тянем bandwidth-stats по каждому из наших юзеров
    const userResults = await pmap(ourUsers, async (u) => {
      const stats = await remnwave.getUserBandwidthStats(u.uuid, start, end)
      // stats.response.series или просто stats.series — apiRequest уже разворачивает .response
      const series = stats?.series || []
      const perNode = {}
      let totalBytes = 0
      for (const s of series) {
        const bytes = Number(s.total || 0)
        if (bytes > 0) perNode[s.uuid] = bytes
        totalBytes += bytes
      }
      return {
        userUuid: u.uuid,
        username: u.username || u.display_name || '—',
        displayName: u.display_name || u.username,
        userId: u.user_id,
        perNode,
        totalBytes,
      }
    }, CONCURRENCY)

    const errors = []
    const matrix = []
    for (let i = 0; i < userResults.length; i++) {
      const r = userResults[i]
      if (r && r.__error) {
        errors.push({ userUuid: ourUsers[i].uuid, username: ourUsers[i].username, error: r.__error })
      } else if (r) {
        matrix.push(r)
      }
    }

    matrix.sort((a, b) => b.totalBytes - a.totalBytes)

    const responseData = {
      period,
      range: { start, end },
      nodes: nodeMeta,
      users: matrix,
      totalPerNode,
      grandTotalBytes: Object.values(totalPerNode).reduce((s, v) => s + v, 0),
      errors,
      meta: {
        usersInDb: ourUsers.length,
        usersWithErrors: errors.length,
      },
    }

    cache.set(period, { data: responseData, fetchedAt: now })
    res.json({ ...responseData, cached: false, fetchedAt: new Date(now).toISOString() })
  } catch (err) {
    console.error('[admin-traffic] by-node error:', err)
    res.status(502).json({ error: 'Failed to aggregate traffic', detail: err.message })
  }
})

/**
 * GET /api/admin/traffic/by-user/:userUuid?period=24h|7d|30d
 * Трафик конкретного пользователя по нодам. Без кеша (одиночный запрос — дешёвый).
 */
router.get('/by-user/:userUuid', async (req, res) => {
  const period = String(req.query.period || '7d').toLowerCase()
  if (!PERIODS[period]) {
    return res.status(400).json({ error: 'Invalid period', allowed: Object.keys(PERIODS) })
  }
  const userUuid = req.params.userUuid
  if (!userUuid) return res.status(400).json({ error: 'Missing userUuid' })

  try {
    const { start, end } = getDateRange(period)
    const remnwave = require('../services/remnwave')
    const stats = await remnwave.getUserBandwidthStats(userUuid, start, end)
    const series = stats?.series || []
    const sparklineData = stats?.sparklineData || []
    const categories = stats?.categories || []

    const byNode = series
      .map(s => ({
        nodeUuid: s.uuid,
        nodeName: s.name || '—',
        countryCode: s.countryCode || '',
        color: s.color,
        usedBytes: Number(s.total || 0),
        daily: Array.isArray(s.data) ? s.data.map(Number) : [],
      }))
      .sort((a, b) => b.usedBytes - a.usedBytes)

    const totalBytes = byNode.reduce((s, n) => s + n.usedBytes, 0)

    res.json({
      userUuid,
      period,
      range: { start, end },
      categories,
      sparklineData,
      byNode,
      totalBytes,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[admin-traffic] by-user error:', err)
    res.status(502).json({ error: 'Failed to fetch user traffic', detail: err.message })
  }
})

// Принудительный сброс кеша
router.post('/cache/clear', (req, res) => {
  cache.clear()
  res.json({ cleared: true })
})

module.exports = router
