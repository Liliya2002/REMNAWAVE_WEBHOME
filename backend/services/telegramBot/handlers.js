/**
 * Обработчики команд и кнопок бота.
 *
 * /start                — регистрация / логин юзера, приветствие, главное меню
 * /start ref_<code>     — то же + привязка реферал-связи
 * /start link_<token>   — привязка существующего email-юзера к этому Telegram (этап D)
 *
 * Кнопки главного меню (определяются совпадением emoji-префикса в settings.menu_buttons):
 *   🌐  → Веб-Панель (deeplink с одноразовым токеном)
 *   👤  → Личный кабинет (подписка, баланс, кнопка подключиться)
 *   🛒  → Купить подписку (список тарифов)
 *   👥  → Реферальная программа (ссылка + статистика)
 *   📋  → Оферта (текст из настроек)
 */
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const db = require('../../db')
const referralService = require('../referral')
const tokens = require('./tokens')
const { getSettings } = require('./settings')
const { InlineKeyboard } = require('grammy')

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')

const normLogin = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')

// ────────────────────────────────────────────────────────────────────────────
// /start
// ────────────────────────────────────────────────────────────────────────────

async function handleStart(ctx) {
  const tgUser = ctx.from
  if (!tgUser) return ctx.reply('Не удалось определить юзера 😕')

  const payload = String(ctx.match || '').trim()

  let user
  try {
    user = await findOrCreateUser(tgUser, payload)
  } catch (err) {
    console.error('[TG bot] findOrCreateUser error:', err.message)
    return ctx.reply('⚠️ Ошибка регистрации. Попробуй ещё раз через минуту.')
  }

  const settings = await getSettings()
  const texts = settings.texts || {}
  const tplKey = user._isNew ? 'welcome_new' : 'welcome_back'
  const tpl = texts[tplKey] || (user._isNew
    ? 'Привет, {name}! Добро пожаловать.'
    : 'С возвращением, {name}!')
  const text = renderTemplate(tpl, {
    name: tgUser.first_name || tgUser.username || 'друг',
    login: user.login,
  })

  // 1. Снимаем старую ReplyKeyboard если она у юзера была от предыдущей версии бота
  //    (отдельным сообщением — Telegram не позволяет remove_keyboard и inline в одном)
  try {
    const removeMsg = await ctx.reply('…', { reply_markup: REMOVE_REPLY_KEYBOARD })
    // И тут же удаляем это техническое сообщение
    await ctx.api.deleteMessage(ctx.chat.id, removeMsg.message_id).catch(() => {})
  } catch {}

  // 2. Welcome с InlineKeyboard под сообщением (с поддержкой web_app)
  await ctx.reply(text, {
    reply_markup: buildMainMenu(settings.menu_buttons || [], settings),
    parse_mode: 'HTML',
  })
}

async function findOrCreateUser(tgUser, payload) {
  const telegramId = parseInt(tgUser.id, 10)
  const tgUsername = tgUser.username || null

  const existing = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId])
  if (existing.rows.length > 0) {
    const u = existing.rows[0]
    if (tgUsername && tgUsername !== u.telegram_username) {
      await db.query('UPDATE users SET telegram_username = $1 WHERE id = $2', [tgUsername, u.id])
    }
    return { ...u, _isNew: false }
  }

  const login = normLogin(tgUsername) || `tg_${telegramId}`
  const loginCheck = await db.query('SELECT 1 FROM users WHERE login = $1', [login])
  const finalLogin = loginCheck.rows.length > 0 ? `tg_${telegramId}` : login

  const randomPass = crypto.randomBytes(32).toString('hex')
  const hash = await bcrypt.hash(randomPass, 12)

  const insert = await db.query(
    `INSERT INTO users (login, email, password_hash, telegram_id, telegram_username, email_confirmed)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING *`,
    [finalLogin, `${telegramId}@telegram.user`, hash, telegramId, tgUsername]
  )
  const newUser = insert.rows[0]

  if (payload && payload.startsWith('ref_')) {
    const refCode = payload.slice(4)
    try {
      const referrerId = await referralService.getUserByReferralCode(refCode)
      if (referrerId && referrerId !== newUser.id) {
        await referralService.createReferral(referrerId, newUser.id, refCode)
        await referralService.processSignupBonus(referrerId, newUser.id).catch(() => {})
      }
    } catch (err) {
      console.warn('[TG bot] Referral link error:', err.message)
    }
  }

  try { await referralService.createReferralLink(newUser.id) }
  catch (err) { console.warn('[TG bot] Create referral link error:', err.message) }

  return { ...newUser, _isNew: true }
}

