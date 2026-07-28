/**
 * Bot-токены. Три отдельных типа — все хранятся в разных таблицах:
 *
 * 1. AUTO_LOGIN — переход из бота на веб без логина.
 *    Таблица telegram_link_tokens, purpose='auto_login', TTL 5 мин.
 *
 * 2. LINK existing — привязка телеграм-аккаунта к существующему сайт-юзеру.
 *    Таблица telegram_link_tokens, purpose='link', TTL 15 мин.
 *    Flow:
 *      - Юзер на /dashboard/security жмёт «Привязать Telegram»
 *      - Backend: createLinkToken(userId) → возвращает token + deeplink + qrPayload
 *      - Юзер сканирует QR / открывает t.me/<bot>?start=link_<token>
 *      - Бот в /start link_<token>: confirmLinkToken — проставляет users.telegram_id
 *      - Frontend поллит pollLinkStatus → видит confirmed_at != null
 *
 * 3. REGISTRATION — новый юзер регится через бот.
 *    Отдельная таблица pending_registrations (юзера ещё нет в users).
 *    TTL 15 мин.
 *    Flow:
 *      - Юзер на /register заполняет форму, жмёт «Через Telegram-бот»
 *      - Backend: createPendingRegistration → token + deeplink
 *      - Юзер /start reg_<token> → confirmPendingRegistration:
 *          создаёт users (telegram_id, telegram_username), реф-связь,
 *          возвращает auto_login токен
 *      - Бот шлёт юзеру кнопку «🌐 Открыть сайт» с auto_login деплинком
 *      - Frontend поллит pollPendingRegistration → видит auto_login_token
 *        → редиректит на /tg-login?t=<auto_login_token>
 */
const crypto = require('crypto')
const db = require('../../db')

const AUTO_LOGIN_TTL_MS  = 5  * 60 * 1000   // 5  минут
const LINK_TTL_MS        = 15 * 60 * 1000   // 15 минут
const REGISTRATION_TTL_MS = 15 * 60 * 1000  // 15 минут
const TOKEN_BYTES = 24                       // 192 бит → 32 hex-символа

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
/**
 * Проверить токен БЕЗ пометки использованным.
 * Нужен, чтобы сначала убедиться в правах юзера (админ-режим, блокировка),
 * а сжигать одноразовый токен — только когда вход реально состоится. Иначе
 * первая же неуспешная попытка сжигала токен, и юзер видел «токен истёк»
 * вместо настоящей причины отказа.
 */
async function peekAutoLoginToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null
  const r = await db.query(
    `SELECT user_id FROM telegram_link_tokens
      WHERE token = $1 AND purpose = 'auto_login'
        AND used_at IS NULL AND expires_at > NOW()`,
    [token]
  )
  return r.rows.length ? { userId: r.rows[0].user_id } : null
}

/**
 * Почему токен не подошёл: not_found | used | expired | ok.
 * Нужно для внятной диагностики на проде — иначе все причины сливаются
 * в одно «токен невалиден или истёк» и понять реальную не получается.
 */
async function diagnoseAutoLoginToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return { reason: 'malformed' }
  const r = await db.query(
    `SELECT user_id, used_at, expires_at, (expires_at <= NOW()) AS expired
       FROM telegram_link_tokens
      WHERE token = $1 AND purpose = 'auto_login'`,
    [token]
  )
  if (r.rows.length === 0) return { reason: 'not_found' }
  const row = r.rows[0]
  if (row.used_at) return { reason: 'used', usedAt: row.used_at, userId: row.user_id }
  if (row.expired) return { reason: 'expired', expiresAt: row.expires_at, userId: row.user_id }
  return { reason: 'ok', userId: row.user_id }
}

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

// ─── LINK existing (привязка к существующему сайт-юзеру) ──────────────────────

async function createLinkToken(userId) {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + LINK_TTL_MS)
  await db.query(
    `INSERT INTO telegram_link_tokens (user_id, token, purpose, expires_at)
     VALUES ($1, $2, 'link', $3)`,
    [userId, token, expiresAt]
  )
  return { token, expiresAt }
}

/**
 * Найти link-token для бота. Возвращает { userId, expired } | null.
 * НЕ помечает used — это сделает confirmLinkToken после успешной привязки.
 */
