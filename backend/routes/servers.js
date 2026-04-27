const express = require('express')
const remnwave = require('../services/remnwave')

const router = express.Router()

// Fallback на mock-данные если Remnwave API недоступен
const mockServers = [
  {
    id: 1,
    uuid: 'mock-1',
    name: 'Moscow Fast',
    remark: 'Быстрый сервер в Москве',
    city: 'Москва',
    address: '93.175.x.x',
    ip: '93.175.x.x',
    country_code: 'RU',
    is_connected: true,
    users_online: 42,
    protocols: ['VLESS', 'Trojan'],
    xray_uptime: 604800
  },
  {
    id: 2,
    uuid: 'mock-2',
    name: 'Berlin Premium',
    remark: 'Премиум сервер в Берлине',
    city: 'Берлин',
    address: '185.20.x.x',
    ip: '185.20.x.x',
    country_code: 'DE',
    is_connected: true,
    users_online: 28,
    protocols: ['VLESS', 'Shadowsocks'],
    xray_uptime: 2592000
  },
  {
    id: 3,
    uuid: 'mock-3',
    name: 'Singapore Ultra',
    remark: 'Ультра быстрый сервер в Сингапуре',
    city: 'Сингапур',
    address: '128.14.x.x',
    ip: '128.14.x.x',
    country_code: 'SG',
    is_connected: true,
    users_online: 65,
    protocols: ['VLESS', 'Trojan', 'Shadowsocks'],
    xray_uptime: 1209600
  }
]

// GET /servers — список всех узлов/серверов с хостами
router.get('/', async (req, res) => {
  try {
    const [nodes, hosts] = await Promise.all([
      remnwave.getNodes(),
      remnwave.getHosts()
    ])
    
    if (nodes && nodes.length > 0) {
      // Создаем маппинг хостов к узлам
      const hostsByNodeUuid = {}
      if (hosts && hosts.length > 0) {
        hosts.forEach(host => {
          if (host.nodes && Array.isArray(host.nodes)) {
            host.nodes.forEach(nodeUuid => {
              if (!hostsByNodeUuid[nodeUuid]) {
                hostsByNodeUuid[nodeUuid] = []
              }
              hostsByNodeUuid[nodeUuid].push(host)
            })
          }
        })
      }
      
      // Преобразуем реальные данные и подставляем отображаемое имя из hosts API
      const enriched = nodes.map(n => {
        const nodeHosts = hostsByNodeUuid[n.uuid] || []
        const primaryHost = nodeHosts.find(h => h.isDisabled !== true) || nodeHosts[0] || null
        const hostDisplayName = primaryHost?.name || primaryHost?.remark || primaryHost?.address || ''
        
        return {
          id: n.uuid || n.id,
          uuid: n.uuid,
          name: hostDisplayName || n.name || 'Unknown',
          node_name: n.name || 'Unknown',
          remark: primaryHost?.remark || '',
          city: n.city || extractCityFromAddress(n.address),
          address: n.address,
          ip: n.address,
          port: primaryHost?.port || n.port || 443,
          country_code: n.countryCode,
          is_connected: n.isConnected === true && !n.isDisabled,
          is_disabled: n.isDisabled,
          users_online: n.usersOnline || 0,
          traffic_used_bytes: n.trafficUsedBytes || 0,
          traffic_limit_bytes: n.trafficLimitBytes || 0,
          xray_uptime: parseInt(n.xrayUptime || 0) * 1000,
          xray_version: n.xrayVersion,
          protocols: extractProtocols(n.configProfile),
          cpu_count: n.cpuCount,
          cpu_model: n.cpuModel,
          total_ram: n.totalRam,
          status_updated: n.updatedAt,
          status_message: n.lastStatusMessage
        }
      })

      const onlineOnly = enriched.filter(s => s.is_connected === true)
      return res.json({ servers: onlineOnly })
    }
  } catch (err) {
    console.error('Error fetching nodes:', err)
  }
  // Fallback на mock-данные
  res.json({ servers: mockServers })
})

// Утилита: извлечь город из адреса
function extractCityFromAddress(address) {
  if (!address) return 'Unknown'
  const parts = address.split('.')
  if (parts.length > 2) {
    const city = parts[0].toUpperCase()
    if (city.startsWith('FN-')) return city.replace('FN-', '')
    return city
  }
  return address
}

// Утилита: извлечь протоколы из конфига
function extractProtocols(configProfile) {
  if (!configProfile?.activeInbounds) return ['Vless', 'Trojan']
  const protocols = new Set()
  configProfile.activeInbounds.forEach(inbound => {
    if (inbound.protocol) {
      protocols.add(inbound.protocol.toUpperCase())
    }
  })
  return Array.from(protocols).length > 0 ? Array.from(protocols) : ['Vless', 'Trojan']
}

// GET /servers/:id — информация о конкретном сервере и его конфигурация
router.get('/:id', async (req, res) => {
  const id = req.params.id
  try {
    const node = await remnwave.getNode(id)
    if (node) {
      return res.json({
        server: node,
        config: {
          subscription: `# Subscription link for node ${id}\nhttps://api.vpn.local/subscribe/${id}`,
          vless: `# VLESS config for node ${id} (use subscription link)`
        }
      })
    }
  } catch (err) {
    console.error(`Error fetching node ${id}:`, err)
  }
  
  // Fallback
  const mockServer = mockServers.find(s => s.id === Number(id))
  if (!mockServer) return res.status(404).json({ error: 'Not found' })
  res.json({
    server: mockServer,
    config: {
      vless: `# VLESS config for server ${id}`,
      trojan: `# Trojan config for server ${id}`
    }
  })
})

// GET /servers/:id/config — получить конфигурацию для аутентифицированного пользователя
router.get('/:id/config', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })
  
  const nodeId = req.params.id
  try {
    // TODO: получить userId из токена
    const userId = 'temp-user-id'
    const config = await remnwave.getSubscriptionConfig(userId, nodeId)
    if (config) return res.json({ config })
  } catch (err) {
    console.error('Error fetching config:', err)
  }
  
  res.json({ config: 'Mock subscription URL' })
})

module.exports = router
