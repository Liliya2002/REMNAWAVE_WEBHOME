-- Свои промокоды: скидки на оплату, бонусные дни и пополнение баланса.
--
-- Не путать с bedolaga_promo_uses (миграция 0025) — там мониторинг чужого
-- бота продаж, только чтение. Здесь наши собственные коды.
--
-- Начисления переиспользуют существующие механизмы: дни идут в
-- users.pending_bonus_days (как реферальные, применяются через
-- POST /api/subscriptions/apply-bonus), деньги — проводкой в
-- wallet_transactions. Своей «промо-валюты» нет.

CREATE TABLE IF NOT EXISTS promo_codes (
  id                  SERIAL PRIMARY KEY,

  -- code — как ввёл админ, показываем его. Поиск идёт по code_normalized
  -- (UPPER, без пробелов и дефисов): пользователь набирает как придётся.
  code                VARCHAR(64)   NOT NULL,
  code_normalized     VARCHAR(64)   NOT NULL,

  type                VARCHAR(16)   NOT NULL,
  value               NUMERIC(12,2) NOT NULL,

  -- Ограничения. NULL везде означает «не ограничено».
  max_uses            INTEGER,
  max_uses_per_user   INTEGER       NOT NULL DEFAULT 1,
  starts_at           TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  min_amount          NUMERIC(12,2),
  plan_ids            INTEGER[]     NOT NULL DEFAULT '{}',
  periods             TEXT[]        NOT NULL DEFAULT '{}',
  first_purchase_only BOOLEAN       NOT NULL DEFAULT false,
  new_users_only_days INTEGER,

  -- Персональный код: работает только у этого пользователя. Нужен для
  -- компенсаций за простой — когда тикет эскалирован человеку и человеку
  -- надо чем-то ответить.
  assigned_user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,

  is_active           BOOLEAN       NOT NULL DEFAULT true,
  batch_label         VARCHAR(64),
  comment             TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT promo_codes_type_chk  CHECK (type IN ('percent','fixed','days','balance')),
  CONSTRAINT promo_codes_value_chk CHECK (value > 0),
  -- Процент больше 100 — это не скидка, а доплата клиенту.
  CONSTRAINT promo_codes_percent_chk CHECK (type <> 'percent' OR value <= 100),
  CONSTRAINT promo_codes_window_chk CHECK (starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_normalized_uniq
  ON promo_codes (code_normalized);

CREATE INDEX IF NOT EXISTS promo_codes_batch_idx
  ON promo_codes (batch_label) WHERE batch_label IS NOT NULL;


CREATE TABLE IF NOT EXISTS promo_code_uses (
  id               SERIAL PRIMARY KEY,

  -- RESTRICT, а не CASCADE: журнал активаций обязан пережить код. Коды не
  -- удаляют, а деактивируют; попытка удалить код с активациями должна
  -- падать на уровне БД, а не тихо стирать историю начислений.
  promo_id         INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE RESTRICT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id       INTEGER REFERENCES payments(id) ON DELETE SET NULL,

  status           VARCHAR(16) NOT NULL,

  discount_amount  NUMERIC(12,2),
  granted_days     NUMERIC(10,2),
  granted_balance  NUMERIC(12,2),
  -- Цена до скидки. В payments.amount лежит сумма СО скидкой (её сверяет
  -- вебхук платёжки), поэтому оригинал больше нигде не сохранился.
  original_amount  NUMERIC(12,2),

  -- Подтверждено сверх лимита. Платёж может подтвердиться после того, как
  -- резерв истёк и ушёл другому: отказать в скидке уже заплатившему хуже,
  -- чем выпустить активацию сверх лимита. Флаг для разбора админом.
  over_limit       BOOLEAN NOT NULL DEFAULT false,

  reserved_until   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at       TIMESTAMPTZ,
  released_at      TIMESTAMPTZ,

  CONSTRAINT promo_uses_status_chk CHECK (status IN ('reserved','applied','released'))
);

-- Повторный вебхук по тому же платежу не должен задвоить активацию.
CREATE UNIQUE INDEX IF NOT EXISTS promo_uses_payment_uniq
  ON promo_code_uses (promo_id, payment_id) WHERE payment_id IS NOT NULL;

-- Лимит на пользователя
CREATE INDEX IF NOT EXISTS promo_uses_user_idx
  ON promo_code_uses (promo_id, user_id);

-- Освобождение протухших резервов и подсчёт занятых активаций
CREATE INDEX IF NOT EXISTS promo_uses_status_idx
  ON promo_code_uses (status, reserved_until);
