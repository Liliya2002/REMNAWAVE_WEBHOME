-- Откат: вернуть старое 5-кнопочное меню. Тексты faq/support_intro/support_contact
-- остаются (они некритичны, ниоткуда больше не читаются).

UPDATE telegram_settings
SET menu_buttons = '[
  {"label": "🌐 Веб-Панель",         "action": "open_web",      "enabled": true, "order": 1},
  {"label": "👤 Личный кабинет",     "action": "cabinet",       "enabled": true, "order": 2},
  {"label": "🛒 Купить подписку",    "action": "buy",           "enabled": true, "order": 3},
  {"label": "👥 Реферальная программа", "action": "referrals",  "enabled": true, "order": 4},
  {"label": "📋 Оферта",             "action": "offer",         "enabled": true, "order": 5}
]'::jsonb
WHERE id = 1;
