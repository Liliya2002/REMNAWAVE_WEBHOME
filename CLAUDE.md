# VPN Webhome — карта проекта

Веб-панель для продажи VPN-подписок поверх панели **RemnaWave**: сайт с личным
кабинетом, админ-панель, Telegram-бот, приём платежей и управление серверами у
нескольких хостинг-провайдеров.

Стек: **backend** — Node.js/Express + PostgreSQL (без ORM, чистый `pg`);
**frontend** — React 18 + Vite + Tailwind (react-router, без state-менеджера);
**деплой** — Docker Compose + образы в GHCR.

---

## Структура

```
backend/          Express API
  routes/         HTTP-эндпоинты (36 файлов). admin-*.js — всё под /api/admin/*
  services/       бизнес-логика и клиенты внешних API (31 файл + 2 папки)
  cron/           фоновые задачи, запускаются из index.js
  middleware/     maintenance-гвард, бан IP, SSR лендингов
  migrations/     нумерованные .up.sql/.down.sql (сейчас 22)
  scripts/        разовые админские утилиты и migrate.js
frontend/src/
  pages/          страницы, включая Admin*.jsx и ruvds/ (вложенные роуты)
  components/     переиспользуемые компоненты
  contexts/       SiteConfig, Notification, Theme, Effects, AdminUi
  config/         adminNav.js — единый источник меню админки
  services/       api.js (authFetch), auth.js (login/register)
deploy/           deploy.sh, backup.sh, rollback.sh — обновление на сервере
nginx/            конфиг + шаблон app.conf.template
VpnMobile/        React Native приложение (отдельно)
```

---

## Ключевые модули

**Оплата.** `services/paymentCreate.js` — единая точка создания счёта (используют
и сайт, и бот). `services/platega.js` — клиент Platega. `services/payment.js` —
активация подписки после оплаты. Вебхук: `POST /api/payments/webhook` в
`routes/payments.js` → `activateSubscription()`.

**Ключи платёжки лежат в БД**, а не в `.env`: `services/paymentSettings.js`
(таблица `payment_settings`, кэш 30 с, `invalidate()` после сохранения). Если в
базе пусто — откат на `PLATEGA_MERCHANT_ID`/`PLATEGA_SECRET`. Настраивается в
админке: Настройки → **Платёжки**.

**RemnaWave.** `services/remnwave.js` — API панели. `remnwaveNodeInstaller.js` —
установка/обновление ноды по SSH. `squadQuota.js`, `trafficGuard.js`,
`p2pDetector.js` — контроль трафика.

**Telegram.** `services/telegramBot/`: `index.js` (grammY), `handlers.js`
(команды и меню, есть `findOrCreateUser`), `adminHandlers.js`, `notify.js`
(`notifyUser`/`notifyAdmin` + шаблоны), `tokens.js` (одноразовые токены входа),
`oidc.js` (вход через браузер), `webAppAuth.js` (валидация initData Mini App),
`settings.js` (настройки из БД).

**Интеграции с провайдерами** — все по одному шаблону (таблица аккаунтов с
зашифрованным секретом → сервис-клиент → `routes/admin-*.js` → страница):
`services/yandexCloud/` (auth, compute, vpc, billing, images, sshKeys),
`services/selectel.js`, `services/ruvds.js`, `services/bedolaga.js`
(мониторинг стороннего бота продаж).

**Кроны** (`backend/index.js` в конце): `expireSubscriptions` 5 мин,
`vpsHealth` 10 мин (внешняя проверка через check-host.net, не с сервера),
`vpsExpiry` 30 мин, `squadQuota`/`p2pDetector` 5 мин, `trafficGuard` 15 мин,
`selectelBalance` 60 мин, `trafficSnapshots` 24 ч.

---

## Как запускать

```bash
cd backend && npm start          # порт 4000
cd frontend && npm run dev       # порт 5173
cd backend && npm run migrate:up # применить миграции
```

Фронт ходит на тот же origin (`VITE_API_URL` пуст) — в dev через прокси Vite.

**Релиз:** поднять `VERSION`, дописать `CHANGELOG.md`, коммит, тег `vX.Y.Z`,
push тега → CI собирает образы в GHCR и создаёт GitHub Release.
На сервере: `cd /opt/vpnwebhome && bash deploy/deploy.sh vX.Y.Z` (сам делает
бэкап БД, миграции, рестарт, smoke-тест, откат при сбое).

---

## Грабли, на которые уже наступали

Это не теория — каждый пункт стоил времени.

