-- v0.1.29: интеграция с Telegram-ботом Bedolaga (remnawave-bedolaga-telegram-bot).
--
-- Подключение к встроенному Web Admin API бота (FastAPI, v3.33+) для мониторинга:
-- статистика, пользователи, подписки, транзакции, тикеты (read-only).
-- Авторизация — токеном (X-API-Key / Bearer), токен шифруется через services/encryption.js.

CREATE TABLE IF NOT EXISTS bedolaga_accounts (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(128) NOT NULL,
  base_url     VARCHAR(256) NOT NULL,        -- напр. http://host:8080 (можно с префиксом)
  api_token    TEXT NOT NULL,               -- encrypted, WEB_API токен бота
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
