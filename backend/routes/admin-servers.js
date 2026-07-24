const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const remnwave = require('../services/remnwave')
const nodeInstaller = require('../services/remnwaveNodeInstaller')
const db = require('../db')
const audit = require('../services/auditLog')

// Все маршруты требуют авторизации + админ
router.use(verifyToken, verifyAdmin)

/**
 * GET /api/admin/servers
 * Полный список серверов с расширенной информацией для админки
 */
router.get('/', async (req, res) => {
  try {
    const [nodes, hosts, squads] = await Promise.all([
      remnwave.getNodes(),
      remnwave.getHosts(),
      remnwave.getInternalSquads()
    ])

    // Маппинг хостов к узлам
    const hostsByNode = {}
    if (Array.isArray(hosts)) {
      hosts.forEach(host => {
        const nodeList = host.nodes || []
        nodeList.forEach(nodeUuid => {
          if (!hostsByNode[nodeUuid]) hostsByNode[nodeUuid] = []
          hostsByNode[nodeUuid].push(host)
        })
      })
    }

    const servers = (nodes || []).map(n => {
      const nodeHosts = hostsByNode[n.uuid] || []
      return {
        id: n.uuid || n.id,
        uuid: n.uuid,
        name: n.name || 'Unknown',
        address: n.address,
        port: n.port || 443,
        countryCode: n.countryCode || '',
        isConnected: n.isConnected === true,
        isDisabled: n.isDisabled === true,
        usersOnline: n.usersOnline || 0,
        trafficUsedBytes: n.trafficUsedBytes || 0,
        trafficLimitBytes: n.trafficLimitBytes || 0,
        trafficResetDay: n.trafficResetDay || null,
        xrayUptime: parseInt(n.xrayUptime || 0) * 1000,
        // Версии приходят вложенным объектом: versions: { xray, node }
        xrayVersion: n.versions?.xray || n.xrayVersion || '',
        nodeVersion: n.versions?.node || '',
        cpuCount: n.cpuCount || 0,
        cpuModel: n.cpuModel || '',
        totalRam: n.totalRam || 0,
        lastStatusMessage: n.lastStatusMessage || '',
        updatedAt: n.updatedAt,
        createdAt: n.createdAt,
        hosts: nodeHosts.map(h => ({
          uuid: h.uuid,
          remark: h.remark || '',
          address: h.address || '',
          port: h.port || 443,
          protocol: h.protocol || '',
          isDisabled: h.isDisabled || false
        })),
        consumptionMultiplier: n.consumptionMultiplier || 1
      }
    })

    res.json({
      servers,
      squads: (squads || []).map(s => ({
        uuid: s.uuid,
        name: s.tag || s.name || 'Без имени',
        inboundsCount: s.inboundsCount ?? 0,
        nodesCount: s.nodesCount ?? 0
      })),
      totalOnline: servers.reduce((sum, s) => sum + s.usersOnline, 0)
    })
  } catch (err) {
    console.error('[AdminServers] Error fetching servers:', err.message)
    res.status(500).json({ error: 'Ошибка получения списка серверов' })
  }
})

/**
 * GET /api/admin/servers/system-stats
 * Системная статистика панели Remnawave
 */
router.get('/system-stats', async (req, res) => {
  try {
    const stats = await remnwave.getSystemStats()
    res.json({ stats })
  } catch (err) {
    console.error('[AdminServers] Error fetching system stats:', err.message)
    res.status(500).json({ error: 'Ошибка получения системной статистики' })
  }
})

// ─── Config Profiles & Infra Providers (read-only, для формы создания) ───────
//
// ВАЖНО: эти маршруты должны идти ДО `GET /:uuid`, иначе Express
// интерпретирует `config-profiles` / `infra-providers` как UUID параметры.

/**
 * GET /api/admin/servers/latest-versions
 * Актуальные версии RemnaWave Node и Xray из GitHub Releases (кэш 6ч).
 * Фронт сравнивает с установленными версиями нод.
 */
