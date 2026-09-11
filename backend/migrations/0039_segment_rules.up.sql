-- Правила по сегментам: что ИИ вправе трогать и как часто.
--
-- Раньше это выражалось только словами в свободном поле ai_prompt, а промпт
-- соблюдается ненадёжно. Здесь — проверяемые кодом правила: разрешение,
-- собственный минимальный интервал и назначение сегмента.
--
-- Строки создаются лениво: нет строки — действуют общие настройки.
CREATE TABLE IF NOT EXISTS broadcast_segment_rules (
  segment           VARCHAR(32) PRIMARY KEY,

  -- Может ли ИИ предлагать и отправлять в этот сегмент.
  ai_allowed        BOOLEAN NOT NULL DEFAULT true,
  -- Может ли человек. Отдельно: сегмент можно закрыть для автоматики,
  -- но оставить себе.
  manual_allowed    BOOLEAN NOT NULL DEFAULT true,

  -- Свой минимум между рассылками именно в этот сегмент, часов.
  -- NULL — действует общий min_interval_minutes.
  min_interval_hours INTEGER,

  -- Назначение: any | sales | service.
  -- sales — только продающие, service — только сервисные новости.
  purpose           VARCHAR(16) NOT NULL DEFAULT 'any',

  -- Пояснение для ИИ: попадает в промпт дословно.
  note              TEXT,

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT segment_rule_purpose_chk CHECK (purpose IN ('any', 'sales', 'service'))
);
