/**
 * Одноразовые токены для перехода юзера из бота на веб без ручного логина.
 *
 * Flow:
 *   1. Юзер в боте жмёт «🌐 Веб-Панель»
 *   2. Бот вызывает createAutoLoginToken(userId) → получает короткий random-токен
 *   3. Бот отдаёт inline-кнопку с URL `https://сайт/tg-login?t=<token>`
 *   4. Юзер открывает в браузере
 *   5. Frontend `TgLogin.jsx` шлёт `GET /auth/tg-login?t=<token>` на бэкенд
 *   6. Бэкенд резолвит токен, помечает как used, выдаёт JWT, редиректит в /dashboard
 *
 * Токены живут 5 минут. После использования помечаются used_at — повторное
 * использование запрещено.
 */
const crypto = require('crypto')
const db = require('../../db')

const AUTO_LOGIN_TTL_MS = 5 * 60 * 1000  // 5 минут
const TOKEN_BYTES = 24                    // 192 бит → 32 hex-символа

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex')
}

/**
 * Создать одноразовый auto-login токен для юзера.
 * Возвращает { token, expires_at }.
 */
async function createAutoLoginToken(userId) {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + AUTO_LOGIN_TTL_MS)
  await db.query(
    `INSERT INTO telegram_link_tokens (user_id, token, purpose, expires_at)
     VALUES ($1, $2, 'auto_login', $3)`,
    [userId, token, expiresAt]
  )
  return { token, expiresAt }
}

/**
 * Использовать токен — найти, проверить срок, пометить used.
 * @returns {{ userId } | null}
 */
async function consumeAutoLoginToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null
  const r = await db.query(
    `UPDATE telegram_link_tokens
        SET used_at = NOW()
      WHERE token = $1
        AND purpose = 'auto_login'
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING user_id`,
    [token]
  )
  if (r.rows.length === 0) return null
  return { userId: r.rows[0].user_id }
}

/**
 * Очистка просроченных токенов — вызывать из cron (периодически).
 */
async function cleanupExpired() {
  await db.query(
    "DELETE FROM telegram_link_tokens WHERE expires_at < NOW() - INTERVAL '1 day'"
  )
}

module.exports = {
  createAutoLoginToken,
  consumeAutoLoginToken,
  cleanupExpired,
  AUTO_LOGIN_TTL_MS,
}
