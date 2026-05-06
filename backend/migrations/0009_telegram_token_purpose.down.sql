DROP INDEX IF EXISTS idx_telegram_link_tokens_purpose;
ALTER TABLE telegram_link_tokens DROP COLUMN IF EXISTS purpose;
