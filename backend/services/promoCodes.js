/**
 * Промокоды: проверка, резервирование и начисление.
 *
 * Единственное место, где считается скидка. Клиент присылает ТОЛЬКО строку
 * кода — сумма, скидка и итог никогда не приходят снаружи.
 *
 * ── Жизненный цикл активации ───────────────────────────────────────────────
 *
 *     reserved ──платёж completed──→ applied
 *         │
 *         └──платёж failed/expired──→ released
 *
 * Резерв нужен потому, что оплата через шлюз живёт до 30 минут и может не
 * состояться. Считать код потраченным сразу — брошенная оплата сожжёт
 * активацию; считать только при подтверждении — пользователь откроет пять
 * вкладок с одноразовым кодом и оплатит все пять.
 *
 * ── Четыре правила, на которых всё держится ────────────────────────────────
 *
 * 1. Корректность не зависит от крона. Резерв с истёкшим reserved_until не
 *    учитывается в лимите самим запросом, то есть код освобождается по
 *    времени. Крон (expireOldPayments) только проставляет released для
 *    отчётов; если он не отработает, ничего не сломается.
 *
 * 2. reserved_until = час, а не payments.expires_at. На момент резерва
 *    expires_at ещё НЕ записан: в POST /create он появляется только после
 *    ответа платёжки. Час — тот же запас, что использует expireOldPayments
 *    для платежей без expires_at.
 *
 * 3. confirm() лимит НЕ проверяет. Платёж в статусе expired может стать
 *    completed (починено в v0.2.1) — подтверждение по СБП приходит и через
 *    час, когда резерв уже истёк и мог уйти другому. Отказать в скидке
 *    человеку, который уже заплатил, хуже, чем выпустить активацию сверх
 *    лимита: ставим over_limit и сообщаем админу.
 *
 * 4. Скидка считается один раз и сохраняется. confirm() берёт сохранённое
 *    значение, а не пересчитывает: правка кода между оплатой и вебхуком не
 *    должна менять уже согласованную сумму.
 */
const db = require('../db')
const { getOrCreateWallet, addWalletTransaction } = require('./wallet')

// Сколько живёт резерв. См. правило 2.
const RESERVE_TTL_MS = 60 * 60 * 1000

const TYPES = ['percent', 'fixed', 'days', 'balance']
// Типы, которые применяются к оплате, и типы, которые активируются сами.
const DISCOUNT_TYPES = ['percent', 'fixed']
const GRANT_TYPES = ['days', 'balance']

// Причины отказа. Строкой наружу, чтобы фронт и бот показали свой текст.
const REASONS = {
  NOT_FOUND: 'not_found',
  INACTIVE: 'inactive',
  NOT_STARTED: 'not_started',
  EXPIRED: 'expired',
  EXHAUSTED: 'exhausted',
  USER_LIMIT: 'user_limit',
  NOT_ASSIGNED: 'not_assigned',
  PLAN_MISMATCH: 'plan_mismatch',
  PERIOD_MISMATCH: 'period_mismatch',
  MIN_AMOUNT: 'min_amount',
  FIRST_PURCHASE_ONLY: 'first_purchase_only',
  TOO_OLD_ACCOUNT: 'too_old_account',
  WRONG_TYPE: 'wrong_type',
}

const MESSAGES = {
  [REASONS.NOT_FOUND]: 'Промокод не найден',
  [REASONS.INACTIVE]: 'Промокод отключён',
  [REASONS.NOT_STARTED]: 'Промокод ещё не начал действовать',
  [REASONS.EXPIRED]: 'Срок действия промокода истёк',
  [REASONS.EXHAUSTED]: 'Промокод исчерпан',
  [REASONS.USER_LIMIT]: 'Вы уже использовали этот промокод',
  [REASONS.NOT_ASSIGNED]: 'Промокод не найден',           // намеренно как NOT_FOUND
  [REASONS.PLAN_MISMATCH]: 'Промокод не действует для этого тарифа',
  [REASONS.PERIOD_MISMATCH]: 'Промокод не действует для этого периода',
  [REASONS.MIN_AMOUNT]: 'Сумма заказа меньше минимальной для этого промокода',
  [REASONS.FIRST_PURCHASE_ONLY]: 'Промокод только для первой покупки',
  [REASONS.TOO_OLD_ACCOUNT]: 'Промокод только для новых аккаунтов',
  [REASONS.WRONG_TYPE]: 'Этот промокод применяется при оплате, а не отдельно',
}

/**
 * Нормализация кода для поиска: верхний регистр, без пробелов и дефисов.
 * Пользователь набирает как придётся, а «ABCD-1234» и «abcd1234» — один код.
 */
function normalize(code) {
  return String(code || '').toUpperCase().replace(/[\s\-_]/g, '')
}

/** Округление вверх до копейки — в пользу клиента. */
function roundUpKopecks(v) {
  return Math.ceil((Number(v) + Number.EPSILON) * 100) / 100
}

/**
 * Скидка по коду. Возвращает {discount, finalAmount}, оба с точностью
 * до копейки. finalAmount никогда не отрицателен.
 */
