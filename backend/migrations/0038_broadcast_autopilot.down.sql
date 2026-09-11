DROP INDEX IF EXISTS broadcast_proposals_due_idx;
ALTER TABLE broadcast_proposals DROP CONSTRAINT IF EXISTS broadcast_proposal_status_chk;
-- Снимаем состояния, которых не будет после отката
UPDATE broadcast_proposals SET status = 'rejected'
 WHERE status IN ('scheduled', 'cancelled', 'failed');
ALTER TABLE broadcast_proposals
  ADD CONSTRAINT broadcast_proposal_status_chk
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));
ALTER TABLE broadcast_proposals
  DROP COLUMN IF EXISTS scheduled_at,
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS fail_reason;
