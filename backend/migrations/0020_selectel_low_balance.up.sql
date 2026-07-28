-- v0.1.29: индикатор низкого баланса Selectel + уведомление админу в Telegram.
--
-- Порог задаётся на аккаунт (в рублях). Крон периодически читает баланс и при
-- падении ниже порога шлёт уведомление админу; low_balance_notified исключает
-- повторный спам (сбрасывается, когда баланс снова поднимается выше порога).

ALTER TABLE selectel_accounts
  ADD COLUMN IF NOT EXISTS low_balance_threshold NUMERIC(12,2),           -- порог в ₽ (NULL/0 = выкл)
  ADD COLUMN IF NOT EXISTS low_balance_notified  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_balance_rub      NUMERIC(14,2),           -- последний известный баланс, ₽
  ADD COLUMN IF NOT EXISTS balance_checked_at    TIMESTAMPTZ;             -- когда крон последний раз проверял
