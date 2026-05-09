/**
 * Telegram-бот: раздел «Админка».
 *
 * Доступен только юзерам с users.is_admin=true.
 *
 * Структура callback_data:
 *   admin:home          — корневое меню админки (возврат с любой страницы)
 *   admin:vps           — список VPS с сводкой + кнопки на каждый сервер
 *   admin:vps:<id>      — детали конкретного сервера
 *
 * Все экраны редактируют то же сообщение через editMessageText (через sendOrEdit).
 */
const { InlineKeyboard } = require('grammy')
const db = require('../../db')

// ────────────────────────────────────────────────────────────────────────────
// Доступ
// ────────────────────────────────────────────────────────────────────────────

async function isAdminTg(telegramId) {
  if (!telegramId) return false
  const r = await db.query(
    'SELECT is_admin FROM users WHERE telegram_id = $1 LIMIT 1',
    [telegramId]
  )
  return r.rows.length > 0 && r.rows[0].is_admin === true
}

async function denyIfNotAdmin(ctx, sendOrEdit) {
  const ok = await isAdminTg(ctx.from?.id)
  if (!ok) {
    await sendOrEdit(ctx, '🚫 У тебя нет прав администратора.', { parse_mode: 'HTML' })
    return false
  }
  return true
}

// ────────────────────────────────────────────────────────────────────────────
// /admin — корневое меню
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminHome(ctx, sendOrEdit) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return

  const text =
    '🛠 <b>Панель администратора</b>\n\n' +
    'Лёгкое управление прямо из Telegram. Полный функционал — на сайте.'

  const kb = new InlineKeyboard()
    .text('🖥 Серверы VPS', 'admin:vps').row()
    .text('◀️ В главное меню', 'menu:back')

  await sendOrEdit(ctx, text, { parse_mode: 'HTML', reply_markup: kb })
}

// ────────────────────────────────────────────────────────────────────────────
// admin:vps — список VPS со сводкой
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminVpsList(ctx, sendOrEdit) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return

  const { rows } = await db.query(
    `SELECT id, name, hosting_provider, ip_address, location, service_type,
            monthly_cost, currency, paid_until, status,
            is_reachable, last_health_check
       FROM vps_servers
      ORDER BY paid_until ASC NULLS LAST, name ASC`
  )

  // Сводка
  const total       = rows.length
  const active      = rows.filter(v => v.status === 'active').length
  const overdue     = rows.filter(v => v.paid_until && new Date(v.paid_until) < new Date()).length
  const soon        = rows.filter(v => {
    if (!v.paid_until) return false
    const days = Math.ceil((new Date(v.paid_until) - Date.now()) / 86400000)
    return days >= 0 && days <= 7
  }).length
  const unreachable = rows.filter(v => v.is_reachable === false).length

  const lines = ['🖥 <b>Серверы VPS</b>', '']
  lines.push(`Всего: <b>${total}</b> (active: ${active})`)
  if (soon > 0)        lines.push(`🟠 Истекают (≤7 дн): <b>${soon}</b>`)
  if (overdue > 0)     lines.push(`🔴 Просрочены: <b>${overdue}</b>`)
  if (unreachable > 0) lines.push(`⚠️ Недоступны: <b>${unreachable}</b>`)

  if (total === 0) {
    lines.push('', '<i>Серверов в БД нет. Добавь через /admin/vps на сайте.</i>')
  } else {
    lines.push('', '<i>Тапни сервер чтобы посмотреть детали.</i>')
  }

  // Кнопки серверов: каждый — отдельная строка с компактной подписью
  const kb = new InlineKeyboard()
  // Telegram имеет лимит 100 кнопок и ~10 кб total; ограничим разумно.
  const MAX_BUTTONS = 30
  const visible = rows.slice(0, MAX_BUTTONS)

  for (const v of visible) {
    const statusIcon = pickStatusIcon(v)
    const cost = v.monthly_cost > 0
      ? ` · ${Number(v.monthly_cost).toFixed(0)} ${v.currency || 'RUB'}/мес`
      : ''
    // 64-byte limit на text у кнопки нет (есть на callback_data — у нас короткое).
    // Но Telegram режет длинные подписи; держим в пределах ~50 символов.
    const label = `${statusIcon} ${truncate(v.name, 30)}${cost}`
    kb.text(label, `admin:vps:${v.id}`).row()
  }

  if (rows.length > MAX_BUTTONS) {
    kb.text(`... и ещё ${rows.length - MAX_BUTTONS} (см. на сайте)`, 'admin:vps:noop').row()
  }

  kb.text('◀️ Назад', 'admin:home')

  await sendOrEdit(ctx, lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
}

