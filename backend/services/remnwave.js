// Remnwave API Service
// Работает с REST API прокси-сервера Remnwave для управления узлами и конфигурациями

const db = require('../db')

// Кеш конфигурации (обновляется раз в 60 сек или при сбросе)
let configCache = null
let configCacheTime = 0
const CONFIG_CACHE_TTL = 60 * 1000 // 60 секунд

/**
 * Получить конфигурацию Remnwave: сначала из БД (site_config), fallback на .env
 */
async function getConfig() {
  const now = Date.now()
  if (configCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache
  }

  try {
    const r = await db.query(
      'SELECT remnwave_api_url, remnwave_api_token, remnwave_secret_key FROM site_config LIMIT 1'
    )
    const row = r.rows[0]
    if (row && row.remnwave_api_token) {
      configCache = {
        apiUrl: row.remnwave_api_url || process.env.REMNWAVE_API_URL || 'https://api.remnawave.com',
        apiToken: row.remnwave_api_token,
        secretKey: row.remnwave_secret_key || process.env.REMNWAVE_SECRET_KEY || ''
      }
      configCacheTime = now
      return configCache
    }
  } catch (err) {
    // БД может быть недоступна при старте — fallback на .env
  }

  configCache = {
    apiUrl: process.env.REMNWAVE_API_URL || 'https://api.remnawave.com',
    apiToken: process.env.REMNWAVE_API_TOKEN || '',
    secretKey: process.env.REMNWAVE_SECRET_KEY || ''
  }
  configCacheTime = now
  return configCache
}

/**
 * Сбросить кеш (вызывается при сохранении настроек в админке)
 */
function invalidateConfigCache() {
  configCache = null
  configCacheTime = 0
}

// Логирование при старте (из .env)
console.log('[Remnwave] API_URL:', process.env.REMNWAVE_API_URL || '(not set, will use DB)')
console.log('[Remnwave] API_TOKEN:', process.env.REMNWAVE_API_TOKEN ? '✓ Configured' : '(not set, will use DB)')
console.log('[Remnwave] SECRET_KEY:', process.env.REMNWAVE_SECRET_KEY ? '✓ Configured' : '(not set, will use DB)')

/**
 * Generic API request wrapper
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g. '/api/nodes')
 * @param {Object|null} body - JSON body for POST/PATCH
 * @param {*} defaultValue - Default value on error (null, [], etc.)
 * @returns {Promise<*>} - Parsed response
 */
async function apiRequest(method, path, body = null, defaultValue = null) {
  const config = await getConfig()
  const label = `${method} ${path}`
  try {
    console.log(`[Remnwave] ${label}`)
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-For': '127.0.0.1',
      'X-Real-IP': '127.0.0.1',
      ...(config.apiToken ? { 'Authorization': `Bearer ${config.apiToken}`, 'X-Api-Key': config.apiToken } : {})
    }
    const options = { method, headers }
    if (body) options.body = JSON.stringify(body)

    const res = await fetch(`${config.apiUrl}${path}`, options)
    const text = await res.text()
    
    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.error(`[Remnwave] Invalid JSON from ${label}:`, text.substring(0, 200))
      throw new Error(`Invalid JSON response`)
    }

    if (!res.ok) {
      console.error(`[Remnwave] ${label} error: ${res.status}`, data)
      throw new Error('Remnwave API request failed')
    }

    return data.response || data
  } catch (err) {
    console.error(`[Remnwave] Error ${label}:`, err.message)
    if (defaultValue !== undefined) return defaultValue
    throw err
  }
}

/**
 * Получить список хостов
 */
async function getHosts() {
  const data = await apiRequest('GET', '/api/hosts', null, [])
  return data.hosts || data || []
}

/**
 * Получить список узлов (серверов)
 */
async function getNodes() {
  const data = await apiRequest('GET', '/api/nodes', null, [])
  if (Array.isArray(data)) return data
  return data.nodes || data.data || []
}

/**
 * Получить информацию о конкретном узле
 */
async function getNode(nodeId) {
  return apiRequest('GET', `/api/nodes/${nodeId}`, null, null)
}

/**
 * Получить список пользователей на узле
 */
async function getUsers(nodeId) {
  const data = await apiRequest('GET', `/api/nodes/${nodeId}/users`, null, [])
  return data.users || data || []
}

/**
 * Получить конфигурацию подписки для пользователя
 */
async function getSubscriptionConfig(userId, nodeId) {
  return apiRequest('GET', `/api/users/${userId}/subscription?nodeId=${nodeId}`, null, null)
}

/**
 * Получить список Internal Squads (краткая версия с inbounds-info)
 */