function computeDiscount(promo, amount) {
  const base = Number(amount)
  let discount = promo.type === 'percent'
    ? roundUpKopecks(base * Number(promo.value) / 100)
    : roundUpKopecks(Number(promo.value))

  if (discount > base) discount = base
  return { discount, finalAmount: Math.round((base - discount) * 100) / 100 }
}

const fail = reason => ({ ok: false, reason, message: MESSAGES[reason] || 'Промокод недоступен' })

/**
 * Сколько активаций занято. Учитываются applied и НЕ протухшие reserved.
 * Правило 1: протухший резерв освобождается сам, без участия крона.
 */
async function countUses(client, promoId, userId = null) {
  const params = [promoId]
  let sql = `SELECT COUNT(*)::int AS n FROM promo_code_uses
              WHERE promo_id = $1
                AND (status = 'applied'
                     OR (status = 'reserved' AND reserved_until > NOW()))`
  if (userId != null) {
    params.push(userId)
    sql += ` AND user_id = $${params.length}`
  }
  const { rows } = await client.query(sql, params)
  return rows[0].n
}

/** Поиск кода по нормализованной форме. */
async function findByCode(client, code) {
  const { rows } = await client.query(
    'SELECT * FROM promo_codes WHERE code_normalized = $1',
    [normalize(code)]
  )
  return rows[0] || null
}

/**
 * Проверка кода.
 *
 * @param {string} code
 * @param {object} ctx
 * @param {number} ctx.userId
 * @param {number} [ctx.planId]   для скидочных типов
 * @param {string} [ctx.period]   для скидочных типов
 * @param {number} [ctx.amount]   сумма заказа до скидки
 * @param {object} [ctx.client]   клиент в транзакции; иначе пул
 * @param {boolean} [ctx.forUpdate] взять код под блокировку (для reserve)
 * @param {string[]} [ctx.allowTypes] какие типы допустимы в этом контексте
 */
async function validate(code, ctx = {}) {
  const client = ctx.client || db
  const promo = ctx.forUpdate
    ? (await client.query('SELECT * FROM promo_codes WHERE code_normalized = $1 FOR UPDATE', [normalize(code)])).rows[0]
    : await findByCode(client, code)

  if (!promo) return fail(REASONS.NOT_FOUND)

  const allow = ctx.allowTypes || TYPES
  if (!allow.includes(promo.type)) return fail(REASONS.WRONG_TYPE)

  if (!promo.is_active) return fail(REASONS.INACTIVE)

  const now = Date.now()
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now) return fail(REASONS.NOT_STARTED)
  if (promo.expires_at && new Date(promo.expires_at).getTime() <= now) return fail(REASONS.EXPIRED)

  // Персональный код у чужого аккаунта отдаём как «не найден»: иначе по
  // ответу можно узнать, что код существует и кому он выдан.
  if (promo.assigned_user_id && promo.assigned_user_id !== ctx.userId) {
    return fail(REASONS.NOT_ASSIGNED)
  }

  if (promo.max_uses != null) {
    if (await countUses(client, promo.id) >= promo.max_uses) return fail(REASONS.EXHAUSTED)
  }
  if (promo.max_uses_per_user != null) {
    if (await countUses(client, promo.id, ctx.userId) >= promo.max_uses_per_user) {
      return fail(REASONS.USER_LIMIT)
    }
  }

  // Ограничения по аккаунту
  if (promo.first_purchase_only || promo.new_users_only_days != null) {
    const { rows } = await client.query('SELECT created_at FROM users WHERE id = $1', [ctx.userId])
    if (!rows[0]) return fail(REASONS.NOT_FOUND)

    if (promo.new_users_only_days != null) {
      const ageDays = (now - new Date(rows[0].created_at).getTime()) / 86400000
      if (ageDays > promo.new_users_only_days) return fail(REASONS.TOO_OLD_ACCOUNT)
    }

    if (promo.first_purchase_only) {
      // Считается только оплаченная ПОДПИСКА. Пополнение баланса покупкой
      // не является, иначе код «на первую покупку» сгорал бы от пополнения.
      const paid = await client.query(
        `SELECT 1 FROM payments
          WHERE user_id = $1 AND status = 'completed' AND payment_type = 'subscription'
          LIMIT 1`,
        [ctx.userId]
      )
      if (paid.rows.length) return fail(REASONS.FIRST_PURCHASE_ONLY)
    }
  }

  // Дальше — только для скидочных типов
  if (!DISCOUNT_TYPES.includes(promo.type)) {
    return { ok: true, promo }
  }

  if (promo.plan_ids?.length && !promo.plan_ids.includes(Number(ctx.planId))) {
    return fail(REASONS.PLAN_MISMATCH)
  }
  if (promo.periods?.length && !promo.periods.includes(ctx.period)) {
    return fail(REASONS.PERIOD_MISMATCH)
  }

  const amount = Number(ctx.amount)
  if (!Number.isFinite(amount) || amount <= 0) return fail(REASONS.MIN_AMOUNT)
  if (promo.min_amount != null && amount < Number(promo.min_amount)) return fail(REASONS.MIN_AMOUNT)

  const { discount, finalAmount } = computeDiscount(promo, amount)
  return { ok: true, promo, originalAmount: amount, discount, finalAmount }
}

