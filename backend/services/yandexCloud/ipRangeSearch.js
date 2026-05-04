/**
 * Поиск IP-адреса в заданном CIDR-диапазоне через цикл alloc/release.
 *
 * Yandex.Cloud не позволяет выбрать конкретный IP при аллокации — только из общего пула.
 * Поэтому брутфорс: аллоцируем ephemeral IP → проверяем попадание в CIDR →
 * если попал, делаем reserved=true и стоп; если нет, освобождаем и пробуем снова.
 *
 * Каждая попытка стоит реальные деньги (~0.005₽). Hard-cap на attempts = 50.
 *
 * Cancellation: между итерациями читаем status из БД. Если 'cancelled' — выходим.
 * Текущий ephemeral IP при отмене всё равно освобождаем чтобы не потерять деньги.
 */
const db = require('../../db')
const { ycClient } = require('./client')
const vpc = require('./vpc')
const { waitForOperation } = require('./operations')

const HARD_CAP = 50
const POLL_MS = 1000

// ───── CIDR matching ─────────────────────────────────────────────────────────

function ipv4ToInt(ip) {
  const parts = String(ip).split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = parseInt(p, 10)
    if (isNaN(v) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n
}

function ipv4InCidr(ip, cidr) {
  const m = String(cidr).match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/)
  if (!m) return false
  const networkIp = ipv4ToInt(m[1])
  const bits = parseInt(m[2], 10)
  const targetIp = ipv4ToInt(ip)
  if (networkIp == null || targetIp == null || bits < 0 || bits > 32) return false
  // Сравниваем верхние `bits` бит — через деление чтобы не уйти в 32-bit signed JS-нюансы.
  const div = Math.pow(2, 32 - bits)
  return Math.floor(networkIp / div) === Math.floor(targetIp / div)
}

/**
 * Возвращает первый CIDR из массива, в который попадает IP, либо null.
 */
function findMatchingCidr(ip, cidrs) {
  if (!ip || !Array.isArray(cidrs)) return null
  for (const c of cidrs) {
    if (ipv4InCidr(ip, c)) return c
  }
  return null
}

function validateOneCidr(cidr) {
  const m = String(cidr || '').match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/)
  if (!m) return 'Формат должен быть IPv4/маска (например 5.45.64.0/20)'
  if (ipv4ToInt(m[1]) == null) return 'Невалидный IPv4 адрес'
  const bits = parseInt(m[2], 10)
  if (isNaN(bits) || bits < 8 || bits > 32) return 'Маска должна быть 8-32'
  return null
}

/**
 * Принимает массив CIDR и валидирует каждый. Возвращает первую найденную ошибку
 * или null если все ОК.
 */
function validateCidrs(arr) {
  if (!Array.isArray(arr)) return 'cidrs должно быть массивом'
  if (arr.length === 0) return 'нужен хотя бы один CIDR'
  if (arr.length > 100) return 'слишком много CIDR (макс 100)'
  for (let i = 0; i < arr.length; i++) {
    const err = validateOneCidr(arr[i])
    if (err) return `CIDR #${i + 1} (${arr[i]}): ${err}`
  }
  return null
}

// Старая single-cidr версия для обратной совместимости — все вызовы внутри обновлены ниже.
function validateCidr(cidr) {
  return validateOneCidr(cidr)
}

// ───── Job DB helpers ────────────────────────────────────────────────────────

async function createJob({ accountId, adminId, params }) {
  const r = await db.query(
    `INSERT INTO yc_jobs (account_id, admin_id, type, status, params, progress)
     VALUES ($1, $2, 'ip_range_search', 'pending', $3, $4)
     RETURNING *`,
    [accountId, adminId || null, JSON.stringify(params), JSON.stringify({ tried: 0, found: 0, attempts: [] })]
  )
  return r.rows[0]
}

async function getJob(jobId) {
  const r = await db.query('SELECT * FROM yc_jobs WHERE id = $1', [jobId])
  return r.rows[0] || null
}

