/**
 * Админ-роуты RUVDS: мультиаккаунты (CRUD) + проксирование API v2.
 *
 * Изменяющие операции (SSH-ключи, команды серверу, статусы уведомлений)
 * зависят от прав токена RUVDS: read / write / remove. Права проверяет сам
 * RUVDS (403), мы дополнительно отдаём role наружу, чтобы UI прятал кнопки.
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const { encrypt } = require('../services/encryption')
const ruvds = require('../services/ruvds')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

const ROLES = ['read', 'write', 'remove']

function safeAccount(a) {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    notes: a.notes,
    is_active: a.is_active,
    sort_order: a.sort_order,
    has_api_token: !!a.api_token,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }
}

async function loadAccount(id) {
  const { rows } = await db.query('SELECT * FROM ruvds_accounts WHERE id = $1', [id])
  return rows[0] || null
}

// Обёртка: подгружает аккаунт и отдаёт результат вызова RUVDS.
function withAccount(handler) {
  return async (req, res) => {
    try {
      const a = await loadAccount(req.params.id)
      if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
      const r = await handler(a, req)
      if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: r.error })
      res.json(r.data)
    } catch (e) { res.status(500).json({ error: e.message }) }
  }
}

// ─── CRUD аккаунтов ───────────────────────────────────────────────────────────
router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ruvds_accounts ORDER BY sort_order, id')
    res.json({ accounts: rows.map(safeAccount) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/accounts', async (req, res) => {
  try {
    const { name, api_token, role, notes } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' })
    if (!api_token || !api_token.trim()) return res.status(400).json({ error: 'Токен обязателен' })
    const r = ROLES.includes(role) ? role : 'read'
    const { rows } = await db.query(
      `INSERT INTO ruvds_accounts (name, api_token, role, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), encrypt(api_token.trim()), r, notes || null, req.userId || null]
    )
    audit.write(req, 'ruvds.account.create', { type: 'ruvds_account', id: rows[0].id }, { name }).catch(() => {})
    res.status(201).json({ account: safeAccount(rows[0]) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/accounts/:id', async (req, res) => {
  try {
    const b = req.body || {}
    const sets = [], vals = []
    let i = 1
    const put = (col, val) => { sets.push(`${col} = $${i++}`); vals.push(val) }

    if ('name' in b) put('name', String(b.name || '').trim())
    if ('notes' in b) put('notes', b.notes || null)
    if ('is_active' in b) put('is_active', !!b.is_active)
    if ('sort_order' in b) put('sort_order', parseInt(b.sort_order, 10) || 0)
    if ('role' in b && ROLES.includes(b.role)) put('role', b.role)
    // Токен: '' = не менять
    if ('api_token' in b && b.api_token !== '') put('api_token', encrypt(String(b.api_token).trim()))

    if (!sets.length) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()')
    vals.push(req.params.id)
    const { rows } = await db.query(`UPDATE ruvds_accounts SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals)
    if (!rows.length) return res.status(404).json({ error: 'Аккаунт не найден' })
    audit.write(req, 'ruvds.account.update', { type: 'ruvds_account', id: req.params.id }, {}).catch(() => {})
    res.json({ account: safeAccount(rows[0]) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/accounts/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM ruvds_accounts WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Аккаунт не найден' })
    audit.write(req, 'ruvds.account.delete', { type: 'ruvds_account', id: req.params.id }, {}).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Проверка связи — заодно валидирует токен.
router.post('/accounts/:id/test', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id)
    if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await ruvds.testAccount(a)
    if (!r.ok) return res.json({ ok: false, error: r.error })
    res.json({ ok: true, balance: r.data })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Чтение ───────────────────────────────────────────────────────────────────
router.get('/accounts/:id/balance', withAccount(a => ruvds.getBalance(a)))
router.get('/accounts/:id/servers', withAccount((a, req) => ruvds.listServers(a, {
  per_page: req.query.per_page || 50, page: req.query.page, search: req.query.search,
  sort: req.query.sort, order: req.query.order,
})))
router.get('/accounts/:id/servers/:sid', withAccount((a, req) => ruvds.getServer(a, req.params.sid)))
router.get('/accounts/:id/servers/:sid/networks', withAccount((a, req) => ruvds.getServerNetworks(a, req.params.sid)))
router.get('/accounts/:id/servers/:sid/power', withAccount((a, req) => ruvds.getServerPower(a, req.params.sid)))
router.get('/accounts/:id/servers/:sid/cost', withAccount((a, req) => ruvds.getServerCost(a, req.params.sid)))
router.get('/accounts/:id/servers/:sid/screenshot', withAccount((a, req) => ruvds.getServerScreenshot(a, req.params.sid)))
router.get('/accounts/:id/payments', withAccount((a, req) => ruvds.listPayments(a, {
  per_page: req.query.per_page || 50, page: req.query.page,
})))
router.get('/accounts/:id/ssh-keys', withAccount(a => ruvds.listSshKeys(a)))
router.get('/accounts/:id/notifications', withAccount((a, req) => ruvds.listNotifications(a, {
  per_page: req.query.per_page || 50, page: req.query.page, status: req.query.status,
})))
router.get('/accounts/:id/notifications/count', withAccount((a, req) => ruvds.notificationsCount(a, { status: req.query.status })))
router.get('/accounts/:id/datacenters', withAccount(a => ruvds.listDatacenters(a)))
router.get('/accounts/:id/tariffs', withAccount(a => ruvds.listTariffs(a)))
router.get('/accounts/:id/os', withAccount(a => ruvds.listOs(a)))

// Статистика: /stat/:kind/:gran/:sid  (kind: cpu|drive|network, gran: hourly|daily)
router.get('/accounts/:id/stat/:kind/:gran/:sid', withAccount((a, req) => {
  const { kind, gran, sid } = req.params
  if (!['cpu', 'drive', 'network'].includes(kind)) return { ok: false, status: 400, error: 'Неизвестный тип статистики' }
  if (!['hourly', 'daily'].includes(gran)) return { ok: false, status: 400, error: 'Неизвестная гранулярность' }
  return ruvds.getStat(a, kind, gran, sid)
}))

// ─── Изменяющие ───────────────────────────────────────────────────────────────
router.post('/accounts/:id/ssh-keys', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { name, public_key } = req.body || {}
    if (!name || !public_key) return res.status(400).json({ error: 'Имя и публичный ключ обязательны' })
    const r = await ruvds.addSshKey(a, { name, public_key })
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'ruvds.sshkey.add', { type: 'ruvds_account', id: a.id }, { name }).catch(() => {})
    res.json(r.data || { ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/accounts/:id/ssh-keys/:keyId', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await ruvds.deleteSshKey(a, req.params.keyId)
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'ruvds.sshkey.delete', { type: 'ruvds_account', id: a.id }, { keyId: req.params.keyId }).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Команда серверу (start/stop/restart) — требует прав write у токена RUVDS.
router.put('/accounts/:id/servers/:sid/actions', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const command = String(req.body?.command || '')
    const r = await ruvds.serverAction(a, req.params.sid, command)
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'ruvds.server.action', { type: 'ruvds_account', id: a.id }, { server: req.params.sid, command }).catch(() => {})
    res.json(r.data || { ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/accounts/:id/notifications/:nid', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await ruvds.markNotification(a, req.params.nid, req.body?.status)
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json(r.data || { ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/accounts/:id/notifications-all', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await ruvds.markAllNotifications(a, req.body?.status)
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json(r.data || { ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
