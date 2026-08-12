-- Периодическое напоминание о низком балансе.
--
-- Раньше уведомление уходило РОВНО ОДИН раз при падении ниже порога и молчало,
-- пока баланс не поднимут. Одно сообщение про уходящий в минус аккаунт легко
-- пропустить, а последствие — остановленные виртуалки.
--
-- 0 = прежнее поведение (один раз). N > 0 = напоминать каждые N часов, пока
-- баланс ниже порога. Значение по умолчанию 0 выбрано намеренно: молчаливое
-- превращение существующих аккаунтов в источник ежедневных сообщений было бы
-- неприятным сюрпризом.
ALTER TABLE selectel_accounts
  ADD COLUMN IF NOT EXISTS low_balance_repeat_hours INTEGER DEFAULT 0,
  -- Время последнего отправленного уведомления. Без него нельзя понять,
  -- пора ли повторять: сам флаг говорит только «уже уведомляли когда-то».
  ADD COLUMN IF NOT EXISTS low_balance_notified_at  TIMESTAMPTZ;

ALTER TABLE yc_accounts
  ADD COLUMN IF NOT EXISTS low_balance_repeat_hours INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_balance_notified_at  TIMESTAMPTZ;
