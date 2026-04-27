const express = require('express')
const crypto = require('crypto')
const db = require('../db')
const { verifyToken } = require('../middleware')

const router = express.Router()

/**
 * Хеширование токена для безопасного хранения в БД
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Создать сессию при логине
 */
async function createSession(userId, token, req) {
  const tokenHash = hashToken(token)
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown'
  const userAgent = req.headers['user-agent'] || 'unknown'
  
  // JWT 8h = expires_at
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)

  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, ip, userAgent, expiresAt]
  )

  // Удаляем истёкшие сессии при каждом логине (очистка)
  await db.query(
    `DELETE FROM user_sessions WHERE expires_at < NOW() OR (is_active = false AND last_active_at < NOW() - INTERVAL '7 days')`
  )
}

/**
 * Обновить last_active_at сессии
 */
async function touchSession(token) {
  const tokenHash = hashToken(token)
  await db.query(
    `UPDATE user_sessions SET last_active_at = NOW() WHERE token_hash = $1 AND is_active = true`,
    [tokenHash]
  )
}

/**
 * Проверить, активна ли сессия
 */
async function isSessionValid(token) {
  const tokenHash = hashToken(token)
  const result = await db.query(
    `SELECT id FROM user_sessions WHERE token_hash = $1 AND is_active = true AND expires_at > NOW()`,
    [tokenHash]
  )
  return result.rows.length > 0
}

// GET /api/sessions — список сессий текущего пользователя
router.get('/', verifyToken, async (req, res) => {
  try {
    const currentTokenHash = hashToken(req.headers.authorization?.split(' ')[1] || '')
    
    const result = await db.query(
      `SELECT id, ip_address, user_agent, created_at, last_active_at, is_active,
              (token_hash = $2) AS is_current
       FROM user_sessions
       WHERE user_id = $1 AND (is_active = true OR last_active_at > NOW() - INTERVAL '7 days')
       ORDER BY is_active DESC, last_active_at DESC
       LIMIT 20`,
      [req.userId, currentTokenHash]
    )

    res.json({ sessions: result.rows })
  } catch (e) {
    console.error('Get sessions error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /api/sessions/:id — завершить конкретную сессию
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE user_sessions SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сессия не найдена' })
    }

    res.json({ ok: true })
  } catch (e) {
    console.error('Delete session error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /api/sessions — завершить все сессии кроме текущей
router.delete('/', verifyToken, async (req, res) => {
  try {
    const currentTokenHash = hashToken(req.headers.authorization?.split(' ')[1] || '')

    await db.query(
      `UPDATE user_sessions SET is_active = false WHERE user_id = $1 AND token_hash != $2 AND is_active = true`,
      [req.userId, currentTokenHash]
    )

    res.json({ ok: true })
  } catch (e) {
    console.error('Delete all sessions error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
module.exports.createSession = createSession
module.exports.touchSession = touchSession
module.exports.isSessionValid = isSessionValid
module.exports.hashToken = hashToken
