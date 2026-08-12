/**
 * Админ-роуты Selectel Cloud: аккаунты (CRUD) + баланс + список серверов.
 * Read-only по облаку (MVP): без управления серверами.
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const { encrypt } = require('../services/encryption')
const selectel = require('../services/selectel')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

// Безопасное представление аккаунта — без секретов.
function safeAccount(a) {
  return {
    id: a.id,
    name: a.name,
    account_id: a.account_id,
    service_username: a.service_username,
    default_project: a.default_project,
    default_region: a.default_region,
    notes: a.notes,
    is_active: a.is_active,
    has_api_key: !!a.api_key,
    has_service_password: !!a.service_password,
    low_balance_threshold: a.low_balance_threshold != null ? Number(a.low_balance_threshold) : null,
    low_balance_repeat_hours: a.low_balance_repeat_hours != null ? Number(a.low_balance_repeat_hours) : 0,
    low_balance_notified: a.low_balance_notified,
    last_balance_rub: a.last_balance_rub != null ? Number(a.last_balance_rub) : null,
    balance_checked_at: a.balance_checked_at,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }
}

// Нормализация порога: '' / null / 0 → NULL (выкл), иначе положительное число.
function normThreshold(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return isFinite(n) && n > 0 ? n : null
}

async function loadAccount(id) {
  const { rows } = await db.query('SELECT * FROM selectel_accounts WHERE id = $1', [id])
  return rows[0] || null
}

// ─── CRUD аккаунтов ───────────────────────────────────────────────────────────
router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM selectel_accounts ORDER BY id')
    res.json({ accounts: rows.map(safeAccount) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/accounts', async (req, res) => {
  try {
    const { name, api_key, account_id, service_username, service_password, default_project, default_region, notes, low_balance_threshold } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' })
    const { rows } = await db.query(
      `INSERT INTO selectel_accounts
         (name, api_key, account_id, service_username, service_password, default_project, default_region, notes, low_balance_threshold, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        name.trim(),
        api_key ? encrypt(api_key) : null,
        account_id || null,
        service_username || null,
        service_password ? encrypt(service_password) : null,
        default_project || null,
        default_region || null,
        notes || null,
        normThreshold(low_balance_threshold),
        req.userId || null,
      ]
    )
    audit.write(req, 'selectel.account.create', { type: 'selectel_account', id: rows[0].id }, { name }).catch(() => {})
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
    if ('account_id' in b) put('account_id', b.account_id || null)
    if ('service_username' in b) put('service_username', b.service_username || null)
    if ('default_project' in b) put('default_project', b.default_project || null)
    if ('default_region' in b) put('default_region', b.default_region || null)
    if ('notes' in b) put('notes', b.notes || null)
    if ('is_active' in b) put('is_active', !!b.is_active)
    // При изменении порога сбрасываем флаг уведомления (пересчитается на след. тике).
    if ('low_balance_threshold' in b) { put('low_balance_threshold', normThreshold(b.low_balance_threshold)); put('low_balance_notified', false) }
    // Интервал повтора: 0 = один раз, потолок в неделю — большее бессмысленно
    if ('low_balance_repeat_hours' in b) {
      const h = Number(b.low_balance_repeat_hours)
      put('low_balance_repeat_hours', isFinite(h) ? Math.min(Math.max(Math.round(h), 0), 168) : 0)
    }
    // Секреты: '' = не менять; null = стереть; строка = зашифровать
    if ('api_key' in b && b.api_key !== '') put('api_key', b.api_key === null ? null : encrypt(b.api_key))
    if ('service_password' in b && b.service_password !== '') put('service_password', b.service_password === null ? null : encrypt(b.service_password))

    if (!sets.length) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()')
    vals.push(req.params.id)
    const { rows } = await db.query(`UPDATE selectel_accounts SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals)
    if (!rows.length) return res.status(404).json({ error: 'Аккаунт не найден' })
    audit.write(req, 'selectel.account.update', { type: 'selectel_account', id: req.params.id }, {}).catch(() => {})
    res.json({ account: safeAccount(rows[0]) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/accounts/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM selectel_accounts WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Аккаунт не найден' })
    audit.write(req, 'selectel.account.delete', { type: 'selectel_account', id: req.params.id }, {}).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Данные аккаунта ──────────────────────────────────────────────────────────
router.get('/accounts/:id/balance', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id)
    if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.getBalance(a)
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ balance: r.balance })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/accounts/:id/servers', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id)
    if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.listServers(a)
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ servers: r.servers, projects: r.projects, errors: r.errors })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Статистика расходов (по продуктам/проектам) за N дней
router.get('/accounts/:id/statistics', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id)
    if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30))
    // Selectel хочет naive datetime без миллисекунд и Z: YYYY-MM-DDTHH:MM:SS
    const end = new Date().toISOString().slice(0, 19)
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19)
    const r = await selectel.getStatistics(a, { start, end, groupType: req.query.group || 'project' })
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ data: r.data, days })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Транзакции (пополнения/списания) за N дней
router.get('/accounts/:id/transactions', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id)
    if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30))
    const to = new Date().toISOString().slice(0, 19)
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19)
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100))
    const r = await selectel.getTransactions(a, { from, to, limit })
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ transactions: r.transactions, days })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── SSH-ключи проекта (Nova keypairs) ────────────────────────────────────────
router.get('/accounts/:id/ssh-keys', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.listSshKeys(a)
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ keys: r.keys, project: r.project, region: r.region })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/accounts/:id/ssh-keys', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.addSshKey(a, { name: req.body?.name, publicKey: req.body?.publicKey })
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'selectel.sshkey.add', { type: 'selectel_account', id: a.id }, { name: req.body?.name }).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.delete('/accounts/:id/ssh-keys/:name', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.deleteSshKey(a, { name: req.params.name })
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'selectel.sshkey.delete', { type: 'selectel_account', id: a.id }, { name: req.params.name }).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Floating IP (Neutron) ────────────────────────────────────────────────────
router.get('/accounts/:id/floating-ips', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.listFloatingIps(a)
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ ips: r.ips, region: r.region })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/accounts/:id/floating-ips/allocate', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.allocateFloatingIp(a)
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'selectel.floatingip.allocate', { type: 'selectel_account', id: a.id }, { ip: r.ip }).catch(() => {})
    res.json({ ok: true, ip: r.ip })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/accounts/:id/floating-ips/:fipId/attach', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.attachFloatingIp(a, { floatingIpId: req.params.fipId, serverId: req.body?.serverId })
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'selectel.floatingip.attach', { type: 'selectel_account', id: a.id }, { fip: req.params.fipId, serverId: req.body?.serverId }).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/accounts/:id/floating-ips/:fipId/detach', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.detachFloatingIp(a, { floatingIpId: req.params.fipId })
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'selectel.floatingip.detach', { type: 'selectel_account', id: a.id }, { fip: req.params.fipId }).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.delete('/accounts/:id/floating-ips/:fipId', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await selectel.releaseFloatingIp(a, { floatingIpId: req.params.fipId })
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'selectel.floatingip.release', { type: 'selectel_account', id: a.id }, { fip: req.params.fipId }).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/accounts/:id/test', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id)
    if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    res.json(await selectel.testAccount(a))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
