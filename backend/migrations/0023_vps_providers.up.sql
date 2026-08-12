-- v0.1.35: справочник хостинг-провайдеров VPS.
--
-- Раньше список был захардкожен во фронте (AdminVps.jsx), поэтому добавить или
-- убрать провайдера можно было только правкой кода. Теперь он редактируется в
-- админке: Настройки → VPS → Провайдеры.
--
-- Связь с vps_servers намеренно оставлена строковой (hosting_provider VARCHAR),
-- а не внешним ключом: так не ломаются существующие записи, а провайдера можно
-- удалить из справочника, не трогая привязанные серверы.

CREATE TABLE IF NOT EXISTS vps_providers (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(128) NOT NULL UNIQUE,
  website_url  VARCHAR(256),          -- официальный сайт
  panel_url    VARCHAR(256),          -- личный кабинет (обычно другой адрес)
  notes        TEXT,                  -- условия оплаты, реквизиты, особенности
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Переносим список из хардкода. URL заполнены там, где они достоверно известны;
-- остальные админ дозаполнит в интерфейсе.
INSERT INTO vps_providers (name, website_url, panel_url, sort_order) VALUES
  ('TimeWEB',       'https://timeweb.cloud',   'https://timeweb.cloud/my',        10),
  ('Selectel',      'https://selectel.ru',     'https://my.selectel.ru',          20),
  ('Yandex Cloud',  'https://yandex.cloud',    'https://console.yandex.cloud',    30),
  ('RUVDS',         'https://ruvds.com',       'https://ruvds.com/my',            40),
  ('VK Cloud',      'https://cloud.vk.com',    NULL,                              50),
  ('AdminVPS',      'https://adminvps.ru',     NULL,                              60),
  ('Aeza',          'https://aeza.net',        NULL,                              70),
  ('Hetzner',       'https://hetzner.com',     'https://console.hetzner.cloud',   80),
  ('OVH',           'https://ovhcloud.com',    NULL,                              90),
  ('Vultr',         'https://vultr.com',       NULL,                             100),
  ('Play2Go',       NULL,                      NULL,                             110),
  ('Mhost',         NULL,                      NULL,                             120),
  ('WarpX',         NULL,                      NULL,                             130),
  ('DoubleServers', NULL,                      NULL,                             140),
  ('UFO',           NULL,                      NULL,                             150)
ON CONFLICT (name) DO NOTHING;

-- Провайдеры, которые уже используются в карточках серверов, но которых нет в
-- списке выше (например заведённые вручную) — добавляем, чтобы справочник
-- сразу совпадал с реальностью.
INSERT INTO vps_providers (name, sort_order)
SELECT DISTINCT hosting_provider, 200
  FROM vps_servers
 WHERE hosting_provider IS NOT NULL
   AND hosting_provider <> ''
   AND hosting_provider <> 'Другой'
ON CONFLICT (name) DO NOTHING;
