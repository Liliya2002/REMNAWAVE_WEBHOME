ALTER TABLE vps_servers
  DROP COLUMN IF EXISTS last_unreachable_at,
  DROP COLUMN IF EXISTS last_health_check,
  DROP COLUMN IF EXISTS is_reachable;
