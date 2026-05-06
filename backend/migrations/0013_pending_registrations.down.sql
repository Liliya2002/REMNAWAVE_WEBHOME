-- Откат v0.1.19.

ALTER TABLE telegram_link_tokens DROP COLUMN IF EXISTS confirmed_at;

DROP INDEX IF EXISTS idx_pending_reg_expires;
DROP TABLE IF EXISTS pending_registrations;
