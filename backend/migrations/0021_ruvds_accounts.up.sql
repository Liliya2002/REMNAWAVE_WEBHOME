-- v0.1.29: интеграция RUVDS (api.ruvds.com, API v2).
--
-- Мультиаккаунт: несколько личных кабинетов RUVDS одновременно.
-- Авторизация — Bearer-токен из https://ruvds.com/my/settings/api
-- (показывается один раз при создании), хранится зашифрованным.
-- role — права токена: read / write / remove (влияет на доступные действия в UI).

CREATE TABLE IF NOT EXISTS ruvds_accounts (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  api_token   TEXT NOT NULL,                     -- encrypted, Bearer
  role        VARCHAR(16) NOT NULL DEFAULT 'read', -- read | write | remove
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
