/**
 * Cron: health-check VPS-серверов через TCP-пинг порта 22 (SSH).
 *
 * Раз в N минут (по умолчанию 5) пингует все vps_servers со status='active' и
 * ip_address. Результат сохраняется в vps_servers.is_reachable + last_health_check.
 *
 * При смене состояния (был ok → стал unreachable, или наоборот) шлёт админу
 * уведомление в Telegram. Уведомления управляются флагами в admin-телеграме:
 *   notifications_enabled.admin_vps_unreachable
 *   notifications_enabled.admin_vps_back_online
 *
 * Чтобы избежать ложных срабатываний (один пакет потерян → паника) — проверяем
 * с retry: 2 попытки, между ними 3 секунды.
 *
 * Включить/выключить весь cron можно env'ом VPS_HEALTH_CHECK_ENABLED=false.
 */
const net = require('net')
const db = require('../db')
const tgNotify = require('../services/telegramBot/notify')

const TICK_MINUTES   = parseInt(process.env.VPS_HEALTH_INTERVAL_MIN || '5', 10)
const PING_PORT      = parseInt(process.env.VPS_HEALTH_PING_PORT     || '22', 10)
const PING_TIMEOUT_MS = parseInt(process.env.VPS_HEALTH_PING_TIMEOUT_MS || '4000', 10)
const RETRY_DELAY_MS  = 3000
const ENABLED         = process.env.VPS_HEALTH_CHECK_ENABLED !== 'false'
const PARALLELISM     = 8

/**
 * TCP-пинг: пытаемся открыть соединение на host:port.
 * Возвращает true если успех, false если timeout/refused/etc.
 */
function pingTcp(host, port = PING_PORT, timeoutMs = PING_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try { sock.destroy() } catch {}
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error',   () => finish(false))
    try { sock.connect(port, host) } catch { finish(false) }
  })
}

async function pingWithRetry(host) {
  if (await pingTcp(host)) return true
  await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  return pingTcp(host)
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '<1 мин'
  const m = Math.round(ms / 60000)
  if (m < 60)  return `${m} мин`
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h < 24)  return mm ? `${h} ч ${mm} мин` : `${h} ч`
  const d = Math.floor(h / 24)
  const hh = h % 24
  return hh ? `${d} д ${hh} ч` : `${d} д`
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function checkOne(vps) {
  const reachable = await pingWithRetry(vps.ip_address)
  const now = new Date()
  const wasReachable = vps.is_reachable
  // Никогда не проверяли (NULL) → считаем что предыдущий статус совпадает с текущим,
  // чтобы при первом запуске cron'а не залить админа уведомлениями про каждый сервер.
  const firstRun = wasReachable === null

  if (reachable) {
    if (firstRun || wasReachable === true) {
      await db.query(
        `UPDATE vps_servers SET is_reachable=true, last_health_check=$2, last_unreachable_at=NULL
         WHERE id=$1`,
        [vps.id, now]
      )
      return { changed: false, reachable: true }
    }
    // Был unreachable → стал reachable. Шлём «снова в строю».
    const downtime = vps.last_unreachable_at ? (now - new Date(vps.last_unreachable_at)) : null
    await db.query(
      `UPDATE vps_servers SET is_reachable=true, last_health_check=$2, last_unreachable_at=NULL
       WHERE id=$1`,
      [vps.id, now]
    )
    tgNotify.notifyAdmin('admin_vps_back_online', {
      name:     escapeHtml(vps.name),
      ip:       vps.ip_address,
      provider: vps.hosting_provider || '—',
      downtime: fmtDuration(downtime),
    }).catch(err => console.warn('[VPS-health] notify back-online error:', err.message))
    return { changed: true, reachable: true }
  }

  // Сервер не отвечает.
  if (firstRun || wasReachable === false) {
    // Уже знали что лежит — просто обновим last_health_check.
    await db.query(
      `UPDATE vps_servers SET is_reachable=false, last_health_check=$2,
                              last_unreachable_at = COALESCE(last_unreachable_at, $2)
       WHERE id=$1`,
      [vps.id, now]
    )
    return { changed: false, reachable: false }
  }

  // Был ok → стал unreachable. Шлём «упал».
  await db.query(
    `UPDATE vps_servers SET is_reachable=false, last_health_check=$2, last_unreachable_at=$2
     WHERE id=$1`,
    [vps.id, now]
  )
  tgNotify.notifyAdmin('admin_vps_unreachable', {
    name:     escapeHtml(vps.name),
    ip:       vps.ip_address,
    provider: vps.hosting_provider || '—',
    port:     PING_PORT,
  }).catch(err => console.warn('[VPS-health] notify unreachable error:', err.message))
  return { changed: true, reachable: false }
}

async function tick() {
  try {
    const { rows } = await db.query(
      `SELECT id, name, ip_address, hosting_provider, is_reachable, last_unreachable_at
         FROM vps_servers
        WHERE status = 'active' AND ip_address IS NOT NULL AND ip_address != ''`
    )
    if (rows.length === 0) return

    // Ограничиваем параллельность чтобы не выжигать сетевой стек.
    const queue = rows.slice()
    let stats = { ok: 0, fail: 0, changed: 0 }
    const workers = Array.from({ length: Math.min(PARALLELISM, queue.length) }, async () => {
      while (queue.length) {
        const v = queue.shift()
        try {
          const r = await checkOne(v)
          if (r.reachable) stats.ok++; else stats.fail++
          if (r.changed) stats.changed++
        } catch (err) {
          console.warn(`[VPS-health] checkOne(${v.name}) error:`, err.message)
        }
      }
    })
    await Promise.all(workers)
    if (stats.changed > 0) {
      console.log(`[VPS-health cron] tick: ok=${stats.ok}, fail=${stats.fail}, changed=${stats.changed}`)
    }
  } catch (err) {
    console.error('[VPS-health cron] tick error:', err.message)
  }
}

function start() {
  if (!ENABLED) {
    console.log('[VPS-health cron] отключён через VPS_HEALTH_CHECK_ENABLED=false')
    return
  }
  // Первый прогон через 30 сек после старта — даём backend'у дойти до зрелого состояния.
  setTimeout(tick, 30 * 1000)
  setInterval(tick, TICK_MINUTES * 60 * 1000)
  console.log(`[VPS-health cron] запущен, интервал ${TICK_MINUTES} мин, ping TCP/${PING_PORT}`)
}

module.exports = { start, tick, pingTcp, pingWithRetry }
