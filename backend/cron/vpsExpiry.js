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

function daysLeftOf(v) {
  return Math.ceil((new Date(v.paid_until) - Date.now()) / 86400000)
}

// Секции по срочности (порядок = приоритет отображения).
const SECTIONS = [
  { key: 'overdue', icon: '🔴', title: 'Просрочено',            match: d => d < 0 },
  { key: 'soon',    icon: '🟠', title: 'Скоро (сегодня–2 дня)', match: d => d >= 0 && d <= 2 },
  { key: 'week',    icon: '🟡', title: 'На неделе',             match: d => d >= 3 && d <= 7 },
]

// Одна компактная запись сервера (2 строки) внутри секции.
function serverLine(v) {
  const d = daysLeftOf(v)
  const name = escapeHtml(v.name || 'VPS')
  const provider = v.hosting_provider ? `  <i>${escapeHtml(v.hosting_provider)}</i>` : ''
  const ip = v.ip_address ? `<code>${escapeHtml(v.ip_address)}</code>` : '<i>IP не указан</i>'
  const dshort = new Date(v.paid_until).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  const phrase = d < 0 ? `<b>${Math.abs(d)} дн</b>` : d === 0 ? '<b>сегодня</b>' : d <= 2 ? `<b>${d} дн</b>` : `${d} дн`
  return `• <b>${name}</b>${provider}\n  ${ip} · до ${dshort} · ${phrase}`
}

// Группировка по секциям с заголовками (вариант A).
function groupedSections(rows) {
  return SECTIONS
    .map(s => {
      const items = rows.filter(v => s.match(daysLeftOf(v)))
      if (!items.length) return null
      return `${s.icon} <b>${s.title}</b> · ${items.length}\n` + items.map(serverLine).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

// Строка-сводка: всего + просрочено + сегодня.
function summaryLine(rows) {
  const overdue = rows.filter(v => daysLeftOf(v) < 0).length
  const today = rows.filter(v => daysLeftOf(v) === 0).length
  const parts = [`📊 Всего: <b>${rows.length}</b>`]
  if (overdue) parts.push(`🔴 просрочено: <b>${overdue}</b>`)
  if (today) parts.push(`🟠 сегодня: <b>${today}</b>`)
  return parts.join(' · ')
}

// Полное сообщение — Вариант B: компактная шапка-сводка + спойлер с секциями
// (детали раскрываются тапом). Единый формат для любого числа серверов.
function buildExpiryMessage(rows) {
  const title = '⚠️ <b>Истекает оплата VPS</b>'
  const sections = groupedSections(rows)
  return `${title}\n${summaryLine(rows)}\n\n<blockquote expandable>${sections}</blockquote>`
}

// Данные для notifyAdmin. Текст генерируется кодом (группировка/спойлер нельзя
// выразить простым шаблоном), поэтому отдаём готовый text — notifyAdmin его
// использует напрямую, минуя DEFAULT_TEXTS. Ключ 'admin_vps_expiring' всё равно
// передаётся вызывающим — для проверки toggle notifications_enabled.
function buildExpiryData(rows) {
  return { text: buildExpiryMessage(rows) }
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

    const r = await tgNotify.notifyAdmin('admin_vps_expiring', buildExpiryData(rows))

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

module.exports = { start, tick, fetchExpiringVps, buildExpiryData, buildExpiryMessage }