async function getLinkToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null
  const r = await db.query(
    `SELECT user_id, expires_at, confirmed_at
       FROM telegram_link_tokens
      WHERE token = $1 AND purpose = 'link'`,
    [token]
  )
  if (r.rows.length === 0) return null
  const row = r.rows[0]
  return {
    userId:       row.user_id,
    expired:      row.expires_at < new Date(),
    confirmedAt:  row.confirmed_at,
  }
}

async function confirmLinkToken(token) {
  await db.query(
    `UPDATE telegram_link_tokens SET confirmed_at = NOW()
      WHERE token = $1 AND purpose = 'link' AND confirmed_at IS NULL`,
    [token]
  )
}

/**
 * Polling endpoint: { status: 'pending' | 'confirmed' | 'expired' }.
 */
async function pollLinkStatus(token) {
  if (!token || typeof token !== 'string') return { status: 'expired' }
  const r = await db.query(
    `SELECT expires_at, confirmed_at
       FROM telegram_link_tokens
      WHERE token = $1 AND purpose = 'link'`,
    [token]
  )
  if (r.rows.length === 0) return { status: 'expired' }
  const row = r.rows[0]
  if (row.confirmed_at) return { status: 'confirmed' }
  if (row.expires_at < new Date()) return { status: 'expired' }
  return { status: 'pending' }
}

// ─── REGISTRATION (новый юзер через бот) ──────────────────────────────────────

async function createPendingRegistration({ login, email, passwordHash, referralCode, registrationIp }) {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS)
  await db.query(
    `INSERT INTO pending_registrations
       (token, login, email, password_hash, referral_code, registration_ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [token, login, email, passwordHash, referralCode || null, registrationIp || null, expiresAt]
  )
  return { token, expiresAt }
}

async function getPendingRegistration(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null
  const r = await db.query(
    `SELECT * FROM pending_registrations WHERE token = $1`,
    [token]
  )
  if (r.rows.length === 0) return null
  const row = r.rows[0]
  return {
    ...row,
    expired: !row.confirmed_at && row.expires_at < new Date(),
  }
}

async function markRegistrationConfirmed(token, createdUserId) {
  await db.query(
    `UPDATE pending_registrations
        SET confirmed_at = NOW(), created_user_id = $2
      WHERE token = $1 AND confirmed_at IS NULL`,
    [token, createdUserId]
  )
}

/**
 * Polling: { status, autoLoginToken? }.
 * Когда регистрация подтверждена — генерим auto_login токен на лету,
 * фронт редиректит /tg-login?t=<autoLoginToken> и юзер залогинен.
 */
async function pollRegistrationStatus(token) {
  if (!token || typeof token !== 'string') return { status: 'expired' }
  const r = await db.query(
    `SELECT expires_at, confirmed_at, created_user_id
       FROM pending_registrations WHERE token = $1`,
    [token]
  )
  if (r.rows.length === 0) return { status: 'expired' }
  const row = r.rows[0]
  if (row.confirmed_at && row.created_user_id) {
    const auto = await createAutoLoginToken(row.created_user_id)
    return { status: 'confirmed', autoLoginToken: auto.token }
  }
  if (row.expires_at < new Date()) return { status: 'expired' }
  return { status: 'pending' }
}

// ─── Очистка ──────────────────────────────────────────────────────────────────

async function cleanupExpired() {
  await db.query(
    "DELETE FROM telegram_link_tokens WHERE expires_at < NOW() - INTERVAL '1 day'"
  )
  await db.query(
    "DELETE FROM pending_registrations WHERE expires_at < NOW() - INTERVAL '1 day' AND confirmed_at IS NULL"
  )
}

module.exports = {
  // auto_login
  createAutoLoginToken, consumeAutoLoginToken, peekAutoLoginToken,
  diagnoseAutoLoginToken, AUTO_LOGIN_TTL_MS,
  // link existing
  createLinkToken, getLinkToken, confirmLinkToken, pollLinkStatus, LINK_TTL_MS,
  // registration
  createPendingRegistration, getPendingRegistration, markRegistrationConfirmed,
  pollRegistrationStatus, REGISTRATION_TTL_MS,
  // util
  cleanupExpired,
}
