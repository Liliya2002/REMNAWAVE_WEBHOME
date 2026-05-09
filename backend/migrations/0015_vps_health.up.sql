-- v0.1.23: VPS health-check.
--
-- Cron `backend/cron/vpsHealth.js` раз в N минут пингует все active VPS
-- (TCP-22). Результаты сохраняются здесь. При смене состояния шлётся
-- админу уведомление в Telegram (admin_vps_unreachable / admin_vps_back_online).
--
--   is_reachable        — true | false | NULL (ещё не проверяли)
--   last_health_check   — timestamp последней проверки
--   last_unreachable_at — когда сервер «упал» в первый раз. Сбрасывается в NULL
--                         когда снова доступен (используется для расчёта downtime).

ALTER TABLE vps_servers
  ADD COLUMN IF NOT EXISTS is_reachable        BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_health_check   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_unreachable_at TIMESTAMPTZ;

-- Дефолты для новых ключей уведомлений в telegram_settings.
-- При `defaults || existing` существующие ключи перевешивают дефолтные —
-- значит новые ключи добавятся, а уже настроенные пользователем не сбросятся.
UPDATE telegram_settings
   SET notifications_enabled = jsonb_build_object(
         'admin_vps_unreachable', true,
         'admin_vps_back_online', true
       ) || notifications_enabled
 WHERE id = 1;
