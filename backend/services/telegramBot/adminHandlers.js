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
const vpsActions = require('../vpsActions')
const remnwave = require('../remnwave')

// Ожидание текстового ввода от админа: Map<telegramUserId, { type, vpsId, ts }>.
// type: 'ip' | 'date'. Живёт 5 минут.
const pendingInput = new Map()
const INPUT_TTL_MS = 5 * 60 * 1000

function isValidIp(s) {
  if (!s || /\s/.test(s)) return false
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return s.split('.').every(o => Number(o) >= 0 && Number(o) <= 255)
  // IPv6 (упрощённо) или hostname
  if (/^[0-9a-f:]+$/i.test(s) && s.includes(':')) return true
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return true
  return false
}

// Парсит ДД.ММ.ГГГГ или ГГГГ-ММ-ДД → ISO 'YYYY-MM-DD'; null если некорректно.
function parseRuDate(s) {
  let d
  let m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  if (m) d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  else return null
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

// Actor для аудита/истории: кто из админов действует через бота.
async function getAdminActor(telegramId) {
  try {
    const r = await db.query('SELECT id, login FROM users WHERE telegram_id = $1 AND is_admin = true LIMIT 1', [telegramId])
    const u = r.rows[0]
    return { adminId: u?.id || null, adminLogin: u?.login || 'tg-admin', source: 'telegram-bot', userAgent: 'telegram-bot' }
  } catch {
    return { adminLogin: 'tg-admin', source: 'telegram-bot', userAgent: 'telegram-bot' }
  }
}

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
  kb2.text('➕ Продлить', `admin:vps:${v.id}:renew`).text('✏️ Изменить', `admin:vps:${v.id}:edit`).row()
  kb2.text('🗑 Удалить', `admin:vps:${v.id}:del`).row()
  if (adminVpsUrl) kb2.url('🔗 Открыть на сайте', adminVpsUrl).row()
  kb2.text('◀️ К списку', 'admin:vps').text('🏠 Админка', 'admin:home')

  await sendOrEdit(ctx, lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb2 })
}

// ────────────────────────────────────────────────────────────────────────────
// admin:vps:<id>:renew — выбор срока продления
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminVpsRenewMenu(ctx, sendOrEdit, vpsId) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  const { rows } = await db.query('SELECT name, paid_until, monthly_cost, currency FROM vps_servers WHERE id = $1', [id])
  if (rows.length === 0) return sendOrEdit(ctx, '⚠️ Сервер не найден.', { parse_mode: 'HTML' })
  const v = rows[0]
  const cur = v.paid_until ? new Date(v.paid_until).toLocaleDateString('ru-RU') : '—'
  const cost = Number(v.monthly_cost) || 0

  const lines = [
    `➕ <b>Продление · ${escapeHtml(v.name)}</b>`, '',
    `📅 Сейчас оплачено до: <b>${cur}</b>`,
  ]
  if (cost > 0) lines.push(`💰 ${cost.toFixed(0)} ${v.currency || 'RUB'}/мес`)
  lines.push('', 'Выбери срок продления:')

  const kb = new InlineKeyboard()
    .text('+1 мес', `admin:vps:${id}:renew:1`).text('+3 мес', `admin:vps:${id}:renew:3`).row()
    .text('+6 мес', `admin:vps:${id}:renew:6`).text('+12 мес', `admin:vps:${id}:renew:12`).row()
    .text('◀️ Отмена', `admin:vps:${id}`)

  await sendOrEdit(ctx, lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
}

