/**
 * Клиент Web Admin API бота Bedolaga (remnawave-bedolaga-telegram-bot, v3.33+).
 *
 * Встроенный FastAPI-сервер бота (по умолчанию порт 8080), авторизация токеном.
 * Здесь — только чтение (мониторинг): overview, пользователи, подписки,
 * транзакции, тикеты. Никаких изменяющих запросов.
 *
 * Токен хранится зашифрованным (services/encryption.js) и передаётся в двух
 * заголовках сразу — X-API-Key и Authorization: Bearer — для совместимости.
 */
const { decrypt } = require('./encryption')

function baseUrl(a) {
  return String(a.base_url || '').trim().replace(/\/+$/, '')
}
function token(a) {
  return a.api_token ? decrypt(a.api_token) : ''
}

// Универсальный вызов с таймаутом и мягкими ретраями (undici на Windows-dev флакует).
// ВАЖНО: ретраи только для GET — повтор POST мог бы продублировать действие
// (напр. отправить рассылку дважды).
async function call(a, path, { query, method = 'GET', body, timeoutMs = 15000, retries = 1 } = {}) {
  const qs = query
    ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))
    : ''
  const url = baseUrl(a) + path + qs
  const tok = token(a)
  const headers = {
    Accept: 'application/json',
    'X-API-Key': tok,
    Authorization: `Bearer ${tok}`,
  }
  const opts = { method, headers }
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  const effRetries = method === 'GET' ? retries : 0

  let lastErr
  for (let attempt = 0; attempt <= effRetries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal })
      clearTimeout(timer)
      const text = await res.text()
      let data
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      if (!res.ok) {
        const msg = (data && (data.detail || data.error || data.message)) || `HTTP ${res.status}`
        return { ok: false, status: res.status, error: typeof msg === 'string' ? msg : JSON.stringify(msg) }
      }
      return { ok: true, status: res.status, data }
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      if (attempt < effRetries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  return { ok: false, networkError: true, error: `Нет связи с ботом: ${lastErr?.message || 'fetch failed'}` }
}

// ─── Хелперы (read-only) ──────────────────────────────────────────────────────
const testAccount = a => call(a, '/health', { retries: 2, timeoutMs: 8000 })
const getOverview  = a => call(a, '/stats/overview')
const listUsers    = (a, q) => call(a, '/users', { query: q })
const getUser      = (a, id) => call(a, `/users/${encodeURIComponent(id)}`)
const listSubscriptions = (a, q) => call(a, '/subscriptions', { query: q })
const listTransactions  = (a, q) => call(a, '/transactions', { query: q })
const listTickets  = (a, q) => call(a, '/tickets', { query: q })
const getTicket    = (a, id) => call(a, `/tickets/${encodeURIComponent(id)}`)

// ─── Сводка по доходам (сумма завершённых пополнений по периодам) ─────────────
// API отдаёт только счётчик (total), но не сумму → считаем сами одним проходом
// по депозитам (они идут от новых к старым). Периоды: сегодня по МСК, 7д, 30д, всё.
// Дорого (пейджинг по 200, ~16 страниц) → кэшируем в памяти на 2 минуты.
const REVENUE_TTL_MS = 120000
const _revenueCache = new Map()   // id -> { ts, data }