router.get('/latest-versions', async (req, res) => {
  try {
    const versionCheck = require('../services/versionCheck')
    const data = await versionCheck.getLatestVersions()
    res.json(data)
  } catch (err) {
    console.error('[AdminServers] latest-versions error:', err.message)
    res.status(502).json({ error: 'Не удалось получить актуальные версии', node: null, xray: null })
  }
})

router.get('/config-profiles', async (req, res) => {
  try {
    const data = await remnwave.listConfigProfiles()
    // Remnawave возвращает { total, configProfiles: [...] }
    res.json({
      total: data?.total || 0,
      profiles: data?.configProfiles || [],
    })
  } catch (err) {
    console.error('[AdminServers] Error listing config profiles:', err.message)
    res.status(502).json({ error: `Ошибка загрузки config-профилей: ${err.message}` })
  }
})

router.get('/config-profiles/:uuid/inbounds', async (req, res) => {
  try {
    const data = await remnwave.getConfigProfileInbounds(req.params.uuid)
    res.json({
      total: data?.total || 0,
      inbounds: data?.inbounds || [],
    })
  } catch (err) {
    console.error('[AdminServers] Error fetching profile inbounds:', err.message)
    res.status(502).json({ error: `Ошибка загрузки inbounds: ${err.message}` })
  }
})

router.get('/infra-providers', async (req, res) => {
  try {
    const data = await remnwave.listInfraProviders()
    res.json({
      total: data?.total || 0,
      providers: data?.providers || [],
    })
  } catch (err) {
    console.error('[AdminServers] Error listing infra providers:', err.message)
    // Если у Remnawave нет infra-billing модуля — это не фатально, отдаём пустой список
    res.json({ total: 0, providers: [] })
  }
})

/**
 * GET /api/admin/servers/available-vps
 * VPS из нашей БД которые ещё не привязаны к Remnawave-ноде и могут быть
 * использованы для установки. Условия:
 *   - status = 'active'
 *   - node_uuid IS NULL
 *   - есть ip_address
 *   - есть хоть один способ SSH-аутентификации (password или key — проверяем
 *     просто что одно из полей не пустое; реальная валидность — на момент SSH)
 *
 * Поля минимально нужные для UI: id, name, ip_address, location, hosting_provider,
 * country_code (из location?), monthly_cost, currency, paid_until.
 */
