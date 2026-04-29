/**
 * Admin Traffic Guard — управление лимитами и просмотр нарушений.
 *
 *   GET    /api/admin/traffic-guard/settings           — глобальные настройки
 *   PUT    /api/admin/traffic-guard/settings           — обновить
 *
 *   GET    /api/admin/traffic-guard/limits/nodes       — все per-node лимиты + список нод RW для UI
 *   PUT    /api/admin/traffic-guard/limits/nodes/:uuid — upsert лимита для ноды
 *   DELETE /api/admin/traffic-guard/limits/nodes/:uuid — удалить лимит ноды
 *
 *   GET    /api/admin/traffic-guard/limits/plans       — все per-plan лимиты + список планов
 *   PUT    /api/admin/traffic-guard/limits/plans/:planId — upsert
 *   DELETE /api/admin/traffic-guard/limits/plans/:planId — удалить
 *
 *   GET    /api/admin/traffic-guard/violations         — журнал (?level=&resolved=&limit=&offset=)
 *   POST   /api/admin/traffic-guard/violations/:id/unblock — разблокировать юзера + пометить resolved
 *
 *   POST   /api/admin/traffic-guard/check-now          — запустить runCheck() немедленно
 *   GET    /api/admin/traffic-guard/blocked            — текущие активные блокировки
 */
const express = require('express')
const router = express.Router()
const db = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')
const remnwave = require('../services/remnwave')
const trafficGuard = require('../services/trafficGuard')

router.use(verifyToken, verifyAdmin)

