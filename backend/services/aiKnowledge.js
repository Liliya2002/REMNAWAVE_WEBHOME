/**
 * База знаний ассистента поддержки: чему он учится и как это попадает в промпт.
 *
 * Важно понимать, что здесь происходит на самом деле. Модель не дообучается —
 * её веса не наши, и никакого fine-tuning через прокси нет. Вместо этого:
 *
 *   1. собираем из прошлых тикетов пары «вопрос клиента → ответ человека»;
 *   2. перед каждым новым тикетом ищем среди них несколько самых близких;
 *   3. кладём их модели как примеры.
 *
 * Снаружи это неотличимо от обучения: чем больше разобранных тикетов, тем
 * ближе ответы к тому, как отвечает живая поддержка. И, в отличие от
 * дообучения, работает сразу, откатывается выключением строки и объяснимо —
 * видно, на каком примере ассистент построил ответ.
 *
 * Поиск — встроенный полнотекстовый Postgres с русской конфигурацией. Со
 * стеммингом: «не работает на айфоне» находит «перестало работать айфон».
 * Векторных эмбеддингов нет намеренно — это ещё один внешний вызов на каждый
 * тикет, деньги и точка отказа, а на нашем объёме (десятки-сотни пар) выигрыш
 * не окупает усложнения.
 */
const crypto = require('crypto')
const db = require('../db')
const log = require('./logger').for('База знаний')

// ─── Отбор того, чему стоит учиться ─────────────────────────────────────────

/**
 * Дежурные ответы, на которых учиться нечему.
 *
 * Их в истории заметная доля: тикеты закрывают пачками по давности. Если такие
 * пары попадут в базу, ассистент начнёт отвечать «закрываем обращение» на живой
 * вопрос — то есть станет хуже, чем был.
 */
const USELESS_ANSWER = [
  /закрыва[ею]м обращени/i,
  /из-за давности/i,
  /вопрос ещё актуален\W*$/i,
  /^\s*(здравствуйте|добрый день|привет)[!.,]*\s*$/i,
  /^\s*(спасибо|пожалуйста|хорошо|принято|ок)[!.,]*\s*$/i,
  /^\s*\+*\s*$/,

  // Перевод в личку. Оператору так можно, ассистенту — нет: выучив это, он
  // начнёт раздавать чужой личный контакт вместо ответа по существу, и тикет
  // уйдёт туда, где его никто не увидит. Встречается в истории регулярно.
  /напиш(и|ите).{0,20}(в личку|личным|в лс)/i,
  /\bв личк[уе]\b/i,
  /@[a-z0-9_]{4,}/i,
]

/** Вопросы, по которым ничего не подберёшь: «а что там?», «ну?». */
const USELESS_QUESTION = [
  /^\s*(что|как|ну|и|а)\s*[?!.]*\s*$/i,
  /^\s*(спасибо|ок|хорошо|понял|понятно|ага)[!.,]*\s*$/i,
]

const MIN_Q = 15      // короче — обычно «?» или «ну что там»
const MIN_A = 40      // короче — обычно «да», «сделано», «ок»
const MAX_LEN = 2000

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

/**
 * Стоит ли учиться на этой паре.
 * @returns {{ok: true} | {ok: false, why: string}}
 */
function looksUseful(question, answer) {
  const q = clean(question)
  const a = clean(answer)
  if (q.length < MIN_Q) return { ok: false, why: 'вопрос слишком короткий' }
  if (a.length < MIN_A) return { ok: false, why: 'ответ слишком короткий' }
  if (q.length > MAX_LEN || a.length > MAX_LEN) return { ok: false, why: 'слишком длинно' }
  for (const re of USELESS_QUESTION) if (re.test(q)) return { ok: false, why: 'вопрос ни о чём' }
  for (const re of USELESS_ANSWER) if (re.test(a)) return { ok: false, why: 'дежурный ответ' }
  return { ok: true }
}

/** Отпечаток пары — чтобы один диалог не попал в базу дважды. */
function fingerprintOf(question, answer) {
  const norm = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '')
  return crypto.createHash('sha1').update(norm(question) + '|' + norm(answer)).digest('hex')
}

// ─── Запись ─────────────────────────────────────────────────────────────────

const WEIGHT = { history: 1, operator: 3, manual: 5 }

