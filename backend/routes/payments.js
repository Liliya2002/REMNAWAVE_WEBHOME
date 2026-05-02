const express = require('express');
const router = express.Router();
const db = require('../db');
const { createPayment, verifyWebhookSignature } = require('../services/platega');
const { verifyToken, verifyActive } = require('../middleware');
const { activateSubscription, activateSubscriptionChange, activateSquadTrafficTopup } = require('../services/payment');

const pgPool = db.pool;
let schemaEnsured = false;

const TOPUP_MIN = 10;
const TOPUP_MAX = 100000;

async function ensureWalletSchema() {
  if (schemaEnsured) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_wallets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      direction VARCHAR(10) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
      balance_before NUMERIC(12,2) NOT NULL,
      balance_after NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'completed',
      reference_type VARCHAR(30),
      reference_id BIGINT,
      description TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference ON wallet_transactions(reference_type, reference_id)`);

  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'subscription'`);
  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_source VARCHAR(30) NOT NULL DEFAULT 'gateway'`);
  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_transaction_id INTEGER REFERENCES wallet_transactions(id) ON DELETE SET NULL`);
  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS webhook_processed_at TIMESTAMP`);

  // Защита от дублей записей платежа с одним transactionId провайдера
  // (если существующие данные содержат дубли — индекс не создастся, залогируем warning).
  try {
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment_id
      ON payments(provider_payment_id)
      WHERE provider_payment_id IS NOT NULL
    `);
  } catch (err) {
    console.error('[SECURITY] Failed to create UNIQUE index on payments.provider_payment_id — возможно, есть дубли. Проверьте вручную.', err.message);
  }

  schemaEnsured = true;
}

function getPeriodDays(period) {
  switch (period) {
    case 'monthly': return 30;
    case 'quarterly': return 90;
    case 'yearly': return 365;
    default: return 30;
  }
}

async function getPlanAndAmount(planId, period) {
  const planResult = await db.query(
    'SELECT * FROM plans WHERE id = $1 AND is_active = true',
    [planId]
  );

  if (planResult.rows.length === 0) {
    throw new Error('Plan not found or inactive');
  }

  const plan = planResult.rows[0];
  if (plan.is_trial) {
    throw new Error('Cannot create payment for trial plan');
  }

  let amount = null;
  switch (period) {
    case 'monthly':
      amount = plan.price_monthly;
      break;
    case 'quarterly':
      amount = plan.price_quarterly;
      break;
    case 'yearly':
      amount = plan.price_yearly;
      break;
    default:
      amount = null;
  }

  if (!amount || Number(amount) <= 0) {
    throw new Error(`This plan does not support ${period} payments`);
  }

  return { plan, amount: Number(amount) };
}

