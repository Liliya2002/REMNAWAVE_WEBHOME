-- v0.1.9: Telegram-бот — настройки, токены привязки.
--
-- telegram_settings — singleton-строка с настройками бота. Хранится в БД
-- (а не в .env) чтобы менять можно было без рестарта прямо из админки.
-- Bot token шифруется через services/encryption.js.
--
-- telegram_link_tokens — для будущего этапа D (привязка существующих email-юзеров
-- к их Telegram-аккаунту через /start link_<token>).

CREATE TABLE IF NOT EXISTS telegram_settings (
  id                     INTEGER PRIMARY KEY DEFAULT 1,
  is_enabled             BOOLEAN NOT NULL DEFAULT false,
  bot_token              TEXT,                            -- encrypted
  bot_username           VARCHAR(64),                     -- "MyVpnBot" (без @), для построения ссылок
  mode                   VARCHAR(16) NOT NULL DEFAULT 'polling' CHECK (mode IN ('polling', 'webhook')),
  webhook_url            TEXT,                            -- "https://example.com/api/tg/webhook"
  webhook_secret         TEXT,                            -- encrypted; передаётся через X-Telegram-Bot-Api-Secret-Token
  admin_chat_id          VARCHAR(64),                     -- куда слать админские уведомления (notifyAdmin)
  notifications_enabled  JSONB NOT NULL DEFAULT '{
    "user_subscription_expiring": true,
    "user_payment_received": true,
    "user_referral_bonus": true,
    "user_traffic_blocked": true,
    "admin_vps_expiring": true,
    "admin_user_registered": false,
    "admin_payment_received": true
  }'::jsonb,
  texts                  JSONB NOT NULL DEFAULT '{
    "welcome_new":   "Привет, {name}! 👋\nТы успешно зарегистрировался в нашем VPN-сервисе. Используй меню снизу для управления подпиской и аккаунтом.",
    "welcome_back":  "С возвращением, {name}! 👋\nИспользуй меню для быстрого доступа к функциям.",
    "offer":         "Здесь будет текст оферты, политики конфиденциальности и условий использования. Задаётся в админке /admin/telegram → Тексты.",
    "no_subscription": "У тебя пока нет активной подписки. Жми «Купить подписку» чтобы выбрать тариф."
  }'::jsonb,
  menu_buttons           JSONB NOT NULL DEFAULT '[
    {"label": "🌐 Веб-Панель",         "action": "open_web",      "enabled": true, "order": 1},
    {"label": "👤 Личный кабинет",     "action": "cabinet",       "enabled": true, "order": 2},
    {"label": "🛒 Купить подписку",    "action": "buy",           "enabled": true, "order": 3},
    {"label": "👥 Реферальная программа", "action": "referrals",  "enabled": true, "order": 4},
    {"label": "📋 Оферта",             "action": "offer",         "enabled": true, "order": 5}
  ]'::jsonb,
  enforce_single_row     BOOLEAN GENERATED ALWAYS AS (id = 1) STORED CHECK (id = 1),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Дефолтная строка (singleton)
INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- Токены привязки existing email-юзера к Telegram (этап D).
-- Юзер в ЛК генерирует токен → пишет боту "/start link_<token>" → бот привязывает.
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user ON telegram_link_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_expires ON telegram_link_tokens(expires_at);
