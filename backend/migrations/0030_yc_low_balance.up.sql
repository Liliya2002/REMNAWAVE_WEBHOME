-- Индикатор низкого баланса Yandex Cloud.
--
-- Ровно те же поля, что у Selectel (selectel_accounts): порог, последний
-- известный баланс, время проверки и флаг «уже уведомили». Единообразие
-- важнее краткости — два похожих механизма с разными именами полей потом
-- расходятся в поведении.
ALTER TABLE yc_accounts
  ADD COLUMN IF NOT EXISTS low_balance_threshold NUMERIC(12,2) DEFAULT 200,
  ADD COLUMN IF NOT EXISTS last_balance_rub      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS balance_checked_at    TIMESTAMPTZ,
  -- Флаг гасит повторные уведомления: алерт уходит один раз при падении ниже
  -- порога и снова становится возможным, когда баланс поднялся.
  ADD COLUMN IF NOT EXISTS low_balance_notified  BOOLEAN DEFAULT false;
