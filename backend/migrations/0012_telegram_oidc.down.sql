-- Откат v0.1.17: убрать поля Telegram OIDC.

ALTER TABLE telegram_settings
  DROP COLUMN IF EXISTS oidc_redirect_uri,
  DROP COLUMN IF EXISTS oidc_client_secret,
  DROP COLUMN IF EXISTS oidc_client_id,
  DROP COLUMN IF EXISTS oidc_enabled;
