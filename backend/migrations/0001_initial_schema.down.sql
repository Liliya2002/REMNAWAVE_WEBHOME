-- Migration: 0001_initial_schema
-- Down
-- Полный откат — DROP всех таблиц, функций, триггеров.
-- ВНИМАНИЕ: уничтожает все данные. Используется только для тестов на пустой БД.

DROP TABLE IF EXISTS subscription_traffic_snapshots CASCADE;
DROP TABLE IF EXISTS landing_page_audit CASCADE;
DROP TABLE IF EXISTS landing_page_visits CASCADE;
DROP TABLE IF EXISTS landing_pages CASCADE;
DROP TABLE IF EXISTS admin_audit_log CASCADE;
DROP TABLE IF EXISTS admin_broadcasts CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS vps_payment_history CASCADE;
DROP TABLE IF EXISTS vps_servers CASCADE;
DROP TABLE IF EXISTS hosting_sync_logs CASCADE;
DROP TABLE IF EXISTS hosting_offers_cache CASCADE;
DROP TABLE IF EXISTS squads CASCADE;
DROP TABLE IF EXISTS config_history CASCADE;
DROP TABLE IF EXISTS site_config CASCADE;
DROP TABLE IF EXISTS site_templates CASCADE;
DROP TABLE IF EXISTS referral_monthly_stats CASCADE;
DROP TABLE IF EXISTS referral_rewards CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
DROP TABLE IF EXISTS referral_links CASCADE;
DROP TABLE IF EXISTS referral_config CASCADE;
DROP TABLE IF EXISTS wallet_transactions CASCADE;
DROP TABLE IF EXISTS user_wallets CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS email_verifications CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS update_referral_config_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_referrals_updated_at() CASCADE;
DROP FUNCTION IF EXISTS generate_referral_code_func() CASCADE;
