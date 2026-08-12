ALTER TABLE selectel_accounts
  DROP COLUMN IF EXISTS low_balance_repeat_hours,
  DROP COLUMN IF EXISTS low_balance_notified_at;
ALTER TABLE yc_accounts
  DROP COLUMN IF EXISTS low_balance_repeat_hours,
  DROP COLUMN IF EXISTS low_balance_notified_at;