async function isCancelled(jobId) {
  const r = await db.query('SELECT status FROM yc_jobs WHERE id = $1', [jobId])
  return r.rows[0]?.status === 'cancelled'
}

async function updateProgress(jobId, progress) {
  await db.query(
    'UPDATE yc_jobs SET progress = $1 WHERE id = $2',
    [JSON.stringify(progress), jobId]
  )
}

async function setStatus(jobId, status, extra = {}) {
  const sets = ['status = $2']
  const values = [jobId, status]
  let idx = 3
  if (extra.startedAt) { sets.push(`started_at = $${idx++}`); values.push(extra.startedAt) }
  if (extra.finishedAt) { sets.push(`finished_at = $${idx++}`); values.push(extra.finishedAt) }
  if (extra.result !== undefined) { sets.push(`result = $${idx++}`); values.push(JSON.stringify(extra.result)) }
  if (extra.error !== undefined) { sets.push(`error = $${idx++}`); values.push(extra.error) }
  await db.query(`UPDATE yc_jobs SET ${sets.join(', ')} WHERE id = $1`, values)
}

// ───── Runner ────────────────────────────────────────────────────────────────

/**
 * Запускает обработку job в фоне (fire-and-forget). Не блокирует HTTP-ответ.
 * Все обновления прогресса идут в БД — фронт поллит /jobs/:id.
 */
function runJobAsync(jobId) {
  setImmediate(() => runJob(jobId).catch(err => {
    console.error(`[YC ip-search] job ${jobId} crashed:`, err.message)
    setStatus(jobId, 'failed', { error: err.message, finishedAt: new Date() }).catch(() => {})
  }))
}

