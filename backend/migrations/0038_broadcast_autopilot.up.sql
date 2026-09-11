-- Автопилот: ИИ отправляет сам, но с окном отмены.
--
-- У API бота нет отмены, поэтому страховка ставится ДО вызова: решив
-- отправить, автопилот не шлёт сразу, а ставит рассылку в очередь со временем
-- отправки и уведомляет админа. Пока время не наступило, её можно снять.
ALTER TABLE broadcast_proposals
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ,
  -- Почему автопилот не смог отправить, когда время пришло (лимиты, сбой API).
  ADD COLUMN IF NOT EXISTS fail_reason  TEXT;

-- Новые состояния: scheduled — ждёт отправки автопилотом,
-- cancelled — снята человеком до истечения окна.
ALTER TABLE broadcast_proposals DROP CONSTRAINT IF EXISTS broadcast_proposal_status_chk;
ALTER TABLE broadcast_proposals
  ADD CONSTRAINT broadcast_proposal_status_chk
  CHECK (status IN ('pending', 'scheduled', 'approved', 'rejected', 'cancelled', 'expired', 'failed'));

-- Выборка «что пора отправить» идёт на каждом тике крона.
CREATE INDEX IF NOT EXISTS broadcast_proposals_due_idx
  ON broadcast_proposals (status, scheduled_at)
  WHERE status = 'scheduled';
