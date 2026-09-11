-- ИИ-планировщик рассылок.
--
-- Подключение к модели (ключ, базовый URL, модель, лимит токенов) НЕ дублируем:
-- берём из ai_assistant_settings — провайдер один, и второй ключ пришлось бы
-- менять в двух местах, о чём рано или поздно забудут.
-- Здесь только то, что относится именно к рассылкам.
ALTER TABLE broadcast_settings
  -- off — выключен; prepare — готовит карточки, отправляет человек;
  -- auto — отправляет сам (реализуется отдельным этапом).
  ADD COLUMN IF NOT EXISTS ai_mode              VARCHAR(16) NOT NULL DEFAULT 'off',
  -- Холостой режим: решения пишутся в журнал, карточки не создаются.
  -- true по умолчанию — как у ассистента тикетов.
  ADD COLUMN IF NOT EXISTS ai_dry_run           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_interval_hours    INTEGER NOT NULL DEFAULT 24,
  -- Какие сегменты ИИ вправе предлагать. Пусто = те же, что разрешены вообще.
  ADD COLUMN IF NOT EXISTS ai_allowed_targets   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_min_confidence    NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  -- Дополнительные указания владельца — подмешиваются к базовому промпту.
  ADD COLUMN IF NOT EXISTS ai_prompt            TEXT,
  -- Окно отмены для автопилота, минут (этап 5).
  ADD COLUMN IF NOT EXISTS ai_auto_delay_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS ai_last_run_at       TIMESTAMPTZ;

ALTER TABLE broadcast_settings
  DROP CONSTRAINT IF EXISTS broadcast_ai_mode_chk;
ALTER TABLE broadcast_settings
  ADD CONSTRAINT broadcast_ai_mode_chk CHECK (ai_mode IN ('off', 'prepare', 'auto'));


-- Предложения ИИ. Карточка живёт до решения человека.
CREATE TABLE IF NOT EXISTS broadcast_proposals (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,

  target        VARCHAR(32) NOT NULL,
  message_text  TEXT NOT NULL,
  template_id   INTEGER REFERENCES broadcast_templates(id) ON DELETE SET NULL,

  -- Почему именно сейчас и этот сегмент — показываем человеку как есть.
  reason        TEXT,
  risks         TEXT,
  confidence    NUMERIC(3,2),
  recipients    INTEGER,               -- ожидаемая аудитория на момент создания

  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  -- Причина отказа накапливается и подмешивается в промпт как антипример:
  -- иначе ИИ будет предлагать одно и то же по кругу.
  reject_reason TEXT,

  input_tokens  INTEGER,
  output_tokens INTEGER,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ,
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  broadcast_id  INTEGER,               -- id на стороне бота после отправки

  CONSTRAINT broadcast_proposal_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

CREATE INDEX IF NOT EXISTS broadcast_proposals_pending_idx
  ON broadcast_proposals (account_id, status, created_at DESC);


-- Журнал решений ИИ, включая «не надо отправлять» и холостые прогоны.
-- Без него холостой режим был бы бесполезен: посмотреть, что ИИ надумал,
-- оказалось бы негде.
CREATE TABLE IF NOT EXISTS broadcast_ai_runs (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES bedolaga_accounts(id) ON DELETE CASCADE,
  should_send   BOOLEAN,
  target        VARCHAR(32),
  confidence    NUMERIC(3,2),
  reason        TEXT,
  outcome       VARCHAR(32) NOT NULL,   -- proposed | skipped | dry_run | blocked | error
  detail        TEXT,
  dry_run       BOOLEAN NOT NULL DEFAULT false,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broadcast_ai_runs_recent_idx
  ON broadcast_ai_runs (account_id, created_at DESC);
