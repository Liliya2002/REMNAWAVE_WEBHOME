/**
 * PROMETHEUS: память.
 *
 * ── Почему запись здесь есть, хотя раздел «только на чтение» ──
 *
 * Запрет касается ДАННЫХ ПРОЕКТА: пользователей, платежей, подписок, настроек,
 * исходников, внешних сервисов. Там по-прежнему нет ни одного пишущего
 * инструмента, и не появится.
 *
 * Память — это его собственный блокнот, отдельные таблицы prometheus_*.
 * Запись в них ничего в проекте не меняет, зато без неё «развивается со
 * временем» невозможно: каждый разбор начинался бы с чистого листа, и на сотом
 * вопросе он знал бы ровно столько же, сколько на первом.
 *
 * Чтобы разница не размывалась, записывать он может не произвольным SQL, а
 * только через три функции ниже. Каждая умеет трогать ровно одну свою
 * таблицу и ничего больше — сколько бы модель ни просила, дотянуться до
 * users или payments отсюда нечем.
 *
 * ── Почему смена нейросети ничего не стирает ──
 *
 * В памяти лежит обычный текст в нашей базе: тема, содержание, чем
 * подтверждено. Ни эмбеддингов, ни форматов конкретного поставщика, ни его
 * идентификаторов сессий. Поиск — встроенный полнотекстовый Postgres.
 * Поэтому смена модели сводится к замене ключа и адреса в настройках: новая
 * читает ту же память с первого вопроса и продолжает с того же места.
 */
const crypto = require('crypto')
const db = require('../../db')
const log = require('../logger').for('Prometheus')

const KINDS = ['fact', 'context', 'decision', 'lesson']
const MAX_CONTENT = 2000

// ─── Запись ─────────────────────────────────────────────────────────────────

/**
 * Запомнить факт, контекст, решение владельца или вывод из своей ошибки.
 *
 * Запись по теме ОБНОВЛЯЕТСЯ, а не копится: иначе через месяц по теме
 * «сегмент expired» будет двадцать почти одинаковых наблюдений, и непонятно,
 * какое из них нынешнее. Прежняя версия не удаляется — помечается устаревшей и
 * ссылается на новую: «было так, стало иначе» само по себе ценно.
 */