// ─── Settings ────────────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM traffic_guard_settings WHERE id=1')
    res.json(r.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings', async (req, res) => {
  const allowed = [
    'enabled', 'default_period', 'default_action', 'limit_source',
    'warn_threshold_percent', 'cron_interval_minutes', 'email_enabled', 'inapp_enabled',
  ]
  const sets = []
  const params = []
  let idx = 1
  for (const key of allowed) {
    if (key in req.body) {
      sets.push(`${key} = $${idx++}`)
      params.push(req.body[key])
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' })
  sets.push(`updated_at = NOW()`)
  try {
    const r = await db.query(`UPDATE traffic_guard_settings SET ${sets.join(', ')} WHERE id=1 RETURNING *`, params)
    res.json(r.rows[0])
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ─── Node limits ─────────────────────────────────────────────────────────────

router.get('/limits/nodes', async (req, res) => {
  try {
    const limitsResult = await db.query('SELECT * FROM node_traffic_limits ORDER BY node_name')
    let nodes = []
    try {
      const rwNodes = await remnwave.getNodes()
      nodes = rwNodes.map(n => ({
        uuid: n.uuid,
        name: n.name || n.nodeName || '—',
        countryCode: n.countryCode || '',
      }))
    } catch (err) {
      // RemnaWave недоступна — отдадим только то что в БД
    }
    res.json({ limits: limitsResult.rows, nodes })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/limits/nodes/:uuid', async (req, res) => {
  const uuid = req.params.uuid
  const { node_name, limit_gb, period, action, enabled, notes } = req.body
  try {
    const r = await db.query(
      `INSERT INTO node_traffic_limits (node_uuid, node_name, limit_gb, period, action, enabled, notes)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), $7)
       ON CONFLICT (node_uuid) DO UPDATE SET
         node_name = COALESCE(EXCLUDED.node_name, node_traffic_limits.node_name),
         limit_gb  = EXCLUDED.limit_gb,
         period    = EXCLUDED.period,
         action    = EXCLUDED.action,
         enabled   = EXCLUDED.enabled,
         notes     = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [uuid, node_name || null, Number(limit_gb || 0), period || null, action || null, enabled, notes || null]
    )
    res.json(r.rows[0])
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.delete('/limits/nodes/:uuid', async (req, res) => {
  try {
    await db.query('DELETE FROM node_traffic_limits WHERE node_uuid=$1', [req.params.uuid])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Plan limits ─────────────────────────────────────────────────────────────

router.get('/limits/plans', async (req, res) => {
  try {
    const limitsR = await db.query(`
      SELECT ptl.*, p.name AS plan_name
      FROM plan_traffic_limits ptl
      JOIN plans p ON p.id = ptl.plan_id
      ORDER BY p.name
    `)
    const plansR = await db.query('SELECT id, name FROM plans ORDER BY name')
    res.json({ limits: limitsR.rows, plans: plansR.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/limits/plans/:planId', async (req, res) => {
  const planId = parseInt(req.params.planId, 10)
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid planId' })
  const { per_node_limit_gb, period, enabled } = req.body
  try {
    const r = await db.query(
      `INSERT INTO plan_traffic_limits (plan_id, per_node_limit_gb, period, enabled)
       VALUES ($1, $2, $3, COALESCE($4, true))
       ON CONFLICT (plan_id) DO UPDATE SET
         per_node_limit_gb = EXCLUDED.per_node_limit_gb,
         period            = EXCLUDED.period,
         enabled           = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING *`,
      [planId, Number(per_node_limit_gb || 0), period || null, enabled]
    )
    res.json(r.rows[0])
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.delete('/limits/plans/:planId', async (req, res) => {
  try {
    await db.query('DELETE FROM plan_traffic_limits WHERE plan_id=$1', [parseInt(req.params.planId, 10)])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Violations ──────────────────────────────────────────────────────────────

router.get('/violations', async (req, res) => {
  const level = req.query.level
  const resolved = req.query.resolved // 'true' | 'false' | undefined
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null
  const userUuid = req.query.user_uuid
  const limit  = Math.min(parseInt(req.query.limit || '50', 10), 500)
  const offset = parseInt(req.query.offset || '0', 10)

  const where = []
  const params = []
  let idx = 1
  if (level) { where.push(`level = $${idx++}`); params.push(level) }
  if (resolved === 'true')  where.push(`resolved_at IS NOT NULL`)
  if (resolved === 'false') where.push(`resolved_at IS NULL`)
  if (userId) { where.push(`user_id = $${idx++}`); params.push(userId) }
  if (userUuid) { where.push(`remnwave_user_uuid = $${idx++}`); params.push(userUuid) }

  try {
    const sql = `
      SELECT v.*, u.email AS user_email
      FROM traffic_violations v
      LEFT JOIN users u ON u.id = v.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY v.detected_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    const r = await db.query(sql, params)
    const totalR = await db.query(
      `SELECT COUNT(*)::int AS n FROM traffic_violations ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      params
    )
    res.json({ items: r.rows, total: totalR.rows[0].n })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/violations/:id/unblock', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  try {
    const v = (await db.query('SELECT * FROM traffic_violations WHERE id=$1', [id])).rows[0]
    if (!v) return res.status(404).json({ error: 'Violation not found' })
    if (v.level !== 'blocked') return res.status(400).json({ error: 'Only blocked violations can be unblocked' })

    let rwResult = { applied: false }
    try {
      await remnwave.enableRemnwaveUser(v.remnwave_user_uuid)
      rwResult = { applied: true }
    } catch (err) {
      rwResult = { applied: false, error: err.message }
    }

    await db.query(
      `UPDATE traffic_violations SET resolved_at=NOW(), action_taken='manual_unblock', resolved_by=$1, notes=$2 WHERE id=$3`,
      [req.user?.id || null, JSON.stringify({ ...rwResult, manual: true }), id]
    )
    res.json({ ok: true, rw: rwResult })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Active blocks (текущие) ─────────────────────────────────────────────────

router.get('/blocked', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT v.*, u.email AS user_email
      FROM traffic_violations v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.level='blocked' AND v.resolved_at IS NULL
      ORDER BY v.detected_at DESC
    `)
    res.json({ items: r.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Check now ───────────────────────────────────────────────────────────────

router.post('/check-now', async (req, res) => {
  try {
    const result = await trafficGuard.runCheck()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Ручное управление банами ────────────────────────────────────────────────

/**
 * GET /api/admin/traffic-guard/users-for-block
 * Список наших юзеров для autocomplete в модалке ручной блокировки.
 */
router.get('/users-for-block', async (req, res) => {
  const search = String(req.query.q || '').trim().toLowerCase()
  try {
    const params = []
    let where = `s.remnwave_user_uuid IS NOT NULL AND s.remnwave_user_uuid <> ''`
    if (search) {
      where += ` AND (LOWER(s.remnwave_username) LIKE $1 OR LOWER(u.email) LIKE $1 OR s.remnwave_user_uuid = $2)`
      params.push(`%${search}%`, search)
    }
    const r = await db.query(`
      SELECT DISTINCT s.remnwave_user_uuid AS uuid, s.remnwave_username AS username,
             s.user_id, u.email
      FROM subscriptions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE ${where}
      ORDER BY s.remnwave_username
      LIMIT 30
    `, params)
    res.json({ items: r.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/traffic-guard/manual-block
 * Ручная блокировка юзера на конкретной ноде.
 * body: { user_uuid, user_id, username, node_uuid, node_name, reason }
 */
router.post('/manual-block', async (req, res) => {
  const { user_uuid, user_id, username, node_uuid, node_name, reason } = req.body || {}
  if (!user_uuid) return res.status(400).json({ error: 'Missing user_uuid' })
  if (!node_uuid) return res.status(400).json({ error: 'Missing node_uuid' })

  try {
    // 1. Disable user в RemnaWave
    let rwResult = { applied: false }
    try {
      await remnwave.disableRemnwaveUser(user_uuid)
      rwResult = { applied: true }
    } catch (err) {
      rwResult = { applied: false, error: err.message }
    }

    // 2. INSERT violation. period='manual', period_key уникальный по timestamp
    const now = new Date()
    const periodKey = `manual:${now.toISOString().replace(/[:.]/g, '-')}`
    const r = await db.query(
      `INSERT INTO traffic_violations
        (user_id, remnwave_user_uuid, username, node_uuid, node_name,
         used_bytes, limit_bytes, used_percent, level, period, period_key,
         action_taken, notes)
       VALUES ($1,$2,$3,$4,$5,0,0,0,'blocked','manual',$6,'manual_block',$7)
       RETURNING *`,
      [user_id || null, user_uuid, username || null, node_uuid, node_name || null,
       periodKey,
       JSON.stringify({ reason: reason || null, manual: true, applyResult: rwResult, by: req.user?.id || null })]
    )

    // 3. Notify user
    try {
      const settings = await trafficGuard.getSettings()
      if (user_id && settings?.inapp_enabled) {
        const notifications = require('../services/notifications')
        await notifications.notifyTrafficBlocked(user_id, {
          nodeName: node_name || '—',
          usedGb: '?', limitGb: '—',
        })
      }
    } catch {}

    res.json({ ok: true, violation: r.rows[0], rw: rwResult })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
