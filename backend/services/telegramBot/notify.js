/**
 * Helpers для отправки Telegram-уведомлений юзерам и админу.
 *
 * Каждое уведомление имеет ключ (например 'user_subscription_expiring').
 * Перед отправкой проверяется:
 *   1. is_enabled = true в telegram_settings
 *   2. notifications_enabled[key] = true
 *   3. У юзера есть telegram_id (для notifyUser)
 *
 * Текст берётся из settings.texts[key]. Если в settings нет — fallback на DEFAULT_TEXTS ниже.
 * В тексте поддерживаются плейсхолдеры {key} → значение из data.
 *
 * Ошибки sendMessage логируются но не пробрасываются — уведомления никогда
 * не должны валить основной flow (cron / webhook / etc).
 */
const db = require('../../db')
const { getSettings } = require('./settings')

// ────────────────────────────────────────────────────────────────────────────
// Дефолтные тексты — fallback если в settings.texts ключа нет.
// Поддерживаются плейсхолдеры {name}, {plan}, {daysLeft}, {amount}, {balance} и пр.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_TEXTS = {
  user_subscription_expiring:
    '⏰ <b>Подписка скоро истечёт</b>\n\n' +
    'Тариф: <b>{plan}</b>\n' +
    'Осталось: <b>{daysLeft}</b> дн.\n' +
    'Истекает: {expiresAt}\n\n' +
    'Продли подписку чтобы не потерять доступ.',

  user_payment_received:
    '✅ <b>Платёж получен</b>\n\n' +
    'Сумма: <b>{amount} ₽</b>\n' +
    '{plan, select, _ "" other "Тариф: {plan}\n"}' +
    'Спасибо! 🙌',

  user_referral_bonus:
    '🎁 <b>Бонус за реферала</b>\n\n' +
    'Тебе начислено: <b>{amount} ₽</b>\n' +
    'Текущий баланс: <b>{balance} ₽</b>',

  user_traffic_blocked:
    '🚫 <b>Доступ заблокирован: превышен лимит трафика</b>\n\n' +
    'Лимит: <b>{limitGb} GB</b>\n' +
    'Использовано: <b>{usedGb} GB</b>\n\n' +
    'Подожди до начала следующего периода или купи дополнительный трафик.',

  admin_vps_expiring:
    '⚠️ <b>VPS — истечение оплаты</b>\n\n{lines}\n\n_Всего: {count} серв._',

  admin_user_registered:
    '👤 <b>Новый юзер</b>\nЛогин: {login}\nИсточник: {source}',

  admin_payment_received:
    '💰 <b>Платёж получен</b>\nЮзер: {login}\nСумма: {amount} ₽\nТариф: {plan}',
}

// ────────────────────────────────────────────────────────────────────────────
// Низкоуровневая отправка через Telegram Bot API.
// Не использует grammY (currentBot может быть не запущен — нам нужен прямой fetch).
// ────────────────────────────────────────────────────────────────────────────

