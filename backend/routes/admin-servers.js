const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const remnwave = require('../services/remnwave')

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
        xrayVersion: n.xrayVersion || '',
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

module.exports = router
