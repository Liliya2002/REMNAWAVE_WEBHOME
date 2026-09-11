/**
 * Кошелёк пользователя: схема и низкоуровневые операции.
 *
 * Вынесено из routes/payments.js, где эти функции жили изначально. Причина не
 * косметическая: промокоды (services/promoCodes.js) начисляют деньги на
 * кошелёк, а routes/payments.js вызывает промокоды при оплате. Оставь
 * помощники в роуте — получится цикл services → routes → services, и Node
 * отдаст частично инициализированный модуль. В коде, который двигает деньги,
 * такое отлаживать невозможно.
 *
 * Все операции принимают client (клиент из пула), а не работают через
 * db.query: они обязаны выполняться в транзакции вызывающего. Исключение —
 * ensureWalletSchema, он одноразовый и к деньгам отношения не имеет.
 */
const db = require('../db')

let schemaEnsured = false

/**
 * Создаёт таблицы кошелька и недостающие колонки payments.
 * Идемпотентно, результат кешируется на процесс.
 */
async function ensureWalletSchema() {
  if (schemaEnsured) return

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_wallets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

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
  `)

  await db.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference ON wallet_transactions(reference_type, reference_id)`)

  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'subscription'`)
  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_source VARCHAR(30) NOT NULL DEFAULT 'gateway'`)
  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_transaction_id INTEGER REFERENCES wallet_transactions(id) ON DELETE SET NULL`)
  await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS webhook_processed_at TIMESTAMP`)

  // Защита от дублей записей платежа с одним transactionId провайдера
  // (если существующие данные содержат дубли — индекс не создастся, залогируем warning).
  try {
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment_id
      ON payments(provider_payment_id)
      WHERE provider_payment_id IS NOT NULL
    `)
  } catch (err) {
    console.error('[SECURITY] Failed to create UNIQUE index on payments.provider_payment_id — возможно, есть дубли. Проверьте вручную.', err.message)
  }

  schemaEnsured = true
}

/**
 * Кошелёк пользователя под блокировкой FOR UPDATE. Создаёт при отсутствии.
 * Вызывать только внутри транзакции — иначе блокировка снимется сразу.
 */
async function getOrCreateWallet(client, userId) {
  let walletRes = await client.query(
    'SELECT user_id, balance, currency FROM user_wallets WHERE user_id = $1 FOR UPDATE',
    [userId]
  )

  if (walletRes.rows.length === 0) {
    await client.query(
      'INSERT INTO user_wallets (user_id, balance, currency) VALUES ($1, 0, $2)',
      [userId, 'RUB']
    )
    walletRes = await client.query(
      'SELECT user_id, balance, currency FROM user_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    )
  }

  return walletRes.rows[0]
}

/** Проводка по кошельку. Баланс не меняет — это делает вызывающий. */
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
  )

  return txRes.rows[0].id
}

module.exports = {
  ensureWalletSchema,
  getOrCreateWallet,
  addWalletTransaction,
}