async function getRevenue(a, { force = false } = {}) {
  const cached = _revenueCache.get(a.id)
  if (!force && cached && Date.now() - cached.ts < REVENUE_TTL_MS) {
    return { ok: true, revenue: cached.data, cached: true }
  }
  const now = Date.now()
  const c7 = now - 7 * 86400000
  const c30 = now - 30 * 86400000
  // Полночь сегодняшнего дня по МСК (UTC+3), выраженная в UTC-мс.
  const msk = new Date(now + 3 * 3600000)
  const mskMidnightUTC = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - 3 * 3600000

  // Дневной ряд за последние 14 дней (по МСК) — для спарклайна выручки.
  const SERIES_DAYS = 14
  const series = new Array(SERIES_DAYS).fill(0) // [13]=сегодня
  const seriesStart = mskMidnightUTC - (SERIES_DAYS - 1) * 86400000

  let today = 0, d7 = 0, d30 = 0, total = 0, count = 0, offset = 0
  for (let page = 0; page < 500; page++) {
    const r = await call(a, '/transactions', { query: { type: 'deposit', is_completed: 'true', limit: 200, offset } })
    if (!r.ok) return { ok: false, error: r.error }
    const items = (r.data && r.data.items) || []
    for (const t of items) {
      const amt = Number(t.amount_rubles) || 0
      if (amt <= 0) continue
      const ts = new Date(t.created_at).getTime()
      total += amt; count++
      if (ts >= c30) d30 += amt
      if (ts >= c7) d7 += amt
      if (ts >= mskMidnightUTC) today += amt
      if (ts >= seriesStart) {
        const idx = Math.floor((ts - seriesStart) / 86400000)
        if (idx >= 0 && idx < SERIES_DAYS) series[idx] += amt
      }
    }
    if (items.length < 200) break
    offset += 200
  }
  const data = { today, d7, d30, total, count, series, computed_at: new Date().toISOString() }
  _revenueCache.set(a.id, { ts: Date.now(), data })
  return { ok: true, revenue: data }
}

// ─── Статистика подписок: по тарифам + серверам + истекающие 1/3/7 дней ───────
// Реальные тарифы (tariff_name) есть только во встроенных подписках /users, а не
// в /subscriptions → приходится обходить всех пользователей (тысячи, ~20-30 с).
// Поэтому: stale-while-revalidate — отдаём кэш мгновенно и обновляем в фоне.
const SUBSTATS_TTL_MS = 300000   // 5 мин
const _subStatsCache = new Map() // id → { ts, data, refreshing }

async function getSubscriptionStats(a, { force = false } = {}) {
  const cached = _subStatsCache.get(a.id)
  const fresh = cached && Date.now() - cached.ts < SUBSTATS_TTL_MS
  if (!force && cached) {
    // Устарело — отдаём старое сразу, обновляем в фоне (не блокируя ответ).
    if (!fresh && !cached.refreshing) {
      cached.refreshing = true
      _computeSubStats(a)
        .then(r => { if (r.ok) _subStatsCache.set(a.id, { ts: Date.now(), data: r.data }) })
        .catch(() => {})
        .finally(() => { const c = _subStatsCache.get(a.id); if (c) c.refreshing = false })
    }
    return { ok: true, stats: cached.data, cached: true, stale: !fresh }
  }
  const r = await _computeSubStats(a)
  if (!r.ok) return { ok: false, error: r.error }
  _subStatsCache.set(a.id, { ts: Date.now(), data: r.data })
  return { ok: true, stats: r.data }
}

