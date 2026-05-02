-- Release v0.1.5 — Traffic Guard 2.0 + Plan Tiers + Squad Quotas + RemnaWave metadata
--
-- Объединяет все изменения схемы для v0.1.5:
--   1. Plan Tiers          — plans.tier/tier_label/sort_order/color, subscriptions.plan_id (FK), payments.provider_metadata
--   2. IP-bans             — users.registration_ip, traffic_violations.client_ips, banned_ips, settings ip_ban_*
--   3. SSH agent + P2P     — settings ssh/torrent flags, node_traffic_limits.block_torrents, расширение CHECK
--   4. Squad Quotas        — plan_squad_limits, subscription_squad_state, squad_traffic_purchases, settings squad_*
--   5. RemnaWave metadata  — users.remnwave_username, plans.hwid_device_limit
--   6. Decimal traffic     — subscriptions.traffic_used_gb / traffic_limit_gb → NUMERIC(10, 2)


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Plan Tiers + change-plan flow
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS tier        INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier_label  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sort_order  INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color       VARCHAR(20);

ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plan_tier;
ALTER TABLE plans ADD CONSTRAINT chk_plan_tier CHECK (tier >= 0 AND tier <= 99);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL;

-- Метаданные платежа — для смены тарифа (хранят subscriptionId, newExpiresAt, calc-snapshot)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB;

-- Backfill plan_id по plan_name (NULL пропускается)
UPDATE subscriptions s
SET plan_id = p.id
FROM plans p
WHERE p.name = s.plan_name
  AND s.plan_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_tier_sort       ON plans(tier, sort_order);
