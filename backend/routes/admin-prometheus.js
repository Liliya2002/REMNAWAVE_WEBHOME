/**
 * PROMETHEUS — аналитический центр проекта.
 *
 * Все эндпоинты только читают. Единственное, что здесь пишется, — история
 * самих разборов (кто что спросил и что ответил): она нужна, чтобы вывод можно
 * было перепроверить, а не верить на слово.
 *
 * Разбор занимает минуты: модель ходит за данными по нескольку раз, один
 * запрос к ней — до двух минут. Дождаться его в рамках HTTP-запроса нельзя:
 * nginx рвёт соединение на шестидесятой секунде. Поэтому /ask только запускает
 * разбор и отдаёт его номер, а ход и результат забираются через
 * GET /sessions/:id.
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const engine = require('../services/prometheus/engine')
const tools = require('../services/prometheus/tools')
const ro = require('../services/prometheus/readonly')
const memory = require('../services/prometheus/memory')
const connection = require('../services/prometheus/connection')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

/** Состояние раздела: что умеет, работает ли защита, есть ли ключ. */
router.get('/status', async (req, res) => {
  try {
    const guard = await ro.selfCheck()
    const conn = await connection.get()
    const stats = (await db.query(
      `SELECT COUNT(*)::int AS сессий,
              COALESCE(SUM(input_tokens + output_tokens), 0)::int AS токенов,
              COALESCE(SUM(tool_calls), 0)::int AS обращений
         FROM prometheus_sessions`)).rows[0]

    res.json({
      readonly_ok: guard.ok,
      readonly_failed: guard.failed || [],
      has_key: !!conn.apiKey,
      model: conn.model || null,
      connection_checked: conn.check_result || null,
      tools: tools.toolDefinitions().map(t => ({ name: t.name, description: t.description })),
      masked_columns: {
        secrets: [...ro.SECRET_COLUMNS].length,
        pii: [...ro.PII_COLUMNS].length,
      },
      stats,
      memory: await memory.stats(),
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/** Список разборов. */
router.get('/sessions', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
    const { rows } = await db.query(
      `SELECT s.*, u.login AS автор,
              (SELECT COUNT(*)::int FROM prometheus_messages m WHERE m.session_id = s.id) AS реплик
         FROM prometheus_sessions s
         LEFT JOIN users u ON u.id = s.started_by
        ORDER BY s.updated_at DESC LIMIT $1`, [limit])
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * Один разбор целиком, вместе с обращениями к инструментам.
 *
 * Его же опрашивает страница, пока идёт разбор: реплики пишутся по мере дела,
 * поэтому видно, за какими данными он сходил, ещё до готового ответа.
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    const s = (await db.query('SELECT * FROM prometheus_sessions WHERE id = $1', [req.params.id])).rows[0]
    if (!s) return res.status(404).json({ error: 'Разбор не найден' })
    const m = await db.query(
      'SELECT * FROM prometheus_messages WHERE session_id = $1 ORDER BY id', [req.params.id])

    // «Идёт работа» в базе и отсутствие её в памяти процесса — значит разбор
    // оборвался (перезапуск, падение). Ждать такой ответ бессмысленно, и лучше
    // сказать об этом, чем крутить ожидание вечно.
    if (s.run_status === 'running' && !engine.isRunning(s.id)
        && Date.now() - new Date(s.run_started_at || s.created_at).getTime() > 30000) {
      s.run_status = 'error'
      s.run_error = s.run_error || 'Разбор оборвался и не будет продолжен'
    }
    res.json({ session: s, messages: m.rows, running: s.run_status === 'running' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * Запустить разбор.
 *
 * Отвечает сразу номером разбора, не дожидаясь результата: ответа ждать
 * минуты, а шлюз рвёт соединение раньше. Ошибки, о которых можно сказать
 * немедленно (нет ключа, не прошла защита), возвращаются здесь же.
 */
router.post('/ask', async (req, res) => {
  try {
    const { question, session_id } = req.body || {}
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'Нужен вопрос' })
    }
    // В журнал — сам факт обращения. Содержимое разбора и так в своей таблице.
    await audit.write(req, 'prometheus.ask', { type: 'prometheus' },
      { question: String(question).slice(0, 300) })

    const r = await engine.start(String(question).slice(0, 8000), {
      sessionId: session_id || null,
      userId: req.userId,
    })
    if (!r.ok) return res.status(502).json(r)
    res.status(202).json(r)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/** Удалить разбор из истории. Единственное разрушающее действие раздела —
 *  и относится оно к его собственным записям, не к данным проекта. */
router.delete('/sessions/:id', async (req, res) => {
  try {
    if (engine.isRunning(req.params.id)) {
      return res.status(409).json({ error: 'Разбор ещё идёт — дождитесь окончания' })
    }
    const { rowCount } = await db.query('DELETE FROM prometheus_sessions WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Разбор не найден' })
    await audit.write(req, 'prometheus.session.delete', { type: 'prometheus', id: req.params.id })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Подключение ────────────────────────────────────────────────────────────

/** Своё подключение к нейросети. Ключ наружу не отдаём — только флаг. */
router.get('/connection', async (req, res) => {
  try {
    const c = await connection.get()
    res.json({
      own: c.own, inherited: c.inherited,
      effective: { base_url: c.base_url, model: c.model, max_tokens: c.max_tokens, has_key: !!c.apiKey },
      send_thinking: c.send_thinking,
      checked_at: c.checked_at, check_result: c.check_result,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/connection', async (req, res) => {
  try {
    const c = await connection.save(req.body || {})
    // В журнал — факт смены подключения, без ключа и без адреса.
    await audit.write(req, 'prometheus.connection.update', { type: 'prometheus' },
      { model: c.model, key_changed: req.body?.api_key ? true : undefined })
    res.json({ own: c.own, inherited: c.inherited, effective: { base_url: c.base_url, model: c.model, has_key: !!c.apiKey } })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * Проверить связь.
 *
 * Не «отвечает ли что-нибудь», а «вызывает ли инструменты»: разбор состоит из
 * обращений к данным, и провайдер, который их проглатывает, здесь бесполезен,
 * хотя на обычном вопросе выглядит исправным.
 */
router.post('/connection/test', async (req, res) => {
  try {
    res.json(await connection.check())
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

/** Список моделей у провайдера — чтобы не угадывать название руками. */
router.get('/connection/models', async (req, res) => {
  try {
    res.json(await connection.models())
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ─── Память ─────────────────────────────────────────────────────────────────

/** Что он запомнил. Владелец должен это видеть: память влияет на все разборы. */
router.get('/memory', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, s.title AS из_разбора
         FROM prometheus_memory m
         LEFT JOIN prometheus_sessions s ON s.id = m.session_id
        WHERE ($1 = 'all' OR m.is_active = ($1 = 'active'))
        ORDER BY m.is_active DESC, m.updated_at DESC
        LIMIT 200`,
      [req.query.filter === 'all' ? 'all' : 'active'])
    res.json({ items: rows, stats: await memory.stats() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * Забыть запись.
 *
 * Нужно владельцу, а не ему: если он запомнил неверно, ошибка будет всплывать
 * в каждом следующем разборе, и переспорить её изнутри нечем.
 */
router.delete('/memory/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM prometheus_memory WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Запись не найдена' })
    await audit.write(req, 'prometheus.memory.delete', { type: 'prometheus_memory', id: req.params.id })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── Находки ────────────────────────────────────────────────────────────────

router.get('/findings', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.*, u.login AS решил
         FROM prometheus_findings f
         LEFT JOIN users u ON u.id = f.decided_by
        ORDER BY (f.status = 'open') DESC,
                 CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 f.updated_at DESC
        LIMIT 200`)
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * Решение владельца по находке.
 *
 * Это и есть обратная связь, на которой он учится: отклонённую проблему он
 * больше не поднимает, а причина отказа уходит ему в память и объясняет,
 * почему здесь так.
 */
router.put('/findings/:id', async (req, res) => {
  try {
    const { status, verdict } = req.body || {}
    if (!['open', 'accepted', 'dismissed', 'fixed'].includes(status)) {
      return res.status(400).json({ error: 'status: open, accepted, dismissed или fixed' })
    }
    const { rows } = await db.query(
      `UPDATE prometheus_findings
          SET status = $2, verdict = COALESCE(NULLIF($3, ''), verdict),
              decided_at = NOW(), decided_by = $4, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id, status, verdict || '', req.userId])
    if (!rows[0]) return res.status(404).json({ error: 'Находка не найдена' })

    // Решение владельца — это знание о проекте, а не просто смена статуса.
    if (status === 'dismissed' && verdict) {
      await memory.remember({
        kind: 'decision',
        topic: rows[0].area ? `${rows[0].area}: ${rows[0].title}`.slice(0, 200) : rows[0].title,
        content: `Владелец отклонил: ${verdict}`,
        confidence: 1,
        evidence: `находка #${rows[0].id}`,
      }).catch(() => {})
    }
    await audit.write(req, 'prometheus.finding.decide',
      { type: 'prometheus_finding', id: req.params.id }, { status, verdict })
    res.json({ item: rows[0] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