async function rawSendMessage({ token, chatId, text, parseMode = 'HTML' }) {
  if (!token || !chatId || !text) return { ok: false, error: 'missing args' }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    })
    const data = await r.json()
    if (!data.ok) {
      // Самая частая ошибка: 403 "bot can't initiate conversation with a user"
      // (юзер не нажимал /start у бота). Это ожидаемо — silent log без stack trace.
      console.warn(`[TG notify] sendMessage failed: ${data.description}`)
      return { ok: false, error: data.description, code: data.error_code }
    }
    return { ok: true, messageId: data.result?.message_id }
  } catch (err) {
    console.warn('[TG notify] network error:', err.message)
    return { ok: false, error: err.message }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Шаблонизация
// ────────────────────────────────────────────────────────────────────────────

/**
 * Простая подстановка {key} → data[key]. Обрабатывает также примитивный
 * select-синтаксис: {var, select, _ "пусто" other "есть {var}"}
 *   - если data[var] пустое → "пусто"
 *   - иначе → "есть {var}" (с подстановкой)
 */
function renderTemplate(tpl, data) {
  if (!tpl) return ''
  let s = String(tpl)

  // Сначала select-синтаксис (один уровень вложенности).
  s = s.replace(/\{(\w+),\s*select,\s*_\s*"([^"]*)"\s+other\s*"([^"]*)"\s*\}/g,
    (_, key, empty, other) => {
      const v = data[key]
      return v == null || v === '' ? empty : other
    })

  // Затем простые {placeholder}
  s = s.replace(/\{(\w+)\}/g, (_, key) =>
    data[key] != null ? String(data[key]) : `{${key}}`
  )

  return s
}

// ────────────────────────────────────────────────────────────────────────────
// notifyUser
// ────────────────────────────────────────────────────────────────────────────

/**
 * Отправить уведомление пользователю в Telegram-личку.
 *
 * @param {number} userId - ID юзера в нашей БД
 * @param {string} key    - ключ уведомления (см. DEFAULT_TEXTS)
 * @param {object} data   - данные для шаблона
 * @returns {{ ok, skipped?, error? }}
 */
async function notifyUser(userId, key, data = {}) {
  try {
    const settings = await getSettings()
    if (!settings.is_enabled || !settings.bot_token) {
      return { ok: false, skipped: 'bot_disabled' }
    }
    if (settings.notifications_enabled?.[key] === false) {
      return { ok: false, skipped: `disabled:${key}` }
    }

    const r = await db.query('SELECT login, telegram_id FROM users WHERE id = $1', [userId])
    const u = r.rows[0]
    if (!u || !u.telegram_id) {
      return { ok: false, skipped: 'no_telegram_id' }
    }

    const tpl = settings.texts?.[key] || DEFAULT_TEXTS[key]
    if (!tpl) return { ok: false, skipped: `no_template:${key}` }

    const text = renderTemplate(tpl, { name: u.login, login: u.login, ...data })
    return await rawSendMessage({
      token: settings.bot_token,
      chatId: u.telegram_id,
      text,
    })
  } catch (err) {
    console.error('[TG notify] notifyUser error:', err.message)
    return { ok: false, error: err.message }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// notifyAdmin
// ────────────────────────────────────────────────────────────────────────────

/**
 * Уведомление админу в admin_chat_id из настроек (или fallback на process.env.TELEGRAM_CHAT_ID).
 *
 * @param {string} key  - ключ (admin_*) для проверки toggle
 * @param {object} data - данные для шаблона. Можно передать data.text напрямую — без шаблона.
 */
async function notifyAdmin(key, data = {}) {
  try {
    const settings = await getSettings()

    // Token: settings.bot_token или legacy ENV
    const token = settings.bot_token || process.env.TELEGRAM_BOT_TOKEN
    const chatId = settings.admin_chat_id || process.env.TELEGRAM_CHAT_ID
    if (!token || !chatId) {
      return { ok: false, skipped: 'no_admin_chat' }
    }
    // Если бот выключен — админские уведомления через ENV всё равно идут (legacy fallback)
    if (settings.is_enabled === false && !process.env.TELEGRAM_BOT_TOKEN) {
      return { ok: false, skipped: 'bot_disabled' }
    }
    if (key && settings.notifications_enabled?.[key] === false) {
      return { ok: false, skipped: `disabled:${key}` }
    }

    let text = data.text
    if (!text) {
      const tpl = settings.texts?.[key] || DEFAULT_TEXTS[key]
      if (!tpl) return { ok: false, skipped: `no_template:${key}` }
      text = renderTemplate(tpl, data)
    }

    return await rawSendMessage({ token, chatId, text })
  } catch (err) {
    console.error('[TG notify] notifyAdmin error:', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = {
  notifyUser,
  notifyAdmin,
  rawSendMessage,
  renderTemplate,
  DEFAULT_TEXTS,
}
