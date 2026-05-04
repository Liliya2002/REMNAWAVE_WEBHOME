/**
 * Yandex.Cloud Compute API — управление виртуальными машинами.
 * Документация: https://yandex.cloud/ru/docs/compute/api-ref/Instance/
 *
 * Все операции YC асинхронные — POST :start возвращает Operation { id, done, ... }.
 * Для UI используем pull-модель: после действия фронт перечитает список и увидит новый статус.
 */
const COMPUTE_BASE = 'https://compute.api.cloud.yandex.net/compute/v1'

/**
 * Список инстансов в папке.
 * @param {object} yc — ycClient(accountId)
 * @param {{ folderId: string, pageSize?: number, pageToken?: string }} opts
 */
async function listInstances(yc, { folderId, pageSize = 100, pageToken } = {}) {
  if (!folderId) throw new Error('folderId обязателен для list-instances')
  const r = await yc.get(`${COMPUTE_BASE}/instances`, {
    params: { folderId, pageSize, pageToken },
  })
  return {
    instances: (r.data?.instances || []).map(simplifyInstance),
    nextPageToken: r.data?.nextPageToken || null,
  }
}

/**
 * Один инстанс полностью (без simplify — UI покажет всё).
 */
async function getInstance(yc, instanceId) {
  const r = await yc.get(`${COMPUTE_BASE}/instances/${instanceId}`, {
    params: { view: 'FULL' },
  })
  return r.data
}

async function startInstance(yc, instanceId) {
  const r = await yc.post(`${COMPUTE_BASE}/instances/${instanceId}:start`, {})
  return r.data
}

async function stopInstance(yc, instanceId) {
  const r = await yc.post(`${COMPUTE_BASE}/instances/${instanceId}:stop`, {})
  return r.data
}

async function restartInstance(yc, instanceId) {
  const r = await yc.post(`${COMPUTE_BASE}/instances/${instanceId}:restart`, {})
  return r.data
}

async function deleteInstance(yc, instanceId) {
  const r = await yc.delete(`${COMPUTE_BASE}/instances/${instanceId}`)
  return r.data
}

/**
 * Создать VM. Возвращает Operation — фронт после получения ответа делает refresh
 * списка через несколько секунд.
 *
 * @param {object} yc
 * @param {object} params
 * @param {string} params.folderId
 * @param {string} params.zoneId               — например "ru-central1-a"
 * @param {string} [params.name]
 * @param {string} [params.description]
 * @param {string} params.platformId           — "standard-v3" (default)
 * @param {number} params.cores                — vCPU (1-16 типично)
 * @param {number} params.memoryGb             — RAM в GB
 * @param {number} [params.coreFraction=100]   — 5/20/50/100 — % выделения CPU
 * @param {string} params.subnetId             — обязателен
 * @param {boolean} [params.publicIp=true]     — добавить one-to-one NAT для публичного IP
 * @param {string} params.imageId              — boot image, например с listImages
 * @param {number} [params.diskSizeGb=20]      — размер boot-диска
 * @param {string} [params.diskType='network-ssd'] — тип диска
 * @param {string} [params.sshKey]             — публичный SSH-ключ (одна строка)
 * @param {string} [params.sshUser='ubuntu']   — имя юзера для cloud-init
 * @param {object} [params.labels]
 * @param {boolean} [params.preemptible=false] — прерываемая (дешевле, но YC может стопнуть)
 */
