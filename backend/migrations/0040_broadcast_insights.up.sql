-- Полигон для экспериментов и защита от повторов.
--
-- Полигон: сегмент, на котором ИИ и человеку разрешено пробовать новое, не
-- рискуя всей базой. У Veltrix это expiring — 34 человека против 5418 у all,
-- при этом за 8 месяцев ему написали трижды.
ALTER TABLE broadcast_segment_rules
  ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;

-- Порог похожести текстов, при котором отправка блокируется, и окно поиска.
-- В настройках, а не в коде: приемлемая степень повтора — вопрос вкуса
-- владельца, а не техническая константа.
ALTER TABLE broadcast_settings
  ADD COLUMN IF NOT EXISTS duplicate_similarity NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  ADD COLUMN IF NOT EXISTS duplicate_window_days INTEGER NOT NULL DEFAULT 14;
