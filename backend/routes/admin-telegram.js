/**
 * Админ-эндпоинты для управления Telegram-ботом.
 *
 * GET  /api/admin/telegram/settings       — текущие настройки (без токена)
 * PUT  /api/admin/telegram/settings       — обновить
 * GET  /api/admin/telegram/status         — running / mode / error
 * POST /api/admin/telegram/restart        — рестарт (применить новые настройки)
 * POST /api/admin/telegram/test           — тест-сообщение в admin_chat_id
 *
 * POST /api/tg/webhook                    — public endpoint для webhook (НЕ admin!)
 *                                           регистрируется отдельно в index.js
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const settingsLayer = require('../services/telegramBot/settings')
const bot = require('../services/telegramBot')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

router.get('/settings', async (req, res) => {
  try {
    const s = await settingsLayer.getSettingsSafe()
    res.json({ settings: s })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/settings', async (req, res) => {
  try {
    const updated = await settingsLayer.updateSettings(req.body || {})
    audit.write(req, 'telegram.settings_update', { type: 'telegram_settings' }, {
      changedKeys: Object.keys(req.body || {}),
    }).catch(() => {})

    // Если поменялся token / mode / is_enabled / webhook_url — рестартим бот
    const hotKeys = ['is_enabled', 'bot_token', 'mode', 'webhook_url', 'webhook_secret']
    const needRestart = hotKeys.some(k => k in (req.body || {}))
    let restartResult = null
    if (needRestart) {
      restartResult = await bot.restart().catch(e => ({ ok: false, error: e.message }))
    }

    res.json({
      settings: { ...updated, bot_token: null, webhook_secret: null,
                  has_bot_token: !!updated.bot_token,
                  has_webhook_secret: !!updated.webhook_secret },
      restart: restartResult,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get('/status', async (req, res) => {
  res.json({ status: bot.status() })
})

router.post('/restart', async (req, res) => {
  const r = await bot.restart()
  audit.write(req, 'telegram.restart', { type: 'telegram_settings' }, { ok: r.ok }).catch(() => {})
  res.json(r)
})

router.post('/stop', async (req, res) => {
  const r = await bot.stop()
  audit.write(req, 'telegram.stop', { type: 'telegram_settings' }, {}).catch(() => {})
  res.json(r)
})

/**
 * POST /test — отправить тест-сообщение в указанный chat_id (или admin_chat_id из настроек).
 * Body: { chat_id?: string, text?: string }
 */
router.post('/test', async (req, res) => {
  try {
    const settings = await settingsLayer.getSettings()
    if (!settings.bot_token) return res.status(400).json({ error: 'bot_token не задан' })

    const chatId = req.body.chat_id || settings.admin_chat_id
    if (!chatId) return res.status(400).json({ error: 'Нет chat_id (передай в body или установи admin_chat_id в настройках)' })

    const text = req.body.text || `✅ Тест от VPN Webhome admin-panel.\nВремя: ${new Date().toLocaleString('ru-RU')}`

    const r = await fetch(`https://api.telegram.org/bot${settings.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    const data = await r.json()
    if (!data.ok) return res.status(400).json({ error: `Telegram API: ${data.description}` })

    audit.write(req, 'telegram.test_message', { type: 'telegram_settings' }, { chat_id: chatId }).catch(() => {})
    res.json({ ok: true, sent_to: chatId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
