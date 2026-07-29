-- v0.1.32: настройки платёжных систем в БД (вместо .env).
--
-- Одна строка-синглтон (id = 1). Секрет шифруется через services/encryption.js.
-- Пока провайдер один — Platega; структура позволяет добавить другие, не ломая
-- существующие поля. Если значения не заданы, сервис падает обратно на .env
-- (PLATEGA_MERCHANT_ID / PLATEGA_SECRET) — старые установки продолжают работать.

CREATE TABLE IF NOT EXISTS payment_settings (
  id                      SMALLINT PRIMARY KEY DEFAULT 1,
  platega_enabled         BOOLEAN NOT NULL DEFAULT true,
  platega_merchant_id     VARCHAR(128),
  platega_secret          TEXT,                 -- encrypted
  platega_payment_method  INTEGER NOT NULL DEFAULT 2,   -- 2 = СБП/QR
  platega_api_url         VARCHAR(256),         -- override, пусто = https://app.platega.io
  success_url             VARCHAR(256),         -- override, пусто = {FRONTEND_URL}/payment/success
  failed_url              VARCHAR(256),         -- override, пусто = {FRONTEND_URL}/payment/failed
  updated_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_settings_singleton CHECK (id = 1)
);

INSERT INTO payment_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
