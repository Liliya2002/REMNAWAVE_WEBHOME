-- Холостой режим: ассистент делает всё, кроме отправки — ответ пишется
-- в журнал. Позволяет посмотреть, ЧТО он собирался написать живым людям,
-- прежде чем выпускать его к ним.
ALTER TABLE ai_assistant_settings
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN DEFAULT true;

-- Закрытие заброшенных тикетов.
--
-- Отдельный переключатель, а не расширение правил ответа: отсечка бэклога
-- (started_at) защищает от ОТВЕТОВ на старую переписку, а этот режим наоборот
-- заходит в бэклог намеренно. Смешивать их в одну настройку нельзя — включив
-- одно, можно случайно получить другое.
ALTER TABLE ai_assistant_settings
  ADD COLUMN IF NOT EXISTS close_stale_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS close_stale_days    INTEGER DEFAULT 30;

-- Пусто = закрывать молча. Иначе текст отправляется клиенту перед закрытием.
ALTER TABLE ai_assistant_settings
  ADD COLUMN IF NOT EXISTS close_stale_message TEXT
    DEFAULT 'Закрываем обращение из-за долгого отсутствия ответа. Если вопрос ещё актуален — напишите нам снова, мы продолжим с этого места.';
