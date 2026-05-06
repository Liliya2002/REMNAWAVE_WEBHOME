-- Откат v0.1.20.

DROP INDEX IF EXISTS idx_users_telegram_oidc_sub;
ALTER TABLE users DROP COLUMN IF EXISTS telegram_oidc_sub;