router.get('/available-vps', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, hosting_provider, ip_address, location, monthly_cost, currency, paid_until,
              ssh_user, ssh_port,
              (ssh_password != '' OR ssh_key != '') AS has_ssh_credentials
         FROM vps_servers
        WHERE status = 'active'
          AND ip_address IS NOT NULL AND ip_address != ''
          AND node_uuid IS NULL
        ORDER BY paid_until DESC NULLS LAST, name ASC`
    )
    res.json({
      total: rows.length,
      vps: rows.map(r => ({
        id: r.id,
        name: r.name,
        ip: r.ip_address,
        provider: r.hosting_provider || null,
        location: r.location || null,
        monthlyCost: r.monthly_cost ? Number(r.monthly_cost) : null,
        currency: r.currency,
        paidUntil: r.paid_until,
        sshUser: r.ssh_user || 'root',
        sshPort: r.ssh_port || 22,
        hasSshCredentials: r.has_ssh_credentials,
      })),
    })
  } catch (err) {
    console.error('[AdminServers] Error listing available VPS:', err.message)
    res.status(500).json({ error: 'Не удалось загрузить список свободных VPS' })
  }
})

/**
 * GET /api/admin/servers/install-jobs/:jobId/stream
 * Server-Sent Events: стримит логи установки в реальном времени.
 *
 * События:
 *   event: snapshot      — на старте: накопленные логи + status
 *   event: log           — каждая новая строка лога
 *   event: done          — установка завершилась (success/failed)
 *
 * Формат каждого события — JSON в data:.
 */
router.get('/install-jobs/:jobId/stream', async (req, res) => {
  const job = nodeInstaller.getJob(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job не найден или истёк' })

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // отключаем proxy buffering nginx
  res.flushHeaders?.()

  const send = (event, data) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Initial snapshot — все накопленные логи + текущий статус
  send('snapshot', {
    status: job.status,
    logs: job.logs,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  })

  // Если job уже завершилась — сразу шлём done и закрываем
  if (job.status !== 'running') {
    send('done', { status: job.status, error: job.error || null })
    return res.end()
  }

  // Подписываемся на live-логи
  const onLog = (entry) => send('log', entry)
  const onDone = (info) => {
    send('done', info)
    res.end()
  }
  job.emitter.on('log', onLog)
  job.emitter.once('done', onDone)

  // Heartbeat чтобы прокси не закрыли idle-соединение
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000)

  req.on('close', () => {
    clearInterval(hb)
    job.emitter.off('log', onLog)
    job.emitter.off('done', onDone)
  })
})

/**
 * GET /api/admin/servers/:uuid
 * Детальная информация о конкретном сервере
 */
router.get('/:uuid', async (req, res) => {
  try {
    const node = await remnwave.getNode(req.params.uuid)
    if (!node) {
      return res.status(404).json({ error: 'Сервер не найден' })
    }
    res.json({ server: node })
  } catch (err) {
    console.error('[AdminServers] Error fetching server:', err.message)
    res.status(500).json({ error: 'Ошибка получения информации о сервере' })
  }
})

/**
 * GET /api/admin/servers/:uuid/users
 * Список пользователей на конкретном сервере
 */
router.get('/:uuid/users', async (req, res) => {
  try {
    const users = await remnwave.getUsers(req.params.uuid)
    res.json({ users: users || [] })
  } catch (err) {
    console.error('[AdminServers] Error fetching server users:', err.message)
    res.status(500).json({ error: 'Ошибка получения пользователей сервера' })
  }
})

/**
 * POST /api/admin/servers/:uuid/enable
 * Включить ноду
 */
router.post('/:uuid/enable', async (req, res) => {
  try {
    const result = await remnwave.enableNode(req.params.uuid)
    res.json({ success: true, node: result })
  } catch (err) {
    console.error('[AdminServers] Error enabling node:', err.message)
    res.status(500).json({ error: 'Ошибка включения сервера' })
  }
})

/**
 * POST /api/admin/servers/:uuid/disable
 * Отключить ноду
 */
router.post('/:uuid/disable', async (req, res) => {
  try {
    const result = await remnwave.disableNode(req.params.uuid)
    res.json({ success: true, node: result })
  } catch (err) {
    console.error('[AdminServers] Error disabling node:', err.message)
    res.status(500).json({ error: 'Ошибка отключения сервера' })
  }
})

/**
 * POST /api/admin/servers/:uuid/restart
 * Перезапуск Xray на ноде
 */
router.post('/:uuid/restart', async (req, res) => {
  try {
    const result = await remnwave.restartNode(req.params.uuid)
    res.json({ success: true, node: result })
  } catch (err) {
    console.error('[AdminServers] Error restarting node:', err.message)
    res.status(500).json({ error: 'Ошибка перезапуска сервера' })
  }
})

/**
 * PATCH /api/admin/servers/hosts/:uuid
 * Обновить хост (включить/отключить)
 */
router.patch('/hosts/:uuid', async (req, res) => {
  try {
    const { isDisabled } = req.body
    if (typeof isDisabled !== 'boolean') {
      return res.status(400).json({ error: 'Поле isDisabled обязательно (boolean)' })
    }
    const result = await remnwave.updateHost(req.params.uuid, { isDisabled })
    res.json({ host: result })
  } catch (err) {
    console.error('[AdminServers] Error updating host:', err.message)
    res.status(500).json({ error: 'Ошибка обновления хоста' })
  }
})

/**
 * PATCH /api/admin/servers/:uuid
 * Обновить настройки ноды (имя и др.)
 */
router.patch('/:uuid', async (req, res) => {
  try {
    const { name } = req.body
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Имя сервера обязательно' })
    }
    const result = await remnwave.updateNode(req.params.uuid, { name: name.trim() })
    res.json({ server: result })
  } catch (err) {
    console.error('[AdminServers] Error updating server:', err.message)
    res.status(500).json({ error: 'Ошибка обновления сервера' })
  }
})

// ─── Создание / удаление / reset traffic / restart-all ────────────────────────

/**
 * POST /api/admin/servers
 * Создать новую Remnawave-ноду. Прокси к POST /api/nodes Remnawave.
 *
 * Минимальная валидация на нашей стороне (Remnawave валидирует строже,
 * но 422 от него неудобен для UI):
 *   - name: 3-30 символов, обязательно
 *   - address: непустой
 *   - port: 1-65535 если задан
 *   - configProfile.activeConfigProfileUuid: валидный UUID
 *   - configProfile.activeInbounds: массив длиной ≥1
 *   - countryCode: 2 символа если задан
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const errors = validateNodePayload(body, { isCreate: true })
    if (errors.length) return res.status(400).json({ error: errors[0], errors })

    const result = await remnwave.createNode(body)
    audit.write(req, 'rw.node.create', { type: 'rw_node', name: body.name }, {
      address: body.address,
      port: body.port,
      countryCode: body.countryCode,
      configProfileUuid: body.configProfile?.activeConfigProfileUuid,
      inboundsCount: body.configProfile?.activeInbounds?.length || 0,
    }).catch(() => {})
    res.status(201).json({ node: result })
  } catch (err) {
    console.error('[AdminServers] Error creating node:', err.message)
    res.status(502).json({ error: `Ошибка создания ноды в Remnawave: ${err.message}` })
  }
})

/**
 * DELETE /api/admin/servers/:uuid
 * Удалить ноду. Фронт перед вызовом обязан спросить confirm-by-typing
 * (юзер вводит имя ноды). Бэк не валидирует — это UX-защита.
 */
router.delete('/:uuid', async (req, res) => {
  try {
    const result = await remnwave.deleteNode(req.params.uuid)
    audit.write(req, 'rw.node.delete', { type: 'rw_node', uuid: req.params.uuid }, {}).catch(() => {})
    res.json({ ok: true, result })
  } catch (err) {
    console.error('[AdminServers] Error deleting node:', err.message)
    res.status(502).json({ error: `Ошибка удаления ноды: ${err.message}` })
  }
})

/**
 * POST /api/admin/servers/:uuid/reset-traffic
 * Сбросить счётчик трафика ноды.
 */
/**
 * POST /api/admin/servers/:uuid/install-on-vps
 * Body: { vpsId: number, appPort: number }
 *
 * Запускает SSH-установку remnawave-node на указанный VPS из нашей БД.
 * Возвращает { jobId } — фронт открывает SSE-стрим /install-jobs/:jobId/stream.
 *
 * URL-параметр :uuid — UUID Remnawave-ноды (та что только что создана через POST /).
 * После успешной установки — UPDATE vps_servers.node_uuid = :uuid (это делает
 * сам инсталлятор, чтобы избежать гонок).
 */
router.post('/:uuid/install-on-vps', async (req, res) => {
  try {
    const nodeUuid = req.params.uuid
    const { vpsId, appPort } = req.body || {}

    if (!Number.isInteger(vpsId)) return res.status(400).json({ error: 'vpsId должен быть числом' })
    const port = Number(appPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'appPort должен быть числом 1-65535' })
    }

    // Получаем SSL_CERT с панели (требуется в .env ноды)
    let pubKeyData
    try {
      pubKeyData = await remnwave.getPanelPubKey()
    } catch (err) {
      return res.status(502).json({ error: `Не удалось получить SSL_CERT с панели: ${err.message}` })
    }
    const sslCert = pubKeyData?.pubKey
    if (!sslCert) {
      return res.status(502).json({ error: 'Remnawave вернул пустой pubKey' })
    }

    const job = await nodeInstaller.startInstallJob({
      vpsId,
      appPort: port,
      sslCert,
      nodeUuid,
    })

    audit.write(req, 'rw.node.install_on_vps', { type: 'rw_node', uuid: nodeUuid }, {
      vpsId, appPort: port, jobId: job.id,
    }).catch(() => {})

    res.json({ jobId: job.id })
  } catch (err) {
    console.error('[AdminServers] install-on-vps error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/:uuid/reset-traffic', async (req, res) => {
  try {
    const result = await remnwave.resetNodeTraffic(req.params.uuid)
    audit.write(req, 'rw.node.reset_traffic', { type: 'rw_node', uuid: req.params.uuid }, {}).catch(() => {})
    res.json({ ok: true, result })
  } catch (err) {
    console.error('[AdminServers] Error resetting node traffic:', err.message)
    res.status(502).json({ error: `Ошибка сброса трафика: ${err.message}` })
  }
})

/**
 * POST /api/admin/servers/actions/restart-all
 * Перезагрузить все ноды одновременно. Опасное действие — фронт обязан
 * спросить confirm-by-typing (RESTART).
 *
 * ВАЖНО: путь идёт перед `/:uuid`-маршрутами в порядке регистрации, поэтому
 * Express не путает `actions` с UUID. Однако т.к. `actions` — не UUID, такая
 * ситуация невозможна. Оставляем как есть.
 */
router.post('/actions/restart-all', async (req, res) => {
  try {
    const force = req.body?.force === true
    const result = await remnwave.restartAllNodes(force)
    audit.write(req, 'rw.node.restart_all', { type: 'rw_nodes' }, { force }).catch(() => {})
    res.json({ ok: true, result })
  } catch (err) {
    console.error('[AdminServers] Error restarting all nodes:', err.message)
    res.status(502).json({ error: `Ошибка перезапуска всех нод: ${err.message}` })
  }
})

// ─── Валидация payload для create ─────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validateNodePayload(body, { isCreate }) {
  const errors = []

  if (isCreate) {
    if (!body.name || typeof body.name !== 'string') {
      errors.push('Имя ноды обязательно')
    } else {
      const n = body.name.trim()
      if (n.length < 3 || n.length > 30) errors.push('Имя 3-30 символов')
    }
    if (!body.address || typeof body.address !== 'string' || body.address.trim().length < 2) {
      errors.push('Адрес обязателен')
    }
    if (!body.configProfile || typeof body.configProfile !== 'object') {
      errors.push('configProfile обязателен')
    } else {
      if (!UUID_RE.test(body.configProfile.activeConfigProfileUuid || '')) {
        errors.push('configProfile.activeConfigProfileUuid должен быть UUID')
      }
      if (!Array.isArray(body.configProfile.activeInbounds) || body.configProfile.activeInbounds.length === 0) {
        errors.push('Нужно выбрать хотя бы один inbound')
      } else if (body.configProfile.activeInbounds.some(u => !UUID_RE.test(u))) {
        errors.push('activeInbounds: все элементы должны быть UUID')
      }
    }
  }

  if (body.port !== undefined && body.port !== null) {
    const p = Number(body.port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) errors.push('Порт 1-65535')
  }
  if (body.countryCode !== undefined && body.countryCode !== null && body.countryCode !== '') {
    if (typeof body.countryCode !== 'string' || body.countryCode.length !== 2) {
      errors.push('countryCode — 2 символа (ISO 3166-1)')
    }
  }
  if (body.tags !== undefined && body.tags !== null) {
    if (!Array.isArray(body.tags) || body.tags.length > 10) {
      errors.push('tags: максимум 10 элементов')
    } else if (body.tags.some(t => typeof t !== 'string' || !/^[A-Z0-9_:]{1,36}$/.test(t))) {
      errors.push('tags: только A-Z, 0-9, _, :, до 36 символов каждый')
    }
  }
  return errors
}

module.exports = router
