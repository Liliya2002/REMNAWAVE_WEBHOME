-- v0.1.28: интеграция Selectel Cloud (selectel.ru).
--
-- Хранит аккаунты Selectel. Баланс тянется по статическому API-ключу (X-Token),
-- список облачных серверов — по сервисному пользователю (OpenStack/Keystone).
-- Чувствительные поля (api_key, service_password) шифруются через services/encryption.js.

CREATE TABLE IF NOT EXISTS selectel_accounts (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(128) NOT NULL,
  -- Баланс/биллинг: статический API-ключ (Профиль → Доступ → API-ключи)
  api_key           TEXT,                     -- encrypted, X-Token
  -- Облачные серверы (OpenStack): сервисный пользователь + номер аккаунта + проект
  account_id        VARCHAR(64),              -- номер аккаунта Selectel (domain)
  service_username  VARCHAR(128),
  service_password  TEXT,                     -- encrypted
  default_project   VARCHAR(128),             -- имя проекта (опц.; пусто = все проекты)
  default_region    VARCHAR(32),              -- регион по умолчанию (опц.)
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
