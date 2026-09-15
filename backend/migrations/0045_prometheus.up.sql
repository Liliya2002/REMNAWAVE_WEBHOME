-- PROMETHEUS: разборы проекта и их история.
--
-- Хранится не только ответ, но и путь к нему: какие инструменты дёргались и с
-- чем. Без этого разбор невозможно перепроверить — остаётся верить выводу на
-- слово, а выводы иногда строятся на неверно понятых данных.
CREATE TABLE IF NOT EXISTS prometheus_sessions (
  id            SERIAL PRIMARY KEY,
  title         TEXT,
  started_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prometheus_messages (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES prometheus_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,          -- user | assistant | tool
  content     TEXT,
  tool_name   TEXT,
  tool_input  JSONB,
  tool_result JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prometheus_messages_session
  ON prometheus_messages (session_id, id);
