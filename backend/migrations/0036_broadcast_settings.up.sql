-- Настройки и шаблоны рассылок Bedolaga.
--
-- У API бота нет ни отмены, ни паузы, ни лимитов частоты — всё это может
-- существовать только на нашей стороне и проверяться ДО вызова.
--
-- Одна строка (id = 1), как у telegram_settings и payment_settings.
CREATE TABLE IF NOT EXISTS broadcast_settings (
  id                      INTEGER PRIMARY KEY DEFAULT 1,

  -- Минимальный промежуток между рассылками. Проверяется по нашему журналу
  -- отправок, а не по истории бота: там лежат и рассылки, отправленные мимо
  -- нашей админки, и подменять одно другим неверно.
  min_interval_minutes    INTEGER NOT NULL DEFAULT 60,
  -- 0 = без ограничения
  max_per_week            INTEGER NOT NULL DEFAULT 0,

  -- Тихие часы. Хранятся часами 0..23; окно может пересекать полночь
  -- (22 → 9 означает «с 22 вечера до 9 утра»).
  quiet_from_hour         INTEGER,
  quiet_to_hour           INTEGER,
  -- Смещение пояса в минутах: у бота аудитория в МСК, сервер живёт в UTC.
  timezone_offset_minutes INTEGER NOT NULL DEFAULT 180,

  -- С какого размера сегмента требовать ввод числа получателей вручную.
  confirm_typing_threshold INTEGER NOT NULL DEFAULT 1000,

  -- Сегменты, разрешённые к отправке. Пусто = все.
  allowed_targets         TEXT[] NOT NULL DEFAULT '{}',

  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT broadcast_settings_single CHECK (id = 1),
  CONSTRAINT broadcast_quiet_from_chk CHECK (quiet_from_hour IS NULL OR quiet_from_hour BETWEEN 0 AND 23),
  CONSTRAINT broadcast_quiet_to_chk   CHECK (quiet_to_hour   IS NULL OR quiet_to_hour   BETWEEN 0 AND 23)
);

INSERT INTO broadcast_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- Шаблоны: образцы, под которые подстраивается ИИ и которыми пользуется
-- человек. По образцу ai_reply_templates у ассистента тикетов.
CREATE TABLE IF NOT EXISTS broadcast_templates (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  -- Когда уместен — текстом, для модели и для человека
  occasion       TEXT,
  body           TEXT NOT NULL,
  target_default VARCHAR(32),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broadcast_templates_active_idx
  ON broadcast_templates (is_active, sort_order);


-- Свой журнал отправок. Нужен отдельно от истории бота: лимиты частоты
-- считаются по тому, что отправили МЫ, и здесь же хранится, кто нажал кнопку
-- и был ли это человек или ИИ.
CREATE TABLE IF NOT EXISTS broadcast_log (
  id             SERIAL PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,
  broadcast_id   INTEGER,                       -- id на стороне бота
  target         VARCHAR(32) NOT NULL,
  message_text   TEXT NOT NULL,
  recipients     INTEGER,
  source         VARCHAR(16) NOT NULL DEFAULT 'manual',   -- manual | ai
  template_id    INTEGER REFERENCES broadcast_templates(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broadcast_log_recent_idx
  ON broadcast_log (account_id, created_at DESC);
