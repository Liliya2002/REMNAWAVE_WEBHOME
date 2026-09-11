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
  min_interval_hours: null, purpose: 'any', note: null,
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
  }
  const { rows } = await db.query(
    `INSERT INTO broadcast_segment_rules (segment, ai_allowed, manual_allowed, min_interval_hours, purpose, note)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (segment) DO UPDATE SET
       ai_allowed = EXCLUDED.ai_allowed,
       manual_allowed = EXCLUDED.manual_allowed,
       min_interval_hours = EXCLUDED.min_interval_hours,
       purpose = EXCLUDED.purpose,
       note = EXCLUDED.note,
       updated_at = NOW()
     RETURNING *`,
    [segment, f.ai_allowed, f.manual_allowed, f.min_interval_hours, f.purpose, f.note]
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

module.exports = {
  extractCodes, promoPerformance,
  getSegmentRules, upsertSegmentRule, checkSegmentInterval,
  NOT_CODES,
}
