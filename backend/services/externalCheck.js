/**
 * Внешняя проверка доступности через check-host.net (бесплатно, без API-ключа).
 *
 * Проверяет TCP-порт хоста с нескольких узлов по миру и возвращает
 * нормализованный результат: доступен ли сервер снаружи и с какой задержкой
 * из разных стран. В отличие от локального TCP-пинга с бэкенда, это показывает
 * реальную внешнюю достижимость (например, если сервер заблокирован в части
 * регионов).
 *
 * Flow check-host.net: submit → request_id → poll check-result (результаты
 * приходят асинхронно за несколько секунд).
 */

const BASE = 'https://check-host.net'

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

/**
 * @param {string} host — IP или домен
 * @param {number} port
 * @param {object} opts { maxNodes, pollAttempts, pollDelayMs }
 * @returns {{ ok, error?, requestId?, permanentLink?, target?, total?, up?, nodes? }}
 *   nodes: [{ node, country, countryCode, city, alive:true|false|null, ms, error }]
 */
async function checkTcp(host, port, opts = {}) {
  const { maxNodes = 8, pollAttempts = 7, pollDelayMs = 2000 } = opts
  const target = `${host}:${port}`

  let sub
  try {
    sub = await fetchJson(`${BASE}/check-tcp?host=${encodeURIComponent(target)}&max_nodes=${maxNodes}`)
  } catch (err) {
    return { ok: false, error: `check-host.net недоступен: ${err.message}` }
  }
  if (!sub || sub.ok !== 1 || !sub.request_id) {
    return { ok: false, error: sub?.error || 'check-host.net отклонил запрос (возможно, лимит).' }
  }

  const nodesMeta = sub.nodes || {}
  const requestId = sub.request_id
  const permanentLink = `${BASE}/check-report/${requestId}`
  const nodeKeys = Object.keys(nodesMeta)

  // Опрашиваем результат пока все узлы не ответят (или не кончатся попытки).
  let results = {}
  for (let i = 0; i < pollAttempts; i++) {
    await new Promise(s => setTimeout(s, pollDelayMs))
    const res = await fetchJson(`${BASE}/check-result/${requestId}`).catch(() => null)
    if (res && typeof res === 'object') results = res
    const allDone = nodeKeys.length > 0 && nodeKeys.every(k => results[k] !== undefined && results[k] !== null)
    if (allDone) break
  }

  const nodes = nodeKeys.map(node => {
    const meta = nodesMeta[node] || []
    const countryCode = (meta[0] || '').toUpperCase()
    const country = meta[1] || countryCode || '?'
    const city = meta[2] || ''
    const r = results[node]

    let alive = null, ms = null, error = null
    if (r === undefined || r === null) {
      alive = null // ещё проверяется / нет данных
    } else if (Array.isArray(r) && r[0] && typeof r[0] === 'object' && r[0].time != null) {
      alive = true; ms = Math.round(r[0].time * 1000)
    } else if (Array.isArray(r) && r[0] && r[0].error) {
      alive = false; error = String(r[0].error)
    } else {
      alive = false // [null] — таймаут/отказ
    }
    return { node, country, countryCode, city, alive, ms, error }
  })

  // Сортируем: живые вперёд, потом по стране
  nodes.sort((a, b) => (Number(b.alive === true) - Number(a.alive === true)) || a.country.localeCompare(b.country))

  return {
    ok: true, requestId, permanentLink, target,
    total: nodes.length,
    up: nodes.filter(n => n.alive === true).length,
    nodes,
  }
}

/**
 * Лёгкая проверка «доступен ли снаружи» (для cron и инлайн-индикатора).
 * reachable = отвечает хотя бы с одного узла. minMs — минимальная задержка среди
 * ответивших. Меньше узлов и быстрее опрос, чем полный checkTcp.
 * @returns {{ ok, error?, reachable?, up?, total?, minMs? }}
 */
async function isReachable(host, port, opts = {}) {
  const { maxNodes = 3 } = opts
  const r = await checkTcp(host, port, { maxNodes, pollAttempts: 6, pollDelayMs: 1500 })
  if (!r.ok) return { ok: false, error: r.error }
  const upNodes = r.nodes.filter(n => n.alive === true)
  const minMs = upNodes.length ? Math.min(...upNodes.map(n => n.ms)) : null
  return { ok: true, reachable: r.up > 0, up: r.up, total: r.total, minMs }
}

module.exports = { checkTcp, isReachable }
