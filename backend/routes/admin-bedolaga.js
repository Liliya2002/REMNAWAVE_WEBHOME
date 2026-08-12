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

// Истекающие подписки, сгруппированные по месяцам окончания.
// Данные берутся из того же кэша, что и статистика подписок — дополнительных
// запросов к боту не делается.
router.get('/accounts/:id/expiring', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await bedolaga.getSubscriptionStats(a, { force: req.query.force === '1' })
    if (!r.ok) return res.status(502).json({ error: r.error })

    const monthsAhead = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6))
    const search = String(req.query.search || '').trim().toLowerCase()

    const now = new Date()
    const limit = new Date(now.getFullYear(), now.getMonth() + monthsAhead + 1, 1).getTime()

    let items = r.stats.expiringList || []
    if (search) {
      items = items.filter(x =>
        String(x.username || '').toLowerCase().includes(search) ||
        String(x.telegram_id || '').includes(search) ||
        String(x.user_id || '').includes(search) ||
        [x.first_name, x.last_name].filter(Boolean).join(' ').toLowerCase().includes(search)
      )
    }

    const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
                   'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
    const groups = new Map()
    let overdue = 0, thisMonth = 0, nextMonth = 0, total = 0
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const nx = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextKey = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, '0')}`

    for (const it of items) {
      const d = new Date(it.end_date)
      if (isNaN(d)) continue
      const isOverdue = it.days_left < 0
      // Просроченные показываем всегда, будущие — в пределах горизонта.
      if (!isOverdue && d.getTime() >= limit) continue

      const key = isOverdue ? 'overdue' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: isOverdue ? 'Просрочено' : `${MONTH[d.getMonth()]} ${d.getFullYear()}`,
          overdue: isOverdue,
          current: key === curKey,
          items: [],
        })
      }
      groups.get(key).items.push(it)
      total++
      if (isOverdue) overdue++
      else if (key === curKey) thisMonth++
      else if (key === nextKey) nextMonth++
    }

    // Просроченные первыми, дальше по возрастанию месяца.
    const months = [...groups.values()].sort((x, y) => {
      if (x.overdue) return -1
      if (y.overdue) return 1
      return x.key.localeCompare(y.key)
    }).map(g => ({ ...g, count: g.items.length }))

    res.json({
      months,
      summary: { overdue, thisMonth, nextMonth, total },
      months_ahead: monthsAhead,
      computed_at: r.stats.computed_at,
      cached: !!r.cached,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Личное сообщение пользователю Bedolaga через НАШ Telegram-бот.
// У API Bedolaga персональной отправки нет (только сегментные рассылки), а наш
// бот может написать первым лишь тем, кто сам его запускал, — поэтому здесь
// возможен штатный отказ, и его нужно показать понятно.
router.post('/accounts/:id/notify-user', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { telegram_id, text } = req.body || {}
    if (!telegram_id) return res.status(400).json({ error: 'Не указан telegram_id' })
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Текст сообщения обязателен' })

    const tgSettings = require('../services/telegramBot/settings')
    const { rawSendMessage } = require('../services/telegramBot/notify')
    const s = await tgSettings.getSettings()
    const token = s.bot_token || process.env.TELEGRAM_BOT_TOKEN
    if (!token) return res.status(503).json({ error: 'Наш Telegram-бот не настроен' })

    const r = await rawSendMessage({ token, chatId: telegram_id, text: String(text).trim() })
    if (!r.ok) {
      // 403 — самый частый случай: юзер не нажимал /start у нашего бота.
      const blocked = /can't initiate|blocked|not found|chat not found/i.test(r.error || '')
      return res.status(200).json({
        ok: false,
        error: blocked
          ? 'Пользователь не запускал нашего бота — Telegram запрещает писать первым. Напишите ему напрямую.'
          : (r.error || 'Не удалось отправить'),
      })
    }
    audit.write(req, 'bedolaga.notify.user', { type: 'bedolaga_account', id: a.id }, { telegram_id }).catch(() => {})
    res.json({ ok: true })
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


// ─── Промокоды ────────────────────────────────────────────────────────────────

// Список промокодов из API бота (live)
router.get('/accounts/:id/promo-codes', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { limit, offset, is_active } = req.query
    relay(res, await bedolaga.listPromoCodes(a, { limit, offset, is_active }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Карточка промокода — вместе с recent_uses (последние 10 активаций)
router.get('/accounts/:id/promo-codes/:pid', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    relay(res, await bedolaga.getPromoCode(a, req.params.pid))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Накопленная база активаций (наша БД) ─────────────────────────────────────

/**
 * Выборка активаций из нашей таблицы. Именно она даёт историю глубже десяти
 * записей: API бота столько не отдаёт, а тут копится с каждой синхронизации.
 */
router.get('/accounts/:id/promo-uses', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const { code, promo_type, search, from, to } = req.query
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500)
    const offset = Math.max(Number(req.query.offset) || 0, 0)

    const where = ['account_id = $1']
    const params = [a.id]
    const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', '$' + params.length)) }

    if (code)       add('code = $$', code)
    if (promo_type) add('promo_type = $$', promo_type)
    if (from)       add('used_at >= $$', from)
    if (to)         add('used_at <= $$', to)
    if (search) {
      // Ищем сразу по username, имени и telegram_id — так удобнее, чем
      // заставлять выбирать поле в интерфейсе.
      params.push(`%${search}%`)
      const p = '$' + params.length
      where.push(`(user_username ILIKE ${p} OR user_full_name ILIKE ${p} OR CAST(user_telegram_id AS TEXT) ILIKE ${p})`)
    }
    const w = where.join(' AND ')

    const [rows, total, byType] = await Promise.all([
      db.query(
        `SELECT * FROM bedolaga_promo_uses WHERE ${w}
         ORDER BY used_at DESC NULLS LAST, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*)::int AS n FROM bedolaga_promo_uses WHERE ${w}`, params),
      db.query(
        `SELECT promo_type, COUNT(*)::int AS n,
                SUM(subscription_days)::int AS days,
                SUM(balance_bonus_kopeks)::int AS kopeks
           FROM bedolaga_promo_uses WHERE ${w} GROUP BY promo_type ORDER BY n DESC`,
        params
      ),
    ])

    const st = await db.query('SELECT * FROM bedolaga_promo_sync_state WHERE account_id = $1', [a.id])

    res.json({
      items: rows.rows,
      total: total.rows[0].n,
      limit, offset,
      by_type: byType.rows,
      sync: st.rows[0] ? {
        last_run_at: st.rows[0].last_run_at,
        status: st.rows[0].status,
        error: st.rows[0].error,
        added: st.rows[0].added,
        missed_total: st.rows[0].missed_total,
        missed_note: st.rows[0].missed_note,
      } : null,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Справочники для фильтров — коды и типы, реально встречающиеся в базе
router.get('/accounts/:id/promo-uses/facets', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const [codes, types] = await Promise.all([
      db.query(`SELECT code, COUNT(*)::int AS n FROM bedolaga_promo_uses
                WHERE account_id = $1 AND code IS NOT NULL GROUP BY code ORDER BY n DESC`, [a.id]),
      db.query(`SELECT promo_type, COUNT(*)::int AS n FROM bedolaga_promo_uses
                WHERE account_id = $1 GROUP BY promo_type ORDER BY n DESC`, [a.id]),
    ])
    res.json({ codes: codes.rows, types: types.rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * Ручной запуск синхронизации. POST без ретраев — повтор безопасен по данным
 * (UPSERT), но лишний прогон зря дёргает API бота.
 */
router.post('/accounts/:id/promo-uses/sync', async (req, res) => {
  try {
    const a = await loadAccount(req.params.id); if (!a) return res.status(404).json({ error: 'Аккаунт не найден' })
    const r = await bedolaga.syncPromoUses(db, a)
    if (!r.ok) return res.status(502).json({ error: r.error })
    audit.write(req, 'bedolaga.promo_sync', { type: 'bedolaga_account', id: a.id },
              { added: r.added, missed: r.missedNow }).catch(() => {})
    res.json(r)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