// ────────────────────────────────────────────────────────────────────────────
// Хелперы
// ────────────────────────────────────────────────────────────────────────────

/**
 * Получить юзера по Telegram-ID. Используется во всех кнопках меню.
 * Если юзера нет — возвращает null (юзер должен сначала /start).
 */
async function getUserByTg(tgId) {
  const r = await db.query('SELECT * FROM users WHERE telegram_id = $1', [tgId])
  return r.rows[0] || null
}

/**
 * Какие actions имеет смысл открывать как Mini App (web_app кнопка).
 * Остальные — оставляем как callback (показывают текст в чате).
 */
const WEB_APP_ACTIONS = {
  open_web:  '/dashboard',
  cabinet:   '/dashboard',
  buy:       '/pricing',
  referrals: '/dashboard?tab=referrals',
}

/**
 * Какие actions это «внешние ссылки» — для них используем url-кнопку
 * (с иконкой стрелки в Telegram), а не callback. Опционально.
 */
function buildExternalUrl(action, settings) {
  if (action === 'support') {
    const raw = (settings.texts?.support_contact || '').trim()
    const m = raw.match(/(?:t\.me\/|@)([a-zA-Z0-9_]{4,32})/)
    if (m) return `https://t.me/${m[1]}`
  }
  return null
}

/**
 * Сборка главного меню как InlineKeyboard (под сообщением).
 *
 * Если в settings задан web_app_url (https://) — кнопки которые ведут
 * на веб (open_web, cabinet, buy, referrals) рисуются как **WebApp-кнопки**:
 * тап откроет мини-приложение прямо в Telegram (с launch-иконкой,
 * визуально отличается от обычной callback-кнопки).
 *
 * Если web_app_url не задан — fallback на обычные callback-кнопки.
 *
 * Раскладка: если у кнопки `wide: true` → отдельная строка,
 * иначе пары по 2.
 */
function buildMainMenu(buttons, settings = {}) {
  const enabled = (buttons || []).filter(b => b && b.enabled !== false)
  enabled.sort((a, b) => (a.order || 0) - (b.order || 0))
  if (enabled.length === 0) return undefined

  const webAppBase = (settings.web_app_url || '').trim()
  const useWebApp = /^https:\/\//.test(webAppBase)

  const rows = []
  let pairBuf = []

  for (const b of enabled) {
    const action = b.action || 'unknown'
    const btn = { text: b.label }

    // 1. WebApp-кнопка (Mini App в Telegram)
    if (useWebApp && WEB_APP_ACTIONS[action]) {
      btn.web_app = { url: webAppBase.replace(/\/$/, '') + WEB_APP_ACTIONS[action] }
    }
    // 2. URL-кнопка (внешняя ссылка с иконкой)
    else if (buildExternalUrl(action, settings)) {
      btn.url = buildExternalUrl(action, settings)
    }
    // 3. Обычная callback-кнопка (серая)
    else {
      btn.callback_data = `menu:${action}`
    }

    if (b.wide) {
      if (pairBuf.length > 0) { rows.push(pairBuf); pairBuf = [] }
      rows.push([btn])
    } else {
      pairBuf.push(btn)
      if (pairBuf.length === 2) { rows.push(pairBuf); pairBuf = [] }
    }
  }
  if (pairBuf.length > 0) rows.push(pairBuf)

  return { inline_keyboard: rows }
}

