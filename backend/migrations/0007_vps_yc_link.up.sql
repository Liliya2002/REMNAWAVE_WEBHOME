-- v0.1.9: связать VM из Yandex Cloud с VPS-записями для управления через /admin/vps.
-- При создании VM в YC (если включён чекбокс "Добавить в VPS") мы автоматически
-- создаём запись в vps_servers и сохраняем ссылку на оригинальный YC instance.

ALTER TABLE vps_servers
  ADD COLUMN IF NOT EXISTS yc_account_id  INTEGER REFERENCES yc_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS yc_instance_id VARCHAR(64);

-- Поиск VPS по YC instance — ищем дубли при создании, и используется при удалении VM
CREATE INDEX IF NOT EXISTS idx_vps_servers_yc_instance
  ON vps_servers (yc_instance_id) WHERE yc_instance_id IS NOT NULL;
