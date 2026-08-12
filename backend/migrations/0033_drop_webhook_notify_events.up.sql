-- Список событий дублировал telegram_settings.notifications_enabled, который
-- проверяет сам notifyAdmin. Два независимых выключателя для одного и того же
-- неизбежно разошлись бы: в админке видно одно, шлётся другое.
ALTER TABLE remnawave_webhook_settings DROP COLUMN IF EXISTS notify_events;