/**
 * Reply-клавиатура «спрятана»: при /start мы убираем старую reply-клавиатуру
 * (если юзер видел её в прошлой версии бота).
 */
const REMOVE_REPLY_KEYBOARD = { remove_keyboard: true }

function renderTemplate(tpl, data) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, key) =>
    data[key] != null ? String(data[key]) : `{${key}}`
  )
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// ────────────────────────────────────────────────────────────────────────────
// 🌐 Веб-Панель
// ────────────────────────────────────────────────────────────────────────────

async function handleOpenWeb(ctx) {
  const user = await getUserByTg(ctx.from.id)
  if (!user) return ctx.reply('Сначала нажми /start чтобы зарегистрироваться.')

  const { token, expiresAt } = await tokens.createAutoLoginToken(user.id)
  const url = `${FRONTEND_URL}/tg-login?t=${token}`
  const ttlMin = Math.round((expiresAt - Date.now()) / 60000)

  const kb = new InlineKeyboard().url('🌐 Открыть веб-панель', url)
  await ctx.reply(
    `Жми кнопку чтобы открыть кабинет в браузере без логина.\n` +
    `<i>Ссылка одноразовая, действует ${ttlMin} мин.</i>`,
    { reply_markup: kb, parse_mode: 'HTML' }
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 👤 Личный кабинет
// ────────────────────────────────────────────────────────────────────────────

async function handleCabinet(ctx) {
  const user = await getUserByTg(ctx.from.id)
  if (!user) return ctx.reply('Сначала нажми /start.')

  // Подписки + баланс
  const [subsRes, balanceRes] = await Promise.all([
    db.query(
      `SELECT id, plan_name, expires_at, traffic_limit_gb, traffic_used_gb,
              subscription_url, is_active
         FROM subscriptions
        WHERE user_id = $1
        ORDER BY is_active DESC, expires_at DESC NULLS LAST
        LIMIT 1`,
      [user.id]
    ),
    // Баланс лежит в user_wallets, а не в users. Если кошелька ещё нет — 0.
    db.query('SELECT balance FROM user_wallets WHERE user_id = $1', [user.id]),
  ])

  const balance = balanceRes.rows[0]?.balance || 0
  const sub = subsRes.rows[0]

  const lines = [`👤 <b>${escapeHtml(user.login)}</b>`]
  lines.push(`💰 Баланс: <b>${fmtMoney(balance)} ₽</b>`)
  lines.push('')

  if (!sub) {
    lines.push('🔴 <b>Нет активной подписки</b>')
    const settings = await getSettings()
    lines.push(settings.texts?.no_subscription || 'Жми «Купить подписку» чтобы выбрать тариф.')
  } else if (sub.is_active) {
    const daysLeft = sub.expires_at
      ? Math.ceil((new Date(sub.expires_at) - Date.now()) / 86400000)
      : null
    const usedGb  = Number(sub.traffic_used_gb)  || 0
    const limitGb = Number(sub.traffic_limit_gb) || 0
    const pct = limitGb > 0 ? Math.min(100, (usedGb / limitGb) * 100) : 0

    lines.push(`✅ <b>Подписка: ${escapeHtml(sub.plan_name)}</b>`)
    if (daysLeft != null) {
      const icon = daysLeft <= 3 ? '🔴' : daysLeft <= 7 ? '🟠' : '🟢'
      lines.push(`${icon} Осталось: <b>${daysLeft}</b> ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}`)
      lines.push(`📅 До: ${new Date(sub.expires_at).toLocaleDateString('ru-RU')}`)
    }
    if (limitGb > 0) {
      lines.push(`📊 Трафик: <b>${usedGb.toFixed(2)} / ${limitGb} GB</b> (${pct.toFixed(0)}%)`)
    }
  } else {
    lines.push(`⚠️ <b>Подписка истекла</b>`)
    if (sub.expires_at) lines.push(`Истекла: ${new Date(sub.expires_at).toLocaleDateString('ru-RU')}`)
    lines.push('Продли подпиской — жми «Купить подписку».')
  }

  // Кнопки
  const kb = new InlineKeyboard()
  if (sub?.is_active && sub.subscription_url) {
    kb.url('📲 Подключить VPN', sub.subscription_url).row()
  }
  // Кнопка «Перейти в веб» — авто-логин
  const { token } = await tokens.createAutoLoginToken(user.id)
  kb.url('🌐 Открыть в браузере', `${FRONTEND_URL}/tg-login?t=${token}`)

  await ctx.reply(lines.join('\n'), { reply_markup: kb, parse_mode: 'HTML' })
}

// ────────────────────────────────────────────────────────────────────────────
// 🛒 Купить подписку
// ────────────────────────────────────────────────────────────────────────────

async function handleBuy(ctx) {
  const user = await getUserByTg(ctx.from.id)
  if (!user) return ctx.reply('Сначала нажми /start.')

  // Тарифы из БД
  const r = await db.query(
    `SELECT id, name, price, duration_days, traffic_limit_gb, hwid_device_limit, tier, color
       FROM plans
      WHERE is_active = true
      ORDER BY sort_order ASC, price ASC`
  )

  if (r.rows.length === 0) {
    return ctx.reply('Тарифы пока не настроены. Загляни позже.')
  }

  const lines = ['🛒 <b>Тарифы</b>\n']
  for (const p of r.rows) {
    const traffic = p.traffic_limit_gb ? `${p.traffic_limit_gb} GB` : '∞'
    const devices = p.hwid_device_limit ? `${p.hwid_device_limit} устр.` : '∞ устр.'
    lines.push(`<b>${escapeHtml(p.name)}</b> — ${fmtMoney(p.price)} ₽ / ${p.duration_days} дн.`)
    lines.push(`   📊 ${traffic} · 📱 ${devices}`)
    lines.push('')
  }
  lines.push('Жми кнопку с нужным тарифом — откроется оплата на сайте.')

  // Inline-кнопки: deeplink на /pricing с pre-selected тарифом + автологин
  const { token } = await tokens.createAutoLoginToken(user.id)
  const kb = new InlineKeyboard()
  for (const p of r.rows) {
    const url = `${FRONTEND_URL}/tg-login?t=${token}&redirect=/pricing?plan=${p.id}`
    kb.url(`${p.name} · ${fmtMoney(p.price)} ₽`, url).row()
  }

  await ctx.reply(lines.join('\n'), { reply_markup: kb, parse_mode: 'HTML' })
}

// ────────────────────────────────────────────────────────────────────────────
// 👥 Реферальная программа
// ────────────────────────────────────────────────────────────────────────────

async function handleReferrals(ctx) {
  const user = await getUserByTg(ctx.from.id)
  if (!user) return ctx.reply('Сначала нажми /start.')

  // Реф-код юзера
  let refLink
  try {
    refLink = await referralService.getOrCreateReferralLink(user.id)
  } catch (err) {
    // Если функции нет — попробуем createReferralLink
    try { refLink = await referralService.createReferralLink(user.id) }
    catch { refLink = null }
  }

  // Статистика
  const stats = await db.query(
    `SELECT COUNT(*)::int AS total,
            COALESCE(SUM(total_earned), 0) AS earned,
            COALESCE(SUM(total_bonus_days_earned), 0) AS bonus_days
       FROM referrals
      WHERE referrer_id = $1`,
    [user.id]
  )
  const s = stats.rows[0]

  const settings = await getSettings()
  const botUsername = settings.bot_username

  const lines = ['👥 <b>Реферальная программа</b>\n']
  lines.push(`Приглашено: <b>${s.total}</b>`)
  lines.push(`Заработано: <b>${fmtMoney(s.earned)} ₽</b>`)
  if (Number(s.bonus_days) > 0) {
    lines.push(`Бонус-дней: <b>${Number(s.bonus_days).toFixed(1)}</b>`)
  }
  lines.push('')

  const refCode = refLink?.code || refLink?.referral_code || refLink
  if (refCode) {
    lines.push('🔗 <b>Твои ссылки:</b>\n')
    if (botUsername) {
      const tgLink = `https://t.me/${botUsername}?start=ref_${refCode}`
      lines.push(`📱 Через бот:\n<code>${tgLink}</code>\n`)
    }
    lines.push(`🌐 На сайт:\n<code>${FRONTEND_URL}/register?ref=${refCode}</code>`)
    lines.push('\n<i>Поделись любой — куда удобнее. Бонус начисляется одинаково.</i>')
  } else {
    lines.push('⚠️ Не удалось получить реф-ссылку. Попробуй позже.')
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}

// ────────────────────────────────────────────────────────────────────────────
// 📋 Оферта
// ────────────────────────────────────────────────────────────────────────────

async function handleOffer(ctx) {
  const settings = await getSettings()
  const text = settings.texts?.offer ||
    'Текст оферты пока не задан. Админ может настроить его в /admin/telegram → Тексты.'
  await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true })
}

// ────────────────────────────────────────────────────────────────────────────
// ❓ FAQ
// ────────────────────────────────────────────────────────────────────────────

async function handleFaq(ctx) {
  const settings = await getSettings()
  const text = settings.texts?.faq ||
    '<b>Вопросы и ответы</b>\n\nРаздел пока пустой. Админ настраивает FAQ в /admin/telegram → Тексты.'
  await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true })
}

