/**
 * Отдача рассылок по промокодам.
 *
 * Идея: если в рассылке был промокод, посчитать, сколько раз его активировали
 * ПОСЛЕ отправки, и учитывать это при выборе следующей рассылки.
 *
 * ── Ограничение, о котором нельзя забывать ─────────────────────────────────
 * API бота отдаёт только ПОСЛЕДНИЕ 10 активаций каждого кода (recent_uses,
 * пагинации нет). Поэтому существует накопительная таблица
 * bedolaga_promo_uses и крон синхронизации: он забирает новые активации и
 * складывает их у нас.
 *
 * Следствия:
 *   • историю до включения синхронизации восстановить НЕЛЬЗЯ — у большинства
 *     старых кодов в базе ровно 10 записей, и это последние, а не те, что
 *     были сразу после рассылки. Такие рассылки в расчёт не берём совсем,
 *     иначе получим уверенные, но лживые цифры;
 *   • синхронизация должна успевать: при потолке в 10 записей и наблюдаемом
 *     пике 3 активации в час часовой интервал даёт запас втрое. Крон сам
 *     считает потери (missed_total) — если он не ноль, интервал мал.
 */
const db = require('../db')
const bedolaga = require('./bedolaga')

// Слова капсом, которые кодами не являются.
const NOT_CODES = new Set([
  'VPN', 'HTTP', 'HTTPS', 'IOS', 'ANDROID', 'WIFI', 'QR', 'SBP', 'TELEGRAM',
  'PRO', 'MAX', 'NEW', 'FREE', 'TOP',
])

/** Коды, упомянутые в тексте, — только те, что существуют в базе активаций. */
function extractCodes(text, knownCodes) {
  const known = new Set(knownCodes.map(c => String(c).toUpperCase()))
  const found = String(text || '').match(/\b[A-Z][A-Z0-9]{3,19}\b/g) || []
  return [...new Set(found)].filter(c => known.has(c) && !NOT_CODES.has(c))
}

/**
 * Отдача каждой рассылки, где был промокод.
 *
 * @param {number} windowDays — окно, в котором считаем активации
 * @returns {{ok: true, items, byCode, coverage}}
 */
