-- Отметка версии тикета на момент обработки.
--
-- Список тикетов отдаёт updated_at, и по нему видно, менялся ли тикет с прошлого
-- раза. Раньше карточка каждого тикета запрашивалась на каждом прогоне только
-- ради проверки «уже обработан» — 35 лишних запросов к API каждые 10 минут.
--
-- Храним именно значение Bedolaga, а не время своей обработки: часы двух серверов
-- расходятся, и сравнение «наше время против их времени» рано или поздно начнёт
-- пропускать изменения.
ALTER TABLE ai_ticket_replies
  ADD COLUMN IF NOT EXISTS ticket_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_atr_ticket_updated
  ON ai_ticket_replies (account_id, ticket_id, ticket_updated_at DESC);
