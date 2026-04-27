/**
 * Сервис уведомлений
 * Создание, отправка и управление уведомлениями пользователей
 */
const db = require('../db');

/**
 * Создать уведомление для одного пользователя
 * @param {number} userId
 * @param {object} opts - { title, message, type, category, link }
 */
async function createNotification(userId, { title, message = '', type = 'info', category = 'system', link = null }) {
  try {
    const result = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, category, link)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, title, message, type, category, link]
    );
    return result.rows[0];
  } catch (err) {
    console.error('Failed to create notification:', err);
    return null;
  }
}

/**
 * Создать уведомления для нескольких пользователей
 * @param {number[]} userIds
 * @param {object} opts - { title, message, type, category, link }
 */
async function createBulkNotifications(userIds, { title, message = '', type = 'info', category = 'admin', link = null }) {
  if (!userIds.length) return 0;

  try {
    // Генерируем VALUES для массовой вставки
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const uid of userIds) {
      values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})`);
      params.push(uid, title, message, type, category, link);
      paramIdx += 6;
    }

    const result = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, category, link)
       VALUES ${values.join(', ')}`,
      params
    );

    return result.rowCount;
  } catch (err) {
    console.error('Failed to create bulk notifications:', err);
    return 0;
  }
}

/**
 * Уведомление об успешной оплате
 */
async function notifyPaymentSuccess(userId, { planName, amount, period }) {
  const periodNames = { monthly: 'месяц', quarterly: '3 месяца', yearly: 'год' };
  return createNotification(userId, {
    title: 'Оплата прошла успешно',
    message: `Тариф «${planName}» на ${periodNames[period] || period} оплачен (${amount} ₽)`,
    type: 'success',
    category: 'payment',
    link: '/dashboard'
  });
}

/**
 * Уведомление о неудачной оплате
 */
async function notifyPaymentFailed(userId, { planName, reason }) {
  return createNotification(userId, {
    title: 'Ошибка оплаты',
    message: `Не удалось оплатить тариф «${planName}»${reason ? ': ' + reason : ''}`,
    type: 'error',
    category: 'payment',
    link: '/pricing'
  });
}

/**
 * Уведомление о скором истечении подписки
 */
async function notifySubscriptionExpiring(userId, { planName, daysLeft }) {
  return createNotification(userId, {
    title: 'Подписка скоро истечёт',
    message: `Тариф «${planName}» истекает через ${daysLeft} ${getDaysWord(daysLeft)}. Продлите, чтобы не потерять доступ.`,
    type: 'warning',
    category: 'subscription',
    link: '/pricing'
  });
}

/**
 * Уведомление об истечении подписки
 */
async function notifySubscriptionExpired(userId, { planName }) {
  return createNotification(userId, {
    title: 'Подписка истекла',
    message: `Тариф «${planName}» истёк. Оформите новую подписку для продолжения.`,
    type: 'error',
    category: 'subscription',
    link: '/pricing'
  });
}

/**
 * Уведомление о реферальном бонусе
 */
async function notifyReferralBonus(userId, { bonusDays, referredEmail }) {
  const masked = referredEmail ? referredEmail.replace(/(.{2}).+(@.+)/, '$1***$2') : 'новый пользователь';
  return createNotification(userId, {
    title: 'Реферальный бонус',
    message: `Вы получили +${bonusDays} ${getDaysWord(bonusDays)} за приглашение (${masked})`,
    type: 'success',
    category: 'referral',
    link: '/dashboard'
  });
}

/**
 * Уведомление о новом сервере
 */
async function notifyNewServer(userId, { country, city }) {
  return createNotification(userId, {
    title: 'Новый сервер доступен',
    message: `Добавлен сервер в ${country}${city ? ', ' + city : ''}`,
    type: 'info',
    category: 'server',
    link: '/servers'
  });
}

/**
 * Приветственное уведомление
 */
async function notifyWelcome(userId) {
  return createNotification(userId, {
    title: 'Добро пожаловать!',
    message: 'Ваш аккаунт создан. Выберите тариф и начните пользоваться VPN.',
    type: 'info',
    category: 'system',
    link: '/pricing'
  });
}

// Склонение слова "день"
function getDaysWord(n) {
  const abs = Math.abs(n);
  if (abs % 100 >= 11 && abs % 100 <= 19) return 'дней';
  const last = abs % 10;
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}

module.exports = {
  createNotification,
  createBulkNotifications,
  notifyPaymentSuccess,
  notifyPaymentFailed,
  notifySubscriptionExpiring,
  notifySubscriptionExpired,
  notifyReferralBonus,
  notifyNewServer,
  notifyWelcome
};