async function promoPerformance(account, { windowDays = 7 } = {}) {
  const hist = await bedolaga.getBroadcastHistory(account)
  if (!hist.ok) return { ok: false, error: hist.error }

  // Раньше этой даты данных об активациях у нас просто нет: синхронизация
  // началась позже, и всё, что мы видим до неё, — обрезанный хвост.
  const { rows: cov } = await db.query(
    `SELECT MIN(first_seen_at) AS since, COUNT(*)::int AS uses
       FROM bedolaga_promo_uses WHERE account_id = $1`,
    [account.id]
  )
  const since = cov[0] && cov[0].since ? new Date(cov[0].since) : null

  const { rows: codeRows } = await db.query(
    'SELECT DISTINCT code FROM bedolaga_promo_uses WHERE account_id = $1',
    [account.id]
  )
  const knownCodes = codeRows.map(r => r.code)

  const items = []
  for (const b of hist.items) {
    const codes = extractCodes(b.message_text, knownCodes)
    if (!codes.length) continue

    const sentAt = new Date(b.created_at)
    // Рассылка старше начала синхронизации — считать по ней нечего.
    const reliable = !!(since && sentAt >= since)

    let uses = null, perThousand = null
    if (reliable) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM bedolaga_promo_uses
          WHERE account_id = $1 AND code = ANY($2)
            AND used_at >= $3 AND used_at < $3::timestamptz + ($4 || ' days')::interval`,
        [account.id, codes, b.created_at, windowDays]
      )
      uses = rows[0].n
      // На тысячу ДОШЕДШИХ, а не отправленных: сравнивать рассылки разного
      // размера иначе нельзя, а до заблокировавших сообщение не дошло.
      perThousand = b.sent_count ? +(uses / b.sent_count * 1000).toFixed(2) : null
    }

    items.push({
      id: b.id, target: b.target_type, created_at: b.created_at,
      codes, sent: b.sent_count, uses, per_thousand: perThousand, reliable,
    })
  }

  // Сводка по кодам — только по надёжным рассылкам.
  const byCode = {}
  for (const it of items) {
    if (!it.reliable) continue
    for (const c of it.codes) {
      if (!byCode[c]) byCode[c] = { code: c, broadcasts: 0, uses: 0, perThousand: [] }
      byCode[c].broadcasts++
      byCode[c].uses += it.uses
      if (it.per_thousand != null) byCode[c].perThousand.push(it.per_thousand)
    }
  }
  const summary = Object.values(byCode).map(c => ({
    code: c.code,
    broadcasts: c.broadcasts,
    uses: c.uses,
    avg_per_thousand: c.perThousand.length
      ? +(c.perThousand.reduce((s, x) => s + x, 0) / c.perThousand.length).toFixed(2)
      : null,
  })).sort((a, b) => (b.avg_per_thousand || 0) - (a.avg_per_thousand || 0))

  return {
    ok: true,
    items,
    byCode: summary,
    coverage: {
      since: since ? since.toISOString() : null,
      total_uses: cov[0] ? cov[0].uses : 0,
      with_codes: items.length,
      reliable: items.filter(i => i.reliable).length,
    },
  }
}

// ─── Правила по сегментам ────────────────────────────────────────────────────

const DEFAULT_RULE = {
  ai_allowed: true, manual_allowed: true,
  min_interval_hours: null, purpose: 'any', note: null, is_sandbox: false,
}

/** Правила для всех сегментов; отсутствующие добираются умолчаниями. */
async function getSegmentRules() {
  const { rows } = await db.query('SELECT * FROM broadcast_segment_rules')
  const map = {}
  for (const s of bedolaga.BROADCAST_SEGMENTS) {
    const r = rows.find(x => x.segment === s.id)
    map[s.id] = { segment: s.id, label: s.label, hint: s.hint, ...DEFAULT_RULE, ...(r || {}) }
  }
  return map
}

async function upsertSegmentRule(segment, patch) {
  if (!bedolaga.BROADCAST_TARGETS.includes(segment)) throw new Error('Неизвестный сегмент')
  const f = {
    ai_allowed: patch.ai_allowed !== false,
    manual_allowed: patch.manual_allowed !== false,
    min_interval_hours: patch.min_interval_hours === '' || patch.min_interval_hours == null
      ? null : Number(patch.min_interval_hours),
    purpose: ['any', 'sales', 'service'].includes(patch.purpose) ? patch.purpose : 'any',
    note: patch.note ? String(patch.note).slice(0, 1000) : null,
    is_sandbox: !!patch.is_sandbox,
  }
  const { rows } = await db.query(
    `INSERT INTO broadcast_segment_rules (segment, ai_allowed, manual_allowed, min_interval_hours, purpose, note, is_sandbox)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (segment) DO UPDATE SET
       ai_allowed = EXCLUDED.ai_allowed,
       manual_allowed = EXCLUDED.manual_allowed,
       min_interval_hours = EXCLUDED.min_interval_hours,
       purpose = EXCLUDED.purpose,
       note = EXCLUDED.note,
       is_sandbox = EXCLUDED.is_sandbox,
       updated_at = NOW()
     RETURNING *`,
    [segment, f.ai_allowed, f.manual_allowed, f.min_interval_hours, f.purpose, f.note, f.is_sandbox]
  )
  return rows[0]
}

/**
 * Свой интервал сегмента соблюдён?
 *
 * Считаем по НАШЕМУ журналу и по этому сегменту: общий лимит частоты
 * ограничивает рассылки вообще, а этот — конкретную аудиторию. Человеку
 * может быть нужно написать `expiring` сегодня и `all` завтра, и общий
 * интервал такому не мешает, а вот повтор по `expiring` — мешает.
 */
async function checkSegmentInterval(accountId, segment) {
  const rules = await getSegmentRules()
  const rule = rules[segment]
  if (!rule || !rule.min_interval_hours) return { ok: true }

  const { rows } = await db.query(
    `SELECT created_at FROM broadcast_log
      WHERE account_id = $1 AND target = $2
      ORDER BY created_at DESC LIMIT 1`,
    [accountId, segment]
  )
  if (!rows[0]) return { ok: true }

  const passedH = (Date.now() - new Date(rows[0].created_at).getTime()) / 3600000
  if (passedH < rule.min_interval_hours) {
    return {
      ok: false,
      reason: 'segment_interval',
      message: `По сегменту «${rule.label}» прошло ${Math.floor(passedH)} ч, минимум — ${rule.min_interval_hours}`,
    }
  }
  return { ok: true }
}

// ─── Отдача по деньгам ───────────────────────────────────────────────────────

const _depCache = new Map()          // id → { ts, rows }
const DEP_TTL_MS = 10 * 60 * 1000
const DAY_MS = 86400000

/** Все завершённые пополнения. Тяжело (тысячи записей), поэтому кэш. */
async function fetchDeposits(account, { force = false } = {}) {
  const c = _depCache.get(account.id)
  if (!force && c && Date.now() - c.ts < DEP_TTL_MS) return c.rows

  const out = []
  for (let off = 0; off < 40000; off += 200) {
    const r = await bedolaga.call(account, '/transactions', {
      query: { type: 'deposit', is_completed: 'true', limit: 200, offset: off },
    })
    if (!r.ok) break
    const items = (r.data && r.data.items) || []
    if (!items.length) break
    for (const t of items) {
      const amt = Number(t.amount_rubles) || 0
      if (amt > 0) out.push({ ts: new Date(t.created_at).getTime(), amt })
    }
    if (items.length < 200) break
  }
  out.sort((a, b) => a.ts - b.ts)
  _depCache.set(account.id, { ts: Date.now(), rows: out })
  return out
}

/**
 * Насколько рассылка подняла выручку.
 *
 * База — тот же день недели за три предыдущие недели: выручка сильно зависит
 * от дня, и сравнение со «вчера» давало бы шум вместо сигнала.
 *
 * Отношение считается только при базе выше MIN_BASE: при базе в 60 ₽ любая
 * случайная покупка даёт «рост в 30 раз», и такие числа затопили бы статистику.
 * У Veltrix ровно это и произошло в январе: x29 при базе 67 ₽.
 */
const MIN_BASE_RUB = 500

async function revenueLift(account, { windowHours = 24 } = {}) {
  const [hist, deposits] = await Promise.all([
    bedolaga.getBroadcastHistory(account),
    fetchDeposits(account),
  ])
  if (!hist.ok) return { ok: false, error: hist.error }

  const win = windowHours * 3600000
  const sumIn = (t0, t1) => {
    let s = 0
    for (const d of deposits) { if (d.ts >= t1) break; if (d.ts >= t0) s += d.amt }
    return s
  }

  const items = []
  for (const b of hist.items) {
    if (!b.sent_count) continue
    const t = new Date(b.created_at).getTime()
    const after = sumIn(t, t + win)
    const baseline = [1, 2, 3].map(k => sumIn(t - k * 7 * DAY_MS, t - k * 7 * DAY_MS + win))
    const base = baseline.reduce((s, x) => s + x, 0) / 3

    items.push({
      id: b.id, target: b.target_type, created_at: b.created_at,
      revenue_after: Math.round(after),
      baseline: Math.round(base),
      // null означает «сравнивать не с чем», а не «нуль»
      lift: base >= MIN_BASE_RUB ? +(after / base).toFixed(2) : null,
    })
  }

  const withLift = items.filter(x => x.lift != null)
  const median = xs => {
    if (!xs.length) return null
    const s = [...xs].sort((a, b) => a - b)
    return +s[Math.floor(s.length / 2)].toFixed(2)
  }

  const bySegment = {}
  for (const it of withLift) (bySegment[it.target] = bySegment[it.target] || []).push(it.lift)

  return {
    ok: true,
    items,
    window_hours: windowHours,
    overall: median(withLift.map(x => x.lift)),
    measured: withLift.length,
    total: items.length,
    by_segment: Object.entries(bySegment).map(([target, v]) => ({
      target,
      n: v.length,
      median: median(v),
      share_positive: Math.round(v.filter(x => x > 1.2).length / v.length * 100),
    })).sort((a, b) => b.n - a.n),
  }
}

// ─── Похожесть текстов ───────────────────────────────────────────────────────

/** Текст к сравнимому виду: без разметки, эмодзи, пунктуации и регистра. */
function normalizeText(t) {
  return String(t || '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Похожесть двух текстов, 0..1 — коэффициент Жаккара по словам.
 *
 * Сравнение по началу строки (как в разовом разборе) ловит только буквальные
 * копии: достаточно поменять первое предложение, и повтор пройдёт. По набору
 * слов совпадение видно даже при переставленных абзацах.
 */
function similarity(a, b) {
  const wa = new Set(normalizeText(a).split(' ').filter(w => w.length > 2))
  const wb = new Set(normalizeText(b).split(' ').filter(w => w.length > 2))
  if (!wa.size || !wb.size) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return +(inter / (wa.size + wb.size - inter)).toFixed(3)
}

/**
 * Не повтор ли это недавней рассылки В ТОТ ЖЕ СЕГМЕНТ.
 *
 * Сегмент здесь принципиален. В истории 34 почти одинаковых сообщения за две
 * недели, но из них 13 — одно сообщение разным аудиториям, и это нормальная
 * практика: сказать одно и то же тем, кто без подписки, и тем, у кого она
 * истекла. Настоящая проблема — оставшиеся 21, отправленные ПОВТОРНО в тот же
 * сегмент, иногда через 18 часов. Проверка без учёта сегмента ругалась бы на
 * законные рассылки и быстро научила бы её игнорировать.
 *
 * @returns {{ok: true, closest} | {ok: false, reason, message, match}}
 */
async function checkDuplicate(account, text, { target, threshold, windowDays } = {}) {
  const broadcasts = require('./broadcasts')
  const s = await broadcasts.getSettings()
  const th = Number(threshold ?? s.duplicate_similarity) || 0.7
  const days = Number(windowDays ?? s.duplicate_window_days) || 14
  if (th >= 1) return { ok: true }                 // 1.0 = проверка выключена

  const hist = await bedolaga.getBroadcastHistory(account)
  if (!hist.ok) return { ok: true }                // нет истории — не мешаем

  const since = Date.now() - days * DAY_MS
  let best = null
  for (const b of hist.items) {
    if (new Date(b.created_at).getTime() < since) continue
    if (target && b.target_type !== target) continue
    const sim = similarity(text, b.message_text)
    if (!best || sim > best.similarity) best = { id: b.id, target: b.target_type, created_at: b.created_at, similarity: sim }
  }

  if (best && best.similarity >= th) {
    const hoursAgo = Math.round((Date.now() - new Date(best.created_at).getTime()) / 3600000)
    const ago = hoursAgo < 48 ? `${hoursAgo} ч` : `${Math.round(hoursAgo / 24)} дн.`
    return {
      ok: false,
      reason: 'duplicate',
      message: `Почти то же самое уже уходило в «${best.target}» ${ago} назад — рассылка №${best.id}, совпадение ${Math.round(best.similarity * 100)} %`,
      match: best,
    }
  }
  return { ok: true, closest: best }
}

/** Недавние тексты — чтобы показать модели, чего не повторять. */
async function recentTexts(account, { days = 14, limit = 8 } = {}) {
  const hist = await bedolaga.getBroadcastHistory(account)
  if (!hist.ok) return []
  const since = Date.now() - days * DAY_MS
  return hist.items
    .filter(b => new Date(b.created_at).getTime() >= since)
    .slice(0, limit)
    .map(b => ({
      id: b.id, target: b.target_type, created_at: b.created_at,
      text: String(b.message_text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 200),
    }))
}

// ─── Заброшенные сегменты ────────────────────────────────────────────────────

/**
 * Сколько дней сегменту не писали. Дата в промпте («последняя 2026-07-28»)
 * требует от модели считать в уме; число дней — сразу повод.
 */
async function segmentNeglect(account) {
  const hist = await bedolaga.getBroadcastHistory(account)
  const last = {}
  if (hist.ok) {
    for (const b of hist.items) {
      if (!last[b.target_type]) last[b.target_type] = new Date(b.created_at).getTime()
    }
  }
  const out = {}
  for (const s of bedolaga.BROADCAST_SEGMENTS) {
    out[s.id] = last[s.id] == null ? null : Math.round((Date.now() - last[s.id]) / DAY_MS)
  }
  return out
}

module.exports = {
  extractCodes, promoPerformance,
  getSegmentRules, upsertSegmentRule, checkSegmentInterval,
  revenueLift, fetchDeposits,
  normalizeText, similarity, checkDuplicate, recentTexts,
  segmentNeglect,
  NOT_CODES, MIN_BASE_RUB,
}
