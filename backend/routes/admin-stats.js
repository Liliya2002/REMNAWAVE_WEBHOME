const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, verifyAdmin } = require('../middleware');

/**
 * GET /api/admin/stats
 * Получить основную статистику для админ-панели
 */
router.get('/', verifyToken, verifyAdmin, async (req, res) => {
  try {
    // Количество пользователей
    const usersResult = await db.query('SELECT COUNT(*) as count FROM users WHERE is_active = TRUE');
    const totalUsers = parseInt(usersResult.rows[0].count);

    // Количество активных подписок
    const subsResult = await db.query(
      'SELECT COUNT(*) as count FROM subscriptions WHERE is_active = TRUE AND expires_at > NOW()'
    );
    const activeSubscriptions = parseInt(subsResult.rows[0].count);

    // Платежная статистика: деньги считаем только по completed.
    const paymentsResult = await db.query(
      `SELECT
              COUNT(*) as total_attempts,
              COUNT(*) FILTER (WHERE status = 'completed') as completed,
              COUNT(*) FILTER (WHERE status <> 'completed') as unpaid,
              COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) as total_amount
       FROM payments`
    );
    const totalPayments = parseInt(paymentsResult.rows[0].total_attempts);
    const completedPayments = parseInt(paymentsResult.rows[0].completed);
    const unpaidPayments = parseInt(paymentsResult.rows[0].unpaid);
    const totalAmount = parseFloat(paymentsResult.rows[0].total_amount) || 0;

    // Доход за последний месяц
    const monthlyResult = await db.query(
      `SELECT SUM(amount) as total FROM payments 
       WHERE status = 'completed' 
       AND created_at >= NOW() - INTERVAL '1 month'`
    );
    const monthlyRevenue = parseFloat(monthlyResult.rows[0].total) || 0;

    // Зарегистрировано за последний месяц
    const newUsersResult = await db.query(
      `SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '1 month'`
    );
    const newUsersThisMonth = parseInt(newUsersResult.rows[0].count);

    // Средняя цена подписки
    const avgPriceResult = await db.query(
      `SELECT AVG(amount) as avg_price FROM payments WHERE status = 'completed'`
    );
    const avgSubscriptionPrice = parseFloat(avgPriceResult.rows[0].avg_price) || 0;

    // Юзеров без подтверждённого email
    const unconfirmedR = await db.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE email_confirmed = false AND is_active = true`
    );
    const unconfirmedEmails = unconfirmedR.rows[0].n || 0;

    const payload = {
      totalUsers,
      activeSubscriptions,
      totalPayments,
      completedPayments,
      unpaidPayments,
      totalAmount,
      monthlyRevenue,
      newUsersThisMonth,
      avgSubscriptionPrice,
      unconfirmedEmails,
    }

    // Поддерживаем одновременно старый и новый формат ответа.
    res.json({
      ...payload,
      stats: payload
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * GET /api/admin/stats/chart
 * Получить данные для графиков (подписки/платежи за период)
 * Query params: period=week/month/year, metric=subscriptions/revenue
 */
router.get('/chart', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const metric = req.query.metric || 'revenue';

    let dateFormat = 'YYYY-MM-DD';
    let daysBack = 30;

    if (period === 'week') {
      daysBack = 7;
      dateFormat = 'YYYY-MM-DD';
    } else if (period === 'year') {
      dateFormat = 'YYYY-WW';
      daysBack = 365;
    }

    let query, label;

    if (metric === 'revenue') {
      query = {
        text: `
          SELECT TO_CHAR(created_at, $1) as date, 
                 SUM(amount) as value,
                 COUNT(*) as count
          FROM payments 
          WHERE status = 'completed' 
          AND created_at >= NOW() - MAKE_INTERVAL(days := $2)
          GROUP BY TO_CHAR(created_at, $1)
          ORDER BY date ASC
        `,
        values: [dateFormat, daysBack]
      };
      label = 'Revenue (₽)';
    } else {
      query = {
        text: `
          SELECT TO_CHAR(created_at, $1) as date,
                 COUNT(*) as value
          FROM subscriptions 
          WHERE created_at >= NOW() - MAKE_INTERVAL(days := $2)
          GROUP BY TO_CHAR(created_at, $1)
          ORDER BY date ASC
        `,
        values: [dateFormat, daysBack]
      };
      label = 'New Subscriptions';
    }

    const result = await db.query(query.text, query.values);
    const data = result.rows.map(row => ({
      date: row.date,
      value: metric === 'revenue' ? parseFloat(row.value || 0) : parseInt(row.value || 0),
      count: parseInt(row.count || 0)
    }));

    // Для совместимости отдаем и массив в корне, и метаданные.
    res.json({
      data,
      items: data,
      label,
      period,
      metric
    });
  } catch (error) {
    console.error('Error getting chart data:', error);
    res.status(500).json({ error: 'Failed to get chart data' });
  }
});

/**
 * GET /api/admin/stats/referrals
 * Получить статистику по рефералам
 */
router.get('/referrals', verifyToken, verifyAdmin, async (req, res) => {
  try {
    // Топ рефереров
    const topReferrersResult = await db.query(
      `SELECT 
        u.id,
        u.login as referrer_login,
        u.email as referrer_email,
        COUNT(DISTINCT r.id) as count,
        COALESCE(SUM(r.total_earned), 0) as total_earned,
        COALESCE(SUM(r.total_bonus_days_earned), 0) as bonus_days
       FROM referrals r
       JOIN users u ON r.referrer_id = u.id
       WHERE r.status = 'active'
       GROUP BY u.id, u.login, u.email
       ORDER BY count DESC
       LIMIT 10`
    );

    // Общая статистика рефералов
    const statsResult = await db.query(
      `SELECT 
        COUNT(DISTINCT referrer_id) as active_referrers,
        COUNT(*) as total_referrals,
        COALESCE(AVG(total_earned), 0) as avg_earned_per_referral,
        COALESCE(SUM(total_earned), 0) as total_earned_distributed
       FROM referrals WHERE status = 'active'`
    );

    const referralStats = {
      activeReferrers: parseInt(statsResult.rows[0].active_referrers),
      totalReferrals: parseInt(statsResult.rows[0].total_referrals),
      avgEarnedPerReferral: parseFloat(statsResult.rows[0].avg_earned_per_referral),
      totalEarnedDistributed: parseFloat(statsResult.rows[0].total_earned_distributed)
    }

    const totalBonusDays = topReferrersResult.rows.reduce((sum, row) => sum + (parseFloat(row.bonus_days) || 0), 0)

    // Совместимость: оставляем stats и добавляем плоские поля для существующего UI.
    res.json({
      topReferrers: topReferrersResult.rows,
      stats: referralStats,
      totalReferrals: referralStats.totalReferrals,
      uniqueReferrers: referralStats.activeReferrers,
      totalBonusDays
    });
  } catch (error) {
    console.error('Error getting referral stats:', error);
    res.status(500).json({ error: 'Failed to get referral statistics' });
  }
});

module.exports = router;
