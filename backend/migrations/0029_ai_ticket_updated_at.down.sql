DROP INDEX IF EXISTS idx_atr_ticket_updated;
ALTER TABLE ai_ticket_replies DROP COLUMN IF EXISTS ticket_updated_at;
