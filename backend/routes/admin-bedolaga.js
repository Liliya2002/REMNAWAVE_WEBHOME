/**
 * Админ-роуты интеграции с ботом Bedolaga: аккаунты (CRUD) + проксирование
 * read-only эндпоинтов Web Admin API бота (мониторинг).
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const { encrypt } = require('../services/encryption')
const bedolaga = require('../services/bedolaga')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

// Безопасное представление аккаунта — без токена.
function safeAccount(a) {
  return {
    id: a.id,
    name: a.name,
    base_url: a.base_url,
    notes: a.notes,
    is_active: a.is_active,
    has_api_token: !!a.api_token,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }
}

async function loadAccount(id) {
  const { rows } = await db.query('SELECT * FROM bedolaga_accounts WHERE id = $1', [id])
  return rows[0] || null
}

// Отдаёт результат вызова API бота: 200 с данными или 502 с ошибкой.
function relay(res, r) {
  if (!r.ok) return res.status(502).json({ error: r.error })
  return res.json(r.data)
}

// ─── CRUD аккаунтов ───────────────────────────────────────────────────────────
router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM bedolaga_accounts ORDER BY id')
    res.json({ accounts: rows.map(safeAccount) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/accounts', async (req, res) => {
  try {
    const { name, base_url, api_token, notes } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' })
    if (!base_url || !base_url.trim()) return res.status(400).json({ error: 'Base URL обязателен' })
    if (!api_token || !api_token.trim()) return res.status(400).json({ error: 'Токен обязателен' })
    const { rows } = await db.query(
      `INSERT INTO bedolaga_accounts (name, base_url, api_token, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), base_url.trim(), encrypt(api_token), notes || null, req.userId || null]
    )
    audit.write(req, 'bedolaga.account.create', { type: 'bedolaga_account', id: rows[0].id }, { name }).catch(() => {})
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
    if ('base_url' in b) put('base_url', String(b.base_url || '').trim())
    if ('notes' in b) put('notes', b.notes || null)
    if ('is_active' in b) put('is_active', !!b.is_active)
    // Токен: '' = не менять; строка = зашифровать
    if ('api_token' in b && b.api_token !== '') put('api_token', encrypt(b.api_token))

    if (!sets.length) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()')
    vals.push(req.params.id)
    const { rows } = await db.query(`UPDATE bedolaga_accounts SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals)
    if (!rows.length) return res.status(404).json({ error: 'Аккаунт не найден' })
    audit.write(req, 'bedolaga.account.update', { type: 'bedolaga_account', id: req.params.id }, {}).catch(() => {})
    res.json({ account: safeAccount(rows[0]) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/accounts/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM bedolaga_accounts WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Аккаунт не найден' })
    audit.write(req, 'bedolaga.account.delete', { type: 'bedolaga_account', id: req.params.id }, {}).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Проверка связи ───────────────────────────────────────────────────────────
router.post('/accounts/:id/test', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id)
    if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await bedolaga.testAccount(a)
    if (!r.ok) return res.json({ ok: false, error: r.error })
    res.json({ ok: true, health: r.data })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Мониторинг (read-only, проксирование) ────────────────────────────────────
router.get('/accounts/:id/overview', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    relay(res, await bedolaga.getOverview(a))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/accounts/:id/users', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { limit, offset, search, status } = req.query
    relay(res, await bedolaga.listUsers(a, { limit, offset, search, status }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/accounts/:id/users/:userId', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    relay(res, await bedolaga.getUser(a, req.params.userId))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/accounts/:id/subscriptions', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { limit, offset, status } = req.query
    relay(res, await bedolaga.listSubscriptions(a, { limit, offset, status }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/accounts/:id/transactions', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { limit, offset, user_id } = req.query
    relay(res, await bedolaga.listTransactions(a, { limit, offset, user_id }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Полная карточка пользователя: профиль + история платежей + имена сквадов (одним вызовом)
router.get('/accounts/:id/users/:userId/full', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const u = await bedolaga.getUser(a, req.params.userId)
    if (!u.ok) return res.status(502).json({ error: u.error })
    const [tx, squads] = await Promise.all([
      bedolaga.listTransactions(a, { user_id: req.params.userId, limit: 100 }),
      bedolaga.getSquadNames(a),
    ])
    const txItems = tx.ok ? (Array.isArray(tx.data) ? tx.data : (tx.data.items || [])) : []
    res.json({ user: u.data, transactions: txItems, tx_error: tx.ok ? null : tx.error, squads })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/accounts/:id/tickets', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { limit, offset, status } = req.query
    relay(res, await bedolaga.listTickets(a, { limit, offset, status }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Статистика подписок: по тарифам (сквадам) + истекающие 1/3/7 дней
router.get('/accounts/:id/subscription-stats', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await bedolaga.getSubscriptionStats(a, { force: req.query.force === '1' })
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ stats: r.stats, cached: !!r.cached })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Отправка рассылки сегменту (РЕАЛЬНОЕ действие — шлёт сообщения пользователям)
router.post('/accounts/:id/broadcast', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { target, message_text } = req.body || {}
    const r = await bedolaga.sendBroadcast(a, { target, message_text })
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'bedolaga.broadcast.send', { type: 'bedolaga_account', id: a.id },
      { target, text_length: (message_text || '').length, broadcast_id: r.broadcast?.id }).catch(() => {})
    res.json({ ok: true, broadcast: r.broadcast })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Статус рассылки по id (для опроса после запуска)
router.get('/accounts/:id/broadcasts/:bid', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await bedolaga.getBroadcast(a, req.params.bid)
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ broadcast: r.broadcast })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Сводка по доходам за периоды (сегодня по МСК / 7д / 30д / всё время)
router.get('/accounts/:id/revenue', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await bedolaga.getRevenue(a, { force: req.query.force === '1' })
    if (!r.ok) return res.status(502).json({ error: r.error })
    res.json({ revenue: r.revenue, cached: !!r.cached })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/accounts/:id/tickets/:ticketId', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    relay(res, await bedolaga.getTicket(a, req.params.ticketId))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Прогрев кэша статистики подписок при старте (в фоне) — расчёт тяжёлый (~20-30 с),
// чтобы первый заход админа на страницу отдавал данные мгновенно.
setTimeout(async () => {
  try {
    const { rows } = await db.query('SELECT * FROM bedolaga_accounts WHERE is_active = true')
    for (const a of rows) bedolaga.getSubscriptionStats(a).catch(() => {})
  } catch { /* прогрев необязателен */ }
}, 5000)

module.exports = router
