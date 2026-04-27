const db = require('../db');
const remnwaveService = require('./remnwave');
const referralService = require('./referral');
const { notifyPaymentSuccess } = require('./notifications');

/**
 * Activate subscription after successful payment
 * 
 * Логика:
 * 1. Ищем ЛЮБУЮ подписку пользователя (активную или истекшую) — через неё узнаём remnwave_user_uuid
 * 2. Если есть remnwave_user_uuid (пользователь был в Remnwave, например после пробника):
 *    → ОБНОВЛЯЕМ его в Remnwave (expire, traffic, squads, status=ACTIVE)
 *    → ОБНОВЛЯЕМ подписку в БД
 * 3. Если нет remnwave_user_uuid (пользователь никогда не активировал ни пробник, ни платный):
 *    → СОЗДАЁМ нового пользователя в Remnwave
 *    → СОЗДАЁМ подписку в БД
 */
async function activateSubscription(payment) {
  try {
    console.log('=== Activating subscription for payment:', payment.id, '===');

    // Get plan details
    const planResult = await db.query(
      'SELECT * FROM plans WHERE id = $1',
      [payment.plan_id]
    );

    if (planResult.rows.length === 0) {
      throw new Error('Plan not found');
    }

    const plan = planResult.rows[0];

    // Calculate subscription end date based on period
    let durationDays;
    switch (payment.period) {
      case 'monthly': durationDays = 30; break;
      case 'quarterly': durationDays = 90; break;
      case 'yearly': durationDays = 365; break;
      default: durationDays = 30;
    }

    // Get user details
    const userResult = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [payment.user_id]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];

    // ====== КЛЮЧЕВОЙ МОМЕНТ ======
    // Ищем ЛЮБУЮ последнюю подписку пользователя (и с UUID, и без — чтобы восстановить
    // потерянную связь). Берём самую свежую с приоритетом для активной.
    const anySubResult = await db.query(
      `SELECT * FROM subscriptions
       WHERE user_id = $1
       ORDER BY
         (CASE WHEN is_active AND expires_at > NOW() THEN 0 ELSE 1 END),
         COALESCE(expires_at, '1970-01-01'::timestamp) DESC,
         created_at DESC
       LIMIT 1`,
      [payment.user_id]
    );

    const existingSub = anySubResult.rows[0] || null;
    const existingSubId = existingSub?.id || null;
    let existingRemnwaveUuid = existingSub?.remnwave_user_uuid || null;

    // Если UUID в нашей БД нет — достанем юзера из Remnwave по его шаблонному username.
    // Это же позволит использовать его expireAt для суммирования остатка пробника.
    let remnwaveLookup = null;
    if (!existingRemnwaveUuid) {
      try {
        remnwaveLookup = await remnwaveService.getRemnwaveUserByUsername(`userweb_${payment.user_id}`);
        if (remnwaveLookup?.uuid) {
          existingRemnwaveUuid = remnwaveLookup.uuid;
          console.log(`Recovered Remnwave UUID by username: ${existingRemnwaveUuid} (expire=${remnwaveLookup.expireAt})`);
        }
      } catch (err) {
        console.error('Remnwave lookup by username failed:', err.message);
      }
    }

    console.log(`User ${payment.user_id}: existingRemnwaveUuid=${existingRemnwaveUuid}, existingSub=${existingSubId}, isActive=${existingSub?.is_active}`);

    const trafficLimitBytes = (plan.traffic_gb || 0) * 1024 * 1024 * 1024;
    const squadUuids = plan.squad_uuids || [];

    let subscriptionId;

    if (existingRemnwaveUuid) {
      // ====== СЦЕНАРИЙ 1: Пользователь уже есть в Remnwave (был пробник или предыдущая подписка) ======
      console.log(`Scenario: User EXISTS in Remnwave (${existingRemnwaveUuid}). Updating...`);

      // База для расчёта = максимум из:
      //  - expires_at из нашей БД (если подписка активна и не истекла)
      //  - expireAt из Remnwave (остатки пробника, если он там ещё не закончился)
      //  - сейчас
      // К этой базе прибавляем купленный период → "суммирование остатка с новым тарифом".
      const candidateDates = [new Date()];
      if (existingSub?.is_active && existingSub.expires_at) {
        const d = new Date(existingSub.expires_at);
        if (d > candidateDates[0]) candidateDates.push(d);
      }
      if (remnwaveLookup?.expireAt) {
        const d = new Date(remnwaveLookup.expireAt);
        if (d > candidateDates[0]) candidateDates.push(d);
      }
      const baseDate = new Date(Math.max(...candidateDates.map(d => d.getTime())));
      const newExpiresAt = new Date(baseDate);
      newExpiresAt.setDate(newExpiresAt.getDate() + durationDays);

      // Обновляем пользователя в Remnwave: expire, трафик, squads, статус ACTIVE
      let updatedRemnwaveUser = null;
      try {
        updatedRemnwaveUser = await remnwaveService.updateRemnwaveUser(existingRemnwaveUuid, {
          expireAt: newExpiresAt,
          trafficLimitBytes: trafficLimitBytes,
          status: 'ACTIVE',
          ...(squadUuids.length > 0 ? { activeInternalSquads: squadUuids } : {})
        });
        console.log(`Remnwave user ${existingRemnwaveUuid} updated: expires=${newExpiresAt.toISOString()}, traffic=${trafficLimitBytes}`);
      } catch (err) {
        console.error('Failed to update Remnwave user:', err.message);
        // Продолжаем — обновим хотя бы БД
      }

      // Данные для записи в БД: приоритет — свежий ответ Remnwave, затем lookup, затем существующая запись
      const rmSrc = updatedRemnwaveUser || remnwaveLookup || {};
      const remnwaveUsername = rmSrc.username || existingSub?.remnwave_username || `userweb_${payment.user_id}`;
      let subscriptionUrl = rmSrc.subscriptionUrl || existingSub?.subscription_url || null;
      if (!subscriptionUrl && rmSrc.shortUuid) {
        const baseUrl = process.env.REMNWAVE_API_URL || 'https://panel-root.guard-proxy.pro';
        subscriptionUrl = `${baseUrl}/api/sub/${rmSrc.shortUuid}`;
      }

      if (existingSubId) {
        // Восстанавливаем связи (UUID/username/url), если в БД их не было, и обновляем план/даты/трафик.
        // traffic_used_gb сбрасываем только при смене плана — продление того же тарифа сохраняет использование.
        const planChanged = existingSub?.plan_name !== plan.name;
        await db.query(
          `UPDATE subscriptions
           SET plan_name = $1,
               expires_at = $2,
               traffic_limit_gb = $3,
               traffic_used_gb = CASE WHEN $9::boolean THEN 0 ELSE traffic_used_gb END,
               is_active = true,
               squad_uuid = $4,
               remnwave_user_uuid = COALESCE(remnwave_user_uuid, $5),
               remnwave_username = COALESCE(remnwave_username, $6),
               subscription_url = COALESCE($7, subscription_url),
               updated_at = NOW()
           WHERE id = $8`,
          [plan.name, newExpiresAt, plan.traffic_gb || 0, squadUuids[0] || null,
           existingRemnwaveUuid, remnwaveUsername, subscriptionUrl, existingSubId, planChanged]
        );
        subscriptionId = existingSubId;
        console.log(`Updated existing subscription ${subscriptionId} in DB (planChanged=${planChanged})`);
      } else {
        // Нет записи в нашей БД (user был создан в Remnwave вне нашего flow) — создаём
        const subResult = await db.query(
          `INSERT INTO subscriptions (
            user_id, plan_name, remnwave_user_uuid, remnwave_username, subscription_url,
            expires_at, traffic_limit_gb, traffic_used_gb, squad_uuid, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, true)
          RETURNING id`,
          [payment.user_id, plan.name, existingRemnwaveUuid, remnwaveUsername,
           subscriptionUrl, newExpiresAt, plan.traffic_gb || 0, squadUuids[0] || null]
        );
        subscriptionId = subResult.rows[0].id;
        console.log(`Created new subscription ${subscriptionId} (existing Remnwave user)`);
      }

    } else {
      // ====== СЦЕНАРИЙ 2: Пользователь НЕ в Remnwave (никогда не активировал) ======
      console.log(`Scenario: User NOT in Remnwave. Creating new...`);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);
      const username = `userweb_${payment.user_id}`;

      let remnwaveUuid = null;
      let remnwaveUsername = username;
      let subscriptionUrl = null;

      if (squadUuids.length > 0) {
        let remnwaveUser = null;
        try {
          remnwaveUser = await remnwaveService.createRemnwaveUser({
            username: username,
            trafficLimitBytes: trafficLimitBytes,
            expireAt: expiresAt,
            activeInternalSquads: squadUuids
          });
        } catch (err) {
          // Типичный случай: "User username already exists" (A019) — юзер остался
          // от прошлого пробника, а связь в БД потерялась. Достаём его и обновляем.
          console.warn(`Remnwave create failed for ${username}: ${err.message}. Trying fetch-by-username fallback.`);
          try {
            const existing = await remnwaveService.getRemnwaveUserByUsername(username);
            if (existing?.uuid) {
              await remnwaveService.updateRemnwaveUser(existing.uuid, {
                expireAt: expiresAt,
                trafficLimitBytes: trafficLimitBytes,
                status: 'ACTIVE',
                activeInternalSquads: squadUuids
              });
              remnwaveUser = existing;
              console.log(`Recovered existing Remnwave user: uuid=${existing.uuid}`);
            }
          } catch (lookupErr) {
            console.error('Remnwave fallback lookup/update failed:', lookupErr.message);
          }
        }

        if (remnwaveUser) {
          remnwaveUuid = remnwaveUser.uuid || null;
          remnwaveUsername = remnwaveUser.username || username;
          subscriptionUrl = remnwaveUser.subscriptionUrl || null;

          if (!subscriptionUrl && remnwaveUser.shortUuid) {
            const baseUrl = process.env.REMNWAVE_API_URL || 'https://panel-root.guard-proxy.pro';
            subscriptionUrl = `${baseUrl}/api/sub/${remnwaveUser.shortUuid}`;
          }

          console.log(`Remnwave user ready: uuid=${remnwaveUuid}, url=${subscriptionUrl}`);
        }
      }

      // Создаём подписку в БД
      const subResult = await db.query(
        `INSERT INTO subscriptions (
          user_id, plan_name, remnwave_user_uuid, remnwave_username, subscription_url,
          expires_at, traffic_limit_gb, traffic_used_gb, squad_uuid, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, true)
        RETURNING id`,
        [payment.user_id, plan.name, remnwaveUuid, remnwaveUsername, subscriptionUrl,
         expiresAt, plan.traffic_gb || 0, squadUuids[0] || null]
      );
      subscriptionId = subResult.rows[0].id;
      console.log(`Created new subscription ${subscriptionId} with new Remnwave user`);
    }

    // Обновляем статус платежа
    await db.query(
      'UPDATE payments SET completed_at = NOW() WHERE id = $1',
      [payment.id]
    );

    // Process referral rewards
    try {
      const referralReward = await referralService.processPaymentReward(
        payment.id,
        payment.user_id,
        parseFloat(payment.amount)
      );
      if (referralReward) {
        console.log('Referral reward processed:', referralReward);
      }
    } catch (error) {
      console.error('Error processing referral reward:', error);
    }

    console.log('=== Subscription activated successfully ===');

    // Уведомление об успешной оплате
    notifyPaymentSuccess(payment.user_id, {
      planName: plan.name,
      amount: payment.amount,
      period: payment.period
    }).catch(err => console.error('Payment notification error:', err));

  } catch (error) {
    console.error('Subscription activation error:', error);
    throw error;
  }
}

/**
 * Expire old pending payments.
 * Marks payments as 'expired' if they've been pending past their expires_at,
 * or for more than 1 hour if expires_at is not set (legacy payments).
 */
async function expireOldPayments() {
  try {
    const result = await db.query(
      `UPDATE payments 
       SET status = 'expired'
       WHERE status = 'pending' 
         AND (
           (expires_at IS NOT NULL AND expires_at < NOW())
           OR
           (expires_at IS NULL AND created_at < NOW() - INTERVAL '1 hour')
         )
       RETURNING id`
    );
    if (result.rows.length > 0) {
      console.log(`[Payments] Expired ${result.rows.length} old pending payments: [${result.rows.map(r => r.id).join(', ')}]`);
    }
  } catch (err) {
    console.error('[Payments] Error expiring old payments:', err.message);
  }
}

// Run expiration check every 2 minutes
setInterval(expireOldPayments, 2 * 60 * 1000);
// Also run once on startup
expireOldPayments();

module.exports = {
  activateSubscription,
  expireOldPayments
};
