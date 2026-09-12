DROP INDEX IF EXISTS idx_ai_knowledge_skipped;
ALTER TABLE ai_knowledge
  DROP COLUMN IF EXISTS skip_reason,
  DROP COLUMN IF EXISTS reviewed_by_admin;