async function getInternalSquads() {
  const data = await apiRequest('GET', '/api/internal-squads', null, [])
  return data.internalSquads || data || []
}

/**
 * Получить один Internal Squad с полным списком inbounds.
 * Нужно для mapping squad↔nodes (через intersect inbound UUIDs).
 */
async function getInternalSquad(uuid) {
  return apiRequest('GET', `/api/internal-squads/${uuid}`, null, null)
}

/**
 * Создать VPN пользователя в Remnwave
 * @param {Object} userData - данные пользователя
 * @param {string} userData.username - имя пользователя
 * @param {number} userData.trafficLimitBytes - лимит трафика в байтах
 * @param {Date} userData.expireAt - дата истечения
 * @param {string[]} [userData.activeInternalSquads] - массив UUID сквадов
 */
async function createRemnwaveUser(userData) {
  const payload = {
    username: userData.username,
    status: userData.status || 'ACTIVE',
    expireAt: (userData.expireAt instanceof Date ? userData.expireAt : new Date(userData.expireAt)).toISOString(),
    trafficLimitBytes: userData.trafficLimitBytes || 0,
    trafficLimitStrategy: userData.trafficLimitStrategy || 'NO_RESET',
    ...(userData.activeInternalSquads?.length > 0 ? { activeInternalSquads: userData.activeInternalSquads } : {}),
    ...(userData.email ? { email: userData.email } : {}),
    ...(userData.telegramId ? { telegramId: userData.telegramId } : {}),
    ...(userData.tag ? { tag: userData.tag } : {}),
    ...(userData.description ? { description: userData.description } : {}),
    ...(userData.hwidDeviceLimit != null ? { hwidDeviceLimit: userData.hwidDeviceLimit } : {}),
  }

  const user = await apiRequest('POST', '/api/users', payload, undefined)
  if (!user || !user.uuid) {
    throw new Error('RemnaWave не создал юзера (apiRequest вернул пустой ответ — проверьте логи RW и валидность payload)')
  }
  console.log(`[Remnwave] User created: uuid=${user.uuid}, shortUuid=${user.shortUuid}`)
  invalidateUsersCache()
  return user
}

/**
 * Найти пользователя Remnwave по username. Возвращает user-объект или null, если не найден.
 */
async function getRemnwaveUserByUsername(username) {
  if (!username) return null
  const data = await apiRequest('GET', `/api/users/by-username/${encodeURIComponent(username)}`, null, null)
  if (!data) return null
  return data.uuid ? data : (data.user || null)
}

// === Кэш полного списка users (для server-side фильтрации/сортировки) ===
// Remnawave игнорирует query-фильтры — фильтруем у себя.
let allUsersCache = null
let allUsersCacheTime = 0
const ALL_USERS_TTL = 30 * 1000

async function fetchAllRemnwaveUsersRaw() {
  const PAGE = 500
  const result = []
  let start = 0
  let totalReported = null
  // Защита от бесконечного цикла: максимум 50 страниц = 25k юзеров
  for (let i = 0; i < 50; i++) {
    const data = await apiRequest('GET', `/api/users?start=${start}&size=${PAGE}`, null, { users: [], total: 0 })
    const users = Array.isArray(data) ? data : (data.users || [])
    if (totalReported === null) totalReported = data.total ?? users.length
    if (users.length === 0) break
    result.push(...users)
    if (result.length >= (totalReported || 0)) break
    start += users.length
    if (users.length < PAGE) break
  }
  return result
}

async function getAllRemnwaveUsers() {
  const now = Date.now()
  if (allUsersCache && (now - allUsersCacheTime) < ALL_USERS_TTL) return allUsersCache
  allUsersCache = await fetchAllRemnwaveUsersRaw()
  allUsersCacheTime = now
  return allUsersCache
}

function invalidateUsersCache() {
  allUsersCache = null
  allUsersCacheTime = 0
}

/**
 * Список пользователей Remnwave с пагинацией.
 * Если задан search/status/нестандартная сортировка — фильтруем поверх закешированного полного списка
 * (Remnawave не поддерживает query-side filtering). Иначе — пагинация напрямую через start/size.
 */
