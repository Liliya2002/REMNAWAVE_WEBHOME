-- v0.1.19: Регистрация через Telegram-бот.
--
-- Юзер на /register заполняет login/email/password → backend создаёт строку
-- в pending_registrations (но НЕ в users — чтоб не плодить полу-юзеров).
-- Юзер сканирует QR / открывает deeplink t.me/<bot>?start=reg_<token>.
-- Бот в handler /start reg_<token>:
--   1. находит pending по token, проверяет TTL и что telegram_id не привязан
--   2. создаёт users (включая telegram_id, telegram_username)
--   3. ставит confirmed_at = NOW(), записывает created_user_id
--   4. шлёт юзеру в чат «✅ готово» + кнопку с auto_login токеном
-- Frontend поллит GET /auth/register/poll?token=<t> — когда видит
-- confirmed_at != NULL, делает редирект /tg-login?t=<auto_login_token> и
-- юзер залогинен.
--
-- email_confirmed остаётся независимым: если site_config.require_email_confirmation
-- = true, юзеру всё равно нужно будет подтвердить email кодом — бот делает
-- ТОЛЬКО привязку telegram_id, не email.

CREATE TABLE IF NOT EXISTS pending_registrations (
  token              VARCHAR(64) PRIMARY KEY,
  login              VARCHAR(64) NOT NULL,
  email              VARCHAR(255) NOT NULL,
  password_hash      TEXT NOT NULL,
  referral_code      VARCHAR(64),
  registration_ip    VARCHAR(64),
  expires_at         TIMESTAMPTZ NOT NULL,
  confirmed_at       TIMESTAMPTZ,
  created_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_reg_expires
  ON pending_registrations(expires_at);

-- В telegram_link_tokens (purpose='link') добавляем confirmed_at — для polling
-- на странице /dashboard/security «привязать Telegram через бот».
-- 'used_at' уже есть, но семантика другая: он ставится когда auto_login токен
-- разменян на JWT. Для link нам нужен отдельный маркер «бот привязал TG».
ALTER TABLE telegram_link_tokens
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
