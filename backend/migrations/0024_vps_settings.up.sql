-- v0.1.35: параметры мониторинга VPS в БД (раньше только .env + перезапуск).
--
-- Singleton-строка (id = 1). NULL в поле = «использовать значение из .env»,
-- поэтому существующие установки продолжают работать без переноса.

CREATE TABLE IF NOT EXISTS vps_settings (
  id                    SMALLINT PRIMARY KEY DEFAULT 1,
  health_enabled        BOOLEAN,      -- NULL = из .env (VPS_HEALTH_CHECK_ENABLED)
  health_interval_min   INTEGER,      -- как часто пинговать
  health_ping_port      INTEGER,      -- какой TCP-порт проверять
  health_check_nodes    INTEGER,      -- сколько внешних узлов check-host
  health_parallelism    INTEGER,      -- параллельность проверок
  expiry_notify_hour    INTEGER,      -- час (UTC) напоминаний об оплате
  default_ssh_port      INTEGER,      -- порт по умолчанию для новых VPS
  updated_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vps_settings_singleton CHECK (id = 1)
);

INSERT INTO vps_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