// ────────────────────────────────────────────────────────────────────────────
// admin:vps:<id> — детали сервера
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminVpsDetail(ctx, sendOrEdit, vpsId) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return

  const id = parseInt(vpsId, 10)
  if (!id) {
    return sendOrEdit(ctx, '⚠️ Неверный ID сервера.', { parse_mode: 'HTML' })
  }

  const { rows } = await db.query(
    `SELECT id, name, hosting_provider, ip_address, location, service_type,
            monthly_cost, currency, paid_months, paid_until,
            node_name, node_uuid, status, ssh_user, ssh_port, notes,
            is_reachable, last_health_check, last_unreachable_at,
            traffic_agent_installed_at, traffic_agent_last_health,
            created_at
       FROM vps_servers WHERE id = $1`,
    [id]
  )
  if (rows.length === 0) {
    return sendOrEdit(ctx, '⚠️ Сервер не найден.', { parse_mode: 'HTML' })
  }
  const v = rows[0]

  const lines = [`🖥 <b>${escapeHtml(v.name)}</b>`, '']

  if (v.hosting_provider) lines.push(`🏢 Провайдер: <b>${escapeHtml(v.hosting_provider)}</b>`)
  if (v.location)         lines.push(`📍 Локация: ${escapeHtml(v.location)}`)
  if (v.service_type)     lines.push(`📦 Тип: ${escapeHtml(v.service_type)}`)
  if (v.ip_address)       lines.push(`🌐 IP: <code>${escapeHtml(v.ip_address)}</code>`)
  if (v.ssh_user || v.ssh_port) {
    lines.push(`🔑 SSH: ${escapeHtml(v.ssh_user || 'root')}@${escapeHtml(String(v.ssh_port || 22))}`)
  }

  // Стоимость
  if (v.monthly_cost > 0) {
    lines.push('')
    lines.push(`💰 <b>${Number(v.monthly_cost).toFixed(2)} ${v.currency || 'RUB'}</b>/мес`)
    if (v.paid_months && v.paid_months > 1) {
      lines.push(`   ↳ оплачено за <b>${v.paid_months}</b> мес`)
    }
  }

  // Оплата до
  if (v.paid_until) {
    const days = Math.ceil((new Date(v.paid_until) - Date.now()) / 86400000)
    let icon, label
    if (days < 0)        { icon = '🔴'; label = `просрочен ${Math.abs(days)} дн.` }
    else if (days === 0) { icon = '🔴'; label = 'истекает сегодня' }
    else if (days <= 3)  { icon = '🟠'; label = `${days} дн.` }
    else if (days <= 7)  { icon = '🟡'; label = `${days} дн.` }
    else                 { icon = '🟢'; label = `${days} дн.` }
    const date = new Date(v.paid_until).toLocaleDateString('ru-RU')
    lines.push(`📅 Оплачено до: <b>${date}</b> ${icon} <i>${label}</i>`)
  }

  // Статус сервера
  lines.push('')
  if (v.is_reachable === true) {
    lines.push(`🟢 <b>Доступен</b>${v.last_health_check ? ' · ' + fmtRelative(v.last_health_check) : ''}`)
  } else if (v.is_reachable === false) {
    const downtime = v.last_unreachable_at
      ? fmtDuration(Date.now() - new Date(v.last_unreachable_at))
      : '?'
    lines.push(`🔴 <b>Недоступен</b> (${downtime})${v.last_health_check ? ' · проверен ' + fmtRelative(v.last_health_check) : ''}`)
  } else {
    lines.push(`⚪ Health-check ещё не выполнялся`)
  }

  // Traffic agent
  if (v.traffic_agent_installed_at) {
    const agentOk = v.traffic_agent_last_health === 'ok'
    lines.push(`📊 Traffic-агент: ${agentOk ? '🟢 ok' : `🟠 ${escapeHtml(v.traffic_agent_last_health || 'неизвестно')}`}`)
  }

  // Связь с RemnaWave node
  if (v.node_name || v.node_uuid) {
    lines.push('')
    lines.push(`🌀 RemnaWave node: ${v.node_name ? escapeHtml(v.node_name) : '<i>без имени</i>'}`)
  }

  if (v.notes && v.notes.trim()) {
    lines.push('')
    lines.push(`📝 ${escapeHtml(truncate(v.notes, 300))}`)
  }

  const kb = new InlineKeyboard()
  if (v.ip_address) {
    kb.url('🔗 Открыть на сайте', '').row()  // placeholder — заменим на FRONTEND_URL ниже
  }

  // Frontend URL берём из env (как и в основных handlers)
  const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '')
  const adminVpsUrl = FRONTEND_URL ? `${FRONTEND_URL}/admin/vps?id=${v.id}` : null

  // Перестраиваем кнопки нормально (без placeholder)
  const kb2 = new InlineKeyboard()
  if (adminVpsUrl) kb2.url('🔗 Открыть на сайте', adminVpsUrl).row()
  kb2.text('◀️ К списку VPS', 'admin:vps').row()
  kb2.text('🏠 В админку', 'admin:home')

  await sendOrEdit(ctx, lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb2 })
}

