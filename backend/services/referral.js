const db = require('../db');
const crypto = require('crypto');

/**
 * Генерирует уникальный реферальный код
 */
function generateReferralCode() {
  return 'ref_' + crypto.randomBytes(8).toString('hex').substring(0, 12);
}

/**
 * Создает реферальную ссылку для пользователя
 */
async function createReferralLink(userId) {
  try {
    // Проверяем, есть ли уже реферальная ссылка
    const existing = await db.query(
      'SELECT id, code FROM referral_links WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    const code = generateReferralCode();
    const result = await db.query(
      'INSERT INTO referral_links (user_id, code) VALUES ($1, $2) RETURNING id, code',
      [userId, code]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Error creating referral link:', error);
    throw error;
  }
}

/**
 * Получает реферальную ссылку пользователя
 */
async function getReferralLink(userId) {
  try {
    const result = await db.query(
      'SELECT id, code, created_at FROM referral_links WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error getting referral link:', error);
    throw error;
  }
}

/**
 * Получает пользователя по реферальному коду
 */
async function getUserByReferralCode(code) {
  try {
    const result = await db.query(
      'SELECT user_id FROM referral_links WHERE code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].user_id;
  } catch (error) {
    console.error('Error getting user by referral code:', error);
    throw error;
  }
}

/**
 * Записывает реферала (связывает пригласившего и приглашенного)
 */
async function createReferral(referrerId, referredUserId, referralCode) {
  try {
    const result = await db.query(
      `INSERT INTO referrals (referrer_id, referred_user_id, referral_code, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (referred_user_id) DO UPDATE SET status = 'active'
       RETURNING id`,
      [referrerId, referredUserId, referralCode]
    );

    return result.rows[0].id;
  } catch (error) {
    console.error('Error creating referral:', error);
    throw error;
  }
}

/**
 * Получает конфигурацию реферальной программы
 */
async function getReferralConfig() {
  try {
    const result = await db.query('SELECT * FROM referral_config LIMIT 1');

    if (result.rows.length === 0) {
      throw new Error('Referral config not found');
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error getting referral config:', error);
    throw error;
  }
}

/**
 * Обновляет конфигурацию реферальной программы (только для админов)
 */
async function updateReferralConfig(updates) {
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
    } = updates;

    const result = await db.query(
      `UPDATE referral_config SET
       first_payment_reward_percent = COALESCE($1, first_payment_reward_percent),
       subsequent_payment_reward_percent = COALESCE($2, subsequent_payment_reward_percent),
       referral_bonus_enabled = COALESCE($3, referral_bonus_enabled),
       referral_bonus_days_on_signup = COALESCE($4, referral_bonus_days_on_signup),
       referral_bonus_days_on_first_payment = COALESCE($5, referral_bonus_days_on_first_payment),
       referral_bonus_days_on_subsequent = COALESCE($6, referral_bonus_days_on_subsequent),
       min_payment_for_reward = COALESCE($7, min_payment_for_reward),
       max_monthly_reward = COALESCE($8, max_monthly_reward)
       WHERE id = 1
       RETURNING *`,
      [
        first_payment_reward_percent,
        subsequent_payment_reward_percent,
        referral_bonus_enabled,
        referral_bonus_days_on_signup,
        referral_bonus_days_on_first_payment,
        referral_bonus_days_on_subsequent,
        min_payment_for_reward,
        max_monthly_reward
      ]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Error updating referral config:', error);
    throw error;
  }
}

/**
 * Обрабатывает вознаграждение при регистрации по реферальной ссылке
 */
async function processSignupBonus(referrerId, referredUserId) {
  try {
    const config = await getReferralConfig();

    if (!config.referral_bonus_enabled) {
      return null;
    }

    // Создаем награду за регистрацию
    const rewardResult = await db.query(
      `INSERT INTO referral_rewards (
        referrer_id, referral_id, reward_type, bonus_days_earned, status, credited_at
      ) 
      SELECT $1, referrals.id, 'signup_bonus', $2, 'credited', NOW()
      FROM referrals WHERE referrer_id = $1 AND referred_user_id = $3
      RETURNING id, bonus_days_earned`,
      [referrerId, config.referral_bonus_days_on_signup, referredUserId]
    );

    if (rewardResult.rows.length === 0) {
      return null;
    }

    // Обновляем статистику реферала
    await db.query(
      `UPDATE referrals 
       SET total_bonus_days_earned = total_bonus_days_earned + $1
       WHERE referrer_id = $2 AND referred_user_id = $3`,
      [config.referral_bonus_days_on_signup, referrerId, referredUserId]
    );

    // Выдаем дни подписки пригласившему
    await addSubscriptionDays(referrerId, config.referral_bonus_days_on_signup, 'signup_bonus');

    return {
      type: 'signup_bonus',
      days: config.referral_bonus_days_on_signup
    };
  } catch (error) {
    console.error('Error processing signup bonus:', error);
    throw error;
  }
}

/**
 * Обрабатывает вознаграждение при пополнении реферала
 */
async function processPaymentReward(paymentId, referredUserId, paymentAmount) {
  try {
    const config = await getReferralConfig();

    // Находим реферала
    const referralResult = await db.query(
      `SELECT * FROM referrals WHERE referred_user_id = $1 AND status = 'active'`,
      [referredUserId]
    );

    if (referralResult.rows.length === 0) {
      return null;
    }

    const referral = referralResult.rows[0];
    const referrerId = referral.referrer_id;

    // Проверяем минимальную сумму платежа
    if (paymentAmount < config.min_payment_for_reward) {
      return null;
    }

    let rewardType, rewardAmount, bonusDays;

    if (referral.payments_count === 0) {
      // Первое пополнение реферала
      rewardType = 'first_payment';
      rewardAmount = (paymentAmount * config.first_payment_reward_percent) / 100;
      bonusDays = config.referral_bonus_days_on_first_payment;

      // Обновляем информацию о первом пополнении
      await db.query(
        `UPDATE referrals 
         SET first_payment_id = $1, first_payment_completed_at = NOW(), payments_count = 1
         WHERE id = $2`,
        [paymentId, referral.id]
      );
    } else {
      // Последующие пополнения
      rewardType = 'subsequent_payment';
      rewardAmount = (paymentAmount * config.subsequent_payment_reward_percent) / 100;
      bonusDays = config.referral_bonus_days_on_subsequent;

      await db.query(
        `UPDATE referrals 
         SET payments_count = payments_count + 1
         WHERE id = $1`,
        [referral.id]
      );
    }

    // Проверяем месячный лимит вознаграждений
    const currentMonth = new Date();
    currentMonth.setDate(1);

    const monthlyResult = await db.query(
      `SELECT total_earned FROM referral_monthly_stats 
       WHERE referrer_id = $1 AND month = $2`,
      [referrerId, currentMonth]
    );

    const monthlyEarned = monthlyResult.rows.length > 0 ? monthlyResult.rows[0].total_earned : 0;

    if (monthlyEarned + rewardAmount > config.max_monthly_reward) {
      rewardAmount = Math.max(0, config.max_monthly_reward - monthlyEarned);
    }

    // Создаем запись о награде
    const rewardResult = await db.query(
      `INSERT INTO referral_rewards (
        referrer_id, referral_id, payment_id, reward_type, amount_earned, bonus_days_earned, status, credited_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'credited', NOW())
      RETURNING id`,
      [referrerId, referral.id, paymentId, rewardType, rewardAmount, bonusDays]
    );

    // Обновляем статистику реферала
    await db.query(
      `UPDATE referrals 
       SET total_earned = total_earned + $1, 
           total_bonus_days_earned = total_bonus_days_earned + $2,
           total_referred_amount = total_referred_amount + $3
       WHERE id = $4`,
      [rewardAmount, bonusDays, paymentAmount, referral.id]
    );

    // Добавляем дни к подписке
    if (config.referral_bonus_enabled && bonusDays > 0) {
      await addSubscriptionDays(referrerId, bonusDays, rewardType);
    }

    // Обновляем месячную статистику
    await updateMonthlyStats(referrerId);

    return {
      type: rewardType,
      amount: rewardAmount,
      days: bonusDays
    };
  } catch (error) {
    console.error('Error processing payment reward:', error);
    throw error;
  }
}

/**
 * Добавляет бонусные дни в накопитель пользователя (pending_bonus_days).
 * Пользователь сам решает когда применить их к подписке через /api/subscriptions/apply-bonus.
 */
async function addSubscriptionDays(userId, days, source = 'referral') {
  try {
    await db.query(
      `UPDATE users SET pending_bonus_days = pending_bonus_days + $1 WHERE id = $2`,
      [days, userId]
    );
    console.log(`[Referral] Added ${days} pending bonus days to user ${userId} (source: ${source})`);
  } catch (error) {
    console.error('Error adding pending bonus days:', error);
    // Не прерываем процесс
  }
}

/**
 * Обновляет месячную статистику рефералов
 */
async function updateMonthlyStats(referrerId) {
  try {
    const currentMonth = new Date();
    currentMonth.setDate(1);

    const result = await db.query(
      `SELECT COUNT(*) as referrals_count, COALESCE(SUM(total_earned), 0) as total_earned, COALESCE(SUM(total_bonus_days_earned), 0) as bonus_days
       FROM referrals WHERE referrer_id = $1 AND status = 'active'`,
      [referrerId]
    );

    const stats = result.rows[0];

    await db.query(
      `INSERT INTO referral_monthly_stats (referrer_id, month, referrals_count, total_earned, bonus_days_earned)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (referrer_id, month) 
       DO UPDATE SET referrals_count = $3, total_earned = $4, bonus_days_earned = $5`,
      [referrerId, currentMonth, stats.referrals_count, stats.total_earned, stats.bonus_days]
    );
  } catch (error) {
    console.error('Error updating monthly stats:', error);
  }
}

/**
 * Получает статистику рефералов пользователя
 */
async function getUserReferralStats(userId) {
  try {
    // Количество активных рефералов
    const referralsResult = await db.query(
      `SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1 AND status = 'active'`,
      [userId]
    );

    // Общий заработанный доход
    const earningsResult = await db.query(
      `SELECT 
       COALESCE(SUM(total_earned), 0) as total_earned,
       COALESCE(SUM(total_bonus_days_earned), 0) as total_bonus_days
       FROM referrals WHERE referrer_id = $1`,
      [userId]
    );

    // Рефералы с деталями
    const referralsDetailResult = await db.query(
      `SELECT 
       r.id, r.referred_user_id, r.payments_count, r.total_earned, r.total_bonus_days_earned,
       r.first_payment_completed_at, r.created_at,
       u.login, u.email
       FROM referrals r
       JOIN users u ON r.referred_user_id = u.id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );

    // Последние награды
    const rewardsResult = await db.query(
      `SELECT r.*, rr.reward_type, rr.amount_earned, rr.bonus_days_earned, rr.created_at
       FROM referral_rewards rr
       JOIN referrals r ON rr.referral_id = r.id
       WHERE rr.referrer_id = $1
       ORDER BY rr.created_at DESC
       LIMIT 10`,
      [userId]
    );

    return {
      activeReferrals: parseInt(referralsResult.rows[0].count),
      totalEarned: parseFloat(earningsResult.rows[0].total_earned),
      totalBonusDays: parseFloat(earningsResult.rows[0].total_bonus_days),
      referralsList: referralsDetailResult.rows,
      recentRewards: rewardsResult.rows
    };
  } catch (error) {
    console.error('Error getting user referral stats:', error);
    throw error;
  }
}

/**
 * Получает реферала по ID
 */
async function getReferralById(referralId) {
  try {
    const result = await db.query(
      `SELECT * FROM referrals WHERE id = $1`,
      [referralId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error getting referral:', error);
    throw error;
  }
}

module.exports = {
  generateReferralCode,
  createReferralLink,
  getReferralLink,
  getUserByReferralCode,
  createReferral,
  getReferralConfig,
  updateReferralConfig,
  processSignupBonus,
  processPaymentReward,
  addSubscriptionDays,
  updateMonthlyStats,
  getUserReferralStats,
  getReferralById
};
