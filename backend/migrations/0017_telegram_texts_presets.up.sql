-- Сохранённые пользователем пресеты шаблонов уведомлений.
-- Структура: { "<notification_key>": [ { "name": "...", "text": "..." }, ... ] }
ALTER TABLE telegram_settings
  ADD COLUMN IF NOT EXISTS texts_presets JSONB NOT NULL DEFAULT '{}'::jsonb;
