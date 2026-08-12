-- Приём вебхуков RemnaWave.
--
-- Панель сама шлёт POST в момент события (нода упала/поднялась/добавлена),
-- поэтому опрос не нужен и задержка нулевая. Включается на стороне панели
-- переменными WEBHOOK_ENABLED / WEBHOOK_URL / WEBHOOK_SECRET_HEADER.
CREATE TABLE IF NOT EXISTS remnawave_webhook_settings (
  id            SERIAL PRIMARY KEY,
  enabled       BOOLEAN DEFAULT true,
  -- Тот же секрет, что в WEBHOOK_SECRET_HEADER панели. ВСЕГДА через encrypt().
  -- Если пусто — откат на .env REMNAWAVE_WEBHOOK_SECRET (как у платёжек).
  secret        TEXT,
  -- Какие события уведомлять. Ключ = имя события RemnaWave.
  notify_events JSONB DEFAULT '{
    "node.connection_lost": true,
    "node.connection_restored": true,
    "node.created": true,
    "node.deleted": true,
    "node.enabled": false,
    "node.disabled": true,
    "node.modified": false,
    "node.traffic_notify": true
  }'::jsonb,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO remnawave_webhook_settings (id) SELECT 1
  WHERE NOT EXISTS (SELECT 1 FROM remnawave_webhook_settings);

-- Журнал событий нод. Нужен не только для истории: по нему считается
-- длительность простоя — на восстановлении ищем момент последнего падения.
CREATE TABLE IF NOT EXISTS remnawave_node_events (
  id            SERIAL PRIMARY KEY,
  event         VARCHAR(64) NOT NULL,
  node_uuid     UUID,
  node_name     VARCHAR(128),
  node_address  VARCHAR(255),
  country_code  VARCHAR(8),
  status_message TEXT,
  users_online  INTEGER,
  payload       JSONB,
  notified      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rne_node    ON remnawave_node_events (node_uuid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rne_created ON remnawave_node_events (created_at DESC);
