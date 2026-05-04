/**
 * Yandex.Cloud VPC API — управление публичными IP, подсетями, сетями.
 * Документация: https://yandex.cloud/ru/docs/vpc/api-ref/Address/
 */
const VPC_BASE = 'https://vpc.api.cloud.yandex.net/vpc/v1'

/**
 * Список публичных IP-адресов в папке.
 * Каждый адрес содержит externalIpv4Address или externalIpv6Address,
 * флаг used (привязан ли к ресурсу) и reserved (статический ли).
 */
async function listAddresses(yc, { folderId, pageSize = 100, pageToken } = {}) {
  if (!folderId) throw new Error('folderId обязателен для list-addresses')
  const r = await yc.get(`${VPC_BASE}/addresses`, {
    params: { folderId, pageSize, pageToken },
  })
  return {
    addresses: (r.data?.addresses || []).map(simplifyAddress),
    nextPageToken: r.data?.nextPageToken || null,
  }
}

/**
 * Получить один адрес.
 */
async function getAddress(yc, addressId) {
  const r = await yc.get(`${VPC_BASE}/addresses/${addressId}`)
  return r.data
}

/**
 * Аллоцировать новый IP-адрес (ephemeral по умолчанию).
 *
 * @param {object} yc
 * @param {object} opts
 * @param {string} opts.folderId
 * @param {string} [opts.name]
 * @param {string} [opts.description]
 * @param {string} [opts.zoneId]   — обязателен для ipv4 spec
 * @param {boolean} [opts.reserved=false] — сразу зарезервировать (статика)
 * @param {string} [opts.ddosProtection]  — 'qrator' если нужна
 * @param {boolean} [opts.ipv6=false]     — выбрать IPv6 вместо IPv4
 */
async function createAddress(yc, opts = {}) {
  if (!opts.folderId) throw new Error('folderId обязателен для createAddress')

  const body = {
    folderId: opts.folderId,
    name: opts.name,
    description: opts.description,
    deletionProtection: false,
  }
  if (opts.ipv6) {
    body.externalIpv6AddressSpec = { zoneId: opts.zoneId }
  } else {
    body.externalIpv4AddressSpec = { zoneId: opts.zoneId, ddosProtectionProvider: opts.ddosProtection }
  }
  // Уберём пустые поля чтобы не нервировать YC
  if (!body.name) delete body.name
  if (!body.description) delete body.description
  if (body.externalIpv4AddressSpec && !body.externalIpv4AddressSpec.ddosProtectionProvider) {
    delete body.externalIpv4AddressSpec.ddosProtectionProvider
  }

  const r = await yc.post(`${VPC_BASE}/addresses`, body)
  return r.data
}

/**
 * Обновить адрес — главный кейс: reserved=true (превращаем ephemeral в static).
 */
async function updateAddress(yc, addressId, patch) {
  const params = {}
  // YC требует updateMask для PATCH-операций
  const fields = Object.keys(patch).filter(k => patch[k] !== undefined)
  if (fields.length === 0) throw new Error('Нечего обновлять')
  params.updateMask = fields.join(',')

  const r = await yc.patch(`${VPC_BASE}/addresses/${addressId}`, patch, { params })
  return r.data
}

/**
 * Освободить адрес (release).
 */
async function deleteAddress(yc, addressId) {
  const r = await yc.delete(`${VPC_BASE}/addresses/${addressId}`)
  return r.data
}

function simplifyAddress(a) {
  return {
    id: a.id,
    folderId: a.folderId,
    name: a.name,
    description: a.description,
    externalIp: a.externalIpv4Address?.address || a.externalIpv6Address?.address || null,
    family: a.externalIpv4Address ? 'IPv4' : (a.externalIpv6Address ? 'IPv6' : 'unknown'),
    zoneId: a.externalIpv4Address?.zoneId || a.externalIpv6Address?.zoneId || null,
    reserved: !!a.reserved,
    used: !!a.used,
    type: a.type,                 // EXTERNAL | INTERNAL
    deletionProtection: !!a.deletionProtection,
    createdAt: a.createdAt,
    labels: a.labels || {},
    ddosProtection: a.externalIpv4Address?.ddosProtectionProvider || null,
  }
}

/**
 * Список подсетей в папке. Нужен при создании VM — указать subnetId.
 */
async function listSubnets(yc, { folderId, pageSize = 100 } = {}) {
  if (!folderId) throw new Error('folderId обязателен для list-subnets')
  const r = await yc.get(`${VPC_BASE}/subnets`, { params: { folderId, pageSize } })
  return {
    subnets: (r.data?.subnets || []).map(s => ({
      id: s.id,
      name: s.name,
      networkId: s.networkId,
      zoneId: s.zoneId,
      v4CidrBlocks: s.v4CidrBlocks || [],
      v6CidrBlocks: s.v6CidrBlocks || [],
      createdAt: s.createdAt,
    })),
  }
}

async function listNetworks(yc, { folderId, pageSize = 50 } = {}) {
  if (!folderId) throw new Error('folderId обязателен для list-networks')
  const r = await yc.get(`${VPC_BASE}/networks`, { params: { folderId, pageSize } })
  return {
    networks: (r.data?.networks || []).map(n => ({
      id: n.id, name: n.name, description: n.description, createdAt: n.createdAt,
    })),
  }
}

module.exports = {
  listAddresses,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
  simplifyAddress,
  listSubnets,
  listNetworks,
}
