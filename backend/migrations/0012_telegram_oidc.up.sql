-- v0.1.17: Telegram OAuth 2.0 / OpenID Connect.
--
-- В отличие от Login Widget (data_check_string + HMAC bot_token), OIDC — это
-- стандартный flow `authorization_code + PKCE`, регистрация через @BotFather:
--   /newoauth → даёт client_id + client_secret
--   /setoauthredirects → задать список разрешённых redirect_uri
--
-- Discovery: https://oauth.telegram.org/.well-known/openid-configuration
-- Authorize: https://oauth.telegram.org/auth
-- Token:     https://oauth.telegram.org/token
-- JWKS:      https://oauth.telegram.org/.well-known/jwks.json
-- ID Token подписывается RS256, мы валидируем подпись через JWKS.
--
-- oidc_client_secret шифруется тем же services/encryption.js что и bot_token.

ALTER TABLE telegram_settings
  ADD COLUMN IF NOT EXISTS oidc_enabled       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oidc_client_id     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS oidc_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS oidc_redirect_uri  TEXT;
