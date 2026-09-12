DROP INDEX IF EXISTS idx_subscriptions_provisioning_queue;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_provisioning_status_chk;
ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS provisioning_status,
  DROP COLUMN IF EXISTS provisioning_error,
  DROP COLUMN IF EXISTS provisioning_attempts,
  DROP COLUMN IF EXISTS provisioning_next_try_at,
  DROP COLUMN IF EXISTS provisioned_at;