/**
 * Резерв активации под платёж. Вызывать ТОЛЬКО в транзакции, где код уже
 * взят под FOR UPDATE (validate с forUpdate: true) — иначе два параллельных
 * запроса с последней активацией пройдут оба.
 */
async function reserve(client, promo, { userId, paymentId, discount, originalAmount }) {
  const { rows } = await client.query(
    `INSERT INTO promo_code_uses
       (promo_id, user_id, payment_id, status, discount_amount, original_amount, reserved_until)
     VALUES ($1, $2, $3, 'reserved', $4, $5, $6)
     RETURNING id`,
    [promo.id, userId, paymentId, discount, originalAmount, new Date(Date.now() + RESERVE_TTL_MS)]
  )
  return rows[0].id
}

/**
 * Подтверждение: платёж оплачен. Лимит НЕ проверяется — см. правило 3.
 * Возвращает { applied, overLimit, use } или null, если резерва не было.
 */
async function confirm(client, paymentId) {
  const { rows } = await client.query(
    `SELECT * FROM promo_code_uses
      WHERE payment_id = $1 AND status = 'reserved' FOR UPDATE`,
    [paymentId]
  )
  const use = rows[0]
  if (!use) return null

  // Резерв протух — активацию всё равно применяем, но помечаем: деньги уже
  // получены, отказывать в скидке поздно.
  const overLimit = use.reserved_until != null && new Date(use.reserved_until).getTime() < Date.now()

  await client.query(
    `UPDATE promo_code_uses
        SET status = 'applied', applied_at = NOW(), over_limit = $2
      WHERE id = $1`,
    [use.id, overLimit]
  )

  if (overLimit) {
    console.warn(`[Promo] активация #${use.id} (код ${use.promo_id}) подтверждена после истечения резерва — возможно превышение лимита`)
  }
  return { applied: true, overLimit, use }
}

/**
 * Возврат активации в оборот. Идемпотентно.
 *
 * Освобождает и reserved, и applied — намеренно. Три случая, когда уже
 * подтверждённую активацию нужно вернуть:
 *   • чарджбэк (completed → refunded): покупки не было;
 *   • компенсация после неудачной активации подписки — деньги вернули на
 *     баланс, значит и код должен снова стать доступен;
 *   • ошибка шлюза сразу после резерва.
 * Оставить её applied означало бы, что человек потратил код на то, что в
 * итоге не получил.
 *
 * Вызывается только с путей отката, поэтому широкое условие безопасно.
 */
async function release(client, paymentId, note = null) {
  const { rowCount } = await client.query(
    `UPDATE promo_code_uses
        SET status = 'released', released_at = NOW()
      WHERE payment_id = $1 AND status IN ('reserved', 'applied')`,
    [paymentId]
  )
  if (rowCount && note) console.log(`[Promo] активация по платежу ${paymentId} освобождена: ${note}`)
  return rowCount
}

/**
 * Активация кода без покупки: days и balance.
 * Собственная транзакция — вызывается из своего эндпоинта, не из оплаты.
 */
async function redeem(userId, code) {
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')

    const res = await validate(code, {
      userId, client, forUpdate: true, allowTypes: GRANT_TYPES,
    })
    if (!res.ok) { await client.query('ROLLBACK'); return res }

    const promo = res.promo
    const value = Number(promo.value)
    let granted = { days: 0, balance: 0 }

    if (promo.type === 'days') {
      await client.query(
        'UPDATE users SET pending_bonus_days = COALESCE(pending_bonus_days, 0) + $1 WHERE id = $2',
        [value, userId]
      )
      granted.days = value
    } else {
      const wallet = await getOrCreateWallet(client, userId)
      const before = Number(wallet.balance || 0)
      const after = Math.round((before + value) * 100) / 100

      await client.query(
        'UPDATE user_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
        [after, userId]
      )
      await addWalletTransaction(client, {
        userId,
        type: 'promo',
        direction: 'in',
        amount: value,
        currency: 'RUB',
        balanceBefore: before,
        balanceAfter: after,
        referenceType: 'promo_code',
        referenceId: promo.id,
        description: `Промокод ${promo.code}`,
        metadata: { code: promo.code },
      })
      granted.balance = value
    }

    await client.query(
      `INSERT INTO promo_code_uses
         (promo_id, user_id, status, granted_days, granted_balance, applied_at)
       VALUES ($1, $2, 'applied', $3, $4, NOW())`,
      [promo.id, userId, granted.days || null, granted.balance || null]
    )

    await client.query('COMMIT')
    return { ok: true, promo, granted }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  normalize,
  computeDiscount,
  validate,
  reserve,
  confirm,
  release,
  redeem,
  countUses,
  RESERVE_TTL_MS,
  TYPES,
  DISCOUNT_TYPES,
  GRANT_TYPES,
  REASONS,
  MESSAGES,
}