async function getOrCreateWallet(client, userId) {
  let walletRes = await client.query(
    'SELECT user_id, balance, currency FROM user_wallets WHERE user_id = $1 FOR UPDATE',
    [userId]
  );

  if (walletRes.rows.length === 0) {
    await client.query(
      'INSERT INTO user_wallets (user_id, balance, currency) VALUES ($1, 0, $2)',
      [userId, 'RUB']
    );
    walletRes = await client.query(
      'SELECT user_id, balance, currency FROM user_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
  }

  return walletRes.rows[0];
}

async function addWalletTransaction(client, {
  userId,
  type,
  direction,
  amount,
  currency = 'RUB',
  balanceBefore,
  balanceAfter,
  referenceType,
  referenceId,
  description,
  metadata = {},
}) {
  const txRes = await client.query(
    `INSERT INTO wallet_transactions (
      user_id, type, direction, amount, currency, balance_before, balance_after,
      reference_type, reference_id, description, metadata, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed')
    RETURNING id`,
    [
      userId,
      type,
      direction,
      amount,
      currency,
      balanceBefore,
      balanceAfter,
      referenceType || null,
      referenceId || null,
      description || null,
      JSON.stringify(metadata || {}),
    ]
  );

  return txRes.rows[0].id;
}

/**
 * POST /api/payments/create
 * Create new payment for a plan
 * Body: { plan_id, period } - period: 'monthly', 'quarterly', 'yearly'
 */
router.post('/create', verifyToken, verifyActive, async (req, res) => {
  try {
    await ensureWalletSchema();

    const { plan_id, period } = req.body;
    const userId = req.userId;

    // Validate input
    if (!plan_id || !period) {
      return res.status(400).json({ error: 'plan_id and period are required' });
    }

    if (!['monthly', 'quarterly', 'yearly'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Must be monthly, quarterly, or yearly' });
    }

    const { plan, amount } = await getPlanAndAmount(plan_id, period);

    // Get user details
    const userResult = await db.query(
      'SELECT email, login FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Create payment record in database
    const paymentResult = await db.query(
      `INSERT INTO payments (
        user_id, plan_id, amount, currency, period, 
        payment_provider, status, payment_type, payment_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [userId, plan_id, amount, 'RUB', period, 'platega', 'pending', 'subscription', 'gateway']
    );

    const paymentId = paymentResult.rows[0].id;

    // Create Platega payment
    const periodLabels = {
      monthly: 'месяц',
      quarterly: '3 месяца',
      yearly: 'год'
    };

    const description = `Оплата тарифа "${plan.name}" (${periodLabels[period]})`;
    const payload = `${userId}|${plan_id}|${period}|${paymentId}`;

    const paymentData = await createPayment(amount, 'RUB', description, payload);

    // Calculate expires_at based on Platega expiresIn (seconds) or default 30 minutes
    const expiresInMs = (paymentData.expiresIn || 1800) * 1000;
    const paymentExpiresAt = new Date(Date.now() + expiresInMs);

    // Update payment record with transaction details and expiration
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
      expiresAt: paymentExpiresAt.toISOString()
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

    const { plan_id, period } = req.body;
    const userId = req.userId;

    if (!plan_id || !period) {
      return res.status(400).json({ error: 'plan_id and period are required' });
    }

    if (!['monthly', 'quarterly', 'yearly'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Must be monthly, quarterly, or yearly' });
    }

    const { plan, amount } = await getPlanAndAmount(plan_id, period);

    await client.query('BEGIN');
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
      metadata: { plan_id, period, payment_id: payment.id },
    });

    await client.query(
      'UPDATE payments SET wallet_transaction_id = $1 WHERE id = $2',
      [walletTxId, payment.id]
    );

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
function mapPlategaStatus(providerStatus) {
  switch (providerStatus) {
    case 'CONFIRMED':  return 'completed';
    case 'CANCELED':   return 'failed';
    case 'CHARGEBACK': return 'refunded';
    default:           return 'pending';
  }
}

// Разрешённые переходы статуса платежа.
// Повторный webhook с тем же статусом — допустим (идемпотентный повтор, без side effects).
// Обратные переходы (например, refunded → completed) запрещены.
const ALLOWED_STATUS_TRANSITIONS = {
  pending:   new Set(['pending', 'completed', 'failed', 'refunded']),
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

    if (!verifyWebhookSignature(req.headers)) {
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
    // Толерантность 1 копейка покрывает округления; valuta — строго совпадение.
    // Это блокирует подделку webhook с произвольной суммой.
    const expectedAmount = Number(payment.amount);
    const webhookAmount = Number(amount);
    const expectedCurrency = String(payment.currency || 'RUB').toUpperCase();
    const webhookCurrency = String(currency || expectedCurrency).toUpperCase();
    if (!Number.isFinite(webhookAmount) || Math.abs(webhookAmount - expectedAmount) > 0.01 || webhookCurrency !== expectedCurrency) {
      await client.query('ROLLBACK');
      console.error(
        `[Webhook] Amount/currency mismatch for payment ${payment.id}: ` +
        `expected ${expectedAmount} ${expectedCurrency}, got ${webhookAmount} ${webhookCurrency}`
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

    // Применяем переход
    await client.query(
      `UPDATE payments
       SET status = $1,
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
           webhook_processed_at = NOW(),
           payment_data = COALESCE(payment_data, '{}'::jsonb) || $3::jsonb
       WHERE id = $2`,
      [targetStatus, payment.id, JSON.stringify(webhookMeta)]
    );

    // Side effects для TOPUP: пополнение и возврат из кошелька
    if (payment.payment_type === 'topup') {
      if (currentStatus === 'pending' && targetStatus === 'completed') {
        await creditTopupToWallet(client, payment, webhookMeta);
      } else if (currentStatus === 'completed' && targetStatus === 'refunded') {
        await refundTopupFromWallet(client, payment, webhookMeta);
      }
    }

    await client.query('COMMIT');

    const shouldActivate = targetStatus === 'completed' && payment.payment_type !== 'topup';
    return { outcome: 'applied', payment, activateSubscription: shouldActivate };
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
