-- v0.1.20 hotfix: Telegram OIDC sub != telegram_id.
--
-- Telegram OAuth 2.0 / OIDC возвращает в claim `sub` opaque-идентификатор,
-- который НЕ совпадает с реальным telegram_id (chat_id) из бота.
-- Например `sub=11713064933933089000` — это 1.17×10^19, выходит за BIGINT.
--
-- Поэтому хранить sub в users.telegram_id нельзя — он туда физически не лезет.
-- Заводим отдельную колонку telegram_oidc_sub.
--
-- Юзер, зашедший через OIDC, получает аккаунт но без telegram_id.
-- Чтобы бот мог ему писать — пусть отдельно привяжет бота через
-- /dashboard → Безопасность → «Привязать через Telegram-бот»
-- (там используется handler /start link_<token>, который уже корректно
-- проставляет telegram_id из ctx.from.id).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_oidc_sub VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_oidc_sub
  ON users(telegram_oidc_sub)
  WHERE telegram_oidc_sub IS NOT NULL;
