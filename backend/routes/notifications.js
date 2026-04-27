/**
 * Роуты уведомлений
 * GET  /api/notifications         — список уведомлений пользователя
 * GET  /api/notifications/unread  — количество непрочитанных
 * PUT  /api/notifications/:id/read — пометить как прочитанное
 * PUT  /api/notifications/read-all — пометить все как прочитанные
 * DELETE /api/notifications/:id    — удалить уведомление
 * 
 * POST /api/notifications/broadcast — (admin) рассылка всем/сегменту
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, verifyAdmin } = require('../middleware');
const { createBulkNotifications } = require('../services/notifications');

// =============================================
// ПОЛЬЗОВАТЕЛЬСКИЕ ЭНДПОИНТЫ
// =============================================

/**
 * GET /api/notifications
 * Получить уведомления текущего пользователя
 * Query: ?limit=20&offset=0&unread_only=false
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { limit = 30, offset = 0, unread_only = 'false' } = req.query;
    const limitNum = Math.min(parseInt(limit) || 30, 100);
    const offsetNum = parseInt(offset) || 0;

    let whereClause = 'WHERE user_id = $1';
    const params = [req.userId];

    if (unread_only === 'true') {
      whereClause += ' AND is_read = false';
    }

    const result = await db.query(
      `SELECT id, title, message, type, category, is_read, link, created_at
       FROM notifications
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offsetNum]
    );

    // Общее количество
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM notifications ${whereClause}`,
      params
    );

    res.json({
      notifications: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: limitNum,
      offset: offsetNum
    });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/notifications/unread
 * Количество непрочитанных уведомлений
 */
router.get('/unread', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('Error fetching unread count:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/notifications/read-all
 * Пометить все уведомления как прочитанные
 */
router.put('/read-all', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );
    res.json({ updated: result.rowCount });
  } catch (err) {
    console.error('Error marking all as read:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Пометить одно уведомление как прочитанное
 */
router.put('/:id/read', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error marking as read:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Удалить одно уведомление
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting notification:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================
// АДМИНСКИЕ ЭНДПОИНТЫ
// =============================================

/**
 * POST /api/notifications/broadcast
 * Отправить уведомление группе пользователей
 * Body: { title, message, type, target, link }
 * target: 'all' | 'active' | 'expiring' | 'new'
 */
router.post('/broadcast', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { title, message, type = 'info', target = 'all', link = null } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'title and message are required' });
    }

    // Определяем получателей
    let userQuery;
    switch (target) {
      case 'active':
        userQuery = 'SELECT id FROM users WHERE is_active = true';
        break;
      case 'expiring':
        // Пользователи у которых подписка истекает в ближайшие 7 дней
        userQuery = `SELECT DISTINCT u.id FROM users u
          JOIN subscriptions s ON s.user_id = u.id
          WHERE s.is_active = true AND s.expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`;
        break;
      case 'new':
        // Зарегистрировались за последние 30 дней
        userQuery = `SELECT id FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`;
        break;
      default: // 'all'
        userQuery = 'SELECT id FROM users';
    }

    const usersResult = await db.query(userQuery);
    const userIds = usersResult.rows.map(r => r.id);

    if (userIds.length === 0) {
      return res.status(400).json({ error: 'No users match the target criteria' });
    }

    // Создаём уведомления
    const count = await createBulkNotifications(userIds, { title, message, type, category: 'admin', link });

    // Логируем рассылку
    await db.query(
      `INSERT INTO admin_broadcasts (title, message, type, target, recipients_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [title, message, type, target, count, req.userId]
    );

    res.json({ success: true, recipients: count });
  } catch (err) {
    console.error('Error broadcasting notifications:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/notifications/broadcasts
 * Получить историю рассылок (admin)
 */
router.get('/broadcasts', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, u.email as created_by_email
       FROM admin_broadcasts b
       LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching broadcasts:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
