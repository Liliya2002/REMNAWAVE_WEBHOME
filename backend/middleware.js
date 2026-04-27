const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware для проверки JWT токена
 * Устанавливает req.userId и req.user
 */
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Middleware для проверки админ-прав
 * Требует предварительного вызова verifyToken
 */
async function verifyAdmin(req, res, next) {
  try {
    const result = await db.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Middleware для проверки active статуса пользователя
 * Требует предварительного вызова verifyToken
 * Также аакобновляет статус истекших подписок
 */
async function verifyActive(req, res, next) {
  try {
    // Автоматически деактивируем истекшие подписки для этого пользователя
    await db.query(
      `UPDATE subscriptions 
       SET is_active = false 
       WHERE user_id = $1 AND is_active = true AND expires_at <= NOW()`,
      [req.userId]
    )

    const result = await db.query(
      'SELECT is_active FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(403).json({ error: 'Your account is disabled' });
    }

    next();
  } catch (error) {
    console.error('Active verification error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  verifyToken,
  verifyAdmin,
  verifyActive,
  JWT_SECRET
};
