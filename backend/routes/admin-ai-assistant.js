/**
 * ИИ-ассистент поддержки: настройки, шаблоны ответов, журнал.
 *
 * Ключ провайдера наружу не отдаём никогда — только флаг has_key.
 * Пустая строка в PUT означает «не менять», как и у остальных секретов проекта.
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const { encrypt } = require('../services/encryption')
const ai = require('../services/aiAssistant')
const bedolaga = require('../services/bedolaga')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

/** Убираем секрет и добавляем производные поля. */
function safeSettings(s) {
  const { api_key, ...rest } = s
  return { ...rest, has_key: !!api_key }
}

// ─── Настройки ────────────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ai_assistant_settings WHERE id = 1')
    res.json({ settings: safeSettings(rows[0] || {}), default_prompt: ai.BASE_PROMPT })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/settings', async (req, res) => {
  try {
    const b = req.body || {}

    // started_at ставится в момент ВКЛЮЧЕНИЯ и больше не двигается: это отсечка
    // накопленного бэклога. Если её переставлять при каждом сохранении, ассистент
    // после любой правки настроек снова считал бы старые тикеты новыми.
    const cur = (await db.query('SELECT enabled, started_at FROM ai_assistant_settings WHERE id = 1')).rows[0] || {}
    const turningOn = b.enabled === true && !cur.enabled
    const startedAt = turningOn && !cur.started_at ? new Date() : cur.started_at

    const clamp = (v, lo, hi, def) => {
      const n = Number(v); return isFinite(n) ? Math.min(Math.max(n, lo), hi) : def
    }

    const { rows } = await db.query(
      `UPDATE ai_assistant_settings SET
         enabled = COALESCE($1, enabled),
         api_key = COALESCE($2, api_key),
         base_url = COALESCE($3, base_url),
         model = COALESCE($4, model),
         effort = COALESCE($5, effort),
         max_tokens = COALESCE($6, max_tokens),
         reply_char_limit = COALESCE($7, reply_char_limit),
         dry_run = COALESCE($8, dry_run),
         max_ticket_age_hours = COALESCE($9, max_ticket_age_hours),
         can_close_tickets = COALESCE($10, can_close_tickets),
         confidence_threshold = COALESCE($11, confidence_threshold),
         poll_interval_min = COALESCE($12, poll_interval_min),
         stop_words = COALESCE($13, stop_words),
         system_prompt = COALESCE($14, system_prompt),
         close_stale_enabled = COALESCE($16, close_stale_enabled),
         close_stale_days = COALESCE($17, close_stale_days),
         close_stale_message = COALESCE($18, close_stale_message),
         close_stale_unanswered = COALESCE($19, close_stale_unanswered),
         started_at = $15,
         updated_at = NOW()
       WHERE id = 1 RETURNING *`,
      [
        b.enabled,
        // Пустая строка = «не менять», иначе секрет затирался бы при каждом сохранении формы
        b.api_key ? encrypt(b.api_key) : null,
        b.base_url || null,
        b.model || null,
        ['low', 'medium', 'high', 'xhigh', 'max'].includes(b.effort) ? b.effort : null,
        b.max_tokens == null ? null : clamp(b.max_tokens, 1000, 64000, 8000),
        b.reply_char_limit == null ? null : clamp(b.reply_char_limit, 200, 4000, 1200),
        b.dry_run,
        b.max_ticket_age_hours == null ? null : clamp(b.max_ticket_age_hours, 1, 720, 48),
        b.can_close_tickets,
        b.confidence_threshold == null ? null : clamp(b.confidence_threshold, 0, 1, 0.75),
        b.poll_interval_min == null ? null : clamp(b.poll_interval_min, 2, 120, 10),
        Array.isArray(b.stop_words) ? b.stop_words.map(String).filter(Boolean) : null,
        b.system_prompt === undefined ? null : b.system_prompt,
        startedAt || null,
        b.close_stale_enabled,
        b.close_stale_days == null ? null : clamp(b.close_stale_days, 7, 3650, 30),
        b.close_stale_message === undefined ? null : b.close_stale_message,
        b.close_stale_unanswered,
      ]
    )

    audit.write(req, 'ai.settings.update', { type: 'ai_assistant', id: 1 },
      { enabled: b.enabled, dry_run: b.dry_run }).catch(() => {})

    try { await require('../cron/aiTickets').reschedule() }
    catch (e) { console.warn('[ai] reschedule:', e.message) }

    res.json({ settings: safeSettings(rows[0]) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/** Проверка связи с провайдером. Дешёвый запрос — просто чтобы понять,
 *  что ключ и базовый URL рабочие. */
router.post('/test', async (req, res) => {
  try {
    const cfg = await ai.getSettings(db)
    if (!cfg.apiKey) return res.status(400).json({ error: 'Ключ не задан' })
    const r = await ai.ping(cfg)
    res.json(r)
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ─── Шаблоны ответов ──────────────────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ai_reply_templates ORDER BY priority, id')
    res.json({ templates: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/templates', async (req, res) => {
  try {
    const { category, question, answer, priority, is_active } = req.body || {}
    if (!question?.trim() || !answer?.trim()) {
      return res.status(400).json({ error: 'Нужны и вопрос, и ответ' })
    }
    const { rows } = await db.query(
      `INSERT INTO ai_reply_templates (category, question, answer, priority, is_active)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [category || null, question.trim(), answer.trim(), Number(priority) || 100, is_active !== false]
    )
    res.status(201).json({ template: rows[0] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/templates/:id', async (req, res) => {
  try {
    const { category, question, answer, priority, is_active } = req.body || {}
    const { rows } = await db.query(
      `UPDATE ai_reply_templates SET
         category = COALESCE($1, category), question = COALESCE($2, question),
         answer = COALESCE($3, answer), priority = COALESCE($4, priority),
         is_active = COALESCE($5, is_active), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [category ?? null, question?.trim() || null, answer?.trim() || null,
       priority == null ? null : Number(priority), is_active, req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Шаблон не найден' })
    res.json({ template: rows[0] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/templates/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM ai_reply_templates WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Журнал ───────────────────────────────────────────────────────────────────

router.get('/log', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const where = []
    const params = []
    if (req.query.action) { params.push(req.query.action); where.push(`action = $${params.length}`) }
    if (req.query.reason) { params.push(req.query.reason); where.push(`escalation_reason = $${params.length}`) }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const [rows, total, stats] = await Promise.all([
      db.query(`SELECT * FROM ai_ticket_replies ${w} ORDER BY created_at DESC
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
      db.query(`SELECT COUNT(*)::int n FROM ai_ticket_replies ${w}`, params),
      db.query(`SELECT action, COUNT(*)::int n,
                       COALESCE(SUM(input_tokens),0)::int input_tokens,
                       COALESCE(SUM(output_tokens),0)::int output_tokens
                  FROM ai_ticket_replies GROUP BY action ORDER BY n DESC`),
    ])
    res.json({ items: rows.rows, total: total.rows[0].n, limit, offset, by_action: stats.rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * Ручная отправка ответа, который ассистент подготовил в холостом режиме.
 * POST без ретраев: повтор отправил бы клиенту второе сообщение.
 */
router.post('/log/:id/send', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ai_ticket_replies WHERE id = $1', [req.params.id])
    const row = rows[0]
    if (!row) return res.status(404).json({ error: 'Запись не найдена' })
    if (row.action !== 'dry_run') return res.status(400).json({ error: 'Отправить можно только черновик холостого прогона' })
    if (!row.reply_text) return res.status(400).json({ error: 'В записи нет текста' })

    const acc = (await db.query('SELECT * FROM bedolaga_accounts WHERE id = $1', [row.account_id])).rows[0]
    if (!acc) return res.status(404).json({ error: 'Аккаунт не найден' })

    const sent = await bedolaga.replyToTicket(acc, row.ticket_id, req.body?.text || row.reply_text)
    if (!sent.ok) return res.status(502).json({ error: sent.error })

    await db.query(`UPDATE ai_ticket_replies SET action='replied', reply_text=$1 WHERE id=$2`,
      [req.body?.text || row.reply_text, row.id])
    audit.write(req, 'ai.reply.send_manual', { type: 'ticket', id: row.ticket_id }, {}).catch(() => {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/** Прогон вхолостую прямо сейчас — не дожидаясь тика крона. */
router.post('/run-now', async (req, res) => {
  try {
    await require('../cron/aiTickets').tick()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
