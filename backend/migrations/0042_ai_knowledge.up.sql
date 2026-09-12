-- База знаний ассистента: как на такие вопросы отвечали живые люди.
--
-- Зачем. До этого ассистент не учился вообще: промпт собирался из статичного
-- текста и горстки шаблонов, написанных руками. Журнал ai_ticket_replies
-- копил его собственные ответы, но обратно в промпт они не попадали никогда —
-- на сотом тикете модель знала ровно столько же, сколько на первом.
--
-- Никакого дообучения модели тут нет и быть не может: веса не наши. Работает
-- иначе — храним пары «вопрос клиента → ответ оператора» и перед каждым
-- обращением подкладываем модели несколько самых близких. Снаружи это и есть
-- «учится»: чем больше разобранных тикетов, тем ближе ответы к тому, как
-- отвечает живая поддержка.
CREATE TABLE IF NOT EXISTS ai_knowledge (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,

  -- Откуда пример:
  --   history  — разбор прошлых тикетов, отвечал человек;
  --   operator — оператор ответил ПОСЛЕ ассистента, то есть поправил его;
  --   manual   — админ добавил руками.
  source        TEXT NOT NULL DEFAULT 'history',
  ticket_id     INTEGER,

  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  category      TEXT,

  -- Вес при подборе. Поправка оператора ценнее рядового примера из истории:
  -- она показывает место, где ассистент ошибся, а человек знал, как надо.
  weight        INTEGER NOT NULL DEFAULT 1,

  is_active     BOOLEAN NOT NULL DEFAULT true,
  used_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,

  -- Отпечаток пары: один и тот же диалог не должен попасть в базу дважды,
  -- сколько бы раз сборщик ни прошёл по тикетам.
  fingerprint   TEXT NOT NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_knowledge DROP CONSTRAINT IF EXISTS ai_knowledge_source_chk;
ALTER TABLE ai_knowledge ADD CONSTRAINT ai_knowledge_source_chk
  CHECK (source IN ('history', 'operator', 'manual'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_knowledge_fingerprint
  ON ai_knowledge (account_id, fingerprint);

-- Поиск по вопросу. Русская конфигурация, потому что со стеммингом:
-- «не работает на айфоне» находит «перестало работать айфон». Отдельного
-- расширения не нужно — встроено в Postgres.
ALTER TABLE ai_knowledge
  ADD COLUMN IF NOT EXISTS search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(question, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(category, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_search ON ai_knowledge USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_pick
  ON ai_knowledge (account_id, is_active, weight DESC);

-- Состояние сборщика: до какого тикета дошли в прошлый раз.
CREATE TABLE IF NOT EXISTS ai_knowledge_state (
  account_id     INTEGER PRIMARY KEY REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,
  last_run_at    TIMESTAMPTZ,
  scanned_total  INTEGER NOT NULL DEFAULT 0,
  added_total    INTEGER NOT NULL DEFAULT 0,
  skipped_total  INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);
