-- v0.1.9: красивое дефолтное меню Telegram-бота + добавлены кнопки
-- «❓ FAQ» и «💬 Поддержка» (как у популярных VPN-ботов).
--
-- Раскладка:
--   👤 Личный кабинет        (wide)
--   🌐 Веб-Панель            (wide)
--   🛒 Купить | 👥 Пригласить (pair)
--   ❓ FAQ                   (wide)
--   💬 Поддержка             (wide)
--   📋 Оферта                (wide)
--
-- Обновляем существующую запись только если меню всё ещё в первоначальном
-- 5-кнопочном виде (юзер ничего не менял в админке). Если уже кастомизировано —
-- не трогаем.

UPDATE telegram_settings
SET menu_buttons = '[
  {"label": "👤 Личный кабинет",     "action": "cabinet",   "enabled": true, "order": 1, "wide": true},
  {"label": "🌐 Веб-Панель",         "action": "open_web",  "enabled": true, "order": 2, "wide": true},
  {"label": "🛒 Купить подписку",    "action": "buy",       "enabled": true, "order": 3},
  {"label": "👥 Пригласить",         "action": "referrals", "enabled": true, "order": 4},
  {"label": "❓ Вопросы и ответы",   "action": "faq",       "enabled": true, "order": 5, "wide": true},
  {"label": "💬 Поддержка",          "action": "support",   "enabled": true, "order": 6, "wide": true},
  {"label": "📋 Оферта",             "action": "offer",     "enabled": true, "order": 7, "wide": true}
]'::jsonb
WHERE id = 1
  AND jsonb_array_length(menu_buttons) <= 5;

-- Добавляем дефолтные тексты для новых разделов (если ещё не заданы)
UPDATE telegram_settings
SET texts = texts
  || jsonb_build_object('faq', COALESCE(texts->>'faq',
       '<b>❓ Вопросы и ответы</b>'
       || E'\n\n<b>Как получить подписку?</b>'
       || E'\nЖми «🛒 Купить подписку» — выбери тариф и оплати.'
       || E'\n\n<b>Как подключить VPN?</b>'
       || E'\nПосле оплаты в «👤 Личный кабинет» появится кнопка «📲 Подключить VPN».'
       || E'\n\n<b>Сколько устройств можно подключить?</b>'
       || E'\nЗависит от тарифа. Лимит указан при покупке.'
       || E'\n\n<b>Что делать если не работает?</b>'
       || E'\nНапиши в «💬 Поддержку» — поможем.'
     ))
  || jsonb_build_object('support_intro', COALESCE(texts->>'support_intro',
       '💬 <b>Поддержка</b>'
       || E'\n\nНапиши нам — отвечаем по будням. Опиши проблему как можно подробнее: что делал, на каком устройстве, скриншот ошибки если есть.'
     ))
  || jsonb_build_object('support_contact', COALESCE(texts->>'support_contact', ''))
WHERE id = 1;
