const express = require('express');
const router = express.Router();
const db = require('../db');
const { createPayment, verifyWebhookSignature } = require('../services/platega');
const { verifyToken, verifyActive } = require('../middleware');
const { activateSubscription, activateSubscriptionChange, activateSquadTrafficTopup } = require('../services/payment');
// Кошелёк живёт в services/wallet.js: промокоды начисляют на него деньги, а
// этот роут вызывает промокоды — держать помощники здесь означало бы цикл
// services → routes → services.
const { ensureWalletSchema, getOrCreateWallet, addWalletTransaction } = require('../services/wallet');
const { getPlanAndAmount, PERIOD_LABELS, MIN_GATEWAY_AMOUNT } = require('../services/pricing');
const promoService = require('../services/promoCodes');

const pgPool = db.pool;

const TOPUP_MIN = 10;
const TOPUP_MAX = 100000;

function getPeriodDays(period) {
  switch (period) {
    case 'monthly': return 30;
    case 'quarterly': return 90;
    case 'yearly': return 365;
    default: return 30;
  }
}



/**
 * POST /api/payments/create
 * Create new payment for a plan
 * Body: { plan_id, period } - period: 'monthly', 'quarterly', 'yearly'
 */
router.post('/create', verifyToken, verifyActive, async (req, res) => {
  try {
    await ensureWalletSchema();

    const { plan_id, period, promo_code } = req.body;
    const userId = req.userId;

    // Validate input
    if (!plan_id || !period) {
      return res.status(400).json({ error: 'plan_id and period are required' });
    }

    if (!['monthly', 'quarterly', 'yearly'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Must be monthly, quarterly, or yearly' });
    }

    const { plan, amount: fullAmount } = await getPlanAndAmount(plan_id, period);

    const userResult = await db.query('SELECT email, login FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // ── Промокод, создание платежа и резерв — одной транзакцией ─────────────
    //
    // Код берётся под FOR UPDATE (validate с forUpdate) и держится до COMMIT:
    // иначе два параллельных запроса с последней активацией пройдут оба.
    //
    // Обращение к платёжке вынесено ЗА транзакцию: сетевой вызов под открытой
    // блокировкой держал бы и соединение из пула, и строку промокода всё
    // время ответа шлюза.
    let paymentId, amount, promoInfo = null;
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      amount = fullAmount;
      let promo = null, discount = 0;

      if (promo_code) {
        const check = await promoService.validate(promo_code, {
          userId, planId: plan_id, period, amount: fullAmount,
          client, forUpdate: true, allowTypes: promoService.DISCOUNT_TYPES,
        });
        if (!check.ok) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: check.message, reason: check.reason });
        }
        promo = check.promo;
        discount = check.discount;
        amount = check.finalAmount;
      }

      // Скидка может увести заказ ниже порога шлюза. Ноль обрабатывается
      // отдельной ветвью ниже, а «больше нуля, но меньше минимума» шлюз просто
      // отклонит — честнее сказать это сразу и предложить оплату с баланса.
      if (amount > 0 && amount < MIN_GATEWAY_AMOUNT) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Со скидкой к оплате ${amount} ₽ — это меньше минимума платёжной системы (${MIN_GATEWAY_AMOUNT} ₽). Оплатите с баланса.`,
          reason: 'below_gateway_minimum',
          amount,
        });
      }

      // В payments.amount пишем сумму СО скидкой: именно её сверяет вебхук
      // платёжки. Полная цена сохраняется в promo_code_uses.original_amount.
      const paymentRes = await client.query(
        `INSERT INTO payments (
          user_id, plan_id, amount, currency, period,
          payment_provider, status, payment_type, payment_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [userId, plan_id, amount, 'RUB', period,
         amount === 0 ? 'promo' : 'platega', 'pending', 'subscription',
         amount === 0 ? 'promo' : 'gateway']
      );
      paymentId = paymentRes.rows[0].id;

      if (promo) {
        await promoService.reserve(client, promo, {
          userId, paymentId, discount, originalAmount: fullAmount,
        });
        promoInfo = { code: promo.code, discount, original_amount: fullAmount };
      }

      // Полная скидка: платёжки в этом потоке нет вообще. Подтверждаем
      // активацию промокода здесь же и активируем подписку после COMMIT.
      if (amount === 0) {
        await client.query(
          `UPDATE payments SET status = 'completed', completed_at = NOW(),
                  payment_data = $2::jsonb
             WHERE id = $1`,
          [paymentId, JSON.stringify({ free_by_promo: true, promo_code: promo?.code || null })]
        );
        if (promo) await promoService.confirm(client, paymentId);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // ── Ветвь «бесплатно по промокоду» ──────────────────────────────────────
    if (amount === 0) {
      const paid = await db.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
      try {
        await activateSubscription(paid.rows[0]);
      } catch (err) {
        console.error('[create] активация бесплатного по промокоду платежа не удалась:', err);
        return res.status(500).json({ error: 'Промокод применён, но активация не удалась. Обратитесь в поддержку.' });
      }
      return res.json({
        success: true, paymentId, free: true, amount: 0, promo: promoInfo,
        message: 'Промокод покрыл всю стоимость — подписка активирована',
      });
    }

    // ── Обычная оплата через шлюз ───────────────────────────────────────────
    const description = `Оплата тарифа "${plan.name}" (${PERIOD_LABELS[period]})`;
    const payload = `${userId}|${plan_id}|${period}|${paymentId}`;

    let paymentData;
    try {
      paymentData = await createPayment(amount, 'RUB', description, payload);
    } catch (err) {
      // Платёж и резерв уже в базе. Резерв освобождаем сразу, иначе код будет
      // занят до истечения часа; платёж помечаем failed, чтобы он не висел
      // в списке неоплаченных у пользователя.
      await promoService.release(db, paymentId, 'ошибка создания платежа в шлюзе').catch(() => {});
      await db.query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [paymentId]).catch(() => {});
      throw err;
    }

    const expiresInMs = (paymentData.expiresIn || 1800) * 1000;
    const paymentExpiresAt = new Date(Date.now() + expiresInMs);

    await db.query(
      `UPDATE payments 
       SET provider_payment_id = $1, payment_url = $2, payment_data = $3, expires_at = $4
       WHERE id = $5`,
      [
        paymentData.transactionId,
        paymentData.redirectUrl,
        JSON.stringify(paymentData),
        paymentExpiresAt,
        paymentId
      ]
    );

    res.json({
      success: true,
      paymentId: paymentId,
      paymentUrl: paymentData.redirectUrl,
      transactionId: paymentData.transactionId,
      expiresIn: paymentData.expiresIn,
      expiresAt: paymentExpiresAt.toISOString(),
      amount,
      promo: promoInfo,
    });

  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

/**
 * GET /api/payments/balance
 * Возвращает текущий баланс пользователя и последние операции
 */
router.get('/balance', verifyToken, verifyActive, async (req, res) => {
  try {
    await ensureWalletSchema();

    const userId = req.userId;
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const wallet = await getOrCreateWallet(client, userId);
      const txRes = await client.query(
        `SELECT id, type, direction, amount, currency, balance_before, balance_after,
                reference_type, reference_id, description, created_at
         FROM wallet_transactions
         WHERE user_id = $1
         ORDER BY id DESC
         LIMIT 20`,
        [userId]
      );
      await client.query('COMMIT');

      res.json({
        balance: Number(wallet.balance || 0),
        currency: wallet.currency || 'RUB',
        transactions: txRes.rows,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

/**
 * POST /api/payments/topup/create
 * Создание платежа на пополнение баланса
 */
router.post('/topup/create', verifyToken, verifyActive, async (req, res) => {
  try {
    await ensureWalletSchema();

    const userId = req.userId;
    const amount = Number(req.body?.amount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid topup amount' });
    }
    if (!Number.isInteger(amount)) {
      return res.status(400).json({ error: 'Сумма должна быть целым числом рублей' });
    }
    if (amount < TOPUP_MIN) {
      return res.status(400).json({ error: `Минимальная сумма пополнения — ${TOPUP_MIN} ₽` });
    }
    if (amount > TOPUP_MAX) {
      return res.status(400).json({ error: `Максимальная сумма пополнения — ${TOPUP_MAX.toLocaleString('ru-RU')} ₽` });
    }

    const paymentResult = await db.query(
      `INSERT INTO payments (
        user_id, plan_id, amount, currency, period,
        payment_provider, status, payment_type, payment_source
      ) VALUES ($1, NULL, $2, $3, NULL, $4, $5, $6, $7)
      RETURNING id`,
      [userId, amount, 'RUB', 'platega', 'pending', 'topup', 'gateway']
    );

    const paymentId = paymentResult.rows[0].id;
    const description = `Пополнение баланса на ${amount.toFixed(2)} ₽`;
    const payload = `${userId}|topup|${paymentId}|${amount.toFixed(2)}`;
    const paymentData = await createPayment(amount, 'RUB', description, payload);

    const expiresInMs = (paymentData.expiresIn || 1800) * 1000;
    const paymentExpiresAt = new Date(Date.now() + expiresInMs);

    await db.query(
      `UPDATE payments
       SET provider_payment_id = $1, payment_url = $2, payment_data = $3, expires_at = $4
       WHERE id = $5`,
      [
        paymentData.transactionId,
        paymentData.redirectUrl,
        JSON.stringify(paymentData),
        paymentExpiresAt,
        paymentId,
      ]
    );

    res.json({
      success: true,
      paymentId,
      paymentUrl: paymentData.redirectUrl,
      transactionId: paymentData.transactionId,
      expiresIn: paymentData.expiresIn,
      expiresAt: paymentExpiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Topup payment creation error:', error);
    res.status(500).json({ error: 'Failed to create topup payment' });
  }
});

/**
 * POST /api/payments/pay-with-balance
 * Списание с баланса и активация подписки без внешнего платежного провайдера
 */
router.post('/pay-with-balance', verifyToken, verifyActive, async (req, res) => {
  const client = await pgPool.connect();
  try {
    await ensureWalletSchema();

    const { plan_id, period, promo_code } = req.body;
    const userId = req.userId;

    if (!plan_id || !period) {
      return res.status(400).json({ error: 'plan_id and period are required' });
    }

    if (!['monthly', 'quarterly', 'yearly'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Must be monthly, quarterly, or yearly' });
    }

    const { plan, amount: fullAmount } = await getPlanAndAmount(plan_id, period);

    await client.query('BEGIN');

    // Промокод проверяем внутри той же транзакции и под FOR UPDATE — иначе
    // два параллельных запроса с последней активацией пройдут оба.
    // Порога шлюза здесь нет: списание с баланса идёт без платёжной системы,
    // поэтому любая сумма, включая нулевую, допустима.
    let amount = fullAmount, promo = null, discount = 0, promoInfo = null;
    if (promo_code) {
      const check = await promoService.validate(promo_code, {
        userId, planId: plan_id, period, amount: fullAmount,
        client, forUpdate: true, allowTypes: promoService.DISCOUNT_TYPES,
      });
      if (!check.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: check.message, reason: check.reason });
      }
      promo = check.promo;
      discount = check.discount;
      amount = check.finalAmount;
      promoInfo = { code: promo.code, discount, original_amount: fullAmount };
    }

    const wallet = await getOrCreateWallet(client, userId);
    const balanceBefore = Number(wallet.balance || 0);

    if (balanceBefore < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Недостаточно средств на балансе',
        required: amount,
        balance: balanceBefore,
      });
    }

    const balanceAfter = Number((balanceBefore - amount).toFixed(2));
    await client.query(
      'UPDATE user_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [balanceAfter, userId]
    );

    const paymentRes = await client.query(
      `INSERT INTO payments (
        user_id, plan_id, amount, currency, period,
        payment_provider, status, payment_type, payment_source,
        payment_data, completed_at
      ) VALUES ($1,$2,$3,'RUB',$4,'wallet','completed','subscription','balance',$5,NOW())
      RETURNING *`,
      [
        userId,
        plan_id,
        amount,
        period,
        JSON.stringify({ paid_with_balance: true, duration_days: getPeriodDays(period) }),
      ]
    );

    const payment = paymentRes.rows[0];

    // При полной скидке с баланса ничего не списывается — проводку на 0 ₽
    // не создаём, она только мусорила бы в истории операций.
    if (amount > 0) {
      const walletTxId = await addWalletTransaction(client, {
        userId,
        type: 'purchase',
        direction: 'out',
        amount,
        currency: 'RUB',
        balanceBefore,
        balanceAfter,
        referenceType: 'payment',
        referenceId: payment.id,
        description: `Оплата подписки ${plan.name} (${period}) с баланса`,
        metadata: { plan_id, period, payment_id: payment.id, promo_code: promo?.code || null },
      });

      await client.query(
        'UPDATE payments SET wallet_transaction_id = $1 WHERE id = $2',
        [walletTxId, payment.id]
      );
    }

    // Оплата уже состоялась, поэтому резерв и подтверждение идут подряд:
    // ждать вебхука тут нечего. Через reserve+confirm, а не вставкой applied
    // напрямую, чтобы путь активации был один и тот же во всех потоках.
    if (promo) {
      await promoService.reserve(client, promo, {
        userId, paymentId: payment.id, discount, originalAmount: fullAmount,
      });
      await promoService.confirm(client, payment.id);
    }

    await client.query('COMMIT');

    try {
      await activateSubscription(payment);
    } catch (activationError) {
      // Компенсация: если активация подписки не прошла, возвращаем средства.
      const rollbackClient = await pgPool.connect();
      try {
        await rollbackClient.query('BEGIN');
        const rollbackWallet = await getOrCreateWallet(rollbackClient, userId);
        const refundBefore = Number(rollbackWallet.balance || 0);
        const refundAfter = Number((refundBefore + amount).toFixed(2));

        await rollbackClient.query(
          'UPDATE user_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
          [refundAfter, userId]
        );

        await addWalletTransaction(rollbackClient, {
          userId,
          type: 'refund',
          direction: 'in',
          amount,
          currency: 'RUB',
          balanceBefore: refundBefore,
          balanceAfter: refundAfter,
          referenceType: 'payment',
          referenceId: payment.id,
          description: `Возврат средств за неуспешную активацию подписки #${payment.id}`,
          metadata: { reason: 'subscription_activation_failed' },
        });

        await rollbackClient.query(
          `UPDATE payments
           SET status = 'failed',
               payment_data = COALESCE(payment_data, '{}'::jsonb) || $1::jsonb
           WHERE id = $2`,
          [JSON.stringify({ activation_error: activationError.message || 'unknown' }), payment.id]
        );

        // Деньги вернули — значит и промокод должен снова стать доступен,
        // иначе человек потратил код на то, чего не получил.
        await promoService.release(rollbackClient, payment.id, 'активация подписки не удалась');

        await rollbackClient.query('COMMIT');
      } catch (rollbackErr) {
        await rollbackClient.query('ROLLBACK');
        console.error('Rollback after balance payment failure error:', rollbackErr);
      } finally {
        rollbackClient.release();
      }

      return res.status(500).json({ error: 'Оплата списана, но активация подписки не удалась. Средства возвращены на баланс.' });
    }

    res.json({
      success: true,
      paymentId: payment.id,
      amount,
      balanceAfter,
      message: 'Подписка успешно оплачена с баланса',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Pay with balance error:', error);
    res.status(500).json({ error: error.message || 'Failed to pay with balance' });
  } finally {
    client.release();
  }
});

// Маппинг провайдерского статуса в наш внутренний.
// Значения — из схемы PaymentStatus документации Platega: PENDING, CANCELED,
// CONFIRMED, CHARGEBACKED. CHARGEBACK без окончания принимаем на всякий случай:
// раньше в коде было только оно, и если провайдер где-то шлёт короткую форму,
// возврат не должен молча уехать в pending.
function mapPlategaStatus(providerStatus) {
  switch (providerStatus) {
    case 'CONFIRMED':    return 'completed';
    case 'CANCELED':     return 'failed';
    case 'CHARGEBACKED':
    case 'CHARGEBACK':   return 'refunded';
    default:             return 'pending';
  }
}

// Статусы, означающие «деньги ещё не зачислены». Из любого из них платёж
// может стать completed.
//
// expired здесь ОБЯЗАТЕЛЕН. Это наш локальный статус: крон expireOldPayments
// ставит его, когда истекло expires_at — время жизни платёжной ФОРМЫ, которое
// вернула Platega. Оно не значит «денег не будет»: подтверждение по СБП вполне
// приходит позже. Раньше expired отсутствовал в таблице переходов, из-за чего
// ALLOWED_STATUS_TRANSITIONS[current] давал пустой Set и вебхук с CONFIRMED
// отбрасывался как недопустимый переход — с ответом 200, так что провайдер
// считал колбэк доставленным и не повторял. Платёж становился незачисляемым
// навсегда (реальный случай: пополнение на 100 ₽ 13.08.2026).
const UNPAID_STATUSES = new Set(['pending', 'expired']);

// Разрешённые переходы статуса платежа.
// Повторный webhook с тем же статусом — допустим (идемпотентный повтор, без side effects).
// Обратные переходы (например, refunded → completed) запрещены.
const ALLOWED_STATUS_TRANSITIONS = {
  pending:   new Set(['pending', 'completed', 'failed', 'refunded']),
  expired:   new Set(['expired', 'completed', 'failed', 'refunded']),
  completed: new Set(['completed', 'refunded']),
  failed:    new Set(['failed']),
  refunded:  new Set(['refunded']),
};

/**
 * POST /api/payments/webhook
 * Webhook to receive payment status updates from Platega
 * Body: { id, amount, currency, status, paymentMethod }
 * Status: CONFIRMED, CANCELED, CHARGEBACK
 */
router.post('/webhook', async (req, res) => {
  try {
    await ensureWalletSchema();

    // ВАЖНО: функция асинхронная (ключи читаются из настроек) — без await
    // проверка всегда проходила бы, т.к. Promise истинный.
    if (!(await verifyWebhookSignature(req.headers))) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { id: transactionId, amount, currency, status, paymentMethod } = req.body;
    console.log('Received Platega webhook:', { transactionId, amount, currency, status });

    const result = await processPlategaWebhook(req.body);

    if (result.outcome === 'not_found') {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (result.outcome === 'amount_mismatch') {
      return res.status(400).json({
        error: 'Amount or currency mismatch',
        expected: result.expected,
        received: result.received,
      });
    }

    // Активация подписки — вне webhook-транзакции (ограничение текущей архитектуры;
    // покрывается отдельным пунктом аудита #6).
    if (result.outcome === 'applied' && result.activateSubscription) {
      try {
        // subscription_change — отдельный flow (применяет смену тарифа по metadata)
        if (result.payment.payment_type === 'subscription_change') {
          await activateSubscriptionChange(result.payment);
        } else if (result.payment.payment_type === 'squad_traffic_topup') {
          await activateSquadTrafficTopup(result.payment);
        } else {
          await activateSubscription(result.payment);
        }
      } catch (err) {
        console.error('Failed to activate subscription after payment:', err);
      }
    }

    // Активация промокода прошла сверх лимита — платёж подтвердился после
    // истечения резерва. Ошибкой это не является (деньги получены), но требует
    // разбора: в админке такие активации помечены флагом over_limit.
    if (result.overLimitPromo) {
      console.warn(`[Promo] платёж ${result.payment?.id} применил промокод сверх лимита — проверьте /admin/promo`);
    }

    // Telegram-уведомления (юзеру + админу) — silent skip если бот выключен / нет TG-id.
    // Кладём в setImmediate чтобы webhook ответил провайдеру быстро.
    if (result.outcome === 'applied' && result.payment) {
      setImmediate(async () => {
        try {
          const tgNotify = require('../services/telegramBot/notify');
          const p = result.payment;
          // Юзеру
          await tgNotify.notifyUser(p.user_id, 'user_payment_received', {
            amount: Number(p.amount).toLocaleString('ru-RU'),
            plan: p.payment_type === 'subscription' || p.payment_type === 'subscription_change'
              ? (p.metadata?.plan_name || `Тариф #${p.plan_id || '—'}`)
              : (p.payment_type === 'topup' ? 'Пополнение баланса' : ''),
          });
          // Админу
          const userRow = await pool.query('SELECT login FROM users WHERE id = $1', [p.user_id]);
          await tgNotify.notifyAdmin('admin_payment_received', {
            login: userRow.rows[0]?.login || `#${p.user_id}`,
            amount: Number(p.amount).toLocaleString('ru-RU'),
            plan: p.payment_type === 'topup' ? 'Пополнение баланса' : (p.metadata?.plan_name || `#${p.plan_id || '—'}`),
          });
        } catch (e) {
          console.warn('[TG notify] payment notification failed:', e.message);
        }
      });
    }

    res.status(200).json({ success: true, outcome: result.outcome });
  } catch (error) {
    console.error('Webhook processing error:', error);
    // 200 чтобы провайдер не повторял — ошибка залогирована, нуждается в ручном разборе.
    res.status(200).json({ success: false });
  }
});

/**
 * Вся логика webhook в одной транзакции:
 *   1. SELECT ... FOR UPDATE платежа по provider_payment_id (защита от конкурентных webhook)
 *   2. Проверка допустимости перехода статуса (state machine)
 *   3. Идемпотентность: если статус уже целевой — просто обновляем webhook_processed_at
 *   4. Для TOPUP: pending→completed зачисляет баланс, completed→refunded списывает его обратно
 */
async function processPlategaWebhook(body) {
  const { id: transactionId, amount, currency, status, paymentMethod } = body;
  const targetStatus = mapPlategaStatus(status);
  const webhookMeta = {
    webhook_status: status,
    paymentMethod: paymentMethod || null,
    amount: amount || null,
    currency: currency || null,
  };

  let overLimitPromo = false;
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const paymentResult = await client.query(
      'SELECT * FROM payments WHERE provider_payment_id = $1 FOR UPDATE',
      [transactionId]
    );

    if (paymentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.error('Payment not found for transaction:', transactionId);
      return { outcome: 'not_found' };
    }

    const payment = paymentResult.rows[0];
    const currentStatus = payment.status;

    // Сверяем сумму и валюту webhook с тем, что мы создавали в БД.
    // Это блокирует подделку webhook с произвольной суммой.
    //
    // Проверяем НЕДОплату, а не точное совпадение. Platega при comissionType=0
    // добавляет комиссию сверх суммы и списывает её с плательщика: мы создаём
    // счёт на 100 ₽, а провайдер проводит 108 ₽ (реальная транзакция
    // cc1d86ac от 13.08.2026). Требование точного равенства отбивало бы такие
    // платежи с 400 — при том, что деньги уже получены.
    //
    // Переплата для нас безопасна: на баланс всё равно идёт payment.amount,
    // а не сумма из webhook. Опасна недоплата — оплатили 10 ₽, а зачислили бы
    // 100. Её и отсекаем, с допуском в копейку на округления.
    const expectedAmount = Number(payment.amount);
    const webhookAmount = Number(amount);
    const expectedCurrency = String(payment.currency || 'RUB').toUpperCase();
    const webhookCurrency = String(currency || expectedCurrency).toUpperCase();
    const underpaid = webhookAmount < expectedAmount - 0.01;
    if (!Number.isFinite(webhookAmount) || underpaid || webhookCurrency !== expectedCurrency) {
      await client.query('ROLLBACK');
      console.error(
        `[Webhook] Amount/currency mismatch for payment ${payment.id}: ` +
        `expected >= ${expectedAmount} ${expectedCurrency}, got ${webhookAmount} ${webhookCurrency}`
      );
      return {
        outcome: 'amount_mismatch',
        payment,
        expected: { amount: expectedAmount, currency: expectedCurrency },
        received: { amount: webhookAmount, currency: webhookCurrency },
      };
    }

    // Проверка допустимости перехода
    const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus] || new Set();
    if (!allowed.has(targetStatus)) {
      await client.query('ROLLBACK');
      console.warn(`[Webhook] Ignored invalid transition ${currentStatus} → ${targetStatus} for payment ${payment.id}`);
      return { outcome: 'invalid_transition', payment, currentStatus, targetStatus };
    }

    // Идемпотентный повтор: статус уже целевой — только метка обработки, без side effects
    if (currentStatus === targetStatus) {
      await client.query(
        `UPDATE payments
         SET webhook_processed_at = NOW(),
             payment_data = COALESCE(payment_data, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [payment.id, JSON.stringify(webhookMeta)]
      );
      await client.query('COMMIT');
      console.log(`Payment ${payment.id} webhook idempotent repeat (status ${currentStatus})`);
      return { outcome: 'already_processed', payment };
    }

    // Применяем переход.
    //
    // Признак «платёж закрыт» передаём ОТДЕЛЬНЫМ булевым параметром, а не
    // сравниваем $1 внутри CASE. Раньше $1 стоял и в `SET status = $1` (там
    // Postgres выводит тип колонки, varchar), и в `CASE WHEN $1 = 'completed'`
    // (там — text), из-за чего запрос падал с «inconsistent types deduced for
    // parameter $1» и переход не применялся вовсе. Приведение типов это тоже
    // чинит, но его легко потерять при правке — булев параметр надёжнее.
    await client.query(
      `UPDATE payments
       SET status = $1,
           completed_at = CASE WHEN $4 THEN NOW() ELSE completed_at END,
           webhook_processed_at = NOW(),
           payment_data = COALESCE(payment_data, '{}'::jsonb) || $3::jsonb
       WHERE id = $2`,
      [targetStatus, payment.id, JSON.stringify(webhookMeta), targetStatus === 'completed']
    );

    // Side effects для TOPUP: пополнение и возврат из кошелька.
    // Источником может быть и expired — см. комментарий к UNPAID_STATUSES.
    // Условие обязано совпадать с таблицей переходов: пропустить сюда статус,
    // которого нет в UNPAID_STATUSES, значит перевести платёж в completed,
    // не начислив денег, — то есть потерять их молча.
    if (payment.payment_type === 'topup') {
      if (UNPAID_STATUSES.has(currentStatus) && targetStatus === 'completed') {
        await creditTopupToWallet(client, payment, webhookMeta);
      } else if (currentStatus === 'completed' && targetStatus === 'refunded') {
        await refundTopupFromWallet(client, payment, webhookMeta);
      }
    }

    // Промокод — в той же транзакции, что и смена статуса платежа.
    // confirm лимит не проверяет намеренно: платёж мог подтвердиться после
    // истечения резерва (статус expired → completed), и отказать в скидке
    // уже заплатившему хуже, чем выпустить активацию сверх лимита.
    if (targetStatus === 'completed') {
      const promoRes = await promoService.confirm(client, payment.id);
      if (promoRes?.overLimit) overLimitPromo = true;
    } else if (targetStatus === 'failed' || targetStatus === 'refunded') {
      await promoService.release(client, payment.id,
        targetStatus === 'refunded' ? 'возврат платежа' : 'платёж не состоялся');
    }

    await client.query('COMMIT');

    const shouldActivate = targetStatus === 'completed' && payment.payment_type !== 'topup';
    return { outcome: 'applied', payment, activateSubscription: shouldActivate, overLimitPromo };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function creditTopupToWallet(client, payment, webhookMeta) {
  const wallet = await getOrCreateWallet(client, payment.user_id);
  const balanceBefore = Number(wallet.balance || 0);
  const amountValue = Number(payment.amount || 0);
  const balanceAfter = Number((balanceBefore + amountValue).toFixed(2));

  await client.query(
    'UPDATE user_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
    [balanceAfter, payment.user_id]
  );

  const walletTxId = await addWalletTransaction(client, {
    userId: payment.user_id,
    type: 'topup',
    direction: 'in',
    amount: amountValue,
    currency: payment.currency || 'RUB',
    balanceBefore,
    balanceAfter,
    referenceType: 'payment',
    referenceId: payment.id,
    description: `Пополнение баланса через ${payment.payment_provider || 'gateway'}`,
    metadata: { transactionId: payment.provider_payment_id, providerStatus: webhookMeta.webhook_status },
  });

  await client.query(
    'UPDATE payments SET wallet_transaction_id = $1 WHERE id = $2',
    [walletTxId, payment.id]
  );
}

async function refundTopupFromWallet(client, payment, webhookMeta) {
  const wallet = await getOrCreateWallet(client, payment.user_id);
  const balanceBefore = Number(wallet.balance || 0);
  const amountValue = Number(payment.amount || 0);
  const balanceAfter = Number((balanceBefore - amountValue).toFixed(2));

  await client.query(
    'UPDATE user_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
    [balanceAfter, payment.user_id]
  );

  await addWalletTransaction(client, {
    userId: payment.user_id,
    type: 'refund',
    direction: 'out',
    amount: amountValue,
    currency: payment.currency || 'RUB',
    balanceBefore,
    balanceAfter,
    referenceType: 'payment',
    referenceId: payment.id,
    description: `Возврат пополнения (chargeback) через ${payment.payment_provider || 'gateway'}`,
    metadata: { transactionId: payment.provider_payment_id, providerStatus: webhookMeta.webhook_status },
  });
}

/**
 * GET /api/payments/history
 * Get payment history for current user
 */
router.get('/history', verifyToken, verifyActive, async (req, res) => {
  try {
    await ensureWalletSchema();

    const userId = req.userId;

    const result = await db.query(
      `SELECT 
        p.id, p.amount, p.currency, p.period, p.status,
        p.payment_type, p.payment_source,
        p.created_at, p.completed_at as paid_at, p.payment_url,
        p.expires_at,
        pl.name as plan_name, pl.description as plan_description
       FROM payments p
       LEFT JOIN plans pl ON p.plan_id = pl.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

module.exports = router;

// Экспортируем внутренности для scripts/reconcile-payments.js: сверка платежей
// обязана применять РОВНО ту же машину состояний и то же начисление на кошелёк,
// что и webhook. Своя копия логики рано или поздно разъедется с этой — а цена
// расхождения здесь измеряется в деньгах пользователей.
module.exports.processPlategaWebhook = processPlategaWebhook;
// Реэкспорт для scripts/reconcile-payments.js, который берёт его отсюда.
module.exports.ensureWalletSchema = ensureWalletSchema;