async function runJob(jobId) {
  const job = await getJob(jobId)
  if (!job) throw new Error(`Job ${jobId} не найден`)
  if (job.status !== 'pending') {
    console.warn(`[YC ip-search] job ${jobId} в статусе ${job.status}, не запускаю`)
    return
  }

  const params = job.params || {}
  const { folderId, zoneId, maxAttempts, namePrefix } = params
  // Поддерживаем оба формата: массив cidrs или одиночный cidr (legacy)
  const cidrs = Array.isArray(params.cidrs) && params.cidrs.length > 0
    ? params.cidrs
    : (params.cidr ? [params.cidr] : [])
  const cap = Math.min(parseInt(maxAttempts) || 30, HARD_CAP)

  await setStatus(jobId, 'running', { startedAt: new Date() })

  const yc = await ycClient(job.account_id)
  const progress = { tried: 0, found: 0, attempts: [], cap }

  let foundAddress = null

  for (let i = 0; i < cap; i++) {
    if (await isCancelled(jobId)) {
      progress.cancelled = true
      await updateProgress(jobId, progress)
      await setStatus(jobId, 'cancelled', { finishedAt: new Date(), result: { foundAddress, progress } })
      return
    }

    const attempt = { n: i + 1, ip: null, matched: false, addressId: null, ts: new Date().toISOString() }
    try {
      // 1. Аллоцируем ephemeral IP
      const op = await vpc.createAddress(yc, {
        folderId, zoneId, ipv6: false, reserved: false,
      })

      // YC возвращает Operation. Метаданные содержат addressId (созданный объект),
      // но IP может быть ещё не назначен — ждём завершения операции.
      const finalOp = await waitForOperation(yc, op, { maxWaitMs: 30000 })
      const addressId = finalOp.metadata?.addressId || finalOp.response?.id || op.metadata?.addressId
      attempt.addressId = addressId

      // Адрес в response
      const addr = finalOp.response || (addressId ? await vpc.getAddress(yc, addressId) : null)
      const ip = addr?.externalIpv4Address?.address || addr?.externalIpv6Address?.address
      attempt.ip = ip || null

      progress.tried++
      const matchedCidr = ip ? findMatchingCidr(ip, cidrs) : null
      if (matchedCidr) {
        // 2a. Попадает! Резервируем (делаем static) + опционально переименовываем.
        attempt.matched = true
        attempt.matchedCidr = matchedCidr
        progress.found++
        const patch = { reserved: true }
        if (namePrefix) patch.name = `${namePrefix}-${ip.replace(/\./g, '-')}`
        try {
          const updateOp = await vpc.updateAddress(yc, addressId, patch)
          await waitForOperation(yc, updateOp, { maxWaitMs: 15000 })
        } catch (e) {
          attempt.reserveError = e.message
        }
        progress.attempts.push(attempt)
        await updateProgress(jobId, progress)
        foundAddress = { id: addressId, ip, reserved: true, name: patch.name, matchedCidr }
        break
      } else {
        // 2b. Не попал — освобождаем
        progress.attempts.push(attempt)
        await updateProgress(jobId, progress)
        try {
          const delOp = await vpc.deleteAddress(yc, addressId)
          await waitForOperation(yc, delOp, { maxWaitMs: 15000 }).catch(() => {})
        } catch (e) {
          attempt.releaseError = e.message
          // Продолжаем — но запишем в attempt чтобы видно было что не освободили
        }
      }
    } catch (e) {
      attempt.error = e.message
      progress.tried++
      progress.attempts.push(attempt)
      progress.lastError = e.message
      await updateProgress(jobId, progress)
      // Если ошибка из-за квоты или auth — нет смысла ретраить (все попытки упадут так же)
      const isFatal = e.status === 401 || e.status === 403 || e.status === 404 ||
                      /quota|forbidden|unauthorized|permission denied|not.found/i.test(e.message)
      if (isFatal) {
        let hint = ''
        if (e.status === 403 || /permission denied/i.test(e.message)) {
          hint = ' Подсказка: у Service Account / OAuth нет роли для создания публичных IP. Дай в YC-консоли роль "vpc.publicAdmin" или "editor" на этот folder.'
        } else if (e.status === 401 || /unauthorized/i.test(e.message)) {
          hint = ' Подсказка: токен невалиден или истёк. Перепроверь creds аккаунта во вкладке «Аккаунты» → «Тест».'
        } else if (/quota/i.test(e.message)) {
          hint = ' Подсказка: исчерпана квота на адреса в этом folder. Освободи неиспользуемые IP во вкладке «IP-адреса» или попроси YC увеличить квоту.'
        }
        await setStatus(jobId, 'failed', {
          error: `Прервано после ошибки на попытке #${i + 1}: ${e.message}.${hint}`,
          finishedAt: new Date(),
          result: { foundAddress: null, progress },
        })
        return
      }
      // Иначе — пауза и идём дальше
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  if (foundAddress) {
    await setStatus(jobId, 'done', {
      finishedAt: new Date(),
      result: { foundAddress, progress },
    })
  } else {
    await setStatus(jobId, 'done', {
      finishedAt: new Date(),
      result: {
        foundAddress: null,
        progress,
        message: `Перебрали ${progress.tried} адресов из ${cap}, ни один не попал в ${cidrs.length === 1 ? cidrs[0] : `${cidrs.length} CIDR-диапазонов`}`,
      },
    })
  }
}

/**
 * Помечаем "зависшие" job'ы как failed при старте бэкенда.
 * Вызывается из index.js на старте.
 */
async function recoverOrphanedJobs() {
  try {
    const r = await db.query(
      `UPDATE yc_jobs
         SET status = 'failed', error = 'backend restarted while running', finished_at = NOW()
       WHERE status IN ('pending', 'running')
       RETURNING id`
    )
    if (r.rowCount > 0) {
      console.log(`[YC ip-search] помечено ${r.rowCount} job(ов) как failed после рестарта бэкенда`)
    }
  } catch (e) {
    console.error('[YC ip-search] recoverOrphanedJobs error:', e.message)
  }
}

module.exports = {
  HARD_CAP, POLL_MS,
  ipv4ToInt, ipv4InCidr, findMatchingCidr,
  validateCidr, validateCidrs, validateOneCidr,
  createJob, getJob, runJobAsync, recoverOrphanedJobs,
}