async function remember({ kind = 'fact', topic, content, confidence = 0.8, sessionId = null, evidence = null }) {
  const t = String(topic || '').trim().slice(0, 200)
  const c = String(content || '').trim().slice(0, MAX_CONTENT)
  if (!t || !c) return { ok: false, error: 'Нужны и тема, и содержание' }
  if (!KINDS.includes(kind)) return { ok: false, error: `kind должен быть одним из: ${KINDS.join(', ')}` }

  const prev = await db.query(
    `SELECT id, content FROM prometheus_memory
      WHERE lower(topic) = lower($1) AND kind = $2 AND is_active = true
      ORDER BY id DESC LIMIT 1`, [t, kind])

  // Ровно то же самое — не плодим запись, просто отмечаем, что подтвердилось.
  if (prev.rows[0] && prev.rows[0].content.trim() === c) {
    await db.query('UPDATE prometheus_memory SET updated_at = NOW() WHERE id = $1', [prev.rows[0].id])
    return { ok: true, id: prev.rows[0].id, unchanged: true }
  }

  const ins = await db.query(
    `INSERT INTO prometheus_memory (kind, topic, content, confidence, session_id, evidence)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [kind, t, c, Math.max(0, Math.min(1, Number(confidence) || 0.8)), sessionId, evidence]
  )
  const id = ins.rows[0].id

  if (prev.rows[0]) {
    await db.query(
      'UPDATE prometheus_memory SET is_active = false, superseded_by = $2, updated_at = NOW() WHERE id = $1',
      [prev.rows[0].id, id])
  }
  log.debug(`запомнил [${kind}] ${t}`)
  return { ok: true, id, replaced: prev.rows[0]?.id || null }
}

/** Отпечаток проблемы — чтобы одна и та же не заводилась заново каждый разбор. */
function fingerprintOf(title, area) {
  const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()
  return crypto.createHash('sha1').update(norm(area) + '|' + norm(title)).digest('hex')
}

/**
 * Зафиксировать найденную проблему.
 *
 * Повтор той же проблемы не создаёт вторую запись и НЕ воскрешает уже
 * отклонённую: если владелец сказал «так задумано», поднимать это снова не
 * нужно — обновится только описание.
 */
async function reportFinding({ title, detail = null, severity = 'medium', area = null, sessionId = null, evidence = null }) {
  const t = String(title || '').trim().slice(0, 300)
  if (!t) return { ok: false, error: 'Нужен заголовок проблемы' }
  const sev = ['low', 'medium', 'high'].includes(severity) ? severity : 'medium'
  const fp = fingerprintOf(t, area)

  const r = await db.query(
    `INSERT INTO prometheus_findings (title, detail, severity, area, session_id, evidence, fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (fingerprint) DO UPDATE
       SET detail = EXCLUDED.detail,
           severity = EXCLUDED.severity,
           evidence = EXCLUDED.evidence,
           updated_at = NOW()
     RETURNING id, status, (xmax = 0) AS created`,
    [t, detail, sev, area, sessionId, evidence, fp]
  )
  const row = r.rows[0]
  return {
    ok: true, id: row.id, created: row.created, status: row.status,
    note: row.created ? null
      : (row.status === 'dismissed'
          ? 'Эту проблему владелец уже отклонил — не поднимай её снова без новых данных'
          : `Такая проблема уже есть, статус: ${row.status}`),
  }
}

// ─── Чтение ─────────────────────────────────────────────────────────────────

/** Найти в памяти относящееся к теме вопроса. */
async function search(text, { limit = 12 } = {}) {
  const q = String(text || '').trim().slice(0, 1000)
  if (q.length < 3) return []
  // ИЛИ вместо И: требовать в записи все слова вопроса — значит не находить
  // почти ничего. Та же причина, что и в базе знаний ассистента тикетов.
  const { rows } = await db.query(
    `WITH qq AS (SELECT NULLIF(replace(plainto_tsquery('russian', $1)::text, '&', '|'), '')::tsquery AS q)
     SELECT m.id, m.kind, m.topic, m.content, m.confidence, m.evidence, m.created_at,
            ts_rank(m.search, qq.q) AS score
       FROM prometheus_memory m, qq
      WHERE m.is_active = true AND qq.q IS NOT NULL AND m.search @@ qq.q
      ORDER BY score DESC, m.updated_at DESC
      LIMIT $2`, [q, limit])
  return rows
}

/** Свежая и важная память — то, что стоит держать перед глазами всегда. */
async function recent({ limit = 20 } = {}) {
  const { rows } = await db.query(
    `SELECT id, kind, topic, content, confidence, created_at
       FROM prometheus_memory
      WHERE is_active = true
      ORDER BY (kind = 'decision') DESC, updated_at DESC
      LIMIT $1`, [limit])
  return rows
}

/** Открытые и отклонённые проблемы — чтобы не поднимать решённое. */
async function findings({ limit = 30 } = {}) {
  const { rows } = await db.query(
    `SELECT id, title, severity, area, status, verdict, created_at
       FROM prometheus_findings
      WHERE status <> 'fixed'
      ORDER BY (status = 'open') DESC,
               CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               updated_at DESC
      LIMIT $1`, [limit])
  return rows
}

/**
 * Что он знает — блоком для начала разбора.
 *
 * Идёт в промпт перед вопросом. Пусто на первом запуске — и это нормально:
 * память набирается по ходу работы, а не закладывается заранее.
 */
async function briefing(question) {
  const [rel, dec, fnd] = await Promise.all([
    search(question, { limit: 10 }),
    recent({ limit: 12 }),
    findings({ limit: 20 }),
  ])

  // Объединяем без повторов: найденное по теме важнее просто свежего.
  const seen = new Set()
  const items = []
  for (const m of [...rel, ...dec]) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    items.push(m)
  }
  if (!items.length && !fnd.length) return ''

  const KIND = { fact: 'факт', context: 'как устроено', decision: 'решение владельца', lesson: 'вывод из ошибки' }
  const parts = ['\n── Что ты уже знаешь об этом проекте ──']
  parts.push('Это твоя память из прошлых разборов. Не пересказывай её владельцу — он это уже знает; опирайся и проверяй, если что-то могло измениться.')

  for (const m of items.slice(0, 18)) {
    const ev = m.evidence ? ` (подтверждено: ${String(m.evidence).slice(0, 120)})` : ''
    parts.push(`\n[${KIND[m.kind] || m.kind}] ${m.topic}: ${m.content}${ev}`)
  }

  if (fnd.length) {
    parts.push('\n── Проблемы, которые ты уже находил ──')
    for (const f of fnd) {
      if (f.status === 'dismissed') {
        parts.push(`[ОТКЛОНЕНА владельцем] ${f.title}${f.verdict ? ` — причина: ${f.verdict}` : ''}. Не поднимай снова без новых данных.`)
      } else {
        parts.push(`[${f.status === 'accepted' ? 'принята в работу' : 'открыта'}, ${f.severity}] ${f.title}`)
      }
    }
  }
  return parts.join('\n')
}

/** Отметить, что запись памяти пригодилась. */
async function markUsed(ids) {
  if (!ids?.length) return
  await db.query('UPDATE prometheus_memory SET used_count = used_count + 1 WHERE id = ANY($1::int[])', [ids])
    .catch(() => {})
}

async function stats() {
  const m = await db.query(
    `SELECT kind, COUNT(*) FILTER (WHERE is_active)::int AS активных, COUNT(*)::int AS всего
       FROM prometheus_memory GROUP BY kind`)
  const f = await db.query(
    'SELECT status, COUNT(*)::int AS n FROM prometheus_findings GROUP BY status')
  return {
    memory: m.rows,
    findings: f.rows,
    total_memory: m.rows.reduce((a, r) => a + r.активных, 0),
  }
}

module.exports = {
  remember, reportFinding, search, recent, findings, briefing, markUsed, stats,
  fingerprintOf, KINDS,
}
