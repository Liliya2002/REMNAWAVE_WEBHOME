-- ИИ-ассистент поддержки: отвечает на тикеты Bedolaga.
--
-- Три сущности: настройки (одна строка), шаблоны примерных ответов
-- и журнал всего, что ассистент сделал или отказался делать.

CREATE TABLE IF NOT EXISTS ai_assistant_settings (
  id            SERIAL PRIMARY KEY,

  -- Подключение. Провайдер Anthropic-совместимый (Customix и подобные),
  -- поэтому хватает базового URL + модели: официальный SDK работает с ними
  -- через подмену baseURL.
  enabled       BOOLEAN     DEFAULT false,
  api_key       TEXT,                     -- ВСЕГДА через encrypt(), наружу только has_key
  base_url      VARCHAR(512) DEFAULT 'https://customix.fun/api',
  model         VARCHAR(128) DEFAULT 'claude-opus-4-8',
  effort        VARCHAR(16)  DEFAULT 'low',
  max_tokens    INTEGER      DEFAULT 8000,
  reply_char_limit INTEGER   DEFAULT 1200, -- предел длины ответа клиенту

  -- Отсечка бэклога. Ставится в момент включения ассистента: отвечаем только
  -- на тикеты, СОЗДАННЫЕ ПОЗЖЕ этой отметки. Отдельного лимита возраста мало —
  -- увеличив его потом, можно случайно запустить ИИ в старую переписку.
  started_at    TIMESTAMPTZ,
  max_ticket_age_hours INTEGER DEFAULT 48,

  -- Поведение
  can_close_tickets BOOLEAN DEFAULT true,  -- разрешено ли закрывать решённые
  confidence_threshold NUMERIC(3,2) DEFAULT 0.75,
  poll_interval_min INTEGER DEFAULT 10,

  -- Стоп-слова: при совпадении ИИ не отвечает, тикет уходит человеку.
  -- Первый из двух слоёв защиты; второй — классификация моделью.
  -- Держим в БД, чтобы пополнять без релиза.
  stop_words    TEXT[] DEFAULT ARRAY[
    'возврат', 'верните деньг', 'вернуть деньг', 'вернуть средств',
    'отмените платеж', 'отмена платеж', 'чарджбэк', 'chargeback',
    'списали дважды', 'двойное списание', 'списали лишн', 'refund'
  ],

  system_prompt TEXT,                      -- базовая роль; шаблоны подмешиваются отдельно
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ai_assistant_settings (id) SELECT 1
  WHERE NOT EXISTS (SELECT 1 FROM ai_assistant_settings);


-- Примерные ответы: показывают ассистенту тон и формулировки.
CREATE TABLE IF NOT EXISTS ai_reply_templates (
  id         SERIAL PRIMARY KEY,
  category   VARCHAR(64),                  -- подключение / оплата / скорость / ...
  question   TEXT NOT NULL,                -- типичная формулировка клиента
  answer     TEXT NOT NULL,                -- как отвечать
  priority   INTEGER DEFAULT 100,          -- меньше — выше в промпте
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_art_active ON ai_reply_templates (is_active, priority);


-- Журнал. Пишем и отправленные ответы, и отказы — по нему видно, почему
-- ассистент промолчал, и он же защищает от повторного ответа.
CREATE TABLE IF NOT EXISTS ai_ticket_replies (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,
  ticket_id     INTEGER NOT NULL,

  -- id последнего сообщения клиента на момент обработки. Вместе с тикетом
  -- образует ключ идемпотентности: на одно и то же сообщение не отвечаем дважды,
  -- но на новое сообщение в том же тикете — отвечаем.
  last_message_id INTEGER NOT NULL,

  action        VARCHAR(24) NOT NULL,      -- replied | escalated | closed | error
  escalation_reason VARCHAR(64),           -- stop_word | model_refund_flag | low_confidence |
                                           -- needs_human | too_old | classify_failed | api_error
  reply_text    TEXT,
  category      VARCHAR(64),
  confidence    NUMERIC(3,2),
  resolved      BOOLEAN,
  closed_ticket BOOLEAN DEFAULT false,

  input_tokens  INTEGER,
  output_tokens INTEGER,
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT ai_ticket_replies_uniq UNIQUE (account_id, ticket_id, last_message_id)
);

CREATE INDEX IF NOT EXISTS idx_atr_created ON ai_ticket_replies (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atr_action  ON ai_ticket_replies (action);
CREATE INDEX IF NOT EXISTS idx_atr_ticket  ON ai_ticket_replies (account_id, ticket_id);