**`admin_only_mode`.** Флаг в `site_config`, гвард — `middleware/maintenance.js`.
Отбивает 403 **до** роутов, поэтому в белом списке `ALLOWED` обязаны быть
server-to-server вызовы: `/api/payments/webhook` (иначе оплата проходит, но
подписка не активируется) и все `/auth/telegram/*` + `/auth/tg-login` (на момент
входа JWT ещё нет, и гвард отбивал даже админа).

**Два аккаунта у одного человека в Telegram.** Вход через бота/Mini App ищет
юзера по `users.telegram_id`, а через браузер (OIDC) — по `telegram_oidc_sub`,
и это **разные** идентификаторы. Симптом: «подписка активирована, но её не
видно». Лечится `scripts/merge-telegram-duplicates.js` (dry-run по умолчанию).
Автоматически связывать по `@username` нельзя — username переуступаем.

**Одноразовые токены.** Проверяй права **до** сжигания токена (`peekAutoLoginToken`
→ проверки → `consumeAutoLoginToken`), иначе после отказа юзер видит «токен
истёк» вместо настоящей причины.

**PWA на iPhone.** `apple-touch-icon` обязан быть **PNG** — по ссылке на `.svg`
iOS молча ставит скриншот страницы вместо значка. `env(safe-area-inset-*)`
равен нулю без `viewport-fit=cover` в `<meta name="viewport">`, так что отступы
под чёлку и home-индикатор просто не работают. Статус-бар красится в
`theme-color`, поэтому его синхронизирует `ThemeContext` (и дублирует
инлайн-скрипт в `index.html`, иначе полоска мигает). Иконки и splash
пересобираются `frontend/scripts/gen-pwa-icons.py`; список splash-размеров
должен совпадать со ссылками в `index.html`.

**Autoprefixer вырезает `-webkit-touch-callout`.** Считает его устаревшим
префиксом и удаляет из сборки — свойства нет в `dist/assets/*.css`. Нужен
`/* autoprefixer: ignore next */` перед объявлением. Проверять именно в
собранном CSS, в исходнике оно на месте.

**`backdrop-blur` создаёт containing block.** У шапки сайта он есть, поэтому
`position: fixed` внутри неё считается от шапки, а не от экрана. Выпадающие
панели рендерить **порталом в `<body>`** (см. `NotificationBell.jsx`).

**Стабильность дерева React.** `MaintenanceGate` возвращал то `children`, то
`<>…{children}</>` — React перемонтировал поддерево и одноразовые эффекты
выполнялись дважды (`/tg-login` дважды обменивал токен). Число и позиция детей
должны быть постоянными.

**Пул PostgreSQL.** Без `pool.on('error')` обрыв простаивающего соединения
(`ECONNRESET`) роняет весь процесс. Обработчик есть в `db.js`, не убирать.

**SSH к VPS.** Хостер может резать **исходящий** порт 22 — проверяется
`bash -c "cat </dev/null >/dev/tcp/github.com/22"`. Обход: доп. порт на VPS +
поле `vps_servers.ssh_port`. В Ubuntu 22.10+ порт задаётся через `ssh.socket`,
сервис называется `ssh`, а не `sshd`. Health-check при этом продолжает работать —
он ходит снаружи через check-host.net.

**Yandex Cloud.** OAuth-токены Яндекса закрыты: с 01.06.2026 новые не выдают,
старые живут год. Переходить на **сервисные аккаунты** (`auth_type='sa_key'`,
поддержка уже есть). Роли на каталог не дают прав ни на список облаков, ни на
биллинг — `billing.accounts.viewer` назначается **на сам биллинг-аккаунт**.

**Шифрование секретов.** `services/encryption.js` требует `ENCRYPTION_KEY` в
`.env` (`openssl rand -hex 32`). Без него токены и пароли пишутся в базу
открытым текстом — проверять на проде.

**Тестировать только локально нельзя.** Telegram-вход, Mini App и вебхуки
работают лишь на проде (нужен публичный HTTPS). Диагностировать по логам:
`docker compose logs --tail=50 backend`.

---

## Договорённости

- Общение и комментарии в коде — **по-русски**.
- Секреты в БД — только через `encrypt()`, наружу отдавать флаг `has_*`, а не
  значение. Пустая строка в PUT = «не менять».
- Новые эндпоинты провайдеров — по образцу `admin-selectel.js`/`admin-ruvds.js`.
- Пункт меню админки добавляется в `frontend/src/config/adminNav.js` (единый
  источник для сайдбара и стартового экрана) + роут в `App.jsx`.
- Ретраи — только для GET. Повтор POST может продублировать действие (создать
  сервер, отправить рассылку, списать деньги).
- Перед массовыми действиями (рассылка, слияние аккаунтов, удаление) —
  подтверждение и dry-run.
