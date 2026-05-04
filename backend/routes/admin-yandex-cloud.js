const express = require('express')
const router = express.Router()
const db = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')
const { encrypt } = require('../services/encryption')
const auth = require('../services/yandexCloud/auth')
const { ycClient } = require('../services/yandexCloud/client')
const compute = require('../services/yandexCloud/compute')
const vpc = require('../services/yandexCloud/vpc')
const billing = require('../services/yandexCloud/billing')
const ipRangeSearch = require('../services/yandexCloud/ipRangeSearch')
const images = require('../services/yandexCloud/images')
const sshKeys = require('../services/yandexCloud/sshKeys')
const audit = require('../services/auditLog')
const dns = require('dns').promises
const net = require('net')

router.use(verifyToken, verifyAdmin)

// Поля, которые могут быть зашифрованы при сохранении.
const ENCRYPTED_FIELDS = ['oauth_token', 'sa_key_json', 'socks5_url']
// Поля, которые скрываем в публичной выдаче (заменяем на "***" если есть).
const HIDDEN_FIELDS = ['oauth_token', 'sa_key_json', 'socks5_url']

/**
 * Возвращает безопасное представление аккаунта (без чувствительных данных).
 */
function publicAccount(row) {
  if (!row) return null
  const result = { ...row }
  for (const f of HIDDEN_FIELDS) {
    if (result[f]) {
      result[`has_${f}`] = true
      result[f] = null
    } else {
      result[`has_${f}`] = false
    }
  }
  return result
}

