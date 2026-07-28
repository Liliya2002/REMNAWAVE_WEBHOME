/**
 * Клиент RUVDS API v2 (https://api.ruvds.com).
 *
 * Авторизация — Bearer-токен из личного кабинета
 * (https://ruvds.com/my/settings/api). Токен хранится зашифрованным.
 *
 * Особенности API, учтённые здесь:
 *   • rate limit → 429 с заголовками ratelimit-* / retry-after (пробрасываем наверх);
 *   • списки приходят обёрнутыми: { servers: [...], pagination: {...} };
 *   • создание/изменение сервера асинхронно → возвращает action, статус
 *     опрашивается через /v2/actions/{id};
 *   • get_price_only=true позволяет узнать цену без реального создания.
 */
const { decrypt } = require('./encryption')

const BASE_URL = (process.env.RUVDS_API_URL || 'https://api.ruvds.com').replace(/\/$/, '')

function tokenOf(account) {
  return account.api_token ? decrypt(account.api_token) : ''
}

/**
 * Универсальный вызов. Ретраи — только для GET (повтор POST/PUT/DELETE мог бы
 * продублировать действие: создать лишний сервер, списать деньги).
 */
async function call(account, path, { method = 'GET', query, body, timeoutMs = 20000, retries = 1 } = {}) {
  const qs = query
    ? '?' + new URLSearchParams(
        Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
      )
    : ''
  const url = BASE_URL + path + qs
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${tokenOf(account)}`,
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
        // RUVDS отдаёт { error: { message, type } } либо api_error
        const msg = data?.error?.message || data?.message || data?.error || `HTTP ${res.status}`
        const out = {
          ok: false,
          status: res.status,
          error: typeof msg === 'string' ? msg : JSON.stringify(msg),
        }
        if (res.status === 429) {
          out.retryAfter = res.headers.get('retry-after')
          out.error = `Превышен лимит запросов к RUVDS. Повторите через ${out.retryAfter || 'несколько'} сек.`
        }
        if (res.status === 401) out.error = 'Токен RUVDS недействителен или истёк'
        if (res.status === 403) out.error = 'Недостаточно прав токена RUVDS для этого действия'
        return out
      }
      return { ok: true, status: res.status, data }
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      if (attempt < effRetries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  return { ok: false, networkError: true, error: `Нет связи с RUVDS: ${lastErr?.message || 'fetch failed'}` }
}

// ─── Чтение ───────────────────────────────────────────────────────────────────
const testAccount   = a => call(a, '/v2/balance', { timeoutMs: 10000, retries: 2 })
const getBalance    = a => call(a, '/v2/balance')
const listServers   = (a, q) => call(a, '/v2/servers', { query: q })
const getServer     = (a, id) => call(a, `/v2/servers/${id}`)
const getServerCost = (a, id) => call(a, `/v2/servers/${id}/cost`)
const getServerNetworks  = (a, id) => call(a, `/v2/servers/${id}/networks`)
const getServerPaidTill  = (a, id) => call(a, `/v2/servers/${id}/paid_till`)
const getServerPower     = (a, id) => call(a, `/v2/servers/${id}/power_state`)
const getServerScreenshot = (a, id) => call(a, `/v2/servers/${id}/screenshot`, { timeoutMs: 30000 })
const listPayments  = (a, q) => call(a, '/v2/payments', { query: q })
const listSshKeys   = a => call(a, '/v2/ssh_keys')
const listNotifications = (a, q) => call(a, '/v2/notifications', { query: q })
const notificationsCount = (a, q) => call(a, '/v2/notifications/count', { query: q })
const listDatacenters = a => call(a, '/v2/datacenters')
const listTariffs   = a => call(a, '/v2/tariffs')
const listOs        = a => call(a, '/v2/os')
const listActions   = (a, q) => call(a, '/v2/actions', { query: q })
const getAction     = (a, id) => call(a, `/v2/actions/${id}`)

// Статистика: kind = cpu | drive | network, gran = hourly | daily
const getStat = (a, kind, gran, serverId) => call(a, `/v2/stat/${kind}/${gran}/${serverId}`, { timeoutMs: 30000 })

// ─── Изменяющие операции (нужны права write / remove) ─────────────────────────
const addSshKey    = (a, { name, public_key }) => call(a, '/v2/ssh_keys', { method: 'POST', body: { name, public_key } })
const deleteSshKey = (a, id) => call(a, `/v2/ssh_keys/${id}`, { method: 'DELETE' })
// command: start | stop | restart (см. actions в докe RUVDS)
const serverAction = (a, id, command) => call(a, `/v2/servers/${id}/actions`, { method: 'PUT', body: { command } })
const markNotification = (a, id, status) => call(a, `/v2/notifications/${id}`, { method: 'PUT', body: { status } })
const markAllNotifications = (a, status) => call(a, '/v2/notifications/status_all', { method: 'PUT', body: { status } })

module.exports = {
  call, BASE_URL,
  testAccount, getBalance,
  listServers, getServer, getServerCost, getServerNetworks, getServerPaidTill,
  getServerPower, getServerScreenshot,
  listPayments, listSshKeys, listNotifications, notificationsCount,
  listDatacenters, listTariffs, listOs, listActions, getAction, getStat,
  addSshKey, deleteSshKey, serverAction, markNotification, markAllNotifications,
}
