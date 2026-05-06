DROP INDEX IF EXISTS idx_vps_servers_yc_instance;

ALTER TABLE vps_servers
  DROP COLUMN IF EXISTS yc_instance_id,
  DROP COLUMN IF EXISTS yc_account_id;
