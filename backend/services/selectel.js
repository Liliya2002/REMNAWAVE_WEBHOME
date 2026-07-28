/**
 * Интеграция Selectel Cloud (selectel.ru).
 *
 * Две системы авторизации:
 *   • Баланс/биллинг → статический API-ключ (X-Token), эндпоинт /v3/balances.
 *   • Облачные серверы → OpenStack: сервисный пользователь + account_id + проект →
 *     Keystone-токен → Nova (compute) из service catalog.
 *
 * Секреты (api_key, service_password) приходят зашифрованными из БД.
 */
const { decrypt } = require('./encryption')

const IDENTITY_URL = (process.env.SELECTEL_IDENTITY_URL || 'https://cloud.api.selcloud.ru/identity/v3').replace(/\/$/, '')
const BILLING_URL  = (process.env.SELECTEL_BILLING_URL  || 'https://api.selectel.ru').replace(/\/$/, '')

function safeDecrypt(v) { try { return decrypt(v) } catch { return null } }

function accCreds(account) {
  return {
    apiKey:    account.api_key ? safeDecrypt(account.api_key) : null,
    accountId: account.account_id || null,
    username:  account.service_username || null,
    password:  account.service_password ? safeDecrypt(account.service_password) : null,
    project:   account.default_project || null,
  }
}

async function fetchJson(url, opts = {}, timeoutMs = 15000, retries = 2) {
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal })
      const text = await r.text()
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { /* not json */ }
      return { ok: r.ok, status: r.status, headers: r.headers, json, text }
    } catch (err) {
      // Сетевой сбой (undici «fetch failed», таймаут) — ретраим с бэкоффом.
      lastErr = err
      if (attempt < retries) await new Promise(s => setTimeout(s, 800 * (attempt + 1)))
    } finally {
      clearTimeout(t)
    }
  }
  return { ok: false, status: 0, networkError: lastErr?.cause?.message || lastErr?.message || 'network error', text: '' }
}

