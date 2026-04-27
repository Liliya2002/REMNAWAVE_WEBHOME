const express = require('express');
const router = express.Router();
const db = require('../db');
const referralService = require('../services/referral');
const { verifyToken, verifyAdmin } = require('../middleware');

/**
 * GET /api/referrals/link
 * Получить реферальную ссылку текущего пользователя
 */
router.get('/link', verifyToken, async (req, res) => {
  try {
    let referralLink = await referralService.getReferralLink(req.userId);

    if (!referralLink) {
      referralLink = await referralService.createReferralLink(req.userId);
    }

    const refUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/register?ref=${referralLink.code}`;

    res.json({
      code: referralLink.code,
      url: refUrl
    });
  } catch (error) {
    console.error('Error getting referral link:', error);
    res.status(500).json({ error: 'Failed to get referral link' });
  }
});

/**
 * GET /api/referrals/stats
 * Получить статистику рефералов текущего пользователя
 */
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const stats = await referralService.getUserReferralStats(req.userId);
    res.json(stats);
  } catch (error) {
    console.error('Error getting referral stats:', error);
    res.status(500).json({ error: 'Failed to get referral stats' });
  }
});

/**
 * GET /api/referrals/config
 * Получить конфигурацию реферальной программы (публичная информация)
 */
router.get('/config', async (req, res) => {
  try {
    const config = await referralService.getReferralConfig();

    // Возвращаем только публичную информацию
    res.json({
      enabled: config.active,
      bonusEnabled: config.referral_bonus_enabled,
      bonusDaysOnSignup: parseFloat(config.referral_bonus_days_on_signup),
      bonusDaysOnFirstPayment: parseFloat(config.referral_bonus_days_on_first_payment),
      firstPaymentRewardPercent: parseFloat(config.first_payment_reward_percent),
      subsequentPaymentRewardPercent: parseFloat(config.subsequent_payment_reward_percent)
    });
  } catch (error) {
    console.error('Error getting referral config:', error);
    res.status(500).json({ error: 'Failed to get referral config' });
  }
});

/**
 * PUT /api/referrals/config
 * Обновить конфигурацию реферальной программы (только админы)
 */
router.put('/config', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const {
      first_payment_reward_percent,
      subsequent_payment_reward_percent,
      referral_bonus_enabled,
      referral_bonus_days_on_signup,
      referral_bonus_days_on_first_payment,
      referral_bonus_days_on_subsequent,
      min_payment_for_reward,
      max_monthly_reward
    } = req.body;

    // Валидация значений
    if (first_payment_reward_percent !== undefined && (first_payment_reward_percent < 0 || first_payment_reward_percent > 100)) {
      return res.status(400).json({ error: 'first_payment_reward_percent must be between 0 and 100' });
    }

    if (subsequent_payment_reward_percent !== undefined && (subsequent_payment_reward_percent < 0 || subsequent_payment_reward_percent > 100)) {
      return res.status(400).json({ error: 'subsequent_payment_reward_percent must be between 0 and 100' });
    }

    const updated = await referralService.updateReferralConfig({
      first_payment_reward_percent,
      subsequent_payment_reward_percent,
      referral_bonus_enabled,
      referral_bonus_days_on_signup,
      referral_bonus_days_on_first_payment,
      referral_bonus_days_on_subsequent,
      min_payment_for_reward,
      max_monthly_reward
    });

    res.json({
      success: true,
      config: updated
    });
  } catch (error) {
    console.error('Error updating referral config:', error);
    res.status(500).json({ error: 'Failed to update referral config' });
  }
});

/**
 * GET /api/referrals/top
 * Получить топ рефереров (публичный рейтинг)
 */
router.get('/top', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const result = await db.query(
      `SELECT 
       u.id, u.login,
       COUNT(DISTINCT r.id) as referrals_count,
       COALESCE(SUM(r.total_earned), 0) as total_earned,
       COALESCE(SUM(r.total_bonus_days_earned), 0) as total_bonus_days,
       MAX(r.created_at) as last_referral_date
       FROM referrals r
       JOIN users u ON r.referrer_id = u.id
       WHERE r.status = 'active'
       GROUP BY u.id, u.login
       ORDER BY referrals_count DESC
       LIMIT $1`,
      [limit]
    );

    res.json({
      referrers: result.rows
    });
  } catch (error) {
    console.error('Error getting top referrers:', error);
    res.status(500).json({ error: 'Failed to get top referrers' });
  }
});

/**
 * POST /api/referrals/migrate
 * Миграция реферальной программы для существующих пользователей (только для администратора)
 * Генерирует реферальные ссылки для всех пользователей, у которых их еще нет
 */
router.post('/migrate', verifyToken, verifyAdmin, async (req, res) => {
  try {
    // Функция для генерации уникального кода
    const generateCode = async () => {
      let code;
      let exists = true;
      while (exists) {
        code = 'ref_' + Math.random().toString(36).substring(2, 10);
        const result = await db.query(
          'SELECT id FROM referral_links WHERE code = $1',
          [code]
        );
        exists = result.rows.length > 0;
      }
      return code;
    };

    // Получить всех пользователей без реферальных ссылок
    const usersWithoutLinks = await db.query(
      `SELECT u.id FROM users u
       WHERE u.is_active = TRUE
       AND NOT EXISTS (SELECT 1 FROM referral_links WHERE user_id = u.id)`,
      []
    );

    let createdCount = 0;
    const failedUsers = [];

    // Для каждого пользователя создать реферальную ссылку
    for (const user of usersWithoutLinks.rows) {
      try {
        const code = await generateCode();
        await db.query(
          `INSERT INTO referral_links (user_id, code, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())`,
          [user.id, code]
        );
        createdCount++;
      } catch (error) {
        console.error(`Failed to create referral link for user ${user.id}:`, error);
        failedUsers.push(user.id);
      }
    }

    // Также создать записи в месячной статистике для новых пользователей
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      await db.query(
        `INSERT INTO referral_monthly_stats (user_id, year, month, referral_bonuses, referral_count, updated_at)
         SELECT u.id, $1, $2, 0, 0, NOW()
         FROM users u
         WHERE u.is_active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM referral_monthly_stats 
           WHERE user_id = u.id AND year = $1 AND month = $2
         )`,
        [year, month]
      );
    } catch (error) {
      console.error('Error creating monthly stats:', error);
    }

    res.json({
      success: true,
      message: `Migration completed. Created ${createdCount} referral links.`,
      created: createdCount,
      failed: failedUsers.length,
      failedUsers: failedUsers.length > 0 ? failedUsers : undefined
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: 'Migration failed', details: error.message });
  }
});

module.exports = router;