async function handleAdminVpsRenewDo(ctx, sendOrEdit, vpsId, monthsArg) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  const months = parseInt(monthsArg, 10)
  const actor = await getAdminActor(ctx.from?.id)

  const r = await vpsActions.renewVps(id, months, 'Продление через Telegram-бот', actor)
  if (!r.ok) {
    const kb = new InlineKeyboard().text('◀️ Назад', `admin:vps:${id}`)
    return sendOrEdit(ctx, `⚠️ ${escapeHtml(r.error)}`, { parse_mode: 'HTML', reply_markup: kb })
  }
  const date = new Date(r.newDateStr).toLocaleDateString('ru-RU')
  const amount = r.monthlyCost > 0 ? `\n💰 Сумма: <b>${(r.monthlyCost * r.months).toFixed(0)} ${r.currency}</b>` : ''
  const text = `✅ <b>Продлено на ${r.months} мес.</b>\n\n<b>${escapeHtml(r.name)}</b>\n📅 Оплачено до: <b>${date}</b>${amount}`
  const kb = new InlineKeyboard().text('🖥 К серверу', `admin:vps:${id}`).text('◀️ К списку', 'admin:vps')
  await sendOrEdit(ctx, text, { parse_mode: 'HTML', reply_markup: kb })
}

// ────────────────────────────────────────────────────────────────────────────
// admin:vps:<id>:del — удаление с подтверждением
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminVpsDeleteConfirm(ctx, sendOrEdit, vpsId) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  const { rows } = await db.query('SELECT name, ip_address FROM vps_servers WHERE id = $1', [id])
  if (rows.length === 0) return sendOrEdit(ctx, '⚠️ Сервер не найден.', { parse_mode: 'HTML' })
  const v = rows[0]

  const text =
    `🗑 <b>Удалить сервер?</b>\n\n<b>${escapeHtml(v.name)}</b>` +
    (v.ip_address ? `\n<code>${escapeHtml(v.ip_address)}</code>` : '') +
    `\n\n⚠️ Запись будет удалена из базы безвозвратно (сам VPS не трогаем).`
  const kb = new InlineKeyboard()
    .text('❌ Да, удалить', `admin:vps:${id}:del:yes`).row()
    .text('◀️ Отмена', `admin:vps:${id}`)
  await sendOrEdit(ctx, text, { parse_mode: 'HTML', reply_markup: kb })
}

async function handleAdminVpsDeleteDo(ctx, sendOrEdit, vpsId) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  const actor = await getAdminActor(ctx.from?.id)

  const r = await vpsActions.deleteVps(id, actor)
  if (!r.ok) {
    const kb = new InlineKeyboard().text('◀️ К списку', 'admin:vps')
    return sendOrEdit(ctx, `⚠️ ${escapeHtml(r.error)}`, { parse_mode: 'HTML', reply_markup: kb })
  }
  const kb = new InlineKeyboard().text('◀️ К списку VPS', 'admin:vps').text('🏠 Админка', 'admin:home')
  await sendOrEdit(ctx, `🗑 <b>Сервер удалён</b>\n\n«${escapeHtml(r.name)}» удалён из базы.`, { parse_mode: 'HTML', reply_markup: kb })
}

// ────────────────────────────────────────────────────────────────────────────
// admin:vps:<id>:edit — редактирование (IP / нода / дата)
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminVpsEditMenu(ctx, sendOrEdit, vpsId) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  const { rows } = await db.query('SELECT name, ip_address, paid_until, node_name FROM vps_servers WHERE id = $1', [id])
  if (rows.length === 0) return sendOrEdit(ctx, '⚠️ Сервер не найден.', { parse_mode: 'HTML' })
  const v = rows[0]

  const lines = [
    `✏️ <b>Редактировать · ${escapeHtml(v.name)}</b>`, '',
    `🌐 IP: <code>${escapeHtml(v.ip_address || '—')}</code>`,
    `🌀 Нода: ${v.node_name ? escapeHtml(v.node_name) : '<i>не привязана</i>'}`,
    `📅 Оплачено до: ${v.paid_until ? new Date(v.paid_until).toLocaleDateString('ru-RU') : '—'}`,
    '', 'Что изменить?',
  ]
  const kb = new InlineKeyboard()
    .text('🌐 IP', `admin:vps:${id}:edit:ip`).text('📅 Дата', `admin:vps:${id}:edit:date`).row()
    .text('🌀 Привязка к ноде', `admin:vps:${id}:node`).row()
    .text('◀️ Назад', `admin:vps:${id}`)
  await sendOrEdit(ctx, lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
}

