-- v0.1.9: грант (бонусы) в Yandex Cloud аккаунте.
--
-- YC не отдаёт сумму гранта через публичный API — поле `balance` в getBillingAccount
-- содержит общую цифру (грант + личные деньги). Поэтому даём админу вписать вручную:
--   - grant_amount       — изначальная сумма гранта (например 4000 ₽)
--   - grant_used_amount  — сколько потрачено (опционально, для отображения остатка)
--   - grant_expires_at   — срок истечения (часто 60 дней с регистрации)
--   - grant_currency     — валюта гранта (обычно совпадает с billing currency)
--
-- Если все поля NULL — UI показывает только обычный баланс, как было раньше.

ALTER TABLE yc_accounts
  ADD COLUMN IF NOT EXISTS grant_amount      NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS grant_used_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS grant_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grant_currency    VARCHAR(8),
  ADD COLUMN IF NOT EXISTS grant_notes       TEXT;
