/**
 * remnwaveUsername — генерация стабильного RemnaWave username для юзера.
 *
 * Формат: 'userweb_' + 8 случайных цифр (вероятность коллизии ~1e-8 при 100M юзерах).
 * Сохраняется в users.remnwave_username один раз и переиспользуется во всех подписках юзера.
 */
const crypto = require('crypto')
const db = require('../db')

function generate8Digits() {
  // crypto.randomInt — криптостойкий
  return String(crypto.randomInt(10_000_000, 100_000_000))
}

/**
 * Возвращает remnwave_username для юзера. Если ещё не сгенерирован — создаёт
 * (с retry на случай коллизии UNIQUE) и сохраняет в users.remnwave_username.
 *
 * @param {number} userId
 * @returns {Promise<string>}
 */
async function getOrCreateUsername(userId) {
  // 1. Уже есть?
  const r = await db.query('SELECT remnwave_username FROM users WHERE id = $1', [userId])
  if (!r.rows[0]) throw new Error('User not found')
  if (r.rows[0].remnwave_username) return r.rows[0].remnwave_username

  // 2. Генерим с retry до 10 попыток
  for (let i = 0; i < 10; i++) {
    const candidate = `userweb_${generate8Digits()}`
    try {
      const upd = await db.query(
        `UPDATE users SET remnwave_username = $1 WHERE id = $2 AND remnwave_username IS NULL
         RETURNING remnwave_username`,
        [candidate, userId]
      )
      if (upd.rows[0]) return upd.rows[0].remnwave_username
      // Концурентность — кто-то выставил параллельно, читаем свежее значение
      const re = await db.query('SELECT remnwave_username FROM users WHERE id = $1', [userId])
      if (re.rows[0]?.remnwave_username) return re.rows[0].remnwave_username
    } catch (err) {
      // UNIQUE conflict — пробуем другой кандидат
      if (err.code !== '23505') throw err
    }
  }
  throw new Error('Failed to generate unique remnwave_username after 10 attempts')
}

/**
 * Резолвит username для юзера: сначала пробует existing remnwave_username,
 * затем legacy `userweb_<user_id>` (с backfill если найден в RW), затем генерит новый.
 *
 * @param {number} userId
 * @param {object} [remnwaveService] — опц. инжект для проверки legacy
 * @returns {Promise<string>}
 */
async function resolveUsernameForUser(userId, remnwaveService = null) {
  const r = await db.query('SELECT id, remnwave_username FROM users WHERE id = $1', [userId])
  if (!r.rows[0]) throw new Error('User not found')
  if (r.rows[0].remnwave_username) return r.rows[0].remnwave_username

  // Backwards compat: ищем legacy юзера в RW по userweb_<id>
  if (remnwaveService) {
    const legacy = `userweb_${userId}`
    try {
      const found = await remnwaveService.getRemnwaveUserByUsername(legacy)
      if (found?.uuid) {
        await db.query('UPDATE users SET remnwave_username = $1 WHERE id = $2', [legacy, userId])
        return legacy
      }
    } catch {}
  }

  return getOrCreateUsername(userId)
}

/**
 * Возвращает metadata юзера для передачи в RemnaWave (email если подтверждён, telegram_id если привязан).
 */
async function getRemnwaveMetadata(userId) {
  const r = await db.query(
    `SELECT email, email_confirmed, telegram_id FROM users WHERE id = $1`,
    [userId]
  )
  const u = r.rows[0]
  if (!u) return {}
  const meta = {}
  if (u.email && u.email_confirmed) meta.email = u.email
  if (u.telegram_id != null) meta.telegramId = Number(u.telegram_id)
  return meta
}

module.exports = { getOrCreateUsername, generate8Digits, resolveUsernameForUser, getRemnwaveMetadata }