function validateAuthInput(body, isCreate) {
  if (isCreate || body.auth_type !== undefined) {
    if (!['oauth', 'sa_key'].includes(body.auth_type)) {
      return 'auth_type должен быть "oauth" или "sa_key"'
    }
  }
  if (body.auth_type === 'sa_key' && body.sa_key_json) {
    try {
      const parsed = JSON.parse(body.sa_key_json)
      if (!parsed.id || !parsed.service_account_id || !parsed.private_key) {
        return 'SA-ключ должен содержать поля id, service_account_id, private_key'
      }
    } catch {
      return 'sa_key_json должен быть валидным JSON'
    }
  }
  if (body.auth_type === 'oauth' && body.oauth_token !== undefined) {
    if (typeof body.oauth_token !== 'string' || body.oauth_token.length < 10) {
      return 'oauth_token слишком короткий'
    }
  }
  if (body.socks5_url) {
    if (!/^socks5:\/\//.test(body.socks5_url)) {
      return 'socks5_url должен начинаться с socks5://'
    }
  }
  return null
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/yandex-cloud/accounts
 */
router.get('/accounts', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.*, u.login AS created_by_login,
              c.expires_at AS iam_expires_at
         FROM yc_accounts a
         LEFT JOIN users u ON u.id = a.created_by
         LEFT JOIN yc_iam_token_cache c ON c.account_id = a.id
        ORDER BY a.is_active DESC, a.created_at DESC`
    )
    res.json({ accounts: r.rows.map(publicAccount) })
  } catch (err) {
    console.error('[YC] list accounts error:', err.message)
    res.status(500).json({ error: 'Не удалось загрузить аккаунты' })
  }
})

/**
 * POST /api/admin/yandex-cloud/accounts
 */
router.post('/accounts', async (req, res) => {
  try {
    const {
      name, auth_type, oauth_token, sa_key_json,
      default_cloud_id, default_folder_id, billing_account_id,
      socks5_url, notes, is_readonly,
    } = req.body

    if (!name || !name.trim()) return res.status(400).json({ error: 'Имя обязательно' })

    const validationErr = validateAuthInput(req.body, true)
    if (validationErr) return res.status(400).json({ error: validationErr })

    const r = await db.query(
      `INSERT INTO yc_accounts
        (name, auth_type, oauth_token, sa_key_json,
         default_cloud_id, default_folder_id, billing_account_id,
         socks5_url, notes, is_readonly, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        name.trim(), auth_type,
        auth_type === 'oauth' && oauth_token ? encrypt(oauth_token) : null,
        auth_type === 'sa_key' && sa_key_json ? encrypt(sa_key_json) : null,
        default_cloud_id || null,
        default_folder_id || null,
        billing_account_id || null,
        socks5_url ? encrypt(socks5_url) : null,
        notes || null,
        !!is_readonly,
        req.userId,
      ]
    )
    audit.write(req, 'yc.account.create', { type: 'yc_account', id: r.rows[0].id }, { name }).catch(() => {})
    res.json({ account: publicAccount(r.rows[0]) })
  } catch (err) {
    console.error('[YC] create account error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * PUT /api/admin/yandex-cloud/accounts/:id
 * Обновляем только переданные поля. Sensitive обновляем только если пришли непустые.
 */
router.put('/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (!id) return res.status(400).json({ error: 'invalid id' })

    const validationErr = validateAuthInput(req.body, false)
    if (validationErr) return res.status(400).json({ error: validationErr })

    const allowed = [
      'name', 'auth_type', 'oauth_token', 'sa_key_json',
      'default_cloud_id', 'default_folder_id', 'billing_account_id',
      'socks5_url', 'notes', 'is_active', 'is_readonly',
    ]
    const sets = []
    const values = []
    let idx = 1
    for (const key of allowed) {
      if (!(key in req.body)) continue
      let value = req.body[key]
      // Sensitive поля: пустая строка = "не менять", null = "стереть"
      if (ENCRYPTED_FIELDS.includes(key)) {
        if (value === '' || value === undefined) continue
        value = value === null ? null : encrypt(String(value))
      }
      sets.push(`${key} = $${idx++}`)
      values.push(value)
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' })

    sets.push(`updated_at = NOW()`)
    values.push(id)
    const r = await db.query(
      `UPDATE yc_accounts SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    )
    if (r.rows.length === 0) return res.status(404).json({ error: 'Не найден' })

    // Если поменяли creds — обнулим IAM-кэш
    if (req.body.oauth_token || req.body.sa_key_json || req.body.auth_type) {
      await db.query('DELETE FROM yc_iam_token_cache WHERE account_id = $1', [id])
    }

    audit.write(req, 'yc.account.update', { type: 'yc_account', id }, {
      changedKeys: Object.keys(req.body).filter(k => allowed.includes(k))
    }).catch(() => {})

    res.json({ account: publicAccount(r.rows[0]) })
  } catch (err) {
    console.error('[YC] update account error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/admin/yandex-cloud/accounts/:id
 */
router.delete('/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (!id) return res.status(400).json({ error: 'invalid id' })

    const r = await db.query('DELETE FROM yc_accounts WHERE id = $1 RETURNING name', [id])
    if (r.rows.length === 0) return res.status(404).json({ error: 'Не найден' })

    audit.write(req, 'yc.account.delete', { type: 'yc_account', id }, { name: r.rows[0].name }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error('[YC] delete account error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/yandex-cloud/accounts/:id/test
 * Проверка connectivity:
 *   1. Получить IAM-токен (форсированно, чтоб ошибка ловилась)
 *   2. Попытаться список облаков (resource-manager) — самый дешёвый запрос
 * Возвращает details: clouds[], duration, hasSocks5
 */
router.post('/accounts/:id/test', async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).json({ error: 'invalid id' })

  const startedAt = Date.now()
  const result = { ok: false, steps: [], durationMs: 0, diagnostics: {} }
  try {
    // 0. Сетевая диагностика — параллельно проверяем что оба домена YC резолвятся и
    //    пускают TCP-соединение. Это даёт ранний ответ если проблема в DNS/firewall.
    result.diagnostics = await runNetworkDiagnostics([
      'iam.api.cloud.yandex.net',
      'resource-manager.api.cloud.yandex.net',
    ])
    for (const d of result.diagnostics.hosts) {
      result.steps.push({
        key: `net_${d.host}`,
        label: `${d.host}: DNS ${d.dnsOk ? '✓' : '✗'}, TCP/443 ${d.tcpOk ? '✓' : '✗'}${d.dnsMs != null ? ` (${d.dnsMs}мс)` : ''}`,
        ok: d.dnsOk && d.tcpOk,
        detail: d.error || null,
      })
    }

    // 1. IAM
    try {
      await auth.refreshIamToken(id)
      result.steps.push({ key: 'iam_token', label: 'Получен IAM-токен', ok: true })
    } catch (err) {
      result.steps.push({ key: 'iam_token', label: `IAM error: ${err.message}`, ok: false })
      throw err
    }

    // 2. List clouds (через YC client с retry/refresh)
    const yc = await ycClient(id)
    result.hasSocks5 = yc.meta.hasSocks5
    const r = await yc.get('https://resource-manager.api.cloud.yandex.net/resource-manager/v1/clouds', {
      params: { pageSize: 50 },
    })
    const clouds = (r.data?.clouds || []).map(c => ({ id: c.id, name: c.name, organizationId: c.organizationId }))
    result.steps.push({
      key: 'list_clouds',
      label: `Доступно облаков: ${clouds.length}`,
      ok: clouds.length > 0,
      detail: clouds.length === 0 ? 'У SA/OAuth нет прав на просмотр облаков' : null,
    })
    result.clouds = clouds
    result.ok = clouds.length > 0
  } catch (err) {
    result.error = err.message
    if (err.diagHint) result.errorHint = err.diagHint
    if (err.code) result.errorCode = err.code
  } finally {
    result.durationMs = Date.now() - startedAt
  }

  audit.write(req, 'yc.account.test', { type: 'yc_account', id }, { ok: result.ok, durationMs: result.durationMs })
    .catch(() => {})
  res.json(result)
})

/**
 * Проверяет DNS resolve + TCP/443 connect для каждого хоста.
 * Возвращает { hosts: [{ host, dnsOk, dnsMs, addresses, tcpOk, tcpMs, error }] }
 */
async function runNetworkDiagnostics(hosts) {
  const out = { hosts: [] }
  for (const host of hosts) {
    const entry = { host, dnsOk: false, tcpOk: false, addresses: [], probes: [] }
    const dnsStart = Date.now()
    let dnsAddresses = []
    try {
      dnsAddresses = await dns.lookup(host, { all: true, family: 0 })
      entry.dnsOk = dnsAddresses.length > 0
      entry.dnsMs = Date.now() - dnsStart
      entry.addresses = dnsAddresses.map(a => a.address)
    } catch (e) {
      entry.error = `DNS: ${e.message}`
      out.hosts.push(entry)
      continue
    }

    if (dnsAddresses.length === 0) {
      out.hosts.push(entry); continue
    }

    // Пробуем ВСЕ IP параллельно — какой первый ответит, тот и победил.
    // Сохраняем результат каждой попытки чтобы было видно где IPv4 ок а IPv6 нет.
    const probes = await Promise.allSettled(dnsAddresses.map(addr => probeTcp(addr.address, addr.family, 5000)))
    entry.probes = probes.map((p, i) => ({
      ip: dnsAddresses[i].address,
      family: dnsAddresses[i].family === 6 ? 'IPv6' : 'IPv4',
      ok: p.status === 'fulfilled',
      ms: p.status === 'fulfilled' ? p.value.ms : null,
      error: p.status === 'rejected' ? p.reason.message : null,
    }))
    const okProbes = entry.probes.filter(p => p.ok)
    entry.tcpOk = okProbes.length > 0
    entry.tcpMs = okProbes.length > 0 ? Math.min(...okProbes.map(p => p.ms)) : null
    if (!entry.tcpOk) {
      entry.error = 'TCP: все IP недоступны на :443'
    }
    out.hosts.push(entry)
  }
  return out
}

function probeTcp(ip, family, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const socket = new net.Socket()
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`TCP timeout ${timeoutMs}ms`))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ ms: Date.now() - start })
    })
    socket.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    socket.connect({ port: 443, host: ip, family })
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function loadAccountWithFolderHint(req, res) {
  const id = parseInt(req.params.id)
  if (!id) { res.status(400).json({ error: 'invalid id' }); return null }
  const r = await db.query('SELECT * FROM yc_accounts WHERE id = $1', [id])
  if (r.rows.length === 0) { res.status(404).json({ error: 'YC аккаунт не найден' }); return null }
  return { id, account: r.rows[0] }
}

function resolveFolderId(account, query) {
  return query?.folderId || account.default_folder_id || null
}

function ensureFolderId(req, res, account) {
  const folderId = resolveFolderId(account, req.query)
  if (!folderId) {
    res.status(400).json({
      error: 'folderId не задан и default_folder_id у аккаунта пустой. Передай ?folderId=... или установи default_folder_id в карточке аккаунта.'
    })
    return null
  }
  return folderId
}

function checkReadonlyOrFail(req, res, account) {
  if (account.is_readonly) {
    res.status(403).json({ error: 'Аккаунт в read-only режиме — destructive-операции запрещены. Сними галку в настройках аккаунта.' })
    return false
  }
  return true
}

// ─── Stage 2: Compute (VM) ─────────────────────────────────────────────────

/**
 * GET /api/admin/yandex-cloud/accounts/:id/instances?folderId=...
 * Список VM в папке.
 */
router.get('/accounts/:id/instances', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const folderId = ensureFolderId(req, res, ctx.account); if (!folderId) return
    const yc = await ycClient(ctx.id)
    const data = await compute.listInstances(yc, { folderId })
    res.json({ folderId, ...data })
  } catch (err) {
    console.error('[YC] list instances error:', err.message)
    res.status(500).json({ error: err.message, hint: err.diagHint })
  }
})

/**
 * GET /api/admin/yandex-cloud/accounts/:id/instances/:vmId
 * Детали одной VM.
 */
router.get('/accounts/:id/instances/:vmId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const yc = await ycClient(ctx.id)
    const data = await compute.getInstance(yc, req.params.vmId)
    res.json({ instance: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/yandex-cloud/accounts/:id/instances
 * Создать VM. Body: см. compute.createInstance.
 */
router.post('/accounts/:id/instances', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  if (!checkReadonlyOrFail(req, res, ctx.account)) return
  try {
    const folderId = req.body.folderId || ctx.account.default_folder_id
    if (!folderId) return res.status(400).json({ error: 'folderId обязателен' })

    // Если пришёл family вместо imageId — резолвим в конкретный imageId
    let imageId = req.body.imageId
    if (!imageId && req.body.imageFamily) {
      const yc0 = await ycClient(ctx.id)
      const img = await images.getLatestByFamily(yc0, req.body.imageFamily)
      imageId = img.id
      if (!imageId) return res.status(400).json({ error: `Не найден образ для family=${req.body.imageFamily}` })
    }
    if (!imageId) return res.status(400).json({ error: 'imageId или imageFamily обязателен' })

    // Если пришёл sshKeyId — подгружаем сохранённый ключ из БД (приоритет над сырым sshKey)
    let sshKey = req.body.sshKey
    let sshUser = req.body.sshUser
    if (req.body.sshKeyId) {
      const k = await db.query(
        'SELECT public_key, default_user FROM yc_ssh_keys WHERE id = $1 AND account_id = $2',
        [req.body.sshKeyId, ctx.id]
      )
      if (k.rows.length === 0) return res.status(400).json({ error: 'Сохранённый SSH-ключ не найден' })
      sshKey = k.rows[0].public_key
      if (!sshUser) sshUser = k.rows[0].default_user
    }

    const yc = await ycClient(ctx.id)
    const op = await compute.createInstance(yc, {
      ...req.body, folderId, imageId, sshKey, sshUser,
    })

    audit.write(req, 'yc.instance.create',
      { type: 'yc_instance' },
      { accountId: ctx.id, folderId, name: req.body.name, imageId, cores: req.body.cores, memoryGb: req.body.memoryGb }
    ).catch(() => {})

    res.json({ operation: op })
  } catch (err) {
    console.error('[YC] create instance error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/yandex-cloud/accounts/:id/catalog?folderId=...
 * Один запрос для UI — отдаёт всё что нужно для формы создания VM:
 * subnets, popular images, platforms, zones, disk types.
 */
router.get('/accounts/:id/catalog', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const folderId = ensureFolderId(req, res, ctx.account); if (!folderId) return
    const yc = await ycClient(ctx.id)

    // Параллелим всё что можно
    const [subnets, latestImages, addresses, sshKeysRows] = await Promise.all([
      vpc.listSubnets(yc, { folderId }).catch(e => ({ subnets: [], error: e.message })),
      // Получаем latest для каждого популярного семейства параллельно
      Promise.all(
        images.POPULAR_FAMILIES.map(async (f) => {
          try {
            const img = await images.getLatestByFamily(yc, f.family)
            return { ...f, imageId: img.id, imageName: img.name, status: img.status }
          } catch (e) {
            return { ...f, error: e.message }
          }
        })
      ),
      // Free static IP — те, что reserved=true И not used (можно прицепить к VM)
      vpc.listAddresses(yc, { folderId }).catch(e => ({ addresses: [], error: e.message })),
      // Сохранённые SSH-ключи для этого аккаунта
      db.query(
        'SELECT id, name, public_key, fingerprint, default_user, notes FROM yc_ssh_keys WHERE account_id = $1 ORDER BY created_at DESC',
        [ctx.id]
      ).then(r => r.rows).catch(() => []),
    ])

    const freeStaticIps = (addresses.addresses || []).filter(a =>
      a.reserved && !a.used && a.family === 'IPv4' && a.externalIp
    )

    res.json({
      folderId,
      subnets: subnets.subnets || [],
      subnetsError: subnets.error,
      images: latestImages,
      platforms: compute.getKnownPlatforms(),
      zones: compute.getKnownZones(),
      diskTypes: compute.getKnownDiskTypes(),
      freeStaticIps,
      sshKeys: sshKeysRows,
    })
  } catch (err) {
    console.error('[YC] catalog error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/yandex-cloud/accounts/:id/subnets?folderId=...
 */
router.get('/accounts/:id/subnets', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const folderId = ensureFolderId(req, res, ctx.account); if (!folderId) return
    const yc = await ycClient(ctx.id)
    const data = await vpc.listSubnets(yc, { folderId })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/yandex-cloud/accounts/:id/instances/:vmId/start|stop|restart
 */
for (const action of ['start', 'stop', 'restart']) {
  router.post(`/accounts/:id/instances/:vmId/${action}`, async (req, res) => {
    const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
    try {
      const yc = await ycClient(ctx.id)
      const fn = compute[`${action}Instance`]
      const data = await fn(yc, req.params.vmId)
      audit.write(req, `yc.instance.${action}`, { type: 'yc_instance', id: req.params.vmId }, { accountId: ctx.id }).catch(() => {})
      res.json({ operation: data })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}

/**
 * DELETE /api/admin/yandex-cloud/accounts/:id/instances/:vmId
 */
router.delete('/accounts/:id/instances/:vmId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  if (!checkReadonlyOrFail(req, res, ctx.account)) return
  try {
    const yc = await ycClient(ctx.id)
    const data = await compute.deleteInstance(yc, req.params.vmId)
    audit.write(req, 'yc.instance.delete', { type: 'yc_instance', id: req.params.vmId }, { accountId: ctx.id }).catch(() => {})
    res.json({ operation: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Stage 3: VPC (публичные IP) ───────────────────────────────────────────

/**
 * GET /api/admin/yandex-cloud/accounts/:id/addresses?folderId=...
 */
router.get('/accounts/:id/addresses', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const folderId = ensureFolderId(req, res, ctx.account); if (!folderId) return
    const yc = await ycClient(ctx.id)
    const data = await vpc.listAddresses(yc, { folderId })
    res.json({ folderId, ...data })
  } catch (err) {
    console.error('[YC] list addresses error:', err.message)
    res.status(500).json({ error: err.message, hint: err.diagHint })
  }
})

/**
 * POST /api/admin/yandex-cloud/accounts/:id/addresses
 * Body: { name?, description?, zoneId, reserved?, ipv6?, ddosProtection? }
 * Аллокация нового IP-адреса. По умолчанию — ephemeral IPv4.
 */
router.post('/accounts/:id/addresses', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  if (!checkReadonlyOrFail(req, res, ctx.account)) return
  try {
    const folderId = req.body.folderId || ctx.account.default_folder_id
    if (!folderId) return res.status(400).json({ error: 'folderId обязателен (передай в body или установи default_folder_id)' })
    const yc = await ycClient(ctx.id)
    const op = await vpc.createAddress(yc, { ...req.body, folderId })
    audit.write(req, 'yc.address.create', { type: 'yc_address' }, { accountId: ctx.id, folderId }).catch(() => {})
    res.json({ operation: op })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * PATCH /api/admin/yandex-cloud/accounts/:id/addresses/:addrId
 * Body: { reserved?: bool, name?, description? }
 * Главный кейс — превратить ephemeral в static (reserved=true).
 */
router.patch('/accounts/:id/addresses/:addrId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const yc = await ycClient(ctx.id)
    const op = await vpc.updateAddress(yc, req.params.addrId, req.body)
    audit.write(req, 'yc.address.update', { type: 'yc_address', id: req.params.addrId }, { changedKeys: Object.keys(req.body) }).catch(() => {})
    res.json({ operation: op })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/admin/yandex-cloud/accounts/:id/addresses/:addrId
 * Освободить IP. Если used=true — YC откажет сам.
 */
router.delete('/accounts/:id/addresses/:addrId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  if (!checkReadonlyOrFail(req, res, ctx.account)) return
  try {
    const yc = await ycClient(ctx.id)
    const op = await vpc.deleteAddress(yc, req.params.addrId)
    audit.write(req, 'yc.address.delete', { type: 'yc_address', id: req.params.addrId }, { accountId: ctx.id }).catch(() => {})
    res.json({ operation: op })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Stage 4: Billing ──────────────────────────────────────────────────────

/**
 * GET /api/admin/yandex-cloud/accounts/:id/billing-accounts
 */
router.get('/accounts/:id/billing-accounts', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const yc = await ycClient(ctx.id)
    const data = await billing.listBillingAccounts(yc)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/yandex-cloud/accounts/:id/balance
 * Возвращает данные billing-аккаунта (баланс, валюту, статус автоплатежа, top-up URL).
 * Если billing_account_id не задан в карточке — возвращает 400 с подсказкой.
 */
router.get('/accounts/:id/balance', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  const billingAccountId = req.query.billingAccountId || ctx.account.billing_account_id
  if (!billingAccountId) {
    return res.status(400).json({
      error: 'billingAccountId не задан. Передай ?billingAccountId=... или установи в карточке аккаунта.',
      hint: 'Список доступных billing-аккаунтов: GET /accounts/:id/billing-accounts',
    })
  }
  try {
    const yc = await ycClient(ctx.id)
    const acc = await billing.getBillingAccount(yc, billingAccountId)
    const sum = parseInt(req.query.sum) || undefined
    const topUpUrl = billing.buildTopUpUrl({
      billingAccountId,
      sum,
      currency: acc?.currency || 'RUB',
    })
    res.json({ billing: acc, topUpUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/yandex-cloud/accounts/:id/top-up-url?sum=1000
 * Просто строит URL — не делает запросов к YC, для удобства фронта.
 */
router.get('/accounts/:id/top-up-url', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  const billingAccountId = req.query.billingAccountId || ctx.account.billing_account_id
  if (!billingAccountId) return res.status(400).json({ error: 'billingAccountId не задан' })
  const url = billing.buildTopUpUrl({
    billingAccountId,
    sum: parseInt(req.query.sum) || undefined,
    currency: req.query.currency || 'RUB',
  })
  res.json({ url })
})

// ─── SSH keys (saved per-account) ──────────────────────────────────────────

router.get('/accounts/:id/ssh-keys', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const r = await db.query(
      `SELECT k.id, k.name, k.public_key, k.fingerprint, k.default_user, k.notes,
              k.created_at, k.updated_at,
              u.login AS created_by_login
         FROM yc_ssh_keys k
         LEFT JOIN users u ON u.id = k.created_by
        WHERE k.account_id = $1
        ORDER BY k.updated_at DESC`,
      [ctx.id]
    )
    res.json({ keys: r.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/accounts/:id/ssh-keys', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const { name, public_key, default_user, notes } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'name обязателен' })

    const v = sshKeys.validatePublicKey(public_key || '')
    if (!v.ok) return res.status(400).json({ error: v.error })

    const fingerprint = sshKeys.computeFingerprint(v.key)
    // Проверка дедупа — есть ли уже такой ключ под другим именем?
    const dup = await db.query(
      'SELECT name FROM yc_ssh_keys WHERE account_id = $1 AND fingerprint = $2 LIMIT 1',
      [ctx.id, fingerprint]
    )
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `Этот же ключ уже сохранён под именем «${dup.rows[0].name}»` })
    }

    const r = await db.query(
      `INSERT INTO yc_ssh_keys (account_id, name, public_key, fingerprint, default_user, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [ctx.id, name.trim().slice(0, 128), v.key, fingerprint,
       (default_user || 'ubuntu').replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'ubuntu',
       notes || null, req.userId]
    )
    audit.write(req, 'yc.ssh_key.create', { type: 'yc_ssh_key', id: r.rows[0].id }, { name, accountId: ctx.id }).catch(() => {})
    res.json({ key: r.rows[0] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ключ с таким именем уже есть' })
    res.status(500).json({ error: err.message })
  }
})

router.put('/accounts/:id/ssh-keys/:keyId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const keyId = parseInt(req.params.keyId)
    const sets = []; const values = [keyId, ctx.id]; let idx = 3
    if (req.body.name !== undefined) { sets.push(`name = $${idx++}`); values.push(req.body.name.trim().slice(0, 128)) }
    if (req.body.default_user !== undefined) {
      const u = (req.body.default_user || 'ubuntu').replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'ubuntu'
      sets.push(`default_user = $${idx++}`); values.push(u)
    }
    if (req.body.notes !== undefined) { sets.push(`notes = $${idx++}`); values.push(req.body.notes || null) }
    if (sets.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()')
    const r = await db.query(`UPDATE yc_ssh_keys SET ${sets.join(', ')} WHERE id = $1 AND account_id = $2 RETURNING *`, values)
    if (r.rows.length === 0) return res.status(404).json({ error: 'Ключ не найден' })
    audit.write(req, 'yc.ssh_key.update', { type: 'yc_ssh_key', id: keyId }, { changedKeys: Object.keys(req.body) }).catch(() => {})
    res.json({ key: r.rows[0] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ключ с таким именем уже есть' })
    res.status(500).json({ error: err.message })
  }
})

router.delete('/accounts/:id/ssh-keys/:keyId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const keyId = parseInt(req.params.keyId)
    const r = await db.query('DELETE FROM yc_ssh_keys WHERE id = $1 AND account_id = $2 RETURNING name', [keyId, ctx.id])
    if (r.rows.length === 0) return res.status(404).json({ error: 'Не найден' })
    audit.write(req, 'yc.ssh_key.delete', { type: 'yc_ssh_key', id: keyId }, { name: r.rows[0].name }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── CIDR lists (saved per-account) ────────────────────────────────────────

/**
 * Нормализация массива CIDR (используется и для save, и для search).
 * Принимает массив или строку, чистит, проверяет и дедублицирует.
 */
function normalizeCidrs(input) {
  let arr = []
  if (Array.isArray(input)) arr = input
  else if (typeof input === 'string') arr = input.split(/[\s,;\n]+/)
  arr = arr
    .map(c => String(c || '').replace(/#.*$/, '').trim())
    .filter(c => c.length > 0)
  return [...new Set(arr)]
}

/**
 * GET /api/admin/yandex-cloud/accounts/:id/cidr-lists
 * Все сохранённые списки для аккаунта.
 */
router.get('/accounts/:id/cidr-lists', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const r = await db.query(
      `SELECT l.id, l.name, l.description, l.cidrs, l.created_at, l.updated_at,
              jsonb_array_length(l.cidrs) AS cidrs_count,
              u.login AS created_by_login
         FROM yc_cidr_lists l
         LEFT JOIN users u ON u.id = l.created_by
        WHERE l.account_id = $1
        ORDER BY l.updated_at DESC`,
      [ctx.id]
    )
    res.json({ lists: r.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/yandex-cloud/accounts/:id/cidr-lists
 * Body: { name, description?, cidrs: [...] | "..." }
 */
router.post('/accounts/:id/cidr-lists', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const { name, description } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'name обязателен' })

    const cidrs = normalizeCidrs(req.body.cidrs)
    const cidrErr = ipRangeSearch.validateCidrs(cidrs)
    if (cidrErr) return res.status(400).json({ error: cidrErr })

    const r = await db.query(
      `INSERT INTO yc_cidr_lists (account_id, name, description, cidrs, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ctx.id, name.trim().slice(0, 128), description || null, JSON.stringify(cidrs), req.userId]
    )
    audit.write(req, 'yc.cidr_list.create', { type: 'yc_cidr_list', id: r.rows[0].id }, { name, count: cidrs.length, accountId: ctx.id }).catch(() => {})
    res.json({ list: r.rows[0] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Список с таким именем уже есть' })
    res.status(500).json({ error: err.message })
  }
})

/**
 * PUT /api/admin/yandex-cloud/accounts/:id/cidr-lists/:listId
 * Body: { name?, description?, cidrs? }
 */
router.put('/accounts/:id/cidr-lists/:listId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const listId = parseInt(req.params.listId)
    if (!listId) return res.status(400).json({ error: 'invalid listId' })

    const sets = []
    const values = [listId, ctx.id]
    let idx = 3

    if (req.body.name !== undefined) {
      if (!req.body.name.trim()) return res.status(400).json({ error: 'name не может быть пустым' })
      sets.push(`name = $${idx++}`); values.push(req.body.name.trim().slice(0, 128))
    }
    if (req.body.description !== undefined) {
      sets.push(`description = $${idx++}`); values.push(req.body.description || null)
    }
    if (req.body.cidrs !== undefined) {
      const cidrs = normalizeCidrs(req.body.cidrs)
      const cidrErr = ipRangeSearch.validateCidrs(cidrs)
      if (cidrErr) return res.status(400).json({ error: cidrErr })
      sets.push(`cidrs = $${idx++}`); values.push(JSON.stringify(cidrs))
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()')

    const r = await db.query(
      `UPDATE yc_cidr_lists SET ${sets.join(', ')}
        WHERE id = $1 AND account_id = $2
        RETURNING *`,
      values
    )
    if (r.rows.length === 0) return res.status(404).json({ error: 'Список не найден' })
    audit.write(req, 'yc.cidr_list.update', { type: 'yc_cidr_list', id: listId }, { changedKeys: Object.keys(req.body) }).catch(() => {})
    res.json({ list: r.rows[0] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Список с таким именем уже есть' })
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/admin/yandex-cloud/accounts/:id/cidr-lists/:listId
 */
router.delete('/accounts/:id/cidr-lists/:listId', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const listId = parseInt(req.params.listId)
    const r = await db.query(
      `DELETE FROM yc_cidr_lists WHERE id = $1 AND account_id = $2 RETURNING name`,
      [listId, ctx.id]
    )
    if (r.rows.length === 0) return res.status(404).json({ error: 'Не найден' })
    audit.write(req, 'yc.cidr_list.delete', { type: 'yc_cidr_list', id: listId }, { name: r.rows[0].name }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Stage 5: IP range search ──────────────────────────────────────────────

/**
 * POST /api/admin/yandex-cloud/accounts/:id/ip-search
 * Body: { cidr, zoneId, maxAttempts?, namePrefix?, folderId? }
 * Запускает background-job. Возвращает { jobId } сразу — фронт поллит /jobs/:id.
 */
router.post('/accounts/:id/ip-search', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  if (!checkReadonlyOrFail(req, res, ctx.account)) return
  try {
    const { zoneId, maxAttempts, namePrefix } = req.body
    const folderId = req.body.folderId || ctx.account.default_folder_id
    if (!folderId) return res.status(400).json({ error: 'folderId обязателен' })
    if (!zoneId) return res.status(400).json({ error: 'zoneId обязателен (например ru-central1-a)' })

    // Нормализация: принимаем cidrs (массив) или cidr (строку) для обратной совместимости
    let cidrs = []
    if (Array.isArray(req.body.cidrs)) {
      cidrs = req.body.cidrs
    } else if (typeof req.body.cidrs === 'string') {
      cidrs = req.body.cidrs.split(/[\s,;]+/)
    } else if (req.body.cidr) {
      cidrs = [req.body.cidr]
    }
    // Чистим — убираем комментарии (#...), пустые строки, дубликаты
    cidrs = cidrs
      .map(c => String(c || '').replace(/#.*$/, '').trim())
      .filter(c => c.length > 0)
    cidrs = [...new Set(cidrs)]

    const cidrErr = ipRangeSearch.validateCidrs(cidrs)
    if (cidrErr) return res.status(400).json({ error: cidrErr })

    const cap = Math.min(parseInt(maxAttempts) || 30, ipRangeSearch.HARD_CAP)
    if (cap < 1) return res.status(400).json({ error: 'maxAttempts должно быть >= 1' })

    const job = await ipRangeSearch.createJob({
      accountId: ctx.id, adminId: req.userId,
      params: { folderId, cidrs, zoneId, maxAttempts: cap, namePrefix: namePrefix || null },
    })

    audit.write(req, 'yc.ip_search.start', { type: 'yc_job', id: job.id }, {
      cidrCount: cidrs.length, cap, accountId: ctx.id,
    }).catch(() => {})

    // Запускаем в фоне
    ipRangeSearch.runJobAsync(job.id)

    res.json({ jobId: job.id, status: job.status, cidrsCount: cidrs.length })
  } catch (err) {
    console.error('[YC] ip-search start error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/yandex-cloud/jobs/:jobId
 * Прогресс конкретного job'а.
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const job = await ipRangeSearch.getJob(parseInt(req.params.jobId))
    if (!job) return res.status(404).json({ error: 'Job не найден' })
    res.json({ job })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/yandex-cloud/jobs/:jobId/cancel
 * Помечает job как 'cancelled' — runner это увидит между итерациями и завершится.
 */
router.post('/jobs/:jobId/cancel', async (req, res) => {
  try {
    const id = parseInt(req.params.jobId)
    const r = await db.query(
      `UPDATE yc_jobs SET status = 'cancelled'
        WHERE id = $1 AND status IN ('pending', 'running')
        RETURNING id, status`,
      [id]
    )
    if (r.rows.length === 0) return res.status(400).json({ error: 'Job уже завершён или не существует' })
    audit.write(req, 'yc.ip_search.cancel', { type: 'yc_job', id }, {}).catch(() => {})
    res.json({ ok: true, job: r.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/yandex-cloud/accounts/:id/jobs?limit=20
 * История job'ов для аккаунта.
 */
router.get('/accounts/:id/jobs', async (req, res) => {
  const ctx = await loadAccountWithFolderHint(req, res); if (!ctx) return
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const r = await db.query(
      `SELECT j.*, u.login AS admin_login
         FROM yc_jobs j
         LEFT JOIN users u ON u.id = j.admin_id
        WHERE j.account_id = $1
        ORDER BY j.created_at DESC
        LIMIT $2`,
      [ctx.id, limit]
    )
    res.json({ jobs: r.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
