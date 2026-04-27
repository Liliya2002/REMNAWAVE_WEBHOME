const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const remnwave = require('../services/remnwave')

router.use(verifyToken, verifyAdmin)

const ALLOWED_STATUSES = new Set(['ACTIVE', 'DISABLED', 'LIMITED', 'EXPIRED'])
const ALLOWED_TRAFFIC_STRATEGIES = new Set(['NO_RESET', 'DAY', 'WEEK', 'MONTH'])

function pickUserPayload(body) {
  const out = {}
  const passthrough = [
    'username', 'status', 'expireAt', 'description', 'tag', 'email',
    'telegramId', 'hwidDeviceLimit', 'activeInternalSquads',
    'trafficLimitBytes', 'trafficLimitStrategy',
    'vlessUuid', 'trojanPassword', 'ssPassword',
  ]
  for (const k of passthrough) if (body[k] !== undefined) out[k] = body[k]

  if (out.status && !ALLOWED_STATUSES.has(out.status)) delete out.status
  if (out.trafficLimitStrategy && !ALLOWED_TRAFFIC_STRATEGIES.has(out.trafficLimitStrategy)) {
    delete out.trafficLimitStrategy
  }
  if (out.expireAt && typeof out.expireAt === 'string') {
    const d = new Date(out.expireAt)
    if (!isNaN(d.getTime())) out.expireAt = d.toISOString()
  }
  if (out.trafficLimitBytes != null) out.trafficLimitBytes = Number(out.trafficLimitBytes) || 0
  if (out.hwidDeviceLimit != null) out.hwidDeviceLimit = Number(out.hwidDeviceLimit) || 0
  return out
}

/**
 * GET /api/admin/rwusers
 * Список пользователей Remnwave (proxy + пагинация + фильтры)
 * Query: page (1-based), size, search, status, sortBy, sortDirection
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const size = Math.min(200, Math.max(5, parseInt(req.query.size) || 25))
    const start = (page - 1) * size
    const search = req.query.search || ''
    const status = req.query.status || ''
    const sortBy = req.query.sortBy || 'updatedAt'
    const sortDirection = req.query.sortDirection === 'asc' ? 'asc' : 'desc'

    const { users, total } = await remnwave.listRemnwaveUsers({
      start, size, search, status, sortBy, sortDirection
    })
    res.json({
      users, total,
      pagination: { page, size, pages: Math.max(1, Math.ceil((total || users.length) / size)) }
    })
  } catch (err) {
    console.error('[AdminRwUsers] list error:', err.message)
    res.status(500).json({ error: 'Ошибка получения списка пользователей' })
  }
})

/**
 * GET /api/admin/rwusers/:uuid
 */
router.get('/:uuid', async (req, res) => {
  try {
    const user = await remnwave.getRemnwaveUserByUuid(req.params.uuid)
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' })
    res.json({ user })
  } catch (err) {
    console.error('[AdminRwUsers] get error:', err.message)
    res.status(500).json({ error: 'Ошибка получения пользователя' })
  }
})

/**
 * POST /api/admin/rwusers — создать
 */
router.post('/', async (req, res) => {
  try {
    const payload = pickUserPayload(req.body || {})
    if (!payload.username) return res.status(400).json({ error: 'username обязателен' })
    if (!payload.status) payload.status = 'ACTIVE'
    if (payload.trafficLimitBytes == null) payload.trafficLimitBytes = 0
    if (!payload.trafficLimitStrategy) payload.trafficLimitStrategy = 'NO_RESET'

    const user = await remnwave.createRemnwaveUser(payload)
    res.json({ user })
  } catch (err) {
    console.error('[AdminRwUsers] create error:', err.message)
    res.status(500).json({ error: err.message || 'Ошибка создания пользователя' })
  }
})

/**
 * PATCH /api/admin/rwusers/:uuid — обновить
 */
router.patch('/:uuid', async (req, res) => {
  try {
    const payload = pickUserPayload(req.body || {})
    const user = await remnwave.updateRemnwaveUser(req.params.uuid, payload)
    res.json({ user })
  } catch (err) {
    console.error('[AdminRwUsers] update error:', err.message)
    res.status(500).json({ error: err.message || 'Ошибка обновления пользователя' })
  }
})

/**
 * DELETE /api/admin/rwusers/:uuid
 */
router.delete('/:uuid', async (req, res) => {
  try {
    await remnwave.deleteRemnwaveUser(req.params.uuid)
    res.json({ ok: true })
  } catch (err) {
    console.error('[AdminRwUsers] delete error:', err.message)
    res.status(500).json({ error: err.message || 'Ошибка удаления' })
  }
})

/**
 * POST /api/admin/rwusers/:uuid/enable | disable | reset-traffic | revoke
 */
router.post('/:uuid/enable', async (req, res) => {
  try { res.json({ user: await remnwave.enableRemnwaveUser(req.params.uuid) }) }
  catch (err) { res.status(500).json({ error: err.message || 'Ошибка' }) }
})

router.post('/:uuid/disable', async (req, res) => {
  try { res.json({ user: await remnwave.disableRemnwaveUser(req.params.uuid) }) }
  catch (err) { res.status(500).json({ error: err.message || 'Ошибка' }) }
})

router.post('/:uuid/reset-traffic', async (req, res) => {
  try { res.json({ user: await remnwave.resetRemnwaveUserTraffic(req.params.uuid) }) }
  catch (err) { res.status(500).json({ error: err.message || 'Ошибка' }) }
})

router.post('/:uuid/revoke', async (req, res) => {
  try { res.json({ user: await remnwave.revokeRemnwaveUserSubscription(req.params.uuid, req.body || {}) }) }
  catch (err) { res.status(500).json({ error: err.message || 'Ошибка' }) }
})

/**
 * GET /api/admin/rwusers/:uuid/hwid — устройства HWID
 */
router.get('/:uuid/hwid', async (req, res) => {
  try {
    const devices = await remnwave.getRemnwaveUserHwidDevices(req.params.uuid)
    res.json({ devices: Array.isArray(devices) ? devices : [] })
  } catch (err) {
    console.error('[AdminRwUsers] hwid error:', err.message)
    res.status(500).json({ error: 'Ошибка получения устройств' })
  }
})

/**
 * DELETE /api/admin/rwusers/:uuid/hwid — удалить все устройства
 */
router.delete('/:uuid/hwid', async (req, res) => {
  try {
    await remnwave.deleteAllRemnwaveUserHwid(req.params.uuid)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Ошибка' })
  }
})

/**
 * DELETE /api/admin/rwusers/:uuid/hwid/:hwid — удалить одно устройство
 */
router.delete('/:uuid/hwid/:hwid', async (req, res) => {
  try {
    await remnwave.deleteRemnwaveUserHwid(req.params.uuid, req.params.hwid)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Ошибка' })
  }
})

module.exports = router