async function _computeSubStats(a) {
  // Имена сквадов (UUID → название) — один запрос.
  const nameByUuid = {}
  const sq = await call(a, '/remnawave/squads')
  if (sq.ok) {
    const list = Array.isArray(sq.data) ? sq.data : (sq.data.items || sq.data.squads || [])
    for (const s of list) { const u = s.uuid || s.id; if (u) nameByUuid[u] = s.name || s.display_name || u }
  }

  const now = Date.now()
  const w1 = now + 1 * 86400000, w3 = now + 3 * 86400000, w7 = now + 7 * 86400000
  const bySquad = {}
  const tariffMap = {}                       // name → { name, count, trial, tariff_id }
  const expiring = { d1: 0, d3: 0, d7: 0 }   // кумулятивно: d1 ⊆ d3 ⊆ d7
  const expiringList = []                    // подробности для страницы «Истекающие»
  let totalActive = 0, trialCount = 0, paidCount = 0, noSquad = 0

  // Идём по пользователям: их встроенные подписки содержат tariff_name/tariff_id
  // (список /subscriptions тариф НЕ отдаёт). Считаем только активные подписки.
  // Пользователей много (тысячи) → грузим страницы параллельно батчами.
  const PAGE = 200
  let totalUsers = 0
  const ov = await call(a, '/stats/overview')
  if (ov.ok) totalUsers = Number(ov.data && ov.data.users && ov.data.users.total) || 0

  const allUsers = []
  if (totalUsers > 0) {
    const pageCount = Math.ceil(totalUsers / PAGE)
    const CONC = 6
    for (let i = 0; i < pageCount; i += CONC) {
      const batch = []
      for (let j = i; j < Math.min(i + CONC, pageCount); j++) batch.push(call(a, '/users', { query: { limit: PAGE, offset: j * PAGE } }))
      const rs = await Promise.all(batch)
      for (const r of rs) { if (!r.ok) return { ok: false, error: r.error }; allUsers.push(...((r.data && r.data.items) || [])) }
    }
  } else {
    // fallback: последовательно, пока страница полная
    for (let page = 0, offset = 0; page < 500; page++, offset += PAGE) {
      const r = await call(a, '/users', { query: { limit: PAGE, offset } })
      if (!r.ok) return { ok: false, error: r.error }
      const items = (r.data && r.data.items) || []
      allUsers.push(...items)
      if (items.length < PAGE) break
    }
  }

  for (const u of allUsers) {
    const subs = (u.subscriptions && u.subscriptions.length) ? u.subscriptions : (u.subscription ? [u.subscription] : [])
    for (const s of subs) {
      if ((s.status || s.actual_status) !== 'active') continue
      totalActive++
      if (s.is_trial) trialCount++; else paidCount++
      // Группировка по тарифу: триалы отдельно, платные — по tariff_name.
      const key = s.is_trial ? 'Триал' : (s.tariff_name || '(без тарифа)')
      if (!tariffMap[key]) tariffMap[key] = { name: key, count: 0, trial: !!s.is_trial, tariff_id: s.is_trial ? null : (s.tariff_id ?? null) }
      tariffMap[key].count++
      // Группировка по серверам (сквадам)
      const squads = s.connected_squads || []
      if (!squads.length) noSquad++
      for (const uu of squads) bySquad[uu] = (bySquad[uu] || 0) + 1
      // Истекающие
      const end = s.end_date ? new Date(s.end_date).getTime() : null
      if (end && end >= now) {
        if (end <= w1) expiring.d1++
        if (end <= w3) expiring.d3++
        if (end <= w7) expiring.d7++
      }
      // Подробный список для страницы «Истекающие»: собираем здесь же, чтобы
      // не делать второй обход всех пользователей (он стоит ~25 секунд).
      if (end) {
        expiringList.push({
          user_id: u.id,
          telegram_id: u.telegram_id ?? null,
          username: u.username ?? null,
          first_name: u.first_name ?? null,
          last_name: u.last_name ?? null,
          subscription_id: s.id,
          tariff_name: s.is_trial ? 'Триал' : (s.tariff_name || null),
          is_trial: !!s.is_trial,
          end_date: s.end_date,
          days_left: Math.ceil((end - now) / 86400000),
          traffic_used_gb: s.traffic_used_gb ?? null,
          traffic_limit_gb: s.traffic_limit_gb ?? null,
        })
      }
    }
  }
  const tariffs = Object.values(tariffMap).sort((x, y) => y.count - x.count)
  const squads = Object.entries(bySquad)
    .map(([uuid, count]) => ({ uuid, name: nameByUuid[uuid] || uuid.slice(0, 8), count }))
    .sort((x, y) => y.count - x.count)
  // Сортировка по дате окончания: ближайшие первыми — так удобнее и для
  // группировки по месяцам, и для «просроченных» сверху.
  expiringList.sort((a, b) => new Date(a.end_date) - new Date(b.end_date))
  const data = { tariffs, squads, expiring, expiringList, totalActive, trialCount, paidCount, noSquad, computed_at: new Date().toISOString() }
  return { ok: true, data }
}

// ─── Отправка рассылки (реальное действие!) ───────────────────────────────────
// target — сегмент бота из белого списка; message_text — текст. POST /broadcasts.
const BROADCAST_TARGETS = ['expiring', 'expired', 'active', 'trial', 'all']

