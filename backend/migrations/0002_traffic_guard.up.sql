-- Traffic Guard: per-node лимиты потребления + автоматическая блокировка нарушителей.
--
-- 4 таблицы:
--   traffic_guard_settings — singleton с глобальными настройками
--   node_traffic_limits    — per-node лимиты (приоритет А)
--   plan_traffic_limits    — per-plan лимиты (приоритет Б)
--   traffic_violations     — журнал нарушений + автоблокировок
--
-- Лимиты в ГБ — NUMERIC(10, 2), допускают дробные значения (например 0.5 ГБ для тестов).
-- В traffic_violations period_key = VARCHAR(64): для 'manual' блокировок ключ имеет вид
--   'manual:<ISO8601-timestamp>' (~32 символа, не помещается в VARCHAR(20)).

-- ─── traffic_guard_settings (singleton, всегда id=1) ───────────────────────────
CREATE TABLE IF NOT EXISTS traffic_guard_settings (
  id INTEGER PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_period VARCHAR(16) NOT NULL DEFAULT 'month',         -- 'day' | 'week' | 'month' | '30d'
  default_action VARCHAR(32) NOT NULL DEFAULT 'disable_user',  -- 'disable_user' | 'disable_squad' | 'warn_only'
  limit_source VARCHAR(16) NOT NULL DEFAULT 'node',            -- 'node' | 'plan' | 'both'
  warn_threshold_percent INTEGER NOT NULL DEFAULT 80,
  cron_interval_minutes INTEGER NOT NULL DEFAULT 15,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  inapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_check_at TIMESTAMP WITH TIME ZONE,
  last_check_status VARCHAR(32),
  last_check_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_period      CHECK (default_period IN ('day', 'week', 'month', '30d')),
  CONSTRAINT chk_action      CHECK (default_action IN ('disable_user', 'disable_squad', 'warn_only')),
  CONSTRAINT chk_source      CHECK (limit_source IN ('node', 'plan', 'both')),
  CONSTRAINT chk_warn        CHECK (warn_threshold_percent BETWEEN 1 AND 99),
  CONSTRAINT chk_interval    CHECK (cron_interval_minutes BETWEEN 1 AND 1440)
);

-- Гарантируем единственную строку
INSERT INTO traffic_guard_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── node_traffic_limits ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_traffic_limits (
  id SERIAL PRIMARY KEY,
  node_uuid VARCHAR(128) NOT NULL UNIQUE,
  node_name VARCHAR(128),
  limit_gb NUMERIC(10, 2) NOT NULL DEFAULT 0,    -- 0 = без лимита, можно 0.5
  period VARCHAR(16),                             -- NULL = брать из settings.default_period
  action VARCHAR(32),                             -- NULL = брать из settings.default_action
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_node_period CHECK (period IS NULL OR period IN ('day', 'week', 'month', '30d')),
  CONSTRAINT chk_node_action CHECK (action IS NULL OR action IN ('disable_user', 'disable_squad', 'warn_only')),
  CONSTRAINT chk_node_limit  CHECK (limit_gb >= 0)
);

-- ─── plan_traffic_limits ───────────────────────────────────────────────────────
-- Лимит трафика per-node для конкретного тарифа (Базовый: 50ГБ/нода, Премиум: 200ГБ/нода).
CREATE TABLE IF NOT EXISTS plan_traffic_limits (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  per_node_limit_gb NUMERIC(10, 2) NOT NULL DEFAULT 0,
  period VARCHAR(16),                             -- NULL = брать из settings
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_traffic_limits_plan_uniq UNIQUE (plan_id),
  CONSTRAINT chk_plan_period CHECK (period IS NULL OR period IN ('day', 'week', 'month', '30d')),
  CONSTRAINT chk_plan_limit  CHECK (per_node_limit_gb >= 0)
);

-- ─── traffic_violations ────────────────────────────────────────────────────────
-- Журнал превышений + автоблокировок. Дедуп через (user_uuid, node_uuid, period_key, level).
CREATE TABLE IF NOT EXISTS traffic_violations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remnwave_user_uuid VARCHAR(128) NOT NULL,
  username VARCHAR(128),
  node_uuid VARCHAR(128) NOT NULL,
  node_name VARCHAR(128),
  used_bytes BIGINT NOT NULL DEFAULT 0,
  limit_bytes BIGINT NOT NULL DEFAULT 0,
  used_percent NUMERIC(6, 2),
  level VARCHAR(16) NOT NULL,                     -- 'warning' | 'blocked'
  action_taken VARCHAR(32),                       -- 'notified' | 'disabled_user' | 'disabled_squad' | 'manual_block' | 'manual_unblock' | 'auto_unblock'
  period VARCHAR(16) NOT NULL,                    -- 'day' | 'week' | 'month' | '30d' | 'manual'
  period_key VARCHAR(64) NOT NULL,                -- '2026-04' (month) | '2026-W17' (week) | '2026-04-29' (day) | '30d:2026-04-29' | 'manual:<ISO>'
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  CONSTRAINT chk_violation_level  CHECK (level IN ('warning', 'blocked')),
  CONSTRAINT chk_violation_period CHECK (period IN ('day', 'week', 'month', '30d', 'manual')),
  CONSTRAINT traffic_violations_unique UNIQUE (remnwave_user_uuid, node_uuid, period_key, level)
);

CREATE INDEX IF NOT EXISTS idx_violations_user_id      ON traffic_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_violations_unresolved   ON traffic_violations(level, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_violations_detected_at  ON traffic_violations(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_violations_node_uuid    ON traffic_violations(node_uuid);