// Запрос текстового ввода (IP или дата) — ставим ожидание и просим прислать сообщение.
async function handleAdminVpsEditPrompt(ctx, sendOrEdit, vpsId, field) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  pendingInput.set(ctx.from.id, { type: field, vpsId: id, ts: Date.now() })
  const prompt = field === 'ip'
    ? '🌐 Пришли <b>новый IP-адрес</b> одним сообщением.\n\n<i>Например: 45.131.214.225</i>'
    : '📅 Пришли <b>новую дату оплаты</b> одним сообщением в формате <b>ДД.ММ.ГГГГ</b>.\n\n<i>Например: 27.12.2026</i>'
  const kb = new InlineKeyboard().text('◀️ Отмена', `admin:vps:${id}:edit`)
  await sendOrEdit(ctx, prompt, { parse_mode: 'HTML', reply_markup: kb })
}

// Обработка присланного текста (если админ в состоянии ожидания). Возвращает true если обработано.
async function handleAdminTextInput(ctx) {
  const st = pendingInput.get(ctx.from?.id)
  if (!st) return false
  if (Date.now() - st.ts > INPUT_TTL_MS) { pendingInput.delete(ctx.from.id); return false }
  if (!(await isAdminTg(ctx.from.id))) { pendingInput.delete(ctx.from.id); return false }

  const text = (ctx.message?.text || '').trim()
  const id = st.vpsId
  const actor = await getAdminActor(ctx.from.id)
  const sendNew = (_c, t, o) => ctx.reply(t, o)

  if (st.type === 'ip') {
    if (!isValidIp(text)) {
      await ctx.reply('⚠️ Не похоже на IP/домен. Пришли корректный адрес или нажми «Отмена» в предыдущем сообщении.', { parse_mode: 'HTML' })
      return true
    }
    const r = await vpsActions.updateVpsFields(id, { ip_address: text }, actor)
    pendingInput.delete(ctx.from.id)
    if (!r.ok) { await ctx.reply(`⚠️ ${escapeHtml(r.error)}`, { parse_mode: 'HTML' }); return true }
    await ctx.reply(`✅ IP обновлён: <code>${escapeHtml(text)}</code>`, { parse_mode: 'HTML' })
    await handleAdminVpsDetail(ctx, sendNew, id)
    return true
  }

  if (st.type === 'date') {
    const iso = parseRuDate(text)
    if (!iso) {
      await ctx.reply('⚠️ Формат даты: <b>ДД.ММ.ГГГГ</b> (например 27.12.2026). Попробуй ещё раз.', { parse_mode: 'HTML' })
      return true
    }
    const r = await vpsActions.updateVpsFields(id, { paid_until: iso }, actor)
    pendingInput.delete(ctx.from.id)
    if (!r.ok) { await ctx.reply(`⚠️ ${escapeHtml(r.error)}`, { parse_mode: 'HTML' }); return true }
    await ctx.reply(`✅ Дата оплаты: <b>${new Date(iso).toLocaleDateString('ru-RU')}</b>`, { parse_mode: 'HTML' })
    await handleAdminVpsDetail(ctx, sendNew, id)
    return true
  }

  return false
}

// Меню выбора RemnaWave-ноды для привязки.
async function handleAdminVpsNodeMenu(ctx, sendOrEdit, vpsId) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  const { rows } = await db.query('SELECT name, node_uuid, node_name FROM vps_servers WHERE id = $1', [id])
  if (rows.length === 0) return sendOrEdit(ctx, '⚠️ Сервер не найден.', { parse_mode: 'HTML' })
  const v = rows[0]

  let nodes = []
  try { nodes = await remnwave.getNodes() } catch { nodes = [] }

  const lines = [
    `🌀 <b>Привязка к ноде · ${escapeHtml(v.name)}</b>`, '',
    `Сейчас: ${v.node_name ? '<b>' + escapeHtml(v.node_name) + '</b>' : '<i>не привязана</i>'}`,
  ]
  const kb = new InlineKeyboard()
  if (!nodes.length) {
    lines.push('', '<i>Ноды RemnaWave не найдены (или панель недоступна).</i>')
  } else {
    lines.push('', 'Выбери ноду:')
    for (const n of nodes.slice(0, 20)) {
      const uuid = n.uuid || n.id
      if (!uuid) continue
      const active = uuid === v.node_uuid ? '✅ ' : ''
      kb.text(`${active}${truncate(n.name || uuid, 40)}`, `admin:vps:${id}:node:${uuid}`).row()
    }
  }
  if (v.node_uuid) kb.text('❌ Отвязать', `admin:vps:${id}:node:none`).row()
  kb.text('◀️ Назад', `admin:vps:${id}:edit`)
  await sendOrEdit(ctx, lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
}