async function sendBroadcast(a, { target, message_text }) {
  if (!BROADCAST_TARGETS.includes(target)) return { ok: false, error: 'Недопустимый сегмент рассылки' }
  if (!message_text || !message_text.trim()) return { ok: false, error: 'Текст сообщения обязателен' }
  const r = await call(a, '/broadcasts', { method: 'POST', body: { target, message_text }, timeoutMs: 20000 })
  if (!r.ok) return { ok: false, error: r.error }
  // Сбрасываем кэш статистики — рассылка могла изменить состояние.
  _subStatsCache.delete(a.id)
  return { ok: true, broadcast: r.data }
}

// Карта UUID сквада → имя (кэш 5 мин) — для резолва connected_squads в карточках.
const _squadNamesCache = new Map()
async function getSquadNames(a) {
  const c = _squadNamesCache.get(a.id)
  if (c && Date.now() - c.ts < 300000) return c.data
  const map = {}
  const sq = await call(a, '/remnawave/squads')
  if (sq.ok) {
    const list = Array.isArray(sq.data) ? sq.data : (sq.data.items || sq.data.squads || [])
    for (const s of list) { const u = s.uuid || s.id; if (u) map[u] = s.name || s.display_name || u }
  }
  _squadNamesCache.set(a.id, { ts: Date.now(), data: map })
  return map
}

// Текущее состояние рассылки (для опроса статуса после запуска).
// У бота нет GET /broadcasts/{id} → ищем в списке.
async function getBroadcast(a, broadcastId) {
  const r = await call(a, '/broadcasts', { query: { limit: 20, offset: 0 } })
  if (!r.ok) return { ok: false, error: r.error }
  const items = (r.data && r.data.items) || []
  const b = items.find(x => String(x.id) === String(broadcastId))
  if (!b) return { ok: false, error: 'Рассылка не найдена' }
  return { ok: true, broadcast: b }
}


// ─── Промокоды ───────────────────────────────────────────────────────────────

/**
 * Список промокодов. Параметры подтверждены документацией:
 * limit 1..200 (по умолчанию 50), offset, is_active.
 */
async function listPromoCodes(a, { limit = 50, offset = 0, is_active } = {}) {
  return call(a, '/promo-codes', {
    query: { limit: Math.min(Math.max(Number(limit) || 50, 1), 200), offset, is_active },
  })
}

/**
 * Карточка промокода. В ответе, помимо счётчиков, приходит recent_uses —
 * ПОСЛЕДНИЕ 10 активаций. Параметров пагинации у этого массива нет:
 * проверено и перебором, и по документации. Отсюда и нужна своя накопительная
 * база (см. syncPromoUses).
 */
async function getPromoCode(a, id) {
  return call(a, `/promo-codes/${encodeURIComponent(id)}`)
}

/** Тип активации в человекочитаемом виде — по номиналу промокода. */
function promoKind(pc) {
  if (Number(pc?.subscription_days) > 0) return 'subscription_days'
  if (Number(pc?.balance_bonus_kopeks) > 0) return 'balance'
  return String(pc?.type || 'other')
}

/**
 * Синхронизация активаций в нашу базу.
 *
 * Идём по всем промокодам, у каждого забираем карточку и складываем recent_uses
 * через UPSERT по (account_id, use_id) — повторные прогоны дублей не создают.
 *
 * Отдельно считаем ПОТЕРИ. API отдаёт только 10 последних активаций, поэтому
 * если между прогонами код активировали чаще, середина уже не вернётся никогда.
 * Ловим это сравнением current_uses с прошлым снимком: прирост больше числа
 * полученных записей — значит часть утекла. Такие пропуски копим и показываем,
 * иначе база тихо выглядела бы полной, не будучи таковой.
 */
