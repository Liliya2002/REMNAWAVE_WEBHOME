-- Rollback Release v0.1.5
-- Откатываем в обратном порядке: traffic decimal → metadata → squad_quotas → ssh/p2p → ip_ban → plan_tiers

-- 6. Subscription traffic decimal → INTEGER
ALTER TABLE subscriptions
  ALTER COLUMN traffic_limit_gb DROP DEFAULT,
  ALTER COLUMN traffic_limit_gb TYPE INTEGER USING ROUND(traffic_limit_gb)::INTEGER,
  ALTER COLUMN traffic_limit_gb SET DEFAULT 0;

ALTER TABLE subscriptions
  ALTER COLUMN traffic_used_gb DROP DEFAULT,
  ALTER COLUMN traffic_used_gb TYPE INTEGER USING ROUND(traffic_used_gb)::INTEGER,
  ALTER COLUMN traffic_used_gb SET DEFAULT 0;

-- 5. RemnaWave metadata
ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plan_hwid_limit;
ALTER TABLE plans DROP COLUMN IF EXISTS hwid_device_limit;
DROP INDEX IF EXISTS idx_users_remnwave_username;
ALTER TABLE users DROP COLUMN IF EXISTS remnwave_username;

-- 4. Squad Quotas
DROP TABLE IF EXISTS squad_traffic_purchases;
DROP TABLE IF EXISTS subscription_squad_state;
DROP TABLE IF EXISTS plan_squad_limits;

ALTER TABLE traffic_guard_settings
  DROP CONSTRAINT IF EXISTS chk_squad_period_strategy,
  DROP CONSTRAINT IF EXISTS chk_squad_topup_mode,
  DROP CONSTRAINT IF EXISTS chk_squad_quota_interval,
  DROP CONSTRAINT IF EXISTS chk_squad_quota_warn,
  DROP COLUMN IF EXISTS squad_period_strategy,
  DROP COLUMN IF EXISTS squad_topup_mode,
  DROP COLUMN IF EXISTS squad_topup_default_price,
  DROP COLUMN IF EXISTS squad_quota_warn_percent,
  DROP COLUMN IF EXISTS squad_quota_interval_minutes,
  DROP COLUMN IF EXISTS squad_quota_enabled;

-- 3. SSH agent + P2P
DELETE FROM traffic_violations WHERE period = 'p2p' OR level IN ('torrent_warning', 'torrent_blocked');

ALTER TABLE traffic_violations DROP CONSTRAINT IF EXISTS chk_violation_period;
ALTER TABLE traffic_violations
  ADD CONSTRAINT chk_violation_period
  CHECK (period IN ('day', 'week', 'month', '30d', 'manual'));

ALTER TABLE traffic_violations DROP CONSTRAINT IF EXISTS chk_violation_level;
ALTER TABLE traffic_violations
  ADD CONSTRAINT chk_violation_level
  CHECK (level IN ('warning', 'blocked'));

ALTER TABLE node_traffic_limits DROP COLUMN IF EXISTS block_torrents;

ALTER TABLE traffic_guard_settings
  DROP CONSTRAINT IF EXISTS chk_torrent_threshold,
  DROP CONSTRAINT IF EXISTS chk_p2p_scan_interval,
  DROP CONSTRAINT IF EXISTS chk_torrent_action,
  DROP COLUMN IF EXISTS torrent_action,
  DROP COLUMN IF EXISTS torrent_attempts_threshold,
  DROP COLUMN IF EXISTS p2p_scan_interval_minutes,
  DROP COLUMN IF EXISTS p2p_detect_enabled,
  DROP COLUMN IF EXISTS ssh_lookup_enabled;

-- 2. IP-bans
DROP TABLE IF EXISTS banned_ips;

ALTER TABLE traffic_guard_settings DROP CONSTRAINT IF EXISTS chk_ip_ban_duration;
ALTER TABLE traffic_guard_settings
  DROP COLUMN IF EXISTS ip_ban_duration_hours,
  DROP COLUMN IF EXISTS ip_ban_enabled;

ALTER TABLE traffic_violations DROP COLUMN IF EXISTS client_ips;
ALTER TABLE users DROP COLUMN IF EXISTS registration_ip;

-- 1. Plan tiers
DROP INDEX IF EXISTS idx_subscriptions_plan_id;
DROP INDEX IF EXISTS idx_plans_active_tier;
DROP INDEX IF EXISTS idx_plans_tier_sort;
ALTER TABLE payments DROP COLUMN IF EXISTS provider_metadata;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_id;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS chk_plan_tier;
ALTER TABLE plans
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS tier_label,
  DROP COLUMN IF EXISTS tier;