// Применить привязку к ноде (или отвязать при uuid='none').
async function handleAdminVpsNodeSet(ctx, sendOrEdit, vpsId, uuid) {
  if (!(await denyIfNotAdmin(ctx, sendOrEdit))) return
  const id = parseInt(vpsId, 10)
  const actor = await getAdminActor(ctx.from?.id)

  let patch, label
  if (uuid === 'none') {
    patch = { node_uuid: null, node_name: null }
    label = 'Нода отвязана'
  } else {
    let nodeName = null
    try {
      const nodes = await remnwave.getNodes()
      const n = nodes.find(x => (x.uuid || x.id) === uuid)
      nodeName = n?.name || null
    } catch { /* ignore */ }
    patch = { node_uuid: uuid, node_name: nodeName }
    label = `Привязано к ноде: <b>${escapeHtml(nodeName || uuid)}</b>`
  }
  const r = await vpsActions.updateVpsFields(id, patch, actor)
  if (!r.ok) {
    const kb = new InlineKeyboard().text('◀️ Назад', `admin:vps:${id}:edit`)
    return sendOrEdit(ctx, `⚠️ ${escapeHtml(r.error)}`, { parse_mode: 'HTML', reply_markup: kb })
  }
  const kb = new InlineKeyboard().text('🖥 К серверу', `admin:vps:${id}`).text('✏️ Ещё изменить', `admin:vps:${id}:edit`)
  await sendOrEdit(ctx, `✅ ${label}`, { parse_mode: 'HTML', reply_markup: kb })
}

// ────────────────────────────────────────────────────────────────────────────
// Роутер callback admin:*
// ────────────────────────────────────────────────────────────────────────────

async function handleAdminCallback(ctx, sendOrEdit) {
  const data = ctx.callbackQuery?.data || ''
  // admin:home | admin:vps | admin:vps:<id> | admin:vps:<id>:renew[:<m>] | admin:vps:<id>:del[:yes]
  const parts = data.split(':')
  const section = parts[1]
  const arg = parts[2]
  const action = parts[3]
  const sub = parts[4]

  try { await ctx.answerCallbackQuery() } catch {}

  if (section === 'home') return handleAdminHome(ctx, sendOrEdit)
  if (section === 'vps') {
    if (arg === 'noop') return  // плейсхолдер «...и ещё N»
    if (!arg) return handleAdminVpsList(ctx, sendOrEdit)
    if (!action) return handleAdminVpsDetail(ctx, sendOrEdit, arg)
    if (action === 'renew') {
      if (sub) return handleAdminVpsRenewDo(ctx, sendOrEdit, arg, sub)
      return handleAdminVpsRenewMenu(ctx, sendOrEdit, arg)
    }
    if (action === 'del') {
      if (sub === 'yes') return handleAdminVpsDeleteDo(ctx, sendOrEdit, arg)
      return handleAdminVpsDeleteConfirm(ctx, sendOrEdit, arg)
    }
    if (action === 'edit') {
      if (sub === 'ip' || sub === 'date') return handleAdminVpsEditPrompt(ctx, sendOrEdit, arg, sub)
      return handleAdminVpsEditMenu(ctx, sendOrEdit, arg)
    }
    if (action === 'node') {
      if (sub) return handleAdminVpsNodeSet(ctx, sendOrEdit, arg, sub)
      return handleAdminVpsNodeMenu(ctx, sendOrEdit, arg)
    }
    return handleAdminVpsDetail(ctx, sendOrEdit, arg)
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
  handleAdminTextInput,
}