async function syncPromoUses(db, a) {
  const stRes = await db.query(
    'SELECT seen_uses, missed_total FROM bedolaga_promo_sync_state WHERE account_id = $1', [a.id]
  )
  const prevSeen = stRes.rows[0]?.seen_uses || {}
  const prevMissed = Number(stRes.rows[0]?.missed_total || 0)

  const seen = {}
  let added = 0, missedNow = 0
  const missedCodes = []

  // Промокодов немного (десятки), но пагинацию соблюдаем — вдруг вырастет
  let offset = 0
  const codes = []
  for (;;) {
    const page = await listPromoCodes(a, { limit: 200, offset })
    if (!page.ok) return { ok: false, error: page.error }
    const items = page.data?.items || []
    codes.push(...items)
    const total = Number(page.data?.total || items.length)
    offset += items.length
    if (!items.length || offset >= total) break
  }

  for (const pc of codes) {
    const detail = await getPromoCode(a, pc.id)
    if (!detail.ok) continue           // один сбойный код не должен валить весь прогон
    const d = detail.data || {}
    const uses = Array.isArray(d.recent_uses) ? d.recent_uses : []
    const cur = Number(d.current_uses ?? pc.current_uses ?? 0)
    seen[String(pc.id)] = cur

    const before = prevSeen[String(pc.id)]
    if (before != null) {
      const grew = cur - Number(before)
      if (grew > uses.length) {
        missedNow += grew - uses.length
        missedCodes.push(`${d.code || pc.code}: +${grew}, получено ${uses.length}`)
      }
    }

    const kind = promoKind(d.id ? d : pc)
    for (const u of uses) {
      const r = await db.query(
        `INSERT INTO bedolaga_promo_uses
           (account_id, use_id, promocode_id, code, promo_type,
            subscription_days, balance_bonus_kopeks,
            user_id, user_telegram_id, user_username, user_full_name, used_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (account_id, use_id) DO NOTHING`,
        [a.id, u.id, pc.id, d.code || pc.code, kind,
         Number(d.subscription_days || 0), Number(d.balance_bonus_kopeks || 0),
         u.user_id, u.user_telegram_id, u.user_username, u.user_full_name, u.used_at]
      )
      added += r.rowCount
    }
  }

  const note = missedCodes.length
    ? `Между прогонами потеряно активаций: ${missedNow}. ${missedCodes.join('; ')}`
    : null

  await db.query(
    `INSERT INTO bedolaga_promo_sync_state
       (account_id, last_run_at, status, error, added, seen_uses, missed_total, missed_note)
     VALUES ($1, NOW(), 'ok', NULL, $2, $3, $4, $5)
     ON CONFLICT (account_id) DO UPDATE SET
       last_run_at = NOW(), status = 'ok', error = NULL,
       added = EXCLUDED.added, seen_uses = EXCLUDED.seen_uses,
       missed_total = EXCLUDED.missed_total, missed_note = EXCLUDED.missed_note`,
    [a.id, added, JSON.stringify(seen), prevMissed + missedNow, note]
  )

  return { ok: true, added, codes: codes.length, missedNow, note }
}


// ─── Тикеты: запись ───────────────────────────────────────────────────────────

/**
 * Ответ в тикет. POST — БЕЗ ретраев: повтор отправит клиенту второе сообщение.
 * Единственная точка, из которой ассистент пишет живым людям.
 */
async function replyToTicket(a, ticketId, text) {
  const msg = String(text || '').slice(0, 4000)   // жёсткий предел API
  if (!msg.trim()) return { ok: false, error: 'Пустой текст ответа' }
  return call(a, `/tickets/${encodeURIComponent(ticketId)}/reply`, {
    method: 'POST',
    body: { message_text: msg },
  })
}

// Документация значения не перечисляет; берём enum из списка тикетов.
const TICKET_STATUSES = ['open', 'answered', 'closed', 'pending']

/** Смена статуса тикета. Значение сверяем с белым списком, чтобы опечатка
 *  не ушла в API и не перевела тикет в неизвестное состояние. */
async function setTicketStatus(a, ticketId, status) {
  if (!TICKET_STATUSES.includes(status)) {
    return { ok: false, error: `Недопустимый статус: ${status}` }
  }
  return call(a, `/tickets/${encodeURIComponent(ticketId)}/status`, {
    method: 'POST',
    body: { status },
  })
}

module.exports = {
  call, testAccount, getOverview,
  replyToTicket, setTicketStatus, TICKET_STATUSES,
  listPromoCodes, getPromoCode, syncPromoUses,
  listUsers, getUser, listSubscriptions, listTransactions, listTickets, getTicket,
  getRevenue, getSubscriptionStats, sendBroadcast, getBroadcast, getSquadNames, BROADCAST_TARGETS,
}
