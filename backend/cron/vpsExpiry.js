/**
 * Cron: уведомление админу про истекающие/просроченные VPS-серверы.
 *
 * Раз в час проверяет: если уже наступил «час уведомлений» (по умолчанию 10:00 UTC)
 * и ещё не слали сегодня — формирует сводку по серверам с paid_until в окне
 * [-3 дня; +7 дней] и шлёт `notifyAdmin('admin_vps_expiring')`.
 *
 * Включить/выключить уведомление можно из админки `/admin/telegram → Админ-уведомления`,
 * флаг `notifications_enabled.admin_vps_expiring`.
 *
 * Час отправки настраивается через env `VPS_EXPIRY_NOTIFY_HOUR_UTC` (число 0-23,
 * по умолчанию 10).
 */
const db = require('../db')
const tgNotify = require('../services/telegramBot/notify')

const TICK_MINUTES = 30
const NOTIFY_HOUR_UTC = parseInt(process.env.VPS_EXPIRY_NOTIFY_HOUR_UTC || '10', 10)

// «Помним» дату последнего успешного уведомления чтобы не повторять в тот же день.
let lastNotifiedDate = null  // 'YYYY-MM-DD'

async function fetchExpiringVps() {
  const { rows } = await db.query(
    `SELECT id, name, hosting_provider, ip_address, paid_until
       FROM vps_servers
      WHERE paid_until IS NOT NULL
        AND paid_until <= CURRENT_DATE + INTERVAL '7 days'
        AND paid_until >= CURRENT_DATE - INTERVAL '3 days'
      ORDER BY paid_until ASC`
  )
  return rows
}

function formatExpiryLines(rows) {
  return rows.map(v => {
    const days = Math.ceil((new Date(v.paid_until) - Date.now()) / 86400000)
    let icon, label
    if (days < 0)       { icon = '🔴'; label = `${Math.abs(days)} дн. просрочен` }
    else if (days === 0){ icon = '🔴'; label = 'истекает сегодня' }
    else if (days <= 2) { icon = '🟠'; label = `${days} дн.` }
    else if (days <= 7) { icon = '🟡'; label = `${days} дн.` }
    else                { icon = '🟢'; label = `${days} дн.` }

    const provider = v.hosting_provider ? ` (${v.hosting_provider})` : ''
    const ip = v.ip_address ? `<code>${v.ip_address}</code>` : '—'
    const date = new Date(v.paid_until).toLocaleDateString('ru-RU')
    return `${icon} <b>${escapeHtml(v.name)}</b>${escapeHtml(provider)}\n   IP: ${ip} · до ${date} · <i>${label}</i>`
  }).join('\n\n')
}

async function tick() {
  try {
    const now = new Date()
    if (now.getUTCHours() !== NOTIFY_HOUR_UTC) return

    const today = now.toISOString().slice(0, 10)  // 'YYYY-MM-DD' в UTC
    if (lastNotifiedDate === today) return

    const rows = await fetchExpiringVps()
    if (rows.length === 0) {
      lastNotifiedDate = today  // помечаем что сегодня "пробежали" — нечего слать
      return
    }

    const r = await tgNotify.notifyAdmin('admin_vps_expiring', {
      lines: formatExpiryLines(rows),
      count: rows.length,
    })

    if (r.ok) {
      lastNotifiedDate = today
      console.log(`[VPS-expiry cron] Уведомление отправлено: ${rows.length} VPS`)
    } else if (r.skipped) {
      // Если notify отключён в settings — не помечаем как «отправлено», иначе после
      // включения настройки будем ждать сутки. Но и не спамим в логах каждые 30 мин.
      // Помечаем дату чтобы ждать следующего дня (юзер может включить флаг в админке завтра).
      lastNotifiedDate = today
      console.log(`[VPS-expiry cron] Skipped: ${r.skipped}`)
    } else {
      console.warn('[VPS-expiry cron] notifyAdmin error:', r.error)
    }
  } catch (err) {
    console.error('[VPS-expiry cron] tick error:', err.message)
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function start() {
  // Сразу не запускаем — внутри tick всё равно фильтруется по часу.
  // Просто крутим раз в 30 минут.
  setInterval(tick, TICK_MINUTES * 60 * 1000)
  console.log(`[VPS-expiry cron] запущен, час отправки: ${NOTIFY_HOUR_UTC}:00 UTC, интервал проверки ${TICK_MINUTES} мин`)
}

module.exports = { start, tick, fetchExpiringVps, formatExpiryLines }
