ALTER TABLE remnawave_webhook_settings
  ADD COLUMN IF NOT EXISTS notify_events JSONB DEFAULT '{}'::jsonb;
