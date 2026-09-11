ALTER TABLE broadcast_segment_rules DROP COLUMN IF EXISTS is_sandbox;
ALTER TABLE broadcast_settings
  DROP COLUMN IF EXISTS duplicate_similarity,
  DROP COLUMN IF EXISTS duplicate_window_days;