/**
 * Добавить пару. Повтор — не ошибка: сборщик ходит по тикетам регулярно и
 * каждый раз видит те же диалоги.
 * @returns {{added: boolean, reason?: string}}
 */
async function add({ accountId, source = 'history', ticketId = null, question, answer,
                     category = null, force = false }) {
  const q = clean(question).slice(0, MAX_LEN)
  const a = clean(answer).slice(0, MAX_LEN)
  if (!q || !a) return { added: false, reason: 'пусто' }

  // Отбор больше НЕ выбрасывает пару, а решает только, попадёт ли она в подбор.
  // Сохраняем всё: выброшенное нельзя ни посмотреть, ни переоценить, а решение
  // «этому учиться не стоит» принимает регэксп — он ошибается.
  const check = force ? { ok: true } : looksUseful(q, a)
  const active = check.ok
  const reason = check.ok ? null : check.why

  const r = await db.query(
    `INSERT INTO ai_knowledge (account_id, source, ticket_id, question, answer, category,
                               weight, fingerprint, is_active, skip_reason, reviewed_by_admin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (account_id, fingerprint) DO UPDATE
       SET source = CASE WHEN ai_knowledge.source = 'history' AND EXCLUDED.source <> 'history'
                         THEN EXCLUDED.source ELSE ai_knowledge.source END,
           weight = GREATEST(ai_knowledge.weight, EXCLUDED.weight),
           -- Добавление вручную включает пару, даже если она уже лежала
           -- выключенной. После полного сбора это основной случай: все пары
           -- из истории уже в базе, и кнопка «в базу знаний» попадает именно
           -- на отклонённые отбором. Без этого она молча ничего не делала.
           is_active = CASE WHEN $11 THEN true ELSE ai_knowledge.is_active END,
           skip_reason = CASE WHEN $11 THEN NULL ELSE ai_knowledge.skip_reason END,
           reviewed_by_admin = ai_knowledge.reviewed_by_admin OR $11,
           updated_at = NOW()
     RETURNING (xmax = 0) AS inserted, is_active`,
    [accountId, source, ticketId, q, a, category, WEIGHT[source] || 1,
     fingerprintOf(q, a), active, reason, force]
  )
  const row = r.rows[0] || {}
  return {
    added: !!row.inserted,
    // Была выключена, а теперь включена — для вызывающего это успех, а не
    // «уже есть»: с точки зрения человека пара только что попала в работу.
    activated: !row.inserted && !!row.is_active && force,
    active: !!row.is_active,
    reason: row.inserted ? reason : 'уже есть',
  }
}

// ─── Сбор из истории тикетов ────────────────────────────────────────────────

/**
 * Разобрать переписку на пары «последний вопрос клиента → ответ человека».
 *
 * Ответы самого ассистента в базу не идут: учиться на себе — верный способ
 * закрепить собственную ошибку. Отличаем их по тексту — в переписке бота и
 * оператор, и ассистент помечены одинаково (is_from_admin), но тексты своих
 * отправок мы храним в ai_ticket_replies.
 *
 * @param {string[]} ownReplies тексты, отправленные ассистентом по этому тикету
 */
function pairsFromTicket(ticket, ownReplies = []) {
  const msgs = Array.isArray(ticket.messages) ? ticket.messages : []
  const own = new Set(ownReplies.map(t => clean(t).toLowerCase()))
  const out = []

  for (let i = 1; i < msgs.length; i++) {
    const m = msgs[i]
    if (!m.is_from_admin) continue

    const text = clean(m.message_text)
    if (!text) continue
    if (own.has(text.toLowerCase())) continue        // это наш же ответ

    // Вопрос — все подряд идущие реплики клиента перед этим ответом: человек
    // часто дробит мысль на два-три сообщения.
    //
    // Свои ответы по пути ПЕРЕШАГИВАЕМ. Иначе в самом ценном случае — оператор
    // поправил ассистента — путь назад упирается в реплику ассистента, вопрос
    // клиента оказывается «не найден», и пример теряется именно там, где он
    // нужнее всего.
    const q = []
    let isOverride = false
    for (let j = i - 1; j >= 0; j--) {
      const prev = msgs[j]
      if (prev.is_from_admin) {
        if (own.has(clean(prev.message_text).toLowerCase())) { isOverride = true; continue }
        break                                   // дошли до чужого ответа — вопрос кончился
      }
      q.unshift(clean(prev.message_text))
    }
    if (!q.length) continue

    out.push({
      question: q.filter(Boolean).join(' '),
      answer: text,
      source: isOverride ? 'operator' : 'history',
    })
  }
  return out
}

