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
    const remnwaveUsernameSvc = require('./remnwaveUsername');
    // Резолвим стабильный username юзера (legacy userweb_<id> или новый userweb_<8 цифр>)
    const username = await remnwaveUsernameSvc.resolveUsernameForUser(payment.user_id, remnwaveService);
    const userMeta = await remnwaveUsernameSvc.getRemnwaveMetadata(payment.user_id);

    let remnwaveLookup = null;
    if (!existingRemnwaveUuid) {
      try {
        remnwaveLookup = await remnwaveService.getRemnwaveUserByUsername(username);
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

      // Обновляем пользователя в Remnwave: expire, трафик, squads, статус ACTIVE,
      // metadata (email/telegram) и лимит устройств
      let updatedRemnwaveUser = null;
      try {
        updatedRemnwaveUser = await remnwaveService.updateRemnwaveUser(existingRemnwaveUuid, {
          expireAt: newExpiresAt,
          trafficLimitBytes: trafficLimitBytes,
          status: 'ACTIVE',
          ...(squadUuids.length > 0 ? { activeInternalSquads: squadUuids } : {}),
          ...userMeta,
          ...(plan.hwid_device_limit != null ? { hwidDeviceLimit: Number(plan.hwid_device_limit) } : {}),
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
      // username взят выше через resolveUsernameForUser

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
            activeInternalSquads: squadUuids,
            ...userMeta,
            ...(plan.hwid_device_limit != null ? { hwidDeviceLimit: Number(plan.hwid_device_limit) } : {}),
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

// ─── Plan-change поток (upgrade/downgrade/swap) ──────────────────────────────

/**
 * Низкоуровневое применение смены тарифа: обновляет subscription + RemnaWave.
 * Сохраняет traffic_used (только обновляет лимит), не сбрасывает счётчик.
 *
 * @param {Object} args
 * @param {number} args.subscriptionId
 * @param {number} args.targetPlanId
 * @param {string} args.newExpiresAt  ISO date
 * @param {string} args.period
 * @param {number} args.amount
 */
async function applyPlanChange({ subscriptionId, targetPlanId, newExpiresAt, period, amount }) {
  const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1', [subscriptionId])
  const sub = subQ.rows[0]
  if (!sub) throw new Error('Subscription not found')

  const planQ = await db.query('SELECT * FROM plans WHERE id=$1', [targetPlanId])
  const plan = planQ.rows[0]
  if (!plan) throw new Error('Target plan not found')

  // 1. Обновляем подписку в нашей БД
  await db.query(
    `UPDATE subscriptions
       SET plan_id          = $1,
           plan_name        = $2,
           traffic_limit_gb = $3,
           squad_uuid       = $4,
           expires_at       = $5,
           is_active        = true,
           updated_at       = NOW()
       WHERE id = $6`,
    [
      plan.id,
      plan.name,
      plan.traffic_gb || 0,
      Array.isArray(plan.squad_uuids) ? (plan.squad_uuids[0] || null) : null,
      newExpiresAt,
      subscriptionId,
    ]
  )

  // 2. Обновляем юзера в RemnaWave: лимит трафика + сквады + дата
  if (sub.remnwave_user_uuid) {
    try {
      const trafficLimitBytes = (plan.traffic_gb || 0) * 1024 * 1024 * 1024
      const expireAtIso = new Date(newExpiresAt).toISOString()
      const activeInternalSquads = Array.isArray(plan.squad_uuids) ? plan.squad_uuids : []
      await remnwaveService.updateRemnwaveUser(sub.remnwave_user_uuid, {
        trafficLimitBytes,
        expireAt: expireAtIso,
        activeInternalSquads,
        status: 'ACTIVE',
        ...(plan.hwid_device_limit != null ? { hwidDeviceLimit: Number(plan.hwid_device_limit) } : {}),
      })
      console.log(`[planChange] RemnaWave updated for user ${sub.remnwave_user_uuid}: plan=${plan.name}, expires=${expireAtIso}`)
    } catch (err) {
      console.error('[planChange] RemnaWave update failed:', err.message)
      // Не валим всю операцию — БД уже обновлена. Админ может пересинхронизировать.
    }
  }

  return {
    subscriptionId,
    planId: plan.id,
    planName: plan.name,
    newExpiresAt,
    period,
    amount,
  }
}

/**
 * Оплата смены тарифа с баланса. Атомарная транзакция.
 */
async function payChangeFromBalance({ userId, subscriptionId, targetPlanId, amount, period, newExpiresAt, calc }) {
  if (amount <= 0) {
    // Бесплатно — без транзакции
    return applyPlanChange({ subscriptionId, targetPlanId, newExpiresAt, period, amount: 0 })
  }

  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Проверяем баланс с lock
    const wQ = await client.query('SELECT balance FROM user_wallets WHERE user_id=$1 FOR UPDATE', [userId])
    const balance = Number(wQ.rows[0]?.balance || 0)
    if (balance < amount) {
      throw new Error('Недостаточно средств')
    }

    // 2. Списываем
    const newBalance = +(balance - amount).toFixed(2)
    await client.query('UPDATE user_wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2', [newBalance, userId])

    // 3. Создаём payment (completed, source='balance', type='subscription_change')
    const payQ = await client.query(
      `INSERT INTO payments (user_id, plan_id, amount, currency, period, payment_provider, status,
                             payment_type, payment_source, completed_at)
       VALUES ($1, $2, $3, 'RUB', $4, 'wallet', 'completed', 'subscription_change', 'balance', NOW())
       RETURNING id`,
      [userId, targetPlanId, amount, period]
    )
    const paymentId = payQ.rows[0].id

    // 4. wallet_transaction
    const wtQ = await client.query(
      `INSERT INTO wallet_transactions
        (user_id, type, direction, amount, currency, balance_before, balance_after, reference_type, reference_id)
       VALUES ($1, 'purchase', 'out', $2, 'RUB', $3, $4, 'payment', $5)
       RETURNING id`,
      [userId, amount, balance, newBalance, paymentId]
    )
    await client.query('UPDATE payments SET wallet_transaction_id=$1 WHERE id=$2', [wtQ.rows[0].id, paymentId])

    await client.query('COMMIT')

    // 5. Применяем смену плана (вне транзакции — RemnaWave может тормозить)
    const result = await applyPlanChange({ subscriptionId, targetPlanId, newExpiresAt, period, amount })
    return { ...result, paymentId, balanceBefore: balance, balanceAfter: newBalance }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Создаёт pending-payment в Platega для смены тарифа.
 * После webhook completed → activateSubscriptionChange().
 */
async function createChangeGatewayPayment({ userId, subscriptionId, targetPlanId, amount, period, newExpiresAt, calc }) {
  // Используем тот же платёжный шлюз что и для обычных платежей.
  // Создаём payment row и инициируем Platega-транзакцию.
  const platega = require('./platega')
  const orderId = `change_${userId}_${subscriptionId}_${Date.now()}`

  const r = await db.query(
    `INSERT INTO payments
      (user_id, plan_id, amount, currency, period, payment_provider, status,
       payment_type, payment_source, expires_at, provider_metadata)
     VALUES ($1, $2, $3, 'RUB', $4, 'platega', 'pending', 'subscription_change', 'gateway',
             NOW() + INTERVAL '1 hour', $5)
     RETURNING id`,
    [userId, targetPlanId, amount, period, JSON.stringify({ subscriptionId, newExpiresAt, calc })]
  )
  const paymentId = r.rows[0].id

  try {
    const txn = await platega.createTransaction({
      orderId,
      amount,
      description: `Смена тарифа на ${calc?.targetPlan?.name || ''} (id ${targetPlanId})`,
      successUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success?id=${paymentId}`,
      failUrl:    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/failed?id=${paymentId}`,
    })
    await db.query(
      `UPDATE payments SET provider_payment_id=$1, payment_url=$2 WHERE id=$3`,
      [txn.transactionId, txn.redirectUrl, paymentId]
    )
    return { paymentId, paymentUrl: txn.redirectUrl, transactionId: txn.transactionId }
  } catch (err) {
    await db.query(`UPDATE payments SET status='failed' WHERE id=$1`, [paymentId])
    throw err
  }
}

/**
 * Применить смену тарифа после успешной оплаты gateway.
 * Вызывается из webhook (status=completed, payment_type='subscription_change').
 *
 * Метаданные о subscriptionId + newExpiresAt мы сохранили в payments.provider_metadata.
 */
/**
 * Применить покупку доп. squad-трафика после оплаты gateway.
 * Метаданные (subscription_id, squad_uuid, gb_amount) лежат в payments.provider_metadata.
 */
async function activateSquadTrafficTopup(payment) {
  const meta = typeof payment.provider_metadata === 'string'
    ? JSON.parse(payment.provider_metadata)
    : (payment.provider_metadata || {})
  if (!meta.subscription_id || !meta.squad_uuid || !meta.gb_amount) {
    console.error('[squadTopup] missing metadata for payment', payment.id)
    return
  }
  const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1', [meta.subscription_id])
  const sub = subQ.rows[0]
  if (!sub) return console.error('[squadTopup] subscription not found:', meta.subscription_id)

  const squadQuota = require('./squadQuota')
  return squadQuota.addExtraTraffic({
    subscription: sub,
    squadUuid: meta.squad_uuid,
    gbAmount: Number(meta.gb_amount),
    source: 'user_purchase',
    amountPaid: Number(payment.amount),
    paymentId: payment.id,
  })
}

async function activateSubscriptionChange(payment) {
  const meta = typeof payment.provider_metadata === 'string'
    ? JSON.parse(payment.provider_metadata)
    : (payment.provider_metadata || {})
  const subscriptionId = meta.subscriptionId
  const newExpiresAt   = meta.newExpiresAt
  if (!subscriptionId || !newExpiresAt) {
    console.error('[planChange] activateChange: missing metadata for payment', payment.id)
    return
  }
  return applyPlanChange({
    subscriptionId,
    targetPlanId: payment.plan_id,
    newExpiresAt,
    period: payment.period,
    amount: Number(payment.amount),
  })
}

module.exports = {
  activateSubscription,
  expireOldPayments,
  applyPlanChange,
  payChangeFromBalance,
  createChangeGatewayPayment,
  activateSubscriptionChange,
  activateSquadTrafficTopup,
};
