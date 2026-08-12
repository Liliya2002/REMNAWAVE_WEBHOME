/**
 * Cron: health-check VPS-серверов через ВНЕШНЮЮ проверку (check-host.net).
 *
 * Раз в N минут (по умолчанию 10) проверяет доступность TCP-порта каждого
 * active-VPS с нескольких узлов по миру. Сервер считается доступным, если
 * отвечает хотя бы с одного узла. Результат → vps_servers.is_reachable +
 * last_health_check.
 *
 * Почему внешняя, а не TCP-пинг с бэкенда: бэкенд может не иметь сетевого
 * доступа к VPS (NAT/файрвол/блокировки), из-за чего локальный пинг давал
 * ложные «недоступен». Внешняя проверка отражает реальную достижимость.
 *
 * При смене состояния шлёт админу уведомление в Telegram:
 *   notifications_enabled.admin_vps_unreachable / admin_vps_back_online
 *
 * Если сам сервис проверки недоступен — цикл для этого сервера пропускается
 * (статус не меняется, алерт не шлётся), чтобы не было ложных срабатываний.
 *
 * Включить/выключить: VPS_HEALTH_CHECK_ENABLED=false.
 */
const db = require('../db')
const tgNotify = require('../services/telegramBot/notify')
const externalCheck = require('../services/externalCheck')

// Настройки читаются из БД с откатом на .env (services/vpsSettings.js) —
// их можно менять в админке без перезапуска backend.
const vpsSettings = require('../services/vpsSettings')

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

async function checkOne(vps, cfg) {
  // Внешняя проверка. Если сам сервис недоступен — пропускаем (статус не трогаем).
  const chk = await externalCheck.isReachable(vps.ip_address, cfg.health_ping_port, { maxNodes: cfg.health_check_nodes })
  if (!chk.ok) {
    return { changed: false, reachable: vps.is_reachable, skipped: true }
  }
  const reachable = chk.reachable
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
    port:     cfg.health_ping_port,
  }).catch(err => console.warn('[VPS-health] notify unreachable error:', err.message))
  return { changed: true, reachable: false }
}

async function tick() {
  try {
    // Настройки читаем на каждом тике: изменённые в админке применяются сразу.
    const cfg = await vpsSettings.get()
    if (!cfg.health_enabled) return

    const { rows } = await db.query(
      `SELECT id, name, ip_address, hosting_provider, is_reachable, last_unreachable_at
         FROM vps_servers
        WHERE status = 'active' AND ip_address IS NOT NULL AND ip_address != ''`
    )
    if (rows.length === 0) return

    // Ограничиваем параллельность чтобы не выжигать сетевой стек.
    const queue = rows.slice()
    let stats = { ok: 0, fail: 0, changed: 0, skipped: 0 }
    const workers = Array.from({ length: Math.min(cfg.health_parallelism, queue.length) }, async () => {
      while (queue.length) {
        const v = queue.shift()
        try {
          const r = await checkOne(v, cfg)
          if (r.skipped) stats.skipped++
          else if (r.reachable) stats.ok++
          else stats.fail++
          if (r.changed) stats.changed++
        } catch (err) {
          console.warn(`[VPS-health] checkOne(${v.name}) error:`, err.message)
        }
      }
    })
    await Promise.all(workers)
    if (stats.changed > 0 || stats.skipped > 0) {
      console.log(`[VPS-health cron] tick: ok=${stats.ok}, fail=${stats.fail}, changed=${stats.changed}, skipped=${stats.skipped}`)
    }
  } catch (err) {
    console.error('[VPS-health cron] tick error:', err.message)
  }
}

// Таймер держим в переменной, чтобы перепланировать его при смене интервала
// в админке — иначе новое значение подхватилось бы только после перезапуска.
let timer = null

async function schedule() {
  const cfg = await vpsSettings.get({ force: true })
  if (timer) { clearInterval(timer); timer = null }
  if (!cfg.health_enabled) {
    console.log('[VPS-health cron] отключён в настройках')
    return
  }
  timer = setInterval(tick, cfg.health_interval_min * 60 * 1000)
  console.log(`[VPS-health cron] интервал ${cfg.health_interval_min} мин, проверка TCP/${cfg.health_ping_port} (check-host.net)`)
}

function start() {
  // Первый прогон через 30 сек после старта — даём backend'у дойти до зрелого состояния.
  setTimeout(tick, 30 * 1000)
  schedule().catch(err => console.error('[VPS-health cron] schedule error:', err.message))
}

// Вызывается после сохранения настроек в админке.
function reschedule() {
  return schedule().catch(err => console.error('[VPS-health cron] reschedule error:', err.message))
}

module.exports = { start, tick, reschedule }
