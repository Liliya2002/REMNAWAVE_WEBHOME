DROP TABLE IF EXISTS broadcast_ai_runs;
DROP TABLE IF EXISTS broadcast_proposals;
ALTER TABLE broadcast_settings
  DROP CONSTRAINT IF EXISTS broadcast_ai_mode_chk;
ALTER TABLE broadcast_settings
  DROP COLUMN IF EXISTS ai_mode,
  DROP COLUMN IF EXISTS ai_dry_run,
  DROP COLUMN IF EXISTS ai_interval_hours,
  DROP COLUMN IF EXISTS ai_allowed_targets,
  DROP COLUMN IF EXISTS ai_min_confidence,
  DROP COLUMN IF EXISTS ai_prompt,
  DROP COLUMN IF EXISTS ai_auto_delay_minutes,
  DROP COLUMN IF EXISTS ai_last_run_at;
