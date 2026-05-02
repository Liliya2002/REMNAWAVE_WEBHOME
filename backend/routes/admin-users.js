const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, verifyAdmin } = require('../middleware');
const audit = require('../services/auditLog');

/**
 * GET /api/admin/users
 * Получить список пользователей (с пагинацией и поиском)
 * Query params: page=1, limit=20, search=login/email, sort=login/created_at, order=ASC/DESC
 */
router.get('/', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const search = req.query.search || '';
    const sort = ['login', 'email', 'created_at', 'is_admin', 'is_active'].includes(req.query.sort) ? req.query.sort : 'created_at';
    const order = req.query.order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const offset = (page - 1) * limit;

    // Построить условие поиска
    let whereClause = '';
    let params = [];
    if (search) {
      whereClause = 'WHERE login ILIKE $1 OR email ILIKE $1';
      params.push(`%${search}%`);
    }

    // Получить общее количество пользователей
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Получить пользователей
    const paramIndex = params.length + 1;
    const usersResult = await db.query(
      `SELECT id, login, email, is_admin, is_active, created_at, updated_at 
       FROM users 
       ${whereClause}
       ORDER BY ${sort} ${order}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({
      users: usersResult.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

/**
 * GET /api/admin/users/plans/list
 * Получить список активных планов
 */
router.get('/plans/list', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, price_monthly, price_quarterly, price_yearly, is_trial, is_active FROM plans WHERE is_active = true ORDER BY id'
    );
    res.json({ plans: result.rows });
  } catch (error) {
    console.error('Error getting plans:', error);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

/**
 * GET /api/admin/users/:id
 * Получить данные конкретного пользователя (полная карточка)
 */
router.get('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const result = await db.query(
      `SELECT id, login, email, is_admin, is_active, email_confirmed, created_at, updated_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Подписки
    const subsResult = await db.query(
      `SELECT id, plan_name, expires_at, is_active, traffic_limit_gb, traffic_used_gb, 
              remnwave_user_uuid, subscription_url, created_at
       FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    // Баланс кошелька
    let balance = 0;
    try {
      const walletRes = await db.query(
        'SELECT balance FROM user_wallets WHERE user_id = $1',
        [userId]
      );
      if (walletRes.rows.length > 0) {
        balance = Number(walletRes.rows[0].balance);
      }
    } catch (_) {}

    // Платежи
    const paymentsRes = await db.query(
      `SELECT p.id, p.amount, p.currency, p.status, p.period, p.payment_type, p.payment_source,
              p.created_at, p.completed_at, pl.name as plan_name
       FROM payments p LEFT JOIN plans pl ON p.plan_id = pl.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC LIMIT 20`,
      [userId]
    );

    // Транзакции кошелька
    const walletTxRes = await db.query(
      `SELECT id, type, direction, amount, balance_before, balance_after, description, created_at
       FROM wallet_transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );

    res.json({
      user: result.rows[0],
      subscriptions: subsResult.rows,
      balance,
      payments: paymentsRes.rows,
      walletTransactions: walletTxRes.rows
    });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PUT /api/admin/users/:id
 * Обновить данные пользователя (email, login, is_admin, is_active)
 */
router.put('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const { email, login, is_admin, is_active } = req.body;

    // Проверить существование пользователя
    const userResult = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Проверить, что email не занят другим пользователем
    if (email) {
      const emailResult = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailResult.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    // Обновить данные
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (email) {
      updates.push(`email = $${paramIndex}`);
      values.push(email);
      paramIndex++;
    }

    if (login) {
      // Проверить уникальность логина
      const loginCheck = await db.query('SELECT id FROM users WHERE login = $1 AND id != $2', [login, userId]);
      if (loginCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Login already in use' });
      }
      updates.push(`login = $${paramIndex}`);
      values.push(login);
      paramIndex++;
    }

    if (typeof is_admin === 'boolean') {
      if (userId === req.userId && !is_admin) {
        return res.status(400).json({ error: 'Cannot remove own admin status' });
      }
      updates.push(`is_admin = $${paramIndex}`);
      values.push(is_admin);
      paramIndex++;
    }

    if (typeof is_active === 'boolean') {
      if (userId === req.userId && !is_active) {
        return res.status(400).json({ error: 'Cannot deactivate yourself' });
      }
      updates.push(`is_active = $${paramIndex}`);
      values.push(is_active);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const before = (await db.query(
      'SELECT login, email, is_admin, is_active FROM users WHERE id = $1', [userId]
    )).rows[0];

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, login, email, is_admin, is_active`;

    const result = await db.query(query, values);
    const after = result.rows[0];

    await audit.write(req, 'user.update', { type: 'user', id: userId },
      audit.diff(before, after, ['login', 'email', 'is_admin', 'is_active']));

    res.json({ user: after });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Удалить пользователя (или деактивировать, если нужны логи)
 */
router.delete('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    // Проверить, что админ не удаляет сам себя
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    // Проверить существование пользователя
    const userResult = await db.query('SELECT id, login, email FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const snapshot = userResult.rows[0];

    // Удалить пользователя (каскад удалит все связи)
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    await audit.write(req, 'user.delete', { type: 'user', id: userId }, { before: snapshot });

    res.json({ ok: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * PUT /api/admin/users/:id/balance
 * Установить баланс пользователя (админ)
 */
router.put('/:id/balance', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const { amount, reason } = req.body;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    await db.query(
      `INSERT INTO user_wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const walletRes = await db.query('SELECT balance FROM user_wallets WHERE user_id = $1', [userId]);
    const currentBalance = Number(walletRes.rows[0].balance);
    const diff = numAmount - currentBalance;

    if (diff === 0) return res.json({ balance: currentBalance });

    await db.query('UPDATE user_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [numAmount, userId]);

    await db.query(
      `INSERT INTO wallet_transactions (user_id, type, direction, amount, currency, balance_before, balance_after, description)
       VALUES ($1, $2, $3, $4, 'RUB', $5, $6, $7)`,
      [userId, diff > 0 ? 'admin_topup' : 'admin_deduct', diff > 0 ? 'in' : 'out', Math.abs(diff), currentBalance, numAmount, reason || 'Изменение баланса администратором']
    );

    await audit.write(req, 'user.balance_set', { type: 'user', id: userId }, {
      balance_before: currentBalance,
      balance_after: numAmount,
      diff,
      reason: reason || null
    });

    res.json({ balance: numAmount });
  } catch (error) {
    console.error('Error updating user balance:', error);
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

/**
 * PUT /api/admin/users/:id/subscription/extend
 * Продлить подписку пользователя на N дней
 */
router.put('/:id/subscription/extend', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const { days, subscriptionId } = req.body;
    const numDays = parseInt(days);
    if (!numDays || numDays < 1 || numDays > 3650) {
      return res.status(400).json({ error: 'Invalid days (1-3650)' });
    }

    let subQuery = 'SELECT * FROM subscriptions WHERE user_id = $1';
    let subParams = [userId];
    if (subscriptionId) {
      subQuery += ' AND id = $2';
      subParams.push(subscriptionId);
    } else {
      subQuery += ' ORDER BY created_at DESC LIMIT 1';
    }

    const subRes = await db.query(subQuery, subParams);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const sub = subRes.rows[0];

    let baseDate = sub.is_active && sub.expires_at
      ? new Date(Math.max(new Date(sub.expires_at), new Date()))
      : new Date();
    baseDate.setDate(baseDate.getDate() + numDays);

    await db.query(
      `UPDATE subscriptions SET expires_at = $1, is_active = true, updated_at = NOW() WHERE id = $2`,
      [baseDate, sub.id]
    );

    if (sub.remnwave_user_uuid) {
      try {
        const remnwaveService = require('../services/remnwave');
        await remnwaveService.updateRemnwaveUser(sub.remnwave_user_uuid, {
          expireAt: baseDate,
          status: 'ACTIVE'
        });
      } catch (err) {
        console.error('Failed to update Remnwave during admin extend:', err.message);
      }
    }

    await audit.write(req, 'subscription.extend', { type: 'subscription', id: sub.id }, {
      user_id: userId,
      days: numDays,
      expires_before: sub.expires_at,
      expires_after: baseDate.toISOString()
    });

    res.json({ ok: true, newExpiresAt: baseDate.toISOString() });
  } catch (error) {
    console.error('Error extending subscription:', error);
    res.status(500).json({ error: 'Failed to extend subscription' });
  }
});

/**
 * GET /api/admin/users/:id/remnwave-info
 * Вернуть "сырые" данные из Remnwave для этого пользователя для сравнения с БД.
 * Ищет по subscriptions.remnwave_user_uuid, иначе по username `userweb_{id}`.
 */
router.get('/:id/remnwave-info', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const subRes = await db.query(
      `SELECT remnwave_user_uuid FROM subscriptions
       WHERE user_id = $1 AND remnwave_user_uuid IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    const uuidFromDb = subRes.rows[0]?.remnwave_user_uuid || null;

    const remnwaveService = require('../services/remnwave');

    let remnwave = null;
    let source = null;
    try {
      remnwave = await remnwaveService.getRemnwaveUserByUsername(`userweb_${userId}`);
      if (remnwave) source = 'by-username';
    } catch (err) {
      console.error('[RemnwaveInfo] lookup failed:', err.message);
    }

    if (!remnwave) {
      return res.json({
        found: false,
        message: 'Пользователь не найден в Remnwave',
        uuidFromDb
      });
    }

    res.json({ found: true, source, uuidFromDb, remnwave });
  } catch (error) {
    console.error('Error fetching Remnwave info:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch Remnwave info' });
  }
});

/**
 * POST /api/admin/users/:id/subscription/sync-remnwave
 * Привести Remnwave-пользователя в соответствие с нашей БД (без изменения сроков/трафика в БД).
 * Используется для починки рассинхронизации: когда в нашей БД подписка выглядит правильно,
 * но в Remnwave юзер остался со старыми данными (или связь UUID в БД потерялась).
 * Body: { subscriptionId? } — если не передан, берётся самая свежая активная подписка.
 */
router.post('/:id/subscription/sync-remnwave', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const { subscriptionId } = req.body || {};

    let subQuery, subParams;
    if (subscriptionId) {
      subQuery = 'SELECT * FROM subscriptions WHERE user_id = $1 AND id = $2';
      subParams = [userId, subscriptionId];
    } else {
      subQuery = `SELECT * FROM subscriptions WHERE user_id = $1
                  ORDER BY (CASE WHEN is_active AND expires_at > NOW() THEN 0 ELSE 1 END),
                           COALESCE(expires_at, '1970-01-01'::timestamp) DESC,
                           created_at DESC
                  LIMIT 1`;
      subParams = [userId];
    }

    const subRes = await db.query(subQuery, subParams);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    const sub = subRes.rows[0];

    // Находим план по plan_name, чтобы взять актуальные squad_uuids и traffic_gb
    const planRes = await db.query(
      'SELECT * FROM plans WHERE name = $1 ORDER BY is_active DESC, id ASC LIMIT 1',
      [sub.plan_name]
    );
    if (planRes.rows.length === 0) {
      return res.status(404).json({ error: `План "${sub.plan_name}" не найден — переименован или удалён` });
    }
    const plan = planRes.rows[0];
    const squadUuids = plan.squad_uuids || [];
    const trafficLimitBytes = (plan.traffic_gb || 0) * 1024 * 1024 * 1024;

    const remnwaveService = require('../services/remnwave');

    // Определяем UUID: сначала из БД, затем по username в Remnwave
    let uuid = sub.remnwave_user_uuid || null;
    let remnwaveUser = null;
    if (!uuid) {
      try {
        remnwaveUser = await remnwaveService.getRemnwaveUserByUsername(`userweb_${userId}`);
        if (remnwaveUser?.uuid) uuid = remnwaveUser.uuid;
      } catch (err) {
        console.error('[SyncRemnwave] lookup failed:', err.message);
      }
    }

    if (!uuid) {
      return res.status(404).json({
        error: 'Remnwave user не найден. Подписка ещё ни разу не была синхронизирована — создайте её заново через "Создать подписку".'
      });
    }

    const isActiveNow = sub.is_active && sub.expires_at && new Date(sub.expires_at) > new Date();
    const desiredStatus = isActiveNow ? 'ACTIVE' : 'DISABLED';

    // PATCH в Remnwave
    let updated = null;
    try {
      updated = await remnwaveService.updateRemnwaveUser(uuid, {
        expireAt: sub.expires_at,
        trafficLimitBytes,
        status: desiredStatus,
        ...(squadUuids.length > 0 ? { activeInternalSquads: squadUuids } : {})
      });
    } catch (err) {
      console.error('[SyncRemnwave] Remnwave update failed:', err.message);
      return res.status(502).json({ error: `Remnwave update failed: ${err.message}` });
    }

    const rmSrc = updated || remnwaveUser || {};
    const remnwaveUsername = rmSrc.username || sub.remnwave_username || `userweb_${userId}`;
    let subscriptionUrl = rmSrc.subscriptionUrl || sub.subscription_url || null;
    if (!subscriptionUrl && rmSrc.shortUuid) {
      const baseUrl = process.env.REMNWAVE_API_URL || 'https://panel-root.guard-proxy.pro';
      subscriptionUrl = `${baseUrl}/api/sub/${rmSrc.shortUuid}`;
    }

    // Восстановим/запишем UUID/username/url и приведём traffic_limit_gb + squad_uuid к плану.
    // expires_at и traffic_used_gb НЕ трогаем — это "синхронизация вниз", не продление.
    await db.query(
      `UPDATE subscriptions
       SET remnwave_user_uuid = COALESCE(remnwave_user_uuid, $1),
           remnwave_username = COALESCE(remnwave_username, $2),
           subscription_url = COALESCE($3, subscription_url),
           traffic_limit_gb = $4,
           squad_uuid = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [uuid, remnwaveUsername, subscriptionUrl, plan.traffic_gb || 0, squadUuids[0] || null, sub.id]
    );

    await audit.write(req, 'subscription.sync_remnwave', { type: 'subscription', id: sub.id }, {
      user_id: userId,
      uuid,
      status: desiredStatus,
      traffic_gb: plan.traffic_gb
    });

    res.json({
      ok: true,
      message: 'Remnwave синхронизирован с БД',
      uuid,
      expireAt: sub.expires_at,
      trafficLimitGb: plan.traffic_gb,
      status: desiredStatus,
      subscriptionUrl
    });
  } catch (error) {
    console.error('Error syncing subscription to Remnwave:', error);
    res.status(500).json({ error: error.message || 'Failed to sync' });
  }
});

/**
 * POST /api/admin/users/:id/subscription/create
 * Купить/создать подписку для пользователя (от имени админа)
 */
router.post('/:id/subscription/create', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const { planId, period } = req.body;
    if (!planId || !period) return res.status(400).json({ error: 'planId and period required' });

    const validPeriods = ['monthly', 'quarterly', 'yearly'];
    if (!validPeriods.includes(period)) return res.status(400).json({ error: 'Invalid period' });

    const planRes = await db.query('SELECT * FROM plans WHERE id = $1 AND is_active = true', [planId]);
    if (planRes.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    const plan = planRes.rows[0];

    let amount = 0;
    switch (period) {
      case 'monthly': amount = Number(plan.price_monthly); break;
      case 'quarterly': amount = Number(plan.price_quarterly); break;
      case 'yearly': amount = Number(plan.price_yearly); break;
    }

    const paymentRes = await db.query(
      `INSERT INTO payments (user_id, plan_id, amount, currency, period, status, payment_type, payment_source)
       VALUES ($1, $2, $3, 'RUB', $4, 'completed', 'subscription', 'admin')
       RETURNING *`,
      [userId, planId, amount, period]
    );

    const { activateSubscription } = require('../services/payment');
    await activateSubscription(paymentRes.rows[0]);

    await audit.write(req, 'subscription.create', { type: 'subscription', id: paymentRes.rows[0].id }, {
      user_id: userId,
      plan_id: planId,
      plan_name: plan.name,
      period,
      amount
    });

    res.json({ ok: true, message: 'Subscription activated' });
  } catch (error) {
    console.error('Error creating admin subscription:', error);
    res.status(500).json({ error: error.message || 'Failed to create subscription' });
  }
});

/**
 * PUT /api/admin/users/:id/toggle-admin
 * Сделать/убрать админа
 */
router.put('/:id/toggle-admin', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    // Проверить, что админ не убирает права сам у себя
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot change own admin status' });
    }

    // Получить текущий статус
    const userResult = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newAdminStatus = !userResult.rows[0].is_admin;

    // Обновить статус
    const result = await db.query(
      'UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2 RETURNING id, login, email, is_admin, is_active',
      [newAdminStatus, userId]
    );

    await audit.write(req, 'user.toggle_admin', { type: 'user', id: userId }, {
      is_admin_before: !newAdminStatus,
      is_admin_after: newAdminStatus
    });

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error toggling admin status:', error);
    res.status(500).json({ error: 'Failed to toggle admin status' });
  }
});

