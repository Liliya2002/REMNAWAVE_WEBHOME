ALTER TABLE yc_accounts
  DROP COLUMN IF EXISTS grant_notes,
  DROP COLUMN IF EXISTS grant_currency,
  DROP COLUMN IF EXISTS grant_expires_at,
  DROP COLUMN IF EXISTS grant_used_amount,
  DROP COLUMN IF EXISTS grant_amount;
