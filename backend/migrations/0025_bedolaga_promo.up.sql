-- Накопительная база активаций промокодов Bedolaga.
--
-- Зачем своя таблица: API бота отдаёт по каждому промокоду только 10 последних
-- активаций и не умеет пагинировать их (подтверждено документацией). Поэтому
-- регулярно опрашиваем и складываем к себе — так со временем набирается
-- история глубже десяти записей.

CREATE TABLE IF NOT EXISTS bedolaga_promo_uses (
  id             SERIAL PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,

  -- id записи об использовании на стороне Bedolaga. Стабилен, поэтому пара
  -- (account_id, use_id) — ключ идемпотентности: повторные синхронизации
  -- не плодят дубли.
  use_id         INTEGER NOT NULL,

  promocode_id   INTEGER NOT NULL,
  -- Код и номинал денормализованы намеренно: промокод в боте могут удалить,
  -- а история активаций должна это пережить.
  code           VARCHAR(128),
  promo_type     VARCHAR(64),
  subscription_days      INTEGER DEFAULT 0,
  balance_bonus_kopeks   INTEGER DEFAULT 0,

  user_id          INTEGER,
  user_telegram_id BIGINT,
  user_username    VARCHAR(255),
  user_full_name   VARCHAR(255),

  used_at        TIMESTAMPTZ,
  first_seen_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT bedolaga_promo_uses_uniq UNIQUE (account_id, use_id)
);

CREATE INDEX IF NOT EXISTS idx_bpu_used_at     ON bedolaga_promo_uses (used_at DESC);
CREATE INDEX IF NOT EXISTS idx_bpu_promocode   ON bedolaga_promo_uses (promocode_id);
CREATE INDEX IF NOT EXISTS idx_bpu_user        ON bedolaga_promo_uses (user_id);
CREATE INDEX IF NOT EXISTS idx_bpu_telegram    ON bedolaga_promo_uses (user_telegram_id);


-- Состояние синхронизации: по строке на аккаунт.
CREATE TABLE IF NOT EXISTS bedolaga_promo_sync_state (
  account_id   INTEGER PRIMARY KEY REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,
  last_run_at  TIMESTAMPTZ,
  status       VARCHAR(32),          -- ok | error
  error        TEXT,
  added        INTEGER DEFAULT 0,    -- добавлено записей на последнем прогоне

  -- Снимок current_uses по каждому промокоду на момент прошлого прогона:
  -- { "<promocode_id>": <current_uses> }.
  -- Нужен, чтобы поймать потерю данных: если счётчик вырос больше чем на 10,
  -- часть активаций уже не попала в recent_uses и утеряна безвозвратно.
  -- Пропуски копим в missed_total и показываем в интерфейсе, а не замалчиваем.
  seen_uses    JSONB DEFAULT '{}'::jsonb,
  missed_total INTEGER DEFAULT 0,
  missed_note  TEXT
);
