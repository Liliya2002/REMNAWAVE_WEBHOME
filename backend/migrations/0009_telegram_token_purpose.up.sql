-- v0.1.9 этап B: token-purpose в telegram_link_tokens.
-- 'link' (этап D) — привязка existing email-юзера к Telegram
-- 'auto_login' (этап B, сейчас) — одноразовый токен для перехода из бота на веб без логина

ALTER TABLE telegram_link_tokens
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(16) NOT NULL DEFAULT 'link'
    CHECK (purpose IN ('link', 'auto_login'));

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_purpose
  ON telegram_link_tokens(purpose, expires_at);