async function createInstance(yc, params) {
  const required = ['folderId', 'zoneId', 'cores', 'memoryGb', 'subnetId', 'imageId']
  for (const k of required) {
    if (!params[k]) throw new Error(`createInstance: ${k} обязателен`)
  }

  const networkInterface = {
    subnetId: params.subnetId,
    primaryV4AddressSpec: {},
  }
  if (params.publicIp !== false) {
    const natSpec = { ipVersion: 'IPV4' }
    // Если передан существующий статический IP — закрепим его за VM.
    // YC не аллоцирует новый, а привяжет указанный.
    if (params.staticIpAddress) {
      natSpec.address = String(params.staticIpAddress)
    }
    networkInterface.primaryV4AddressSpec.oneToOneNatSpec = natSpec
  }

  const metadata = {}
  if (params.sshKey) {
    const user = params.sshUser || 'ubuntu'
    // Стандартный путь: ssh-keys = "user:ssh-rsa ..." для cloud-init на Ubuntu/Debian
    metadata['ssh-keys'] = `${user}:${params.sshKey.trim()}`
  }

  const body = {
    folderId: params.folderId,
    name: params.name || undefined,
    description: params.description || undefined,
    zoneId: params.zoneId,
    platformId: params.platformId || 'standard-v3',
    resourcesSpec: {
      memory: String(Math.floor(Number(params.memoryGb) * 1024 * 1024 * 1024)),
      cores: String(Math.floor(Number(params.cores))),
      coreFraction: String(Math.floor(Number(params.coreFraction) || 100)),
    },
    bootDiskSpec: {
      mode: 'READ_WRITE',
      autoDelete: true,
      diskSpec: {
        typeId: params.diskType || 'network-ssd',
        size: String(Math.floor(Number(params.diskSizeGb || 20) * 1024 * 1024 * 1024)),
        imageId: params.imageId,
      },
    },
    networkInterfaceSpecs: [networkInterface],
    metadata: Object.keys(metadata).length ? metadata : undefined,
    labels: params.labels || undefined,
    schedulingPolicy: params.preemptible ? { preemptible: true } : undefined,
  }

  const r = await yc.post(`${COMPUTE_BASE}/instances`, body)
  return r.data
}

/**
 * Список доступных в YC платформ. Их относительно мало и они не часто меняются —
 * можно хардкодить, но удобнее запросить.
 * https://cloud.yandex.ru/docs/compute/concepts/vm-platforms
 */
const KNOWN_PLATFORMS = [
  { id: 'standard-v3',     label: 'standard-v3 (Cascade Lake/Ice Lake) — рекомендуется' },
  { id: 'standard-v2',     label: 'standard-v2 (Cascade Lake)' },
  { id: 'standard-v1',     label: 'standard-v1 (Broadwell)' },
  { id: 'highfreq-v3',     label: 'highfreq-v3 (повышенная частота)' },
  { id: 'gpu-standard-v3', label: 'gpu-standard-v3 (с GPU)' },
]
const KNOWN_ZONES = [
  { id: 'ru-central1-a', label: 'ru-central1-a (Москва)' },
  { id: 'ru-central1-b', label: 'ru-central1-b (Санкт-Петербург)' },
  { id: 'ru-central1-d', label: 'ru-central1-d (Калуга)' },
]
const KNOWN_DISK_TYPES = [
  { id: 'network-ssd',                label: 'network-ssd — обычный SSD' },
  { id: 'network-hdd',                label: 'network-hdd — HDD (дешевле)' },
  { id: 'network-ssd-nonreplicated',  label: 'network-ssd-nonreplicated — без репликации (быстрее)' },
  { id: 'network-ssd-io-m3',          label: 'network-ssd-io-m3 — для IO-нагрузок' },
]
function getKnownPlatforms() { return KNOWN_PLATFORMS }
function getKnownZones() { return KNOWN_ZONES }
function getKnownDiskTypes() { return KNOWN_DISK_TYPES }

/**
 * Привести raw YC instance к компактной форме для таблицы.
 * Оставляем все ключевые поля + считаем публичный/приватный IP из networkInterfaces.
 */
function simplifyInstance(inst) {
  const ni = inst.networkInterfaces || []
  const primary = ni[0] || {}
  const publicIp =
    primary.primaryV4Address?.oneToOneNat?.address ||
    primary.primaryV4Address?.dnsRecords?.[0]?.fqdn ||
    null
  const privateIp = primary.primaryV4Address?.address || null

  return {
    id: inst.id,
    name: inst.name,
    description: inst.description,
    folderId: inst.folderId,
    status: inst.status,           // PROVISIONING|RUNNING|STOPPING|STOPPED|STARTING|RESTARTING|ERROR|CRASHED|DELETING
    fqdn: inst.fqdn,
    zoneId: inst.zoneId,
    platformId: inst.platformId,
    cores: inst.resources?.cores ? Number(inst.resources.cores) : null,
    memory: inst.resources?.memory ? Number(inst.resources.memory) : null,   // bytes
    coreFraction: inst.resources?.coreFraction ? Number(inst.resources.coreFraction) : null,
    publicIp,
    privateIp,
    bootDiskId: inst.bootDisk?.diskId || null,
    secondaryDiskIds: (inst.secondaryDisks || []).map(d => d.diskId),
    createdAt: inst.createdAt,
    labels: inst.labels || {},
  }
}

module.exports = {
  listInstances,
  getInstance,
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstance,
  createInstance,
  simplifyInstance,
  getKnownPlatforms,
  getKnownZones,
  getKnownDiskTypes,
}