// ────────────────────────────────────────────────────────────────────────────
// Роутер callback admin:*
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminCallback(ctx, sendOrEdit) {
  const data = ctx.callbackQuery?.data || ''
  // admin:home, admin:vps, admin:vps:<id>, admin:vps:noop
  const parts = data.split(':')
  const section = parts[1]
  const arg = parts[2]

  try { await ctx.answerCallbackQuery() } catch {}

  if (section === 'home') return handleAdminHome(ctx, sendOrEdit)
  if (section === 'vps') {
    if (arg === 'noop') return  // плейсхолдер «...и ещё N» — ничего не делаем
    if (arg) return handleAdminVpsDetail(ctx, sendOrEdit, arg)
    return handleAdminVpsList(ctx, sendOrEdit)
  }

  await sendOrEdit(ctx, '🚧 Неизвестный раздел админки.', { parse_mode: 'HTML' })
}

// ────────────────────────────────────────────────────────────────────────────
// Утилиты
// ────────────────────────────────────────────────────────────────────────────

function pickStatusIcon(v) {
  if (v.is_reachable === false) return '🔴'
  if (v.paid_until) {
    const days = Math.ceil((new Date(v.paid_until) - Date.now()) / 86400000)
    if (days < 0) return '🔴'
    if (days <= 3) return '🟠'
    if (days <= 7) return '🟡'
  }
  if (v.status === 'active') return '🟢'
  return '⚪'
}

function truncate(s, n) {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '?'
  const m = Math.round(ms / 60000)
  if (m < 60)  return `${m} мин`
  const h = Math.floor(m / 60); const mm = m % 60
  if (h < 24)  return mm ? `${h} ч ${mm} мин` : `${h} ч`
  const d = Math.floor(h / 24); const hh = h % 24
  return hh ? `${d} д ${hh} ч` : `${d} д`
}

function fmtRelative(ts) {
  const ms = Date.now() - new Date(ts).getTime()
  if (ms < 60000) return 'только что'
  return fmtDuration(ms) + ' назад'
}

module.exports = {
  isAdminTg,
  handleAdminHome,
  handleAdminVpsList,
  handleAdminVpsDetail,
  handleAdminCallback,
}
