ALTER TABLE prometheus_sessions
  DROP COLUMN IF EXISTS run_status,
  DROP COLUMN IF EXISTS run_error,
  DROP COLUMN IF EXISTS run_started_at;