/**
 * Пройти по тикетам аккаунта и пополнить базу.
 *
 * Только чтение на стороне бота: список тикетов и карточки. Ничего не
 * отправляет и не меняет.
 */
async function harvest(account, { limit = 100, bedolaga = require('./bedolaga') } = {}) {
  const list = await bedolaga.listTickets(account, { limit, offset: 0 })
  if (!list.ok) {
    await saveState(account.id, { error: list.error })
    return { ok: false, error: list.error }
  }
  const items = list.data?.items || list.data || []

  // Свои отправки по всем тикетам разом — чтобы не дёргать базу в цикле.
  const mine = await db.query(
    `SELECT ticket_id, reply_text FROM ai_ticket_replies
      WHERE account_id = $1 AND reply_text IS NOT NULL`,
    [account.id]
  )
  const ownByTicket = new Map()
  for (const r of mine.rows) {
    if (!ownByTicket.has(r.ticket_id)) ownByTicket.set(r.ticket_id, [])
    ownByTicket.get(r.ticket_id).push(r.reply_text)
  }

  let scanned = 0, added = 0, inactive = 0, known = 0
  const reasons = {}

  for (const t of items) {
    let card = t
    if (!Array.isArray(card.messages) || !card.messages.length) {
      const r = await bedolaga.getTicket(account, t.id)
      if (!r.ok) continue
      card = r.data
    }
    scanned++
    for (const p of pairsFromTicket(card, ownByTicket.get(t.id) || [])) {
      const res = await add({
        accountId: account.id, source: p.source, ticketId: t.id,
        question: p.question, answer: p.answer, category: card.title || null,
      })
      if (res.added) {
        added++
        if (!res.active) { inactive++; reasons[res.reason] = (reasons[res.reason] || 0) + 1 }
      } else known++
    }
  }

  // Перепроверяем то, что уже лежит в базе.
  //
  // Фильтры отбора мы правим по мере того, как находим вредные примеры, — но
  // применяются они только при вставке. Без этого прохода правило, добавленное
  // сегодня, не подействует на всё, что собрано вчера, и ассистент продолжит
  // учиться на том, ради чего правило и заводили.
  const disabled = await recheckExisting(account.id)

  await saveState(account.id, { scanned, added, skipped: inactive })
  log.info(`Разобрано тикетов: ${scanned}, новых пар: ${added} (из них выключено отбором: ${inactive}), уже было: ${known}` +
    (disabled ? `, отключено по новым правилам: ${disabled}` : ''))
  return { ok: true, scanned, added, inactive, known, disabled, reasons }
}

/**
 * Прогнать действующие фильтры по уже собранным примерам и выключить те, что
 * больше не проходят. Добавленные руками не трогаем: админ знал, что делал.
 * @returns {number} сколько выключено
 */
async function recheckExisting(accountId) {
  const { rows } = await db.query(
    `SELECT id, question, answer FROM ai_knowledge
      WHERE account_id = $1 AND is_active = true
        AND source <> 'manual' AND reviewed_by_admin = false`,
    [accountId]
  )
  const bad = rows
    .map(r => ({ id: r.id, check: looksUseful(r.question, r.answer) }))
    .filter(x => !x.check.ok)
  if (!bad.length) return 0
  for (const b of bad) {
    await db.query(
      `UPDATE ai_knowledge SET is_active = false, skip_reason = $2, updated_at = NOW() WHERE id = $1`,
      [b.id, b.check.why]
    )
  }
  return bad.length
}

async function saveState(accountId, { scanned = 0, added = 0, skipped = 0, error = null }) {
  await db.query(
    `INSERT INTO ai_knowledge_state (account_id, last_run_at, scanned_total, added_total, skipped_total, last_error)
     VALUES ($1, NOW(), $2, $3, $4, $5)
     ON CONFLICT (account_id) DO UPDATE
       SET last_run_at = NOW(),
           scanned_total = ai_knowledge_state.scanned_total + EXCLUDED.scanned_total,
           added_total   = ai_knowledge_state.added_total   + EXCLUDED.added_total,
           skipped_total = ai_knowledge_state.skipped_total + EXCLUDED.skipped_total,
           last_error    = EXCLUDED.last_error`,
    [accountId, scanned, added, skipped, error]
  ).catch(e => log.warn('Состояние сборщика не записалось: ' + e.message))
}

