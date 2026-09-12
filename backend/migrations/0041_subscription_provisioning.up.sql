-- Состояние выдачи доступа в RemnaWave для оплаченной подписки.
--
-- Зачем. До этого активация писала подписку в базу независимо от того, удалось
-- ли создать пользователя в панели. Если панель не ответила или у тарифа не
-- оказалось серверной группы, в базе появлялась строка с is_active = true и
-- remnwave_user_uuid = NULL: человек заплатил, в кабинете видит активную
-- подписку, а подключаться ему не к чему. Ошибка при этом никуда не всплывала —
-- активация не падала, вебхук отвечал 200, админ ничего не узнавал.
--
-- Отдельная колонка, а не «uuid IS NULL»: нужно хранить причину сбоя, число
-- попыток и время следующей, чтобы повтор был управляемым, а не бесконечным.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provisioning_status      TEXT      NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS provisioning_error       TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_attempts    INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provisioning_next_try_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisioned_at           TIMESTAMPTZ;

-- 'ok'      — доступ в панели выдан;
-- 'pending' — не выдан, стоит в очереди на повтор;
-- 'failed'  — попытки исчерпаны, нужен человек.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_provisioning_status_chk;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_provisioning_status_chk
  CHECK (provisioning_status IN ('ok', 'pending', 'failed'));

-- Уже существующие битые подписки ставим в очередь: миграция не только заводит
-- механизм, но и лечит то, что сломалось до неё.
UPDATE subscriptions
   SET provisioning_status = 'pending',
       provisioning_next_try_at = NOW(),
       provisioning_error = 'Найдено при установке механизма повторов: доступа в панели нет'
 WHERE is_active = true AND remnwave_user_uuid IS NULL;

-- Уже рабочим проставляем время выдачи, чтобы отличать их от тех, кого
-- механизм ещё не трогал.
UPDATE subscriptions
   SET provisioned_at = COALESCE(updated_at, created_at)
 WHERE remnwave_user_uuid IS NOT NULL AND provisioned_at IS NULL;

-- Частичный индекс: очередь повторов выбирается часто, а строк в ней единицы.
CREATE INDEX IF NOT EXISTS idx_subscriptions_provisioning_queue
  ON subscriptions (provisioning_next_try_at)
  WHERE provisioning_status = 'pending';