async function listRemnwaveUsers({ start = 0, size = 20, search = '', status = '', sortBy = 'updatedAt', sortDirection = 'desc' } = {}) {
  const trimmedSearch = String(search || '').trim().toLowerCase()
  const needsFilter = !!trimmedSearch || !!status
  const needsCustomSort = sortBy && sortBy !== 'updatedAt' || sortDirection === 'asc'

  // Быстрый путь: нет фильтров и стандартная сортировка → один запрос с пагинацией
  if (!needsFilter && !needsCustomSort) {
    const data = await apiRequest('GET', `/api/users?start=${start}&size=${size}`, null, { users: [], total: 0 })
    const users = Array.isArray(data) ? data : (data.users || [])
    const total = data.total ?? users.length
    return { users, total }
  }

  // Медленный путь: загружаем всё и фильтруем/сортируем у себя
  const all = await getAllRemnwaveUsers()
  let filtered = all
  if (trimmedSearch) {
    filtered = filtered.filter(u => {
      const username = String(u.username || '').toLowerCase()
      const email = String(u.email || '').toLowerCase()
      const tag = String(u.tag || '').toLowerCase()
      const desc = String(u.description || '').toLowerCase()
      const tg = String(u.telegramId || '')
      return username.includes(trimmedSearch)
        || email.includes(trimmedSearch)
        || tag.includes(trimmedSearch)
        || desc.includes(trimmedSearch)
        || tg.includes(trimmedSearch)
    })
  }
  if (status) {
    filtered = filtered.filter(u => u.status === status)
  }

  // Sort in-place
  if (sortBy) {
    const dir = sortDirection === 'asc' ? 1 : -1
    filtered = [...filtered].sort((a, b) => {
      let av = a?.[sortBy]
      let bv = b?.[sortBy]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      // Даты как ISO-string сравниваются лексикографически правильно; число как число
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }

  const total = filtered.length
  const page = filtered.slice(start, start + size)
  return { users: page, total }
}

async function getRemnwaveUserByUuid(uuid) {
  if (!uuid) return null
  const data = await apiRequest('GET', `/api/users/${encodeURIComponent(uuid)}`, null, null)
  return data?.uuid ? data : (data?.user || null)
}

async function deleteRemnwaveUser(uuid) {
  const r = await apiRequest('DELETE', `/api/users/${encodeURIComponent(uuid)}`)
  invalidateUsersCache()
  return r
}

async function enableRemnwaveUser(uuid) {
  const r = await apiRequest('POST', `/api/users/${encodeURIComponent(uuid)}/actions/enable`)
  invalidateUsersCache()
  return r
}

async function disableRemnwaveUser(uuid) {
  const r = await apiRequest('POST', `/api/users/${encodeURIComponent(uuid)}/actions/disable`)
  invalidateUsersCache()
  return r
}

async function resetRemnwaveUserTraffic(uuid) {
  const r = await apiRequest('POST', `/api/users/${encodeURIComponent(uuid)}/actions/reset-traffic`)
  invalidateUsersCache()
  return r
}

async function revokeRemnwaveUserSubscription(uuid, body = {}) {
  const r = await apiRequest('POST', `/api/users/${encodeURIComponent(uuid)}/actions/revoke`, body)
  invalidateUsersCache()
  return r
}

async function getRemnwaveUserHwidDevices(userUuid) {
  if (!userUuid) return []
  const data = await apiRequest('GET', `/api/hwid/devices/${encodeURIComponent(userUuid)}`, null, [])
  return data?.devices || data || []
}

async function deleteRemnwaveUserHwid(userUuid, hwid) {
  return apiRequest('POST', `/api/hwid/devices/delete`, { userUuid, hwid })
}

async function deleteAllRemnwaveUserHwid(userUuid) {
  return apiRequest('POST', `/api/hwid/devices/delete-all`, { userUuid })
}

/**
 * Обновить пользователя в Remnwave (squads, expireAt, traffic, status, email, tag, ...)
 */
async function updateRemnwaveUser(userUuid, updateData) {
  const payload = { uuid: userUuid }

  if (updateData.activeInternalSquads) payload.activeInternalSquads = updateData.activeInternalSquads
  if (updateData.expireAt) {
    payload.expireAt = (updateData.expireAt instanceof Date ? updateData.expireAt : new Date(updateData.expireAt)).toISOString()
  }
  if (updateData.trafficLimitBytes !== undefined) payload.trafficLimitBytes = updateData.trafficLimitBytes
  if (updateData.trafficLimitStrategy !== undefined) payload.trafficLimitStrategy = updateData.trafficLimitStrategy
  if (updateData.status) payload.status = updateData.status
  if (updateData.email !== undefined) payload.email = updateData.email || null
  if (updateData.telegramId !== undefined) payload.telegramId = updateData.telegramId == null ? null : Number(updateData.telegramId)
  if (updateData.tag !== undefined) payload.tag = updateData.tag || null
  if (updateData.description !== undefined) payload.description = updateData.description || null
  if (updateData.hwidDeviceLimit !== undefined) payload.hwidDeviceLimit = Number(updateData.hwidDeviceLimit) || 0

  const user = await apiRequest('PATCH', '/api/users', payload)
  console.log(`[Remnwave] User ${userUuid} updated`)
  invalidateUsersCache()
  return user
}

/**
 * Обновить internal squads для пользователя
 */
async function updateRemnwaveUserSquads(userUuid, squadUuids) {
  return updateRemnwaveUser(userUuid, { activeInternalSquads: squadUuids })
}

/**
 * Получить subscription URL для пользователя
 */
async function getUserSubscriptionUrl(userUuid) {
  const data = await apiRequest('GET', `/api/users/${userUuid}/subscription`, null, null)
  return data?.subscriptionUrl || data
}

/**
 * Создать пользователя на узле
 */
async function createUser(nodeId, userData) {
  return apiRequest('POST', `/api/nodes/${nodeId}/users`, userData, null)
}

/**
 * Получить системную статистику панели
 */
async function getSystemStats() {
  return apiRequest('GET', '/api/system/stats', null, null)
}

/**
 * Обновить ноду (имя и др.)
 */
async function updateNode(uuid, data) {
  return apiRequest('PATCH', '/api/nodes', { uuid, ...data })
}

/**
 * Обновить хост (включить/отключить и др.)
 */
async function updateHost(uuid, data) {
  return apiRequest('PATCH', '/api/hosts', { uuid, ...data })
}

/**
 * Включить ноду
 */
async function enableNode(uuid) {
  return apiRequest('POST', `/api/nodes/${uuid}/actions/enable`)
}

/**
 * Отключить ноду
 */
async function disableNode(uuid) {
  return apiRequest('POST', `/api/nodes/${uuid}/actions/disable`)
}

/**
 * Перезапустить Xray на ноде
 */
async function restartNode(uuid) {
  return apiRequest('POST', `/api/nodes/${uuid}/actions/restart`)
}

/**
 * Трафик одного пользователя с разбивкой по нодам и по дням.
 * RemnaWave 2.7+: GET /api/bandwidth-stats/users/{uuid}?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Ответ:
 *   {
 *     categories: ['2026-04-22', ...],
 *     series: [{ uuid, name, color, countryCode, total, data: [bytes per day] }],
 *     sparklineData: [...],
 *     topNodes: [...]
 *   }
 *
 * @param {string} userUuid - UUID пользователя в RemnaWave
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate   - YYYY-MM-DD
 */
async function getUserBandwidthStats(userUuid, startDate, endDate) {
  const qs = new URLSearchParams({ start: startDate, end: endDate })
  return apiRequest('GET', `/api/bandwidth-stats/users/${userUuid}?${qs}`, null, null)
}

/**
 * Общий трафик по всем нодам за период (для итоговой строки).
 * GET /api/bandwidth-stats/nodes?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Возвращает {categories, series:[{uuid, name, total, data:[..]}], sparklineData, topNodes}.
 */
async function getNodesBandwidthStats(startDate, endDate) {
  const qs = new URLSearchParams({ start: startDate, end: endDate })
  return apiRequest('GET', `/api/bandwidth-stats/nodes?${qs}`, null, null)
}

/**
 * Включить хосты (bulk)
 */
async function enableHosts(uuids) {
  return apiRequest('POST', '/api/hosts/bulk/enable', { uuids })
}

/**
 * Отключить хосты (bulk)
 */
async function disableHosts(uuids) {
  return apiRequest('POST', '/api/hosts/bulk/disable', { uuids })
}

module.exports = {
  getNodes,
  getHosts,
  getNode,
  getUsers,
  getSubscriptionConfig,
  createUser,
  createRemnwaveUser,
  updateRemnwaveUser,
  getRemnwaveUserByUsername,
  listRemnwaveUsers,
  getRemnwaveUserByUuid,
  deleteRemnwaveUser,
  enableRemnwaveUser,
  disableRemnwaveUser,
  resetRemnwaveUserTraffic,
  revokeRemnwaveUserSubscription,
  getRemnwaveUserHwidDevices,
  deleteRemnwaveUserHwid,
  deleteAllRemnwaveUserHwid,
  getUserSubscriptionUrl,
  getInternalSquads,
  getInternalSquad,
  updateRemnwaveUserSquads,
  getSystemStats,
  updateNode,
  updateHost,
  enableNode,
  disableNode,
  restartNode,
  enableHosts,
  disableHosts,
  getUserBandwidthStats,
  getNodesBandwidthStats,
  getConfig,
  invalidateConfigCache
}