/**
 * PUT /api/admin/users/:id/toggle-active
 * Активировать/деактивировать пользователя
 */
router.put('/:id/toggle-active', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    // Проверить, что админ не деактивирует сам себя
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot disable yourself' });
    }

    // Получить текущий статус
    const userResult = await db.query('SELECT is_active FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newActiveStatus = !userResult.rows[0].is_active;

    // Обновить статус
    const result = await db.query(
      'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, login, email, is_admin, is_active',
      [newActiveStatus, userId]
    );

    await audit.write(req, 'user.toggle_active', { type: 'user', id: userId }, {
      is_active_before: !newActiveStatus,
      is_active_after: newActiveStatus
    });

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error toggling active status:', error);
    res.status(500).json({ error: 'Failed to toggle active status' });
  }
});

/**
 * PUT /api/admin/users/:id/email-confirmed
 * Admin toggle: вручную подтвердить email юзера или сбросить подтверждение.
 * body: { confirmed: boolean }
 */
router.put('/:id/email-confirmed', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { confirmed } = req.body || {};
    if (typeof confirmed !== 'boolean') {
      return res.status(400).json({ error: 'confirmed (boolean) required' });
    }
    const r = await db.query(
      'UPDATE users SET email_confirmed=$1, updated_at=NOW() WHERE id=$2 RETURNING id, email, email_confirmed',
      [confirmed, userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await audit.write(req, 'user.email_confirmed_toggle', { type: 'user', id: userId }, {
      confirmed,
    });
    res.json({ user: r.rows[0] });
  } catch (err) {
    console.error('email-confirmed toggle:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users/:id/subscription/:subId/calculate-change
 * Preview расчёта смены тарифа для конкретной подписки юзера. Без побочных эффектов.
 * body: { target_plan_id, period }
 */
router.post('/:id/subscription/:subId/calculate-change', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const subId  = parseInt(req.params.subId);
    const { target_plan_id, period = 'remaining' } = req.body || {};
    if (!target_plan_id) return res.status(400).json({ error: 'Missing target_plan_id' });

    const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
    const sub = subQ.rows[0];
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    let currentPlan = null;
    if (sub.plan_id) {
      const r = await db.query('SELECT * FROM plans WHERE id=$1', [sub.plan_id]);
      currentPlan = r.rows[0] || null;
    }
    if (!currentPlan && sub.plan_name) {
      const r = await db.query('SELECT * FROM plans WHERE name=$1 LIMIT 1', [sub.plan_name]);
      currentPlan = r.rows[0] || null;
    }

    const tgtQ = await db.query('SELECT * FROM plans WHERE id=$1', [target_plan_id]);
    const targetPlan = tgtQ.rows[0];
    if (!targetPlan) return res.status(404).json({ error: 'Target plan not found' });

    const planChange = require('../services/planChange');
    const calc = planChange.calculateChange({ subscription: sub, currentPlan, targetPlan, period });
    if (!calc.ok) return res.status(400).json(calc);

    res.json({
      ...calc,
      adminMode: true,
      subscription: {
        id: sub.id,
        plan_name: sub.plan_name,
        expires_at: sub.expires_at,
        traffic_used_gb: sub.traffic_used_gb,
        traffic_limit_gb: sub.traffic_limit_gb,
      },
    });
  } catch (err) {
    console.error('[admin-users change preview]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users/:id/subscription/:subId/change
 * Применить смену тарифа от имени админа — БЕСПЛАТНО, без оплаты.
 * body: { target_plan_id, period }
 *
 * Использует applyPlanChange() (обновляет БД + RemnaWave).
 * Audit логирует операцию.
 */
router.post('/:id/subscription/:subId/change', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const subId  = parseInt(req.params.subId);
    const { target_plan_id, period = 'remaining' } = req.body || {};
    if (!target_plan_id) return res.status(400).json({ error: 'Missing target_plan_id' });

    const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
    const sub = subQ.rows[0];
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    let currentPlan = null;
    if (sub.plan_id) {
      const r = await db.query('SELECT * FROM plans WHERE id=$1', [sub.plan_id]);
      currentPlan = r.rows[0] || null;
    }
    const tgtQ = await db.query('SELECT * FROM plans WHERE id=$1', [target_plan_id]);
    const targetPlan = tgtQ.rows[0];
    if (!targetPlan) return res.status(404).json({ error: 'Target plan not found' });

    const planChange = require('../services/planChange');
    const calc = planChange.calculateChange({ subscription: sub, currentPlan, targetPlan, period });
    if (!calc.ok) return res.status(400).json(calc);

    const paymentService = require('../services/payment');
    const result = await paymentService.applyPlanChange({
      subscriptionId: sub.id,
      targetPlanId: targetPlan.id,
      newExpiresAt: calc.newExpiresAt,
      period,
      amount: 0,
    });

    await audit.write(req, 'subscription.admin_change', { type: 'subscription', id: subId }, {
      user_id: userId,
      from_plan: currentPlan?.name || sub.plan_name,
      to_plan: targetPlan.name,
      period,
      payDifference_skipped: calc.payDifference,
      newExpiresAt: calc.newExpiresAt,
    });

    res.json({ ok: true, calc, result });
  } catch (err) {
    console.error('[admin-users change apply]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/users/:id/subscription/:subId
 * Удалить (soft) подписку юзера: is_active=false + опц. отключить юзера в RemnaWave.
 * Query: ?disable_remnwave=true (опционально, по умолчанию true)
 */
router.delete('/:id/subscription/:subId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const subId  = parseInt(req.params.subId);
    const disableRw = req.query.disable_remnwave !== 'false';

    const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
    const sub = subQ.rows[0];
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    let rwResult = { applied: false };
    if (disableRw && sub.remnwave_user_uuid) {
      try {
        const remnwave = require('../services/remnwave');
        await remnwave.disableRemnwaveUser(sub.remnwave_user_uuid);
        rwResult = { applied: true };
      } catch (err) {
        rwResult = { applied: false, error: err.message };
      }
    }

    await db.query(
      `UPDATE subscriptions SET is_active=false, expires_at=COALESCE(expires_at, NOW()), updated_at=NOW() WHERE id=$1`,
      [subId]
    );

    await audit.write(req, 'subscription.admin_delete', { type: 'subscription', id: subId }, {
      user_id: userId,
      plan_name: sub.plan_name,
      remnwave_disabled: rwResult.applied,
      remnwave_error: rwResult.error,
    });

    res.json({ ok: true, rw: rwResult });
  } catch (err) {
    console.error('[admin-users subscription delete]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Squad Quotas (admin actions) ────────────────────────────────────────────

/**
 * GET /api/admin/users/:id/subscription/:subId/squad-states
 * Возвращает все subscription_squad_state для подписки в текущем периоде +
 * историю покупок trafic.
 */
router.get('/:id/subscription/:subId/squad-states', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const subId = parseInt(req.params.subId);
    const userId = parseInt(req.params.id);
    const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
    const sub = subQ.rows[0];
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const squadQuota = require('../services/squadQuota');
    const settingsQ = await db.query('SELECT * FROM traffic_guard_settings WHERE id=1');
    const settings = settingsQ.rows[0];
    const periodKey = squadQuota.getCurrentPeriodKey(settings.squad_period_strategy, sub);

    const states = (await db.query(
      `SELECT * FROM subscription_squad_state
       WHERE subscription_id=$1 AND period_key=$2`,
      [sub.id, periodKey]
    )).rows;

    const purchases = (await db.query(
      `SELECT p.*, u.login AS granted_by_login
       FROM squad_traffic_purchases p
       LEFT JOIN users u ON u.id = p.granted_by
       WHERE p.subscription_id=$1 AND p.period_key=$2
       ORDER BY p.created_at DESC LIMIT 50`,
      [sub.id, periodKey]
    )).rows;

    res.json({ subscription_id: sub.id, period_key: periodKey, states, purchases });
  } catch (err) {
    console.error('[admin squad-states]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users/:id/subscription/:subId/squad/:squadUuid/reactivate
 * Manual reactivate squad'а (вернуть в RemnaWave) даже если usage > limit.
 */
router.post('/:id/subscription/:subId/squad/:squadUuid/reactivate', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const subId = parseInt(req.params.subId);
    const { squadUuid } = req.params;

    const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
    const sub = subQ.rows[0];
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const squadQuota = require('../services/squadQuota');
    const settingsQ = await db.query('SELECT * FROM traffic_guard_settings WHERE id=1');
    const periodKey = squadQuota.getCurrentPeriodKey(settingsQ.rows[0].squad_period_strategy, sub);

    const stateR = await db.query(
      `SELECT * FROM subscription_squad_state
       WHERE subscription_id=$1 AND squad_uuid=$2 AND period_key=$3`,
      [sub.id, squadUuid, periodKey]
    );
    if (!stateR.rows[0]) return res.status(404).json({ error: 'Squad state not found' });

    await squadQuota.reactivateSquad(sub, stateR.rows[0]);

    await audit.write(req, 'squad.admin_reactivate', { type: 'subscription_squad', id: stateR.rows[0].id }, {
      user_id: userId, subscription_id: sub.id, squad_uuid: squadUuid,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users/:id/subscription/:subId/squad/:squadUuid/reset
 * Сбросить used_bytes (admin override): начать счёт заново в текущем периоде.
 * Также реактивирует squad если был disabled.
 */
router.post('/:id/subscription/:subId/squad/:squadUuid/reset', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const subId = parseInt(req.params.subId);
    const { squadUuid } = req.params;

    const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
    const sub = subQ.rows[0];
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const squadQuota = require('../services/squadQuota');
    const settingsQ = await db.query('SELECT * FROM traffic_guard_settings WHERE id=1');
    const periodKey = squadQuota.getCurrentPeriodKey(settingsQ.rows[0].squad_period_strategy, sub);

    const stateR = await db.query(
      `UPDATE subscription_squad_state
       SET used_bytes = 0, warned_80_at = NULL, updated_at = NOW()
       WHERE subscription_id=$1 AND squad_uuid=$2 AND period_key=$3
       RETURNING *`,
      [sub.id, squadUuid, periodKey]
    );
    const state = stateR.rows[0];
    if (!state) return res.status(404).json({ error: 'Squad state not found' });

    // Если был disabled — реактивируем (т.к. usage обнулён)
    if (state.is_disabled) {
      await squadQuota.reactivateSquad(sub, state);
    }

    await audit.write(req, 'squad.admin_reset_usage', { type: 'subscription_squad', id: state.id }, {
      user_id: userId, subscription_id: sub.id, squad_uuid: squadUuid,
    });
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users/:id/subscription/:subId/squad/:squadUuid/gift
 * Подарить N ГБ extra на squad (бесплатно, от админа).
 * body: { gb_amount, notes }
 */
router.post('/:id/subscription/:subId/squad/:squadUuid/gift', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const subId = parseInt(req.params.subId);
    const { squadUuid } = req.params;
    const { gb_amount, notes } = req.body || {};
    const gb = Number(gb_amount);
    if (!gb || gb <= 0) return res.status(400).json({ error: 'Invalid gb_amount' });

    const subQ = await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
    const sub = subQ.rows[0];
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const squadQuota = require('../services/squadQuota');
    const result = await squadQuota.addExtraTraffic({
      subscription: sub,
      squadUuid,
      gbAmount: gb,
      source: 'admin_gift',
      amountPaid: 0,
      paymentId: null,
      grantedBy: req.user.id,
      notes: notes || null,
    });

    await audit.write(req, 'squad.admin_gift_traffic', { type: 'subscription_squad', id: result.id }, {
      user_id: userId, subscription_id: sub.id, squad_uuid: squadUuid, gb_amount: gb,
    });
    res.json({ ok: true, state: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
