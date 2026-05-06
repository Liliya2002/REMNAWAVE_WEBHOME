-- v0.1.9: Telegram Mini Apps support.
-- Если web_app_url задан (https://) — главное меню бота рисуется
-- WebApp-кнопками: тап открывает мини-приложение прямо в Telegram'е
-- (без перехода в браузер). Это визуально самый красивый формат.

ALTER TABLE telegram_settings
  ADD COLUMN IF NOT EXISTS web_app_url TEXT;