// ─── Подбор примеров под конкретный тикет ───────────────────────────────────

/**
 * Найти примеры, близкие к вопросу клиента.
 *
 * Ранг умножается на вес источника: поправка оператора при прочих равных
 * вытесняет рядовой пример из истории. Порог отсекает случайные совпадения по
 * одному общему слову — лучше не дать модели ничего, чем дать пример не по теме:
 * он собьёт её сильнее, чем отсутствие примеров.
 */
const MIN_RANK = 0.05

async function findRelevant(accountId, text, { limit = 4 } = {}) {
  const q = clean(text).slice(0, 1000)
  if (q.length < 8) return []

  // ИЛИ вместо И. plainto_tsquery склеивает слова через «&», то есть требует
  // в примере ВСЕ слова вопроса сразу — для живого обращения на три строки это
  // не срабатывает почти никогда: проверено, ноль совпадений на 17 примерах.
  // Заменяем связку на «|» и полагаемся на ранжирование: чем больше пересечение,
  // тем выше ранг. Инъекции нет — строка сперва проходит через plainto_tsquery,
  // а уже её нормализованный вывод переписывается.
  const { rows } = await db.query(
    `WITH qq AS (
       SELECT NULLIF(replace(plainto_tsquery('russian', $2)::text, '&', '|'), '')::tsquery AS q
     )
     SELECT k.id, k.question, k.answer, k.source, k.category, k.weight,
            ts_rank(k.search, qq.q) * k.weight AS score
       FROM ai_knowledge k, qq
      WHERE k.account_id = $1
        AND k.is_active = true
        AND qq.q IS NOT NULL
        AND k.search @@ qq.q
      ORDER BY score DESC
      LIMIT $3`,
    [accountId, q, limit]
  )
  return rows.filter(r => Number(r.score) >= MIN_RANK)
}

/** Отметить, что примеры пригодились — видно, какие реально работают. */
async function markUsed(ids) {
  if (!ids?.length) return
  await db.query(
    `UPDATE ai_knowledge SET used_count = used_count + 1, last_used_at = NOW() WHERE id = ANY($1::int[])`,
    [ids]
  ).catch(() => {})
}

/** Блок примеров для промпта. Пусто — значит блока в промпте не будет вовсе. */
function renderForPrompt(examples) {
  if (!examples.length) return ''
  const parts = ['\n── Как на похожие вопросы отвечали наши операторы ──']
  for (const e of examples) {
    const tag = e.source === 'operator' ? ' (оператор поправил ассистента — ориентируйся на это в первую очередь)' : ''
    parts.push(`\nВопрос клиента: ${e.question}\nОтвет поддержки${tag}: ${e.answer}`)
  }
  parts.push('\nЭто образцы тона и подхода, а не готовые ответы. Если вопрос отличается — отвечай по существу нового вопроса, а не копируй пример.')
  return parts.join('\n')
}

// ─── Сводка для админки ─────────────────────────────────────────────────────

async function stats(accountId = null) {
  const where = accountId ? 'WHERE account_id = $1' : ''
  const args = accountId ? [accountId] : []
  const { rows } = await db.query(
    `SELECT source, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_active)::int AS active,
            COALESCE(SUM(used_count), 0)::int AS used
       FROM ai_knowledge ${where} GROUP BY source`, args)
  const out = { total: 0, active: 0, used: 0, by_source: {} }
  for (const r of rows) {
    out.total += r.n; out.active += r.active; out.used += r.used
    out.by_source[r.source] = { total: r.n, active: r.active, used: r.used }
  }
  const st = accountId
    ? (await db.query('SELECT * FROM ai_knowledge_state WHERE account_id = $1', [accountId])).rows[0]
    : null
  return { ...out, state: st || null }
}

module.exports = {
  add, harvest, findRelevant, markUsed, renderForPrompt, stats, recheckExisting,
  pairsFromTicket, looksUseful, fingerprintOf, WEIGHT, MIN_RANK,
}
