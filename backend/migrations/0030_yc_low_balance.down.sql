ALTER TABLE yc_accounts
  DROP COLUMN IF EXISTS low_balance_threshold,
  DROP COLUMN IF EXISTS last_balance_rub,
  DROP COLUMN IF EXISTS balance_checked_at,
  DROP COLUMN IF EXISTS low_balance_notified;
