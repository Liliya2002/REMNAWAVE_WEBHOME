/**
 * Telegram-бот — bootstrap, start/stop, переключение режима polling↔webhook.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Архитектура
 *
 * 1. На старте backend читает telegram_settings из БД. Если is_enabled=true и
 *    есть bot_token — стартует бот.
 * 2. В режиме 'polling' — bot.start() (long-polling, держится в этом же процессе)
 * 3. В режиме 'webhook' — устанавливается webhook на bot_username, обработка
 *    через POST endpoint в admin-telegram.js (или отдельный route).
 *
 * Изменения настроек (например toggle is_enabled, смена режима) — через
 * admin-telegram.js → restart() → graceful stop + start с новыми настройками.
 *
 * Никаких глобальных state-переменных кроме `currentBot` — всё лежит в БД.
 * ────────────────────────────────────────────────────────────────────────────
 */
const { Bot } = require('grammy')
const { getSettings } = require('./settings')
const handlers = require('./handlers')

let currentBot = null
let currentMode = null  // 'polling' | 'webhook' | null
let startupError = null

/**
 * Создаёт grammY Bot и регистрирует все обработчики.
 * @param {string} token
 */
function buildBot(token) {
  const bot = new Bot(token)

  // Команды
  bot.command('start', handlers.handleStart)

  // Главное меню — InlineKeyboard под сообщением (data="menu:<action>")
  bot.callbackQuery(/^menu:/, handlers.handleMenuCallback)

  // Глобальный обработчик ошибок — чтобы вылет на одном update не клал бота
  bot.catch((err) => {
    const ctx = err.ctx
    console.error(`[TG bot] error processing update #${ctx?.update?.update_id}:`, err.error?.message || err.error || err)
  })

  return bot
}

/**
 * Стартует бот по текущим настройкам в БД.
 * Возвращает { ok, mode, info, error }.
 */
async function start() {
  if (currentBot) {
    console.warn('[TG bot] already running, stopping first')
    await stop()
  }

  startupError = null
  let settings
  try {
    settings = await getSettings()
  } catch (err) {
    startupError = `Не удалось прочитать настройки: ${err.message}`
    return { ok: false, error: startupError }
  }

  if (!settings.is_enabled) {
    return { ok: false, error: 'Бот выключен в настройках (is_enabled=false)' }
  }
  if (!settings.bot_token) {
    return { ok: false, error: 'bot_token не задан в настройках' }
  }

  let bot
  try {
    bot = buildBot(settings.bot_token)
  } catch (err) {
    startupError = `Ошибка создания Bot: ${err.message}`
    return { ok: false, error: startupError }
  }

  // Сначала проверим что токен валидный — getMe()
  let info
  try {
    info = await bot.api.getMe()
  } catch (err) {
    startupError = `getMe() failed: ${err.message}. Проверь токен.`
    return { ok: false, error: startupError }
  }

  // Если в БД нет bot_username — сохраним из getMe()
  if (info?.username && info.username !== settings.bot_username) {
    try {
      const db = require('../../db')
      await db.query('UPDATE telegram_settings SET bot_username = $1 WHERE id = 1', [info.username])
    } catch {}
  }

  if (settings.mode === 'webhook') {
    // Webhook-режим — регистрируем webhook в Telegram, реальная обработка через POST endpoint
    if (!settings.webhook_url) {
      startupError = 'Для webhook-режима нужен webhook_url'
      return { ok: false, error: startupError }
    }
    try {
      await bot.api.setWebhook(settings.webhook_url, {
        secret_token: settings.webhook_secret || undefined,
        drop_pending_updates: false,
      })
    } catch (err) {
      startupError = `setWebhook failed: ${err.message}`
      return { ok: false, error: startupError }
    }
    currentBot = bot
    currentMode = 'webhook'
    console.log(`[TG bot] webhook installed: ${settings.webhook_url}`)
    return { ok: true, mode: 'webhook', info, webhookUrl: settings.webhook_url }
  } else {
    // Polling-режим — снимаем webhook (если был) и стартуем long-polling
    try { await bot.api.deleteWebhook() } catch {}
    // bot.start() блокирует — запускаем без await
    bot.start({
      onStart: (botInfo) => console.log(`[TG bot] polling started, bot=@${botInfo.username}`),
    }).catch(err => {
      console.error('[TG bot] polling fatal:', err.message)
    })
    currentBot = bot
    currentMode = 'polling'
    return { ok: true, mode: 'polling', info }
  }
}

/**
 * Останавливает бот (если запущен).
 */
async function stop() {
  if (!currentBot) return { ok: true, alreadyStopped: true }
  try {
    if (currentMode === 'polling') {
      await currentBot.stop()
    } else if (currentMode === 'webhook') {
      await currentBot.api.deleteWebhook().catch(() => {})
    }
  } catch (err) {
    console.error('[TG bot] stop error:', err.message)
  }
  currentBot = null
  currentMode = null
  console.log('[TG bot] stopped')
  return { ok: true }
}

/**
 * Перезапуск (для применения изменённых настроек).
 */
async function restart() {
  await stop()
  return start()
}

/**
 * Текущий статус — для админки.
 */
function status() {
  return {
    running: !!currentBot,
    mode: currentMode,
    error: startupError,
  }
}

/**
 * Авто-старт при загрузке backend если is_enabled=true.
 * Не падает если бот не настроен — просто молча не стартует.
 */
async function autoStart() {
  try {
    const settings = await getSettings()
    if (settings.is_enabled && settings.bot_token) {
      const r = await start()
      if (!r.ok) console.warn(`[TG bot] auto-start skipped: ${r.error}`)
    } else {
      console.log('[TG bot] disabled or no token — skipped')
    }
  } catch (err) {
    console.warn('[TG bot] auto-start error:', err.message)
  }
}

/**
 * Обработка входящего webhook-update (для webhook-режима).
 * Вызывается из admin-telegram.js → POST /webhook.
 */
async function handleWebhookUpdate(update, secretToken) {
  if (!currentBot || currentMode !== 'webhook') {
    throw new Error('Бот не работает в webhook-режиме')
  }
  const settings = await getSettings()
  if (settings.webhook_secret && settings.webhook_secret !== secretToken) {
    throw new Error('Неверный webhook secret')
  }
  await currentBot.handleUpdate(update)
}

module.exports = {
  start,
  stop,
  restart,
  status,
  autoStart,
  handleWebhookUpdate,
}
