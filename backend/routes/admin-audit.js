/**
 * GET /api/admin/audit — список записей журнала с фильтрами и пагинацией.
 * GET /api/admin/audit/actions — список различных action для фильтра в UI.
 */
const express = require('express')
const router = express.Router()
const db = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')

router.use(verifyToken, verifyAdmin)

router.get('/actions', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT action, COUNT(*)::int AS count
         FROM admin_audit_log
        GROUP BY action ORDER BY action ASC`
    )
    res.json({ actions: rows })
  } catch (err) {
    console.error('[AdminAudit] actions error:', err.message)
    res.status(500).json({ error: 'Ошибка загрузки списка действий' })
  }
})

router.get('/', async (req, res) => {
  try {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50))
    const offset = Math.max(0, parseInt(req.query.offset) || 0)
    const action = (req.query.action || '').trim()
    const adminId = parseInt(req.query.adminId) || null
    const targetType = (req.query.targetType || '').trim()
    const targetId = (req.query.targetId || '').trim()
    const since = (req.query.since || '').trim()  // ISO дата
    const until = (req.query.until || '').trim()

    const conds = []
    const vals = []
    let i = 1

    if (action)     { conds.push(`action = $${i++}`);       vals.push(action) }
    if (adminId)    { conds.push(`admin_id = $${i++}`);     vals.push(adminId) }
    if (targetType) { conds.push(`target_type = $${i++}`);  vals.push(targetType) }
    if (targetId)   { conds.push(`target_id = $${i++}`);    vals.push(targetId) }
    if (since)      { conds.push(`created_at >= $${i++}`);  vals.push(since) }
    if (until)      { conds.push(`created_at <= $${i++}`);  vals.push(until) }

    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM admin_audit_log ${whereSql}`, vals)
    const dataRes = await db.query(
      `SELECT id, admin_id, admin_login, action, target_type, target_id, changes, ip, user_agent, created_at
         FROM admin_audit_log ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${i} OFFSET $${i + 1}`,
      [...vals, limit, offset]
    )

    res.json({
      items: dataRes.rows,
      total: totalRes.rows[0].total,
      limit, offset
    })
  } catch (err) {
    console.error('[AdminAudit] list error:', err.message)
    res.status(500).json({ error: 'Ошибка загрузки журнала' })
  }
})

module.exports = router
