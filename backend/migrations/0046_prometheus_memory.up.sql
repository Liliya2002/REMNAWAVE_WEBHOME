-- PROMETHEUS: собственная память.
--
-- Зачем отдельно от истории разборов. История (prometheus_messages) — это
-- стенограмма: что спросили, куда сходил, что ответил. Читать её целиком перед
-- каждым вопросом невозможно и незачем. Память — это выжимка: установленные
-- факты, найденные проблемы и решения владельца по ним. Её и подкладываем в
-- начало каждого разбора.
--
-- ГЛАВНОЕ: память хранится в НАШЕЙ базе обычным текстом. Ни эмбеддингов, ни
-- форматов конкретного провайдера, ни идентификаторов его сессий. Поэтому
-- смена нейросети — замена ключа, адреса и названия модели в настройках — не
-- стирает накопленное: новая модель читает ту же память с первого же вопроса.
-- Это прямое требование, а не удачное совпадение: привязать накопленное к
-- поставщику значило бы обнулять проект при каждой смене.

-- ─── Установленные факты и наблюдения ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS prometheus_memory (
  id          SERIAL PRIMARY KEY,

  -- Что это за запись:
  --   fact     — установленный факт о проекте («expired молчит 51 день»)
  --   context  — как здесь устроено и что означает («у тарифов свои сквады»)
  --   decision — решение владельца («сюда не пишем, так задумано»)
  --   lesson   — вывод из собственной ошибки («корреляция была ложной»)
  kind        TEXT NOT NULL DEFAULT 'fact',

  -- Короткий ключ темы: «сегмент expired», «выдача доступа», «промокоды».
  -- По нему память группируется и обновляется, чтобы не копить десять версий
  -- одного и того же наблюдения.
  topic       TEXT NOT NULL,
  content     TEXT NOT NULL,

  -- Насколько уверенно это утверждается. Факт из выборки — высокая, догадка —
  -- низкая. Нужно, чтобы через месяц отличить измеренное от предположенного.
  confidence  NUMERIC(3,2) NOT NULL DEFAULT 0.80,

  session_id  INTEGER REFERENCES prometheus_sessions(id) ON DELETE SET NULL,
  -- Чем подтверждено: запрос, файл, вызов API. Без этого проверить нельзя.
  evidence    TEXT,

  -- Факты устаревают. Помеченное неактуальным не удаляется: «было так, стало
  -- иначе» — само по себе ценное знание.
  is_active   BOOLEAN NOT NULL DEFAULT true,
  superseded_by INTEGER REFERENCES prometheus_memory(id) ON DELETE SET NULL,

  used_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prometheus_memory DROP CONSTRAINT IF EXISTS prometheus_memory_kind_chk;
ALTER TABLE prometheus_memory ADD CONSTRAINT prometheus_memory_kind_chk
  CHECK (kind IN ('fact', 'context', 'decision', 'lesson'));

-- Поиск по теме и содержанию. Русская конфигурация со стеммингом — та же, что
-- в базе знаний ассистента тикетов, и по той же причине: внешних сервисов для
-- поиска не заводим, иначе смена провайдера снова всё ломает.
ALTER TABLE prometheus_memory
  ADD COLUMN IF NOT EXISTS search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(topic, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(content, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_prometheus_memory_search ON prometheus_memory USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_prometheus_memory_topic ON prometheus_memory (topic, is_active);

-- ─── Найденные проблемы ─────────────────────────────────────────────────────
--
-- Отдельно от фактов, потому что у проблемы есть судьба: её чинят, отклоняют
-- или признают несущественной. Без этого он будет поднимать одно и то же на
-- каждом разборе, а владелец — каждый раз объяснять, почему это не чинят.
CREATE TABLE IF NOT EXISTS prometheus_findings (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  detail      TEXT,
  severity    TEXT NOT NULL DEFAULT 'medium',   -- low | medium | high
  area        TEXT,                              -- платежи, рассылки, подписки…

  -- open      — открыта
  -- accepted  — владелец согласен, чинить будем
  -- dismissed — владелец отклонил (причина в verdict), больше не поднимать
  -- fixed     — починено
  status      TEXT NOT NULL DEFAULT 'open',
  verdict     TEXT,

  session_id  INTEGER REFERENCES prometheus_sessions(id) ON DELETE SET NULL,
  evidence    TEXT,
  fingerprint TEXT NOT NULL,                     -- чтобы не заводить дубль той же проблемы

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ,
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE prometheus_findings DROP CONSTRAINT IF EXISTS prometheus_findings_status_chk;
ALTER TABLE prometheus_findings ADD CONSTRAINT prometheus_findings_status_chk
  CHECK (status IN ('open', 'accepted', 'dismissed', 'fixed'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_prometheus_findings_fp ON prometheus_findings (fingerprint);
CREATE INDEX IF NOT EXISTS idx_prometheus_findings_status ON prometheus_findings (status, severity);
