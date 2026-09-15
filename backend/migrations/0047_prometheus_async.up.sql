-- PROMETHEUS: разбор уходит в фон.
--
-- Разбор идёт минутами: модель ходит за данными по нескольку раз, один запрос к
-- ней — до двух минут, шагов до четырнадцати. Синхронный ответ такого не
-- переживает: nginx обрывает соединение на шестидесятой секунде и отдаёт
-- HTML-страницу 504, которую фронт получает вместо JSON. Разбор при этом
-- продолжается и досчитывается в базу — просто некому отдать результат.
--
-- Теперь запрос сразу возвращает номер разбора, а ход виден по мере появления
-- реплик. Состояние прогона нужно, чтобы отличить «ещё думает» от «упал».
ALTER TABLE prometheus_sessions
  ADD COLUMN IF NOT EXISTS run_status     TEXT NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS run_error      TEXT,
  ADD COLUMN IF NOT EXISTS run_started_at TIMESTAMPTZ;

-- Старые разборы завершены по определению: они писались синхронно.
UPDATE prometheus_sessions SET run_status = 'done' WHERE run_status IS NULL;
