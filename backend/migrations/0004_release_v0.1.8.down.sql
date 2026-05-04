-- Откат release v0.1.8 — порядок обратный up.sql, с учётом FK-зависимостей
-- (yc_cidr_lists / yc_ssh_keys / yc_iam_token_cache / yc_jobs FK на yc_accounts —
--  поэтому YC-аккаунты дропаем последними).

-- 7. Users lowercase indexes
DROP INDEX IF EXISTS users_email_lower_uq;
DROP INDEX IF EXISTS users_login_lower_uq;
-- UPDATE'ы из up.sql необратимы (исходный регистр потерян) — этим down не восстанавливаем.

-- 6. SSH keys
DROP INDEX IF EXISTS idx_yc_ssh_keys_fingerprint;
DROP INDEX IF EXISTS idx_yc_ssh_keys_account;
DROP TABLE IF EXISTS yc_ssh_keys;

-- 5. CIDR lists
DROP INDEX IF EXISTS yc_cidr_lists_account_id_idx;
DROP TABLE IF EXISTS yc_cidr_lists;

-- 4. Yandex Cloud основа
DROP INDEX IF EXISTS idx_yc_jobs_account_status;
DROP TABLE IF EXISTS yc_jobs;
DROP TABLE IF EXISTS yc_iam_token_cache;
DROP TABLE IF EXISTS yc_accounts;

-- 3. Traffic Agent install log
DROP INDEX IF EXISTS idx_traffic_agent_log_vps;
DROP TABLE IF EXISTS traffic_agent_install_log;

-- 2. Traffic Agent install state
ALTER TABLE vps_servers
  DROP COLUMN IF EXISTS traffic_agent_installed_at,
  DROP COLUMN IF EXISTS traffic_agent_last_health,
  DROP COLUMN IF EXISTS traffic_agent_last_check;

ALTER TABLE site_config
  DROP COLUMN IF EXISTS traffic_agent_panel_public_key,
  DROP COLUMN IF EXISTS traffic_agent_panel_private_key;

-- 1. Home landing
ALTER TABLE site_config DROP COLUMN IF EXISTS home_landing_id;
