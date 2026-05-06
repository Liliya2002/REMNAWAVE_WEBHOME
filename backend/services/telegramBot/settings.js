/**
 * Доступ к настройкам бота в БД.
 * Singleton-строка `telegram_settings` с id=1.
 *
 * Bot token шифруется при записи через services/encryption.js (общий ENCRYPTION_KEY).
 * При чтении расшифровывается.
 */
const db = require('../../db')
const { encrypt, decrypt } = require('../encryption')

const ROW_ID = 1

/**
 * Получить настройки бота. Чувствительные поля (bot_token, webhook_secret) расшифровываются.
 * Возвращает дефолтную пустую структуру если строки нет.
 */
async function getSettings() {
  const r = await db.query('SELECT * FROM telegram_settings WHERE id = $1', [ROW_ID])
  if (r.rows.length === 0) {
    return {
      id: ROW_ID,
      is_enabled: false,
      bot_token: null,
      bot_username: null,
      mode: 'polling',
      webhook_url: null,
      webhook_secret: null,
      admin_chat_id: null,
      notifications_enabled: {},
      texts: {},
      menu_buttons: [],
    }
  }
  const row = r.rows[0]
  return {
    ...row,
    bot_token:      row.bot_token ? safeDecrypt(row.bot_token) : null,
    webhook_secret: row.webhook_secret ? safeDecrypt(row.webhook_secret) : null,
  }
}

/**
 * Безопасное представление для админки — токен скрыт.
 */
async function getSettingsSafe() {
  const s = await getSettings()
  return {
    ...s,
    bot_token: null,
    has_bot_token: !!s.bot_token,
    webhook_secret: null,
    has_webhook_secret: !!s.webhook_secret,
  }
}

/**
 * Обновить настройки. Поля sensitive (bot_token, webhook_secret) принимают:
 *   - undefined → не менять
 *   - '' → не менять (так UI не "стирает" значение случайно)
 *   - null → стереть
 *   - строка → зашифровать и сохранить
 */
async function updateSettings(patch) {
  const allowed = [
    'is_enabled', 'bot_username', 'mode', 'webhook_url',
    'admin_chat_id', 'notifications_enabled', 'texts', 'menu_buttons',
    'web_app_url',
  ]
  const sensitiveFields = ['bot_token', 'webhook_secret']

  // Валидация mode
  if (patch.mode !== undefined && !['polling', 'webhook'].includes(patch.mode)) {
    throw new Error("mode должен быть 'polling' или 'webhook'")
  }
  if (patch.mode === 'webhook' && !patch.webhook_url && !(await getSettings()).webhook_url) {
    throw new Error('Для webhook-режима нужен webhook_url')
  }
  // web_app_url — только https
  if (patch.web_app_url && patch.web_app_url.length > 0 && !/^https:\/\//.test(patch.web_app_url)) {
    throw new Error('Web App URL должен начинаться с https:// (Telegram требует HTTPS для Mini Apps)')
  }

  const sets = []
  const values = [ROW_ID]
  let idx = 2

  for (const k of allowed) {
    if (!(k in patch)) continue
    sets.push(`${k} = $${idx++}`)
    let v = patch[k]
    if (k === 'notifications_enabled' || k === 'texts' || k === 'menu_buttons') {
      v = JSON.stringify(v ?? {})
    }
    values.push(v)
  }

  for (const k of sensitiveFields) {
    if (!(k in patch)) continue
    const v = patch[k]
    if (v === undefined || v === '') continue
    sets.push(`${k} = $${idx++}`)
    values.push(v === null ? null : encrypt(String(v)))
  }

  if (sets.length === 0) return await getSettings()

  sets.push('updated_at = NOW()')
  await db.query(
    `UPDATE telegram_settings SET ${sets.join(', ')} WHERE id = $1`,
    values
  )
  return await getSettings()
}

function safeDecrypt(value) {
  try { return decrypt(value) } catch { return null }
}

module.exports = {
  getSettings,
  getSettingsSafe,
  updateSettings,
}
