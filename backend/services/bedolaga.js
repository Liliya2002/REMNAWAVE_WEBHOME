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
    }
  }
  const tariffs = Object.values(tariffMap).sort((x, y) => y.count - x.count)
  const squads = Object.entries(bySquad)
    .map(([uuid, count]) => ({ uuid, name: nameByUuid[uuid] || uuid.slice(0, 8), count }))
    .sort((x, y) => y.count - x.count)
  const data = { tariffs, squads, expiring, totalActive, trialCount, paidCount, noSquad, computed_at: new Date().toISOString() }
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

module.exports = {
  call, testAccount, getOverview,
  listUsers, getUser, listSubscriptions, listTransactions, listTickets, getTicket,
  getRevenue, getSubscriptionStats, sendBroadcast, getBroadcast, getSquadNames, BROADCAST_TARGETS,
}