// ─── Баланс (статический API-ключ, X-Token) ───────────────────────────────────
async function getBalance(account) {
  const { apiKey } = accCreds(account)
  if (!apiKey) return { ok: false, error: 'Не задан API-ключ (X-Token) для баланса' }
  // Selectel billing: GET https://api.selectel.ru/v3/balances, заголовок X-Token.
  // Ответ: { data: { billings: [{ balance_type, balances_values_sum, final_sum }], debt_status } }
  const r = await fetchJson(`${BILLING_URL}/v3/balances`, {
    headers: { 'X-Token': apiKey, Accept: 'application/json' },
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `Selectel billing HTTP ${r.status}: ${(r.text || '').slice(0, 200)}`, status: r.status }
  return { ok: true, balance: r.json ?? r.text }
}

// ─── Статистика расходов (по продуктам/проектам) ──────────────────────────────
// GET /v1/cloud_billing/statistic/consumption (X-Token).
async function getStatistics(account, { start, end, groupType = 'project', periodGroupType = 'all', providerKeys } = {}) {
  const { apiKey } = accCreds(account)
  if (!apiKey) return { ok: false, error: 'Не задан API-ключ (X-Token)' }
  const keys = providerKeys || ['vpc', 'dbaas', 'mks', 'storage', 'cdn']
  const qs = new URLSearchParams()
  for (const k of keys) qs.append('provider_keys', k)
  qs.set('start', start); qs.set('end', end); qs.set('locale', 'ru')
  qs.set('group_type', groupType); qs.set('period_group_type', periodGroupType)
  const r = await fetchJson(`${BILLING_URL}/v1/cloud_billing/statistic/consumption?${qs}`, {
    headers: { 'X-Token': apiKey, Accept: 'application/json' },
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `Statistics HTTP ${r.status}: ${(r.text || '').slice(0, 200)}` }
  return { ok: true, data: r.json?.data || [] }
}

// ─── Транзакции (история пополнений/списаний) ─────────────────────────────────
// GET /v2/billing/transactions (X-Token).
async function getTransactions(account, { from, to, limit = 100, offset = 0 } = {}) {
  const { apiKey } = accCreds(account)
  if (!apiKey) return { ok: false, error: 'Не задан API-ключ (X-Token)' }
  // offset у Selectel обязателен (несмотря на доку)
  const qs = new URLSearchParams({ created_from: from, created_to: to, limit: String(limit), offset: String(offset || 0) })
  const r = await fetchJson(`${BILLING_URL}/v2/billing/transactions?${qs}`, {
    headers: { 'X-Token': apiKey, Accept: 'application/json' },
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `Transactions HTTP ${r.status}: ${(r.text || '').slice(0, 200)}` }
  const j = r.json
  const list = Array.isArray(j) ? j : (j?.data || j?.transactions || [])
  return { ok: true, transactions: list }
}

// ─── Keystone ─────────────────────────────────────────────────────────────────
async function keystoneToken(creds, { project } = {}) {
  const body = {
    auth: {
      identity: {
        methods: ['password'],
        password: { user: { name: creds.username, domain: { name: creds.accountId }, password: creds.password } },
      },
    },
  }
  if (project) body.auth.scope = { project: { name: project, domain: { name: creds.accountId } } }

  const r = await fetchJson(`${IDENTITY_URL}/auth/tokens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `Keystone HTTP ${r.status}: ${(r.text || '').slice(0, 200)}`, status: r.status }
  return { ok: true, token: r.headers.get('x-subject-token'), data: r.json?.token }
}

async function listProjects(creds) {
  const t = await keystoneToken(creds)
  if (!t.ok) return t
  const r = await fetchJson(`${IDENTITY_URL}/auth/projects`, {
    headers: { 'X-Auth-Token': t.token, Accept: 'application/json' },
  })
  if (!r.ok) return { ok: false, error: `Список проектов HTTP ${r.status}` }
  return { ok: true, projects: r.json?.projects || [] }
}

// ─── Compute (Nova) ───────────────────────────────────────────────────────────
function computeEndpoints(catalog) {
  const svc = (catalog || []).find(c => c.type === 'compute')
  if (!svc) return []
  return (svc.endpoints || [])
    .filter(e => !e.interface || e.interface === 'public')
    .map(e => ({ region: e.region, url: e.url.replace(/\/$/, '') }))
}

async function listServersInProject(creds, projectName) {
  const t = await keystoneToken(creds, { project: projectName })
  if (!t.ok) return { ok: false, error: t.error, servers: [] }

  const endpoints = computeEndpoints(t.data?.catalog)
  const servers = []
  for (const ep of endpoints) {
    const r = await fetchJson(`${ep.url}/servers/detail`, {
      headers: { 'X-Auth-Token': t.token, Accept: 'application/json' },
    })
    if (!r.ok) continue

    // Карта flavor → vCPU/RAM/disk
    const flavorMap = {}
    const fr = await fetchJson(`${ep.url}/flavors/detail`, {
      headers: { 'X-Auth-Token': t.token, Accept: 'application/json' },
    })
    if (fr.ok) for (const f of (fr.json?.flavors || [])) flavorMap[f.id] = f

    for (const s of (r.json?.servers || [])) {
      const flav = flavorMap[s.flavor?.id]
      const ips = []
      for (const addrs of Object.values(s.addresses || {})) for (const a of addrs) if (a.addr) ips.push(a.addr)
      servers.push({
        id: s.id,
        name: s.name,
        status: s.status,
        region: ep.region,
        project: projectName,
        az: s['OS-EXT-AZ:availability_zone'] || null,
        ips,
        created: s.created,
        vcpus: flav?.vcpus ?? null,
        ram: flav?.ram ?? null,
        disk: flav?.disk ?? null,
        flavor: s.flavor?.id || null,
      })
    }
  }
  return { ok: true, servers }
}

async function listServers(account) {
  const creds = accCreds(account)
  if (!creds.username || !creds.password || !creds.accountId) {
    return { ok: false, error: 'Не заданы сервисный пользователь / пароль / Account ID (нужны для облачных серверов)' }
  }

  let projects
  if (creds.project) {
    projects = [{ name: creds.project }]
  } else {
    const pr = await listProjects(creds)
    if (!pr.ok) return { ok: false, error: pr.error }
    projects = pr.projects
  }

  const servers = []
  const errors = []
  for (const p of projects) {
    const r = await listServersInProject(creds, p.name)
    if (r.ok) servers.push(...r.servers)
    else errors.push(`${p.name}: ${r.error}`)
  }
  return { ok: true, servers, projects: projects.map(p => p.name), errors }
}

// ─── Сеть / IP / SSH-ключи (OpenStack, project-scoped) ────────────────────────

async function scopedContext(creds, projectName) {
  const t = await keystoneToken(creds, { project: projectName })
  if (!t.ok) return { ok: false, error: t.error }
  return { ok: true, token: t.token, catalog: t.data?.catalog || [] }
}

function endpointsOf(catalog, type) {
  const svc = (catalog || []).find(c => c.type === type)
  if (!svc) return []
  return (svc.endpoints || [])
    .filter(e => !e.interface || e.interface === 'public')
    .map(e => ({ url: e.url.replace(/\/$/, ''), region: e.region }))
}

// Выбор одного эндпоинта для операций: заданный регион → любой ru-* → первый.
function endpointOf(catalog, type, region) {
  const eps = endpointsOf(catalog, type)
  if (!eps.length) return null
  return (region && eps.find(e => e.region === region))
    || eps.find(e => /^ru-/i.test(e.region || ''))
    || eps[0]
}

async function pickProject(creds) {
  if (creds.project) return creds.project
  const pr = await listProjects(creds)
  if (!pr.ok || !pr.projects.length) return null
  return pr.projects[0].name
}

// Готовит контекст: creds + project + token + catalog. Ошибки — единообразно.
async function prepare(account) {
  const creds = accCreds(account)
  if (!creds.username || !creds.password || !creds.accountId) {
    return { ok: false, error: 'Не заданы сервисный пользователь / пароль / Account ID' }
  }
  const project = await pickProject(creds)
  if (!project) return { ok: false, error: 'Не найден проект' }
  const ctx = await scopedContext(creds, project)
  if (!ctx.ok) return ctx
  return { ok: true, token: ctx.token, catalog: ctx.catalog, project, region: account.default_region || null }
}

// ── SSH-ключи (Nova os-keypairs) ──
async function listSshKeys(account) {
  const p = await prepare(account)
  if (!p.ok) return p
  const eps = endpointsOf(p.catalog, 'compute')
  if (!eps.length) return { ok: false, error: 'Нет compute-эндпоинта' }
  const seen = new Set()
  const keys = []
  for (const ep of eps) {
    const r = await fetchJson(`${ep.url}/os-keypairs`, { headers: { 'X-Auth-Token': p.token, Accept: 'application/json' } })
    if (!r.ok) continue
    for (const k of (r.json?.keypairs || [])) {
      const kp = k.keypair || k
      if (kp?.name && !seen.has(kp.name)) {
        seen.add(kp.name)
        keys.push({ name: kp.name, fingerprint: kp.fingerprint, publicKey: kp.public_key, region: ep.region })
      }
    }
  }
  return { ok: true, keys, project: p.project }
}
async function addSshKey(account, { name, publicKey }) {
  if (!name || !publicKey) return { ok: false, error: 'Нужны имя и публичный ключ' }
  const p = await prepare(account)
  if (!p.ok) return p
  const nova = endpointOf(p.catalog, 'compute', p.region)
  if (!nova) return { ok: false, error: 'Нет compute-эндпоинта' }
  const r = await fetchJson(`${nova.url}/os-keypairs`, {
    method: 'POST', headers: { 'X-Auth-Token': p.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ keypair: { name, public_key: publicKey } }),
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `HTTP ${r.status}: ${(r.text || '').slice(0, 200)}` }
  return { ok: true }
}
async function deleteSshKey(account, { name }) {
  const p = await prepare(account)
  if (!p.ok) return p
  const nova = endpointOf(p.catalog, 'compute', p.region)
  if (!nova) return { ok: false, error: 'Нет compute-эндпоинта' }
  const r = await fetchJson(`${nova.url}/os-keypairs/${encodeURIComponent(name)}`, {
    method: 'DELETE', headers: { 'X-Auth-Token': p.token, Accept: 'application/json' },
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `HTTP ${r.status}` }
  return { ok: true }
}

// ── Floating IP (Neutron) ──
async function listFloatingIps(account) {
  const p = await prepare(account)
  if (!p.ok) return p
  const eps = endpointsOf(p.catalog, 'network')
  if (!eps.length) return { ok: false, error: 'Нет network-эндпоинта' }
  const ips = []
  for (const ep of eps) {
    const r = await fetchJson(`${ep.url}/v2.0/floatingips`, { headers: { 'X-Auth-Token': p.token, Accept: 'application/json' } })
    if (!r.ok) continue
    for (const f of (r.json?.floatingips || [])) {
      ips.push({ id: f.id, ip: f.floating_ip_address, status: f.status, portId: f.port_id, fixedIp: f.fixed_ip_address, region: ep.region })
    }
  }
  return { ok: true, ips }
}
async function allocateFloatingIp(account) {
  const p = await prepare(account)
  if (!p.ok) return p
  const net = endpointOf(p.catalog, 'network', p.region)
  if (!net) return { ok: false, error: 'Нет network-эндпоинта' }
  // Внешняя сеть (router:external=true)
  const nr = await fetchJson(`${net.url}/v2.0/networks?router:external=true`, { headers: { 'X-Auth-Token': p.token, Accept: 'application/json' } })
  if (!nr.ok) return { ok: false, error: nr.networkError ? `Сеть: ${nr.networkError}` : `HTTP ${nr.status}` }
  const ext = (nr.json?.networks || [])[0]
  if (!ext) return { ok: false, error: 'Не найдена внешняя сеть для выделения IP' }
  const r = await fetchJson(`${net.url}/v2.0/floatingips`, {
    method: 'POST', headers: { 'X-Auth-Token': p.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ floatingip: { floating_network_id: ext.id } }),
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `HTTP ${r.status}: ${(r.text || '').slice(0, 200)}` }
  return { ok: true, ip: r.json?.floatingip?.floating_ip_address }
}
async function setFloatingIpPort(account, floatingIpId, portId) {
  const p = await prepare(account)
  if (!p.ok) return p
  const net = endpointOf(p.catalog, 'network', p.region)
  if (!net) return { ok: false, error: 'Нет network-эндпоинта' }
  const r = await fetchJson(`${net.url}/v2.0/floatingips/${floatingIpId}`, {
    method: 'PUT', headers: { 'X-Auth-Token': p.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ floatingip: { port_id: portId } }),
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `HTTP ${r.status}: ${(r.text || '').slice(0, 200)}` }
  return { ok: true }
}
async function attachFloatingIp(account, { floatingIpId, serverId }) {
  const p = await prepare(account)
  if (!p.ok) return p
  const net = endpointOf(p.catalog, 'network', p.region)
  if (!net) return { ok: false, error: 'Нет network-эндпоинта' }
  // Порт сервера
  const pr = await fetchJson(`${net.url}/v2.0/ports?device_id=${encodeURIComponent(serverId)}`, { headers: { 'X-Auth-Token': p.token, Accept: 'application/json' } })
  if (!pr.ok) return { ok: false, error: pr.networkError ? `Сеть: ${pr.networkError}` : `HTTP ${pr.status}` }
  const port = (pr.json?.ports || []).find(pt => (pt.fixed_ips || []).length) || (pr.json?.ports || [])[0]
  if (!port) return { ok: false, error: 'У сервера не найден порт' }
  return setFloatingIpPort(account, floatingIpId, port.id)
}
async function detachFloatingIp(account, { floatingIpId }) {
  return setFloatingIpPort(account, floatingIpId, null)
}
async function releaseFloatingIp(account, { floatingIpId }) {
  const p = await prepare(account)
  if (!p.ok) return p
  const net = endpointOf(p.catalog, 'network', p.region)
  if (!net) return { ok: false, error: 'Нет network-эндпоинта' }
  const r = await fetchJson(`${net.url}/v2.0/floatingips/${floatingIpId}`, {
    method: 'DELETE', headers: { 'X-Auth-Token': p.token, Accept: 'application/json' },
  })
  if (!r.ok) return { ok: false, error: r.networkError ? `Сеть: ${r.networkError}` : `HTTP ${r.status}` }
  return { ok: true }
}

// ─── Тест подключения (для кнопки в UI) ───────────────────────────────────────
async function testAccount(account) {
  const b = await getBalance(account).catch(e => ({ ok: false, error: e.message }))
  const s = await listServers(account).catch(e => ({ ok: false, error: e.message }))
  return {
    balance: b.ok ? { ok: true } : { ok: false, error: b.error },
    servers: s.ok ? { ok: true, count: s.servers.length, projects: s.projects } : { ok: false, error: s.error },
  }
}

// Суммарный баланс в рублях из ответа /v3/balances.
// Значения balances_values_sum приходят в копейках → делим на 100.
function balanceTotalRub(balance) {
  const billings = balance?.data?.billings
  if (!Array.isArray(billings)) return null
  return billings.reduce((s, b) => s + (Number(b.balances_values_sum) || 0), 0) / 100
}

module.exports = {
  getBalance, listServers, testAccount, getStatistics, getTransactions,
  listSshKeys, addSshKey, deleteSshKey,
  listFloatingIps, allocateFloatingIp, attachFloatingIp, detachFloatingIp, releaseFloatingIp,
  balanceTotalRub,
}