CREATE INDEX IF NOT EXISTS idx_plans_active_tier     ON plans(is_active, tier) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions(plan_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. IP-bans (Phase 1 of Traffic Guard 2.0)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip VARCHAR(45);

ALTER TABLE traffic_violations
  ADD COLUMN IF NOT EXISTS client_ips JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE traffic_guard_settings
  ADD COLUMN IF NOT EXISTS ip_ban_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ip_ban_duration_hours INTEGER NOT NULL DEFAULT 0;

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_ip_ban_duration;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_ip_ban_duration CHECK (ip_ban_duration_hours >= 0);

CREATE TABLE IF NOT EXISTS banned_ips (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL UNIQUE,
  reason TEXT,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',           -- 'manual' | 'auto_violation'
  related_violation_id INTEGER REFERENCES traffic_violations(id) ON DELETE SET NULL,
  related_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  related_user_uuid VARCHAR(128),
  expires_at TIMESTAMP WITH TIME ZONE,                     -- NULL = бессрочно
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  CONSTRAINT chk_banned_ip_source CHECK (source IN ('manual', 'auto_violation'))
);

CREATE INDEX IF NOT EXISTS idx_banned_ips_ip        ON banned_ips(ip);
CREATE INDEX IF NOT EXISTS idx_banned_ips_expires   ON banned_ips(expires_at);
CREATE INDEX IF NOT EXISTS idx_banned_ips_user_id   ON banned_ips(related_user_id);
CREATE INDEX IF NOT EXISTS idx_banned_ips_violation ON banned_ips(related_violation_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SSH agent + P2P/Torrent detection (Phases 2, 3 of Traffic Guard 2.0)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE traffic_guard_settings
  ADD COLUMN IF NOT EXISTS ssh_lookup_enabled         BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS p2p_detect_enabled         BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS p2p_scan_interval_minutes  INTEGER  NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS torrent_attempts_threshold INTEGER  NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS torrent_action             VARCHAR(32) NOT NULL DEFAULT 'warn_only';

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_torrent_action;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_torrent_action CHECK (torrent_action IN ('warn_only', 'disable_user', 'ip_ban'));

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_p2p_scan_interval;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_p2p_scan_interval CHECK (p2p_scan_interval_minutes BETWEEN 1 AND 1440);

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_torrent_threshold;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_torrent_threshold CHECK (torrent_attempts_threshold >= 1);

-- Per-node флаг: настроен ли в RemnaWave routing-rule для блока торрентов
ALTER TABLE node_traffic_limits
  ADD COLUMN IF NOT EXISTS block_torrents BOOLEAN NOT NULL DEFAULT FALSE;

-- Расширяем enum level в traffic_violations: добавляем torrent_warning, torrent_blocked
ALTER TABLE traffic_violations DROP CONSTRAINT IF EXISTS chk_violation_level;
ALTER TABLE traffic_violations
  ADD CONSTRAINT chk_violation_level
  CHECK (level IN ('warning', 'blocked', 'torrent_warning', 'torrent_blocked'));

-- Расширяем enum period: добавляем 'p2p'
ALTER TABLE traffic_violations DROP CONSTRAINT IF EXISTS chk_violation_period;
ALTER TABLE traffic_violations
  ADD CONSTRAINT chk_violation_period
  CHECK (period IN ('day', 'week', 'month', '30d', 'manual', 'p2p'));


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Squad Quotas — per-squad traffic limits + auto-disable + topup
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plan_squad_limits (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  squad_uuid VARCHAR(128) NOT NULL,
  limit_gb NUMERIC(10, 2) NOT NULL DEFAULT 0,            -- 0 = без per-squad лимита
  topup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  topup_price_per_gb NUMERIC(10, 2),                      -- NULL = из settings
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_squad_limits_unique UNIQUE (plan_id, squad_uuid),
  CONSTRAINT chk_squad_limit CHECK (limit_gb >= 0),
  CONSTRAINT chk_squad_topup_price CHECK (topup_price_per_gb IS NULL OR topup_price_per_gb >= 0)
);

CREATE INDEX IF NOT EXISTS idx_plan_squad_limits_plan ON plan_squad_limits(plan_id);

CREATE TABLE IF NOT EXISTS subscription_squad_state (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  squad_uuid VARCHAR(128) NOT NULL,
  squad_name VARCHAR(128),
  period_key VARCHAR(20) NOT NULL,
  base_limit_gb NUMERIC(10, 2) NOT NULL DEFAULT 0,
  extra_gb NUMERIC(10, 2) NOT NULL DEFAULT 0,
  used_bytes BIGINT NOT NULL DEFAULT 0,
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at TIMESTAMP WITH TIME ZONE,
  reactivated_at TIMESTAMP WITH TIME ZONE,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  warned_80_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_squad_state_unique UNIQUE (subscription_id, squad_uuid, period_key)
);

CREATE INDEX IF NOT EXISTS idx_squad_state_sub      ON subscription_squad_state(subscription_id);
CREATE INDEX IF NOT EXISTS idx_squad_state_disabled ON subscription_squad_state(is_disabled) WHERE is_disabled = true;
CREATE INDEX IF NOT EXISTS idx_squad_state_period   ON subscription_squad_state(period_key);

CREATE TABLE IF NOT EXISTS squad_traffic_purchases (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  squad_uuid VARCHAR(128) NOT NULL,
  squad_name VARCHAR(128),
  period_key VARCHAR(20) NOT NULL,
  gb_amount NUMERIC(10, 2) NOT NULL,
  amount_paid NUMERIC(10, 2) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'user_purchase',   -- 'user_purchase' | 'admin_gift'
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_squad_purchases_sub  ON squad_traffic_purchases(subscription_id);
CREATE INDEX IF NOT EXISTS idx_squad_purchases_user ON squad_traffic_purchases(user_id);

ALTER TABLE traffic_guard_settings
  ADD COLUMN IF NOT EXISTS squad_quota_enabled          BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS squad_quota_interval_minutes INTEGER  NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS squad_quota_warn_percent     INTEGER  NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS squad_topup_default_price    NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS squad_topup_mode             VARCHAR(20) NOT NULL DEFAULT 'flexible',
  ADD COLUMN IF NOT EXISTS squad_period_strategy        VARCHAR(30) NOT NULL DEFAULT 'calendar_month';

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_squad_quota_warn;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_squad_quota_warn CHECK (squad_quota_warn_percent BETWEEN 1 AND 99);

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_squad_quota_interval;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_squad_quota_interval CHECK (squad_quota_interval_minutes BETWEEN 1 AND 1440);

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_squad_topup_mode;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_squad_topup_mode CHECK (squad_topup_mode IN ('flexible', 'packs'));

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_squad_period_strategy;
ALTER TABLE traffic_guard_settings
  ADD CONSTRAINT chk_squad_period_strategy CHECK (squad_period_strategy IN ('calendar_month', 'subscription_period'));

-- Расширяем CHECK для payments.payment_type — добавляем 'squad_traffic_topup'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'payments' AND constraint_name = 'chk_payment_type'
  ) THEN
    ALTER TABLE payments DROP CONSTRAINT chk_payment_type;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RemnaWave metadata — стабильный username + HWID device limit per plan
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS remnwave_username VARCHAR(50) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_remnwave_username ON users(remnwave_username);

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS hwid_device_limit INTEGER;

ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plan_hwid_limit;
ALTER TABLE plans
  ADD CONSTRAINT chk_plan_hwid_limit CHECK (hwid_device_limit IS NULL OR hwid_device_limit >= 0);


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Subscription traffic — точность NUMERIC(10, 2) вместо INTEGER
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE subscriptions
  ALTER COLUMN traffic_used_gb DROP DEFAULT,
  ALTER COLUMN traffic_used_gb TYPE NUMERIC(10, 2) USING traffic_used_gb::NUMERIC(10, 2),
  ALTER COLUMN traffic_used_gb SET DEFAULT 0;

ALTER TABLE subscriptions
  ALTER COLUMN traffic_limit_gb DROP DEFAULT,
  ALTER COLUMN traffic_limit_gb TYPE NUMERIC(10, 2) USING traffic_limit_gb::NUMERIC(10, 2),
  ALTER COLUMN traffic_limit_gb SET DEFAULT 0;