// ────────────────────────────────────────────────────────────────────────────
// 💬 Поддержка
// ────────────────────────────────────────────────────────────────────────────

async function handleSupport(ctx) {
  const settings = await getSettings()
  // Контакт берём из settings.texts.support_contact — это либо @username, либо t.me ссылка
  const raw = (settings.texts?.support_contact || '').trim()
  let username = null
  if (raw) {
    const m = raw.match(/(?:t\.me\/|@)([a-zA-Z0-9_]{4,32})/)
    if (m) username = m[1]
  }

  const introText = settings.texts?.support_intro ||
    '💬 <b>Поддержка</b>\n\nНапиши нам — отвечаем по будням. Опиши проблему как можно подробнее: что делал, на каком устройстве, скриншот ошибки если есть.'

  if (username) {
    const kb = new InlineKeyboard().url(`💬 Написать @${username}`, `https://t.me/${username}`)
    await ctx.reply(introText, { parse_mode: 'HTML', reply_markup: kb })
  } else {
    await ctx.reply(
      `${introText}\n\n<i>⚠️ Контакт поддержки не настроен. Админу: укажи @username в /admin/telegram → Тексты → support_contact.</i>`,
      { parse_mode: 'HTML' }
    )
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Роутер по emoji-префиксу
// ────────────────────────────────────────────────────────────────────────────

/**
 * Роутер callback_query от inline-кнопок. Data приходит в формате "menu:<action>".
 */
const MENU_HANDLERS = {
  open_web:  handleOpenWeb,
  cabinet:   handleCabinet,
  buy:       handleBuy,
  referrals: handleReferrals,
  offer:     handleOffer,
  faq:       handleFaq,
  support:   handleSupport,
}

async function handleMenuCallback(ctx) {
  // 1. Сразу отвечаем на callback (убирает loading-кружок на кнопке).
  //    Если не отозвать в течение ~10 секунд — Telegram покажет "истекло".
  try { await ctx.answerCallbackQuery() } catch {}

  const data = ctx.callbackQuery?.data || ''
  const action = data.startsWith('menu:') ? data.slice(5) : data
  const handler = MENU_HANDLERS[action]
  if (!handler) {
    return ctx.reply('🚧 Неизвестное действие. Нажми /start чтобы обновить меню.')
  }
  return handler(ctx)
}

module.exports = {
  handleStart,
  handleMenuCallback,
  // Экспорт по отдельности — на случай прямых вызовов
  handleOpenWeb,
  handleCabinet,
  handleBuy,
  handleReferrals,
  handleOffer,
  handleFaq,
  handleSupport,
  buildMainMenu,
  renderTemplate,
  REMOVE_REPLY_KEYBOARD,
}
