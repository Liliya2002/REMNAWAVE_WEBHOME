-- Release v0.1.8 — объединённая миграция за всё что добавлено после v0.1.5.
--
-- Объединяет в один атомарный пак: 7 предыдущих миграций (0004…0010), которые
-- разрабатывались поэтапно. Перед релизом сжаты в один файл чтобы:
--   - на чистом проде/деве накатывалось одной командой
--   - migrate:status был коротким и понятным
--   - не было промежуточных состояний БД при прыжках с релиза на релиз
--
-- Содержимое:
--   1. Home landing             — главная как редактируемый лендинг (site_config.home_landing_id)
--   2. Traffic Agent (install)  — keypair панели + статус установки на нодах
--   3. Traffic Agent (log)      — журнал попыток установки/проверки
--   4. Yandex Cloud — основа    — мульти-аккаунты + IAM-кэш + jobs scaffold
--   5. Yandex Cloud — CIDR lists — сохранённые списки CIDR per account
--   6. Yandex Cloud — SSH keys  — сохранённые публичные ключи per account
--   7. Users lowercase + UNIQUE — case-insensitive логин и email


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Home landing — site_config.home_landing_id
-- ═══════════════════════════════════════════════════════════════════════════
-- Если NULL — на главной показывается дефолтный <Landing /> (как было раньше).
-- ON DELETE SET NULL — удаление лендинга автоматически снимает его с главной.

ALTER TABLE site_config
  ADD COLUMN IF NOT EXISTS home_landing_id INTEGER
    REFERENCES landing_pages(id) ON DELETE SET NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Traffic Agent — install state
-- ═══════════════════════════════════════════════════════════════════════════
-- site_config: один общий keypair панели на все ноды (private encrypted).
-- vps_servers: статус установки на каждой ноде.

ALTER TABLE site_config
  ADD COLUMN IF NOT EXISTS traffic_agent_panel_public_key  TEXT,
  ADD COLUMN IF NOT EXISTS traffic_agent_panel_private_key TEXT;

ALTER TABLE vps_servers
  ADD COLUMN IF NOT EXISTS traffic_agent_installed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS traffic_agent_last_health  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS traffic_agent_last_check   TIMESTAMPTZ;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Traffic Agent — journal of install/check/uninstall attempts
-- ═══════════════════════════════════════════════════════════════════════════
-- Хранит достаточно деталей чтобы админ видел где и почему упало.

CREATE TABLE IF NOT EXISTS traffic_agent_install_log (
  id           SERIAL PRIMARY KEY,
  vps_id       INTEGER REFERENCES vps_servers(id) ON DELETE CASCADE,
  action       VARCHAR(32)  NOT NULL,            -- 'install' | 'check' | 'uninstall'
  status       VARCHAR(32)  NOT NULL,            -- 'ok' | 'partial' | 'failed' | 'health_failed'
  error_code   VARCHAR(64),                      -- известный код ошибки (см. trafficAgentInstaller → classifyError)
  error_hint   TEXT,                             -- подсказка админу — что делать
  steps        JSONB        DEFAULT '[]'::jsonb, -- [{ key, label, ok, detail }]
  health_ok    BOOLEAN,
  health_msg   TEXT,
  stdout_tail  TEXT,                             -- последние ~1500 символов stdout
  stderr_tail  TEXT,                             -- последние ~1500 символов stderr
  duration_ms  INTEGER,
  admin_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_traffic_agent_log_vps
  ON traffic_agent_install_log (vps_id, started_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Yandex Cloud — accounts, IAM-token cache, jobs
-- ═══════════════════════════════════════════════════════════════════════════
-- Мульти-аккаунт. Все sensitive поля шифруются через services/encryption.js.

CREATE TABLE IF NOT EXISTS yc_accounts (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(128) NOT NULL,
  auth_type          VARCHAR(16)  NOT NULL CHECK (auth_type IN ('oauth', 'sa_key')),
  oauth_token        TEXT,                     -- encrypted
  sa_key_json        TEXT,                     -- encrypted (полный JSON SA-ключа)
  default_cloud_id   VARCHAR(64),
  default_folder_id  VARCHAR(64),
  billing_account_id VARCHAR(64),
  socks5_url         TEXT,                     -- encrypted, опц. SOCKS5 для всех запросов
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  is_readonly        BOOLEAN NOT NULL DEFAULT false,  -- запрещает destructive ops
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Кэш IAM-токенов (живут 12ч, перевыпуск за 1ч до истечения)
CREATE TABLE IF NOT EXISTS yc_iam_token_cache (
  account_id    INTEGER PRIMARY KEY REFERENCES yc_accounts(id) ON DELETE CASCADE,
  iam_token     TEXT NOT NULL,                  -- encrypted
  expires_at    TIMESTAMPTZ NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Long-running jobs (поиск IP в CIDR-диапазонах)
CREATE TABLE IF NOT EXISTS yc_jobs (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES yc_accounts(id) ON DELETE CASCADE,
  type         VARCHAR(32) NOT NULL,            -- 'ip_range_search'
  status       VARCHAR(16) NOT NULL DEFAULT 'pending',
                                                -- 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  params       JSONB DEFAULT '{}'::jsonb,
  progress     JSONB DEFAULT '{}'::jsonb,
  result       JSONB,
  error        TEXT,
  admin_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yc_jobs_account_status
  ON yc_jobs (account_id, status, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Yandex Cloud — CIDR lists (saved per-account)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS yc_cidr_lists (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES yc_accounts(id) ON DELETE CASCADE,
  name         VARCHAR(128) NOT NULL,
  description  TEXT,
  cidrs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT yc_cidr_lists_unique_name_per_account UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS yc_cidr_lists_account_id_idx ON yc_cidr_lists(account_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Yandex Cloud — SSH keys (saved per-account)
-- ═══════════════════════════════════════════════════════════════════════════
-- Хранятся ТОЛЬКО публичные ключи (приватная часть остаётся у пользователя).
-- Используются при создании VM (выбор из dropdown'а).

CREATE TABLE IF NOT EXISTS yc_ssh_keys (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES yc_accounts(id) ON DELETE CASCADE,
  name          VARCHAR(128) NOT NULL,
  public_key    TEXT NOT NULL,
  fingerprint   VARCHAR(80),                    -- sha256-hex от key content (для дедупа)
  default_user  VARCHAR(64) NOT NULL DEFAULT 'ubuntu',
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_yc_ssh_keys_account     ON yc_ssh_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_yc_ssh_keys_fingerprint ON yc_ssh_keys(account_id, fingerprint);


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Users — case-insensitive логин и email
-- ═══════════════════════════════════════════════════════════════════════════
-- Vasya и vasya теперь один и тот же пользователь.
-- На уровне БД ставим UNIQUE-индексы по LOWER(...) — защита от дублей даже
-- если backend где-то забудет нормализовать.

UPDATE users SET login = LOWER(login) WHERE login != LOWER(login);
UPDATE users SET email = LOWER(email) WHERE email != LOWER(email);

CREATE UNIQUE INDEX IF NOT EXISTS users_login_lower_uq ON users (LOWER(login));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (LOWER(email));
