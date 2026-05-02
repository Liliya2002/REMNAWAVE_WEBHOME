# Changelog — VPN Webhome

> Все ключевые изменения проекта, сгруппированные по фичам

---

## v0.1.7 — Hotfix: legacy UPDATE users.remnwave_uuid в /activate

После v0.1.6 fallback на A019 сработал, но `/activate` пытался обновить
`users.remnwave_uuid` — колонки больше нет (UUID хранится только в
`subscriptions.remnwave_user_uuid`). Убран мёртвый UPDATE.

---

## v0.1.6 — Hotfix: Free Trial activation для existing RW юзеров

> Изначально планировался как `v0.1.5.1`, но `docker/metadata-action` в CI
> поддерживает только строгий semver `X.Y.Z`. Перевыпущено как `0.1.6`.

**Bugfix:** `POST /api/subscriptions/activate` (Free Trial) падал с **HTTP 500**
если юзер уже существовал в RemnaWave (например, от прошлой подписки или
Free Trial был активирован ранее, потом удалена запись из нашей БД).

RW отвечал `400 A019: User username already exists` → `apiRequest` проглатывал
ошибку и возвращал `null` → `createRemnwaveUser` падал с
`TypeError: Cannot read properties of null (reading 'uuid')` → 500.

**Фикс:**
- В `/activate` добавлен fallback (как в `payment.js`): на ошибке create →
  `getRemnwaveUserByUsername` → `updateRemnwaveUser` с новыми expire/traffic/
  squads/metadata. Существующий RW-юзер переиспользуется для новой подписки.
- `createRemnwaveUser` теперь явно проверяет `user.uuid` и кидает
  осмысленную ошибку вместо `TypeError`.

Также фикс в `deploy/deploy.sh`:
- `docker compose restart nginx` после перезапуска backend/frontend (без
  этого nginx кеширует старый IP backend → 502 Bad Gateway после деплоя)
- `MAX_WAIT` smoke-теста 60 → 120 сек

---

## v0.1.5 — Traffic Guard 2.0 + Plan Tiers + Squad Quotas

Большое расширение Traffic Guard — теперь система не только следит за лимитами трафика,
но и автоматически банит IP нарушителей (защита от ре-регистрации) и детектит P2P/torrent.

### 🌐 IP-баны (Phase 1)

| Что | Где |
|---|---|
| `users.registration_ip` — IP при регистрации | Migration `0003_ip_ban` |
| `traffic_violations.client_ips JSONB` — массив IP нарушителя | Migration `0003` |
| Таблица `banned_ips` с source/expires_at/reason/notes | Migration `0003` |
| Auto-ban при создании blocked-violation | [`backend/services/trafficGuard.js`] |
| Middleware `checkBannedIp` на `/auth/register` | [`backend/middleware/ipBan.js`] |
| Сервис `services/ipBan.js` — addManual/Auto, list, remove, cleanup | [`backend/services/ipBan.js`] |
| CRUD `/api/admin/traffic-guard/banned-ips` | [`backend/routes/admin-traffic-guard.js`] |
| Settings: `ip_ban_enabled` + `ip_ban_duration_hours` (0 = пока активна блокировка) | UI + DB |
| Новый таб «Бан по IP» в /admin/traffic-guard | [`frontend/src/pages/AdminTrafficGuard.jsx`] |
| Показ `client_ips` в карточках violations | UI |

Auto-unblock и manual unblock через `/violations/:id/unblock` снимают связанные **авто-баны**.
Manual-баны живут пока админ сам не снимет.

### 🔑 SSH-агент для нод (Phase 2)

On-demand lookup настоящего IP клиента из access.log на ноде RemnaWave, без массового логирования.

| Что | Где |
|---|---|
| Migration: `ssh_lookup_enabled` + торрент/P2P-поля | Migration `0004_traffic_guard_ssh` |
| Узкий sh-скрипт для ноды (whitelist-команды) | [`infra/node-agent/access-log-query.sh`] |
| Полная инструкция по установке агента на ноду | [`infra/node-agent/README.md`] |
| SSH-клиент на бэкенде (через `ssh2`, command-restriction) | [`backend/services/sshAgent.js`] |
| Интеграция в Traffic Guard: при blocked-violation тянет реальный IP | [`backend/services/trafficGuard.js`] |
| Endpoint `/ssh/health-check` — проверка SSH на всех нодах | [`backend/routes/admin-traffic-guard.js`] |
| Endpoint `/ssh/lookup` — на лету IP юзера на ноде | UI карточки юзера |
| Раздел «SSH-агент» в Settings + кнопка «Проверить» | UI |
| Кнопка «Получить реальный IP» в карточке юзера → таб «Трафик» | [`frontend/src/pages/AdminUserCard.jsx`] |

ENV-параметры: `TRAFFIC_AGENT_SSH_USER` / `_PORT` / `_PRIVATE_KEY` / `_PRIVATE_KEY_PATH` / `_TIMEOUT_MS`.

### 🚫 P2P/Torrent детекция (Phase 3)

Периодически парсит access.log на нодах через SSH-агент, ищет записи с `[torrent-block]` и
создаёт violations при превышении порога попыток.

| Что | Где |
|---|---|
| `node_traffic_limits.block_torrents` (per-node toggle) | Migration `0004` |
| Расширение `level` enum: `torrent_warning` / `torrent_blocked` | Migration `0004` |
| Расширение `period` enum: `p2p` | Migration `0004` |
| Settings: `p2p_detect_enabled`, `p2p_scan_interval_minutes`, `torrent_attempts_threshold`, `torrent_action` | DB + UI |
| Сервис P2P-детектора: `runScan()` параллельно по нодам, логика warning → blocked | [`backend/services/p2pDetector.js`] |
| Cron: `cron/p2pDetector.js` (default 5 мин, динамическое расписание) | [`backend/cron/p2pDetector.js`] |
| Endpoint `/p2p-scan-now` — ручной запуск скана | [`backend/routes/admin-traffic-guard.js`] |
| Раздел «P2P / Torrent детекция» в Settings + помощник с готовым Xray-конфигом | UI |
| Per-node toggle «P2P scan» в табе «Лимиты по нодам» | UI |
| Расширение фильтров и цветовой индикации в табе «Нарушения» | UI |
| Кнопка «Запустить P2P-скан» в Settings (видна когда enabled) | UI |

**Архитектура:** блокировка торрентов настраивается **админом руками** в RemnaWave-панели
(routing-rule + sniffing). Наш сервис только парсит access.log и применяет санкции.
В UI приведён готовый JSON-снипет для копирования.

При срабатывании `torrent_blocked`:
- Действие из settings (`warn_only` / `disable_user` / `ip_ban`)
- Если `ip_ban` или `ip_ban_enabled` — забанит IP с торрент-попыток
- Email + in-app нотификация юзеру

### 📋 Прочее

- `docs/privacy-policy-draft.md` — draft Privacy Policy и текст согласия для register-checkbox
- `backend/.env.example` дополнен SSH/SMTP/FRONTEND_URL переменными
- `services/email.js` уже имел `sendNotificationEmail` — переиспользуется в P2P-нотификациях

### 🎚️ Plan Tiers + Change-plan (новое в v0.1.5)

Добавлены **уровни тарифов** и **возможность менять тариф** прямо из личного кабинета.

| Что | Где |
|---|---|
| `plans.tier` (INT), `tier_label`, `sort_order`, `color` | Migration `0005_plan_tiers` |
| `subscriptions.plan_id` FK + backfill | Migration `0005` |
| `payments.provider_metadata JSONB` (для gateway-flow смены тарифа) | Migration `0005` |
| Сервис расчёта `calculateChange()` (upgrade/downgrade/swap/renew) | [`backend/services/planChange.js`] |
| `POST /api/subscriptions/calculate-change` — preview | [`backend/routes/subscriptions.js`] |
| `POST /api/subscriptions/change` — apply (balance/gateway) | [`backend/routes/subscriptions.js`] |
| `applyPlanChange`, `payChangeFromBalance`, `createChangeGatewayPayment`, `activateSubscriptionChange` | [`backend/services/payment.js`] |
| Webhook поддерживает `payment_type='subscription_change'` | [`backend/routes/payments.js`] |
| `POST /api/plans/reorder` — bulk drag-and-drop | [`backend/routes/plans.js`] |
| Поля tier/sort_order/tier_label/color в plans CRUD | [`backend/routes/plans.js`] |
| `ChangePlanModal.jsx` — 3-шаговая модалка (план → период → оплата) | [`frontend/src/components/ChangePlanModal.jsx`] |
| Кнопка «Сменить тариф» в Dashboard `SubscriptionsSection` | [`frontend/src/pages/dashboard/SubscriptionsSection.jsx`] |
| Новый дизайн `AdminPlans` — карточки группированные по tier с drag-and-drop | [`frontend/src/pages/AdminPlans.jsx`] |
| Новый дизайн `PlanForm` — двухколоночный с live-preview + tier-presets | [`frontend/src/components/PlanForm.jsx`] |

**Бизнес-правила:**
- **Upgrade** — доплата разницы за оставшийся срок (`payDifference = newCost − refund`); опционально доп. период (30/91/365 дн)
- **Downgrade** — без возврата на баланс, но **больше дней** (конвертация виртуального кредита в дни нового, более дешёвого тарифа)
- **Swap** (тот же tier, другие планы) — пересчёт по тем же правилам в зависимости от изменения цены
- **Traffic_used сохраняется** при смене тарифа (только лимит обновляется)
- **squad_uuids** обновляются в RemnaWave автоматически

**UI новый дизайн:**
- Карточки тарифов в админке с цветным акцентом по tier и группировкой
- Drag-and-drop для изменения tier/sort_order
- В форме редактирования — 5 пресетов tier (Trial/Basic/Pro/Premium/Ultimate) + кастомизация цвета
- Live-preview карточки тарифа в правой колонке формы

### 🎚️ Squad Quotas — per-server лимиты с авто-отключением (новое в v0.1.5)

RemnaWave не умеет лимиты per-squad — мы добавили **второй контур** контроля. Каждый
тариф может задать лимит ГБ на каждый из своих squad'ов отдельно. Cron мониторит
потребление, отключает squad при превышении (удаляет из `activeInternalSquads` юзера),
автоматически восстанавливает в новом периоде или при покупке доп. трафика.

| Что | Где |
|---|---|
| `plan_squad_limits` (per-plan-per-squad: limit_gb, topup_price, topup_enabled) | Migration `0006_squad_quotas` |
| `subscription_squad_state` (used/extra/disabled snapshot per period) | Migration `0006` |
| `squad_traffic_purchases` (журнал покупок и подарков от админа) | Migration `0006` |
| `traffic_guard_settings`: новые поля squad_quota_* + topup defaults | Migration `0006` |
| Сервис `services/squadQuota.js`: sync, enforce, disable, reactivate, addExtraTraffic | [`backend/services/squadQuota.js`] |
| Mapping squad↔nodes через intersect inbound UUIDs (с кешем 10 мин) | `resolveSquadNodeMap()` |
| Cron `cron/squadQuota.js` (default 10 мин, динамический rescheduling) | [`backend/cron/squadQuota.js`] |
| `GET /api/subscriptions/:id/squad-usage` — usage per-squad | [`backend/routes/subscriptions.js`] |
| `POST /api/subscriptions/:id/squad-topup` — покупка доп. ГБ (balance/gateway) | [`backend/routes/subscriptions.js`] |
| `PUT /api/plans/:id/squad-limits` — bulk-обновление лимитов плана | [`backend/routes/plans.js`] |
| Admin endpoints: reactivate/reset/gift squad-traffic | [`backend/routes/admin-users.js`] |
| Webhook `payment_type='squad_traffic_topup'` | [`backend/services/payment.js`] |
| `SquadUsageSection.jsx` — карточки серверов в Dashboard с прогресс-барами | [`frontend/src/components/SquadUsageSection.jsx`] |
| `TopupTrafficModal.jsx` — модалка покупки (slider/packs + balance/gateway) | [`frontend/src/components/TopupTrafficModal.jsx`] |
| `AdminSquadQuotaSection.jsx` — управление в админке (reactivate/reset/gift) | [`frontend/src/components/AdminSquadQuotaSection.jsx`] |
| `PlanForm` — секция «Лимиты per-squad» в форме тарифа | [`frontend/src/components/PlanForm.jsx`] |
| `AdminTrafficGuard` Settings — раздел «Squad Quotas» с тумблерами и параметрами | [`frontend/src/pages/AdminTrafficGuard.jsx`] |

**Бизнес-правила:**
- **Период**: настраивается — `calendar_month` (1 числа) или `subscription_period` (30 дней с активации)
- **Доп. трафик** сгорает в конце периода (стандарт)
- **Цена ₽/ГБ**: глобальная в settings + override per-squad-per-plan
- **Покупка** — произвольный объём (slider) ИЛИ фиксированные пакеты (выбирается в settings)
- **При 100%** — мгновенное отключение squad'а (`activeInternalSquads` обновляется в RemnaWave)
- **При 80%** — warning (in-app + email, по флагу `warned_80_at` чтоб не спамить)
- **Все squad'ы отключены** → подписка считается «эффективно отключённой», UI показывает alert
- **Admin gift** — админ может бесплатно подарить ГБ (audit log)

---

## v0.1.4 — Тёмная/светлая тема, Traffic Guard, Admin Instructions

### 🎨 Светлая/тёмная тема (sky-blue палитра)

Полноценное переключение темы для всего публичного сайта. Админка остаётся всегда тёмной.

| Что | Где |
|---|---|
| `tailwind.config.cjs` — `darkMode: 'class'` | [`frontend/tailwind.config.cjs`] |
| `ThemeContext` — light/dark/system + persist в localStorage | [`frontend/src/contexts/ThemeContext.jsx`] |
| `ThemeToggle` (Sun/Moon/Monitor) в header | [`frontend/src/components/ThemeToggle.jsx`] |
| FOUC-prevention — inline-script в `index.html` (применяет тему до загрузки React) | [`frontend/index.html`] |
| `AdminLayout` форсит `dark` класс на корне, восстанавливает пользовательскую тему при выходе | [`frontend/src/components/AdminLayout.jsx`] |
| Все 21+ публичных страниц получили `dark:` префиксы | `frontend/src/pages/*.jsx` |
| Sky-blue палитра для светлой темы: `bg-sky-100/sky-50/sky-900/sky-700` | везде в публичных страницах |
| `dark:bg-slate-900` подложка под полупрозрачные тёмные градиенты — фикс "просвечивания" | везде где было `bg-sky-50 dark:bg-gradient-to-br` |

### 🛡️ Traffic Guard — авто-контроль превышений per-node лимитов

Фоновый watchdog который сравнивает потребление трафика наших юзеров на каждой ноде с лимитом, шлёт warning при 80% и блокирует подписку при 100%. Auto-unblock в новый период.

| Что | Где |
|---|---|
| Migration: `traffic_guard_settings`, `node_traffic_limits`, `plan_traffic_limits`, `traffic_violations` | [`backend/migrations/0002_traffic_guard.up.sql`] |
| Service `trafficGuard.runCheck()` — основная логика проверки/применения политики | [`backend/services/trafficGuard.js`] |
| Cron каждые N минут (читает из settings, динамический rescheduling) | [`backend/cron/trafficGuard.js`] |
| Routes `/api/admin/traffic-guard/*` — settings/limits/violations/blocked/check-now/manual-block | [`backend/routes/admin-traffic-guard.js`] |
| Notifications: `notifyTrafficWarning`, `notifyTrafficBlocked`, `notifyTrafficUnblocked` | [`backend/services/notifications.js`] |
| Universal `sendNotificationEmail({subject, heading, body, ctaText, ctaUrl})` | [`backend/services/email.js`] |
| Wrapper'ы RemnaWave: `getUserBandwidthStats`, `getNodesBandwidthStats` | [`backend/services/remnwave.js`] |
| Админ-страница `/admin/traffic-guard` (5 табов) | [`frontend/src/pages/AdminTrafficGuard.jsx`] |

**Возможности:**
- Лимиты per-node + per-plan, периоды day/week/month/30d (rolling)
- Источник лимитов: только node / только plan / оба (берётся минимум)
- Действие при 100%: disable_user / disable_squad / warn_only
- Warning-порог настраивается (по умолчанию 80%)
- In-app + email-нотификации (тумблеры в settings)
- Auto-unblock при смене периода
- **Ручная блокировка** (модалка с поиском юзера + выбором ноды + причиной)
- **Ручной unblock** через карточку violation
- Дробные лимиты (`NUMERIC(10, 2)` — например 0.5 ГБ для тестов)

### 📊 Traffic Tracking — отслеживание расхода

Страница `/admin/traffic` с таблицей user × node + переключение периода и фильтрами.

| Что | Где |
|---|---|
| Backend: `/api/admin/traffic/by-node?period=24h\|7d\|30d` (агрегатор) | [`backend/routes/admin-traffic.js`] |
| Backend: `/api/admin/traffic/by-user/:uuid` (для карточки юзера) | [`backend/routes/admin-traffic.js`] |
| Frontend: `AdminTrafficTracking.jsx` | [`frontend/src/pages/AdminTrafficTracking.jsx`] |

**Фичи:**
- Sticky-первая-колонка, sortable headers
- Чекбокс-фильтр по нодам (persist в localStorage), кнопки Все/Очистить/Инвертировать
- Поиск по имени/UUID, CSV-экспорт текущей выборки
- Имя юзера → клик ведёт на его карточку `/admin/users/:id`
- В шапке summary: всего юзеров / нод / общий трафик / среднее на юзера

### 👤 Карточка пользователя — таб «Трафик»

| Что | Где |
|---|---|
| Новый таб с двумя секциями: Traffic Guard violations + расход по нодам | [`frontend/src/pages/AdminUserCard.jsx`] |

**Внутри:**
- Секция Traffic Guard: иконка-индикатор (red/amber/green), счётчик активных warnings/blocks, разделение «Активные» / «История», кнопка «Разблокировать» прямо в карточке
- Таблица расхода по нодам: переключатель периода, флаги стран, прогресс-бары доли, footer с total

### 📚 Admin Instructions — markdown-инструкции с GitHub

Админ-страница с 4 вкладками; контент тянется markdown-ом с GitHub в realtime, кеш 10 мин.

| Что | Где |
|---|---|
| Backend: `/api/admin/docs/:slug` (GitHub fetch + cache + stale fallback) | [`backend/routes/admin-docs.js`] |
| Frontend: `AdminInstructions.jsx` (react-markdown + remark-gfm) | [`frontend/src/pages/AdminInstructions.jsx`] |
| 4 markdown-файла-наброска | [`docs/admin/*.md`] |
| Стили markdown в тёмной теме (`prose-admin`) | [`frontend/src/index.css`] |

Табы: Конфиги Xray / Настройки RemnaWave / Настройки VPS / Платёжные системы. Кнопки «Обновить» (force GitHub fetch) и «Открыть в GitHub» (для редактирования).

### 🎯 Брендинг

| Что | Где |
|---|---|
| `/favicon.svg` — глобус с замочком в cyan→blue | [`frontend/public/favicon.svg`] |
| `/logo.svg` — геральдический щит с буквой V | [`frontend/public/logo.svg`] |
| Поля `support_email` / `support_telegram` теперь выводятся в footer + Maintenance-странице | [`frontend/src/App.jsx`], [`frontend/src/components/MaintenanceGate.jsx`] |
| Адаптивные настройки в админке (favicon/logo URL): дефолт = проектные иконки, hint с размерами | [`frontend/src/components/TemplateBuilder.jsx`], [`frontend/src/contexts/SiteConfigContext.jsx`] |

### 🔧 Прочее

- **Rate limiters** подняты: `adminLimiter` 100→500, `globalLimiter` 300→1000 за 15 мин (фикс 429 при работе админа)
- **AdminOverview** — добавлены пункты в группах Пользователи / Безопасность / Документация
- **Pricing.jsx**: фикс popular plan + free trial card, у которых был хардкоженый светлый/тёмный градиент без `dark:` префикса (карточки "светились" на тёмной теме)
- **react-markdown@^9.1.0**, **remark-gfm@^4.0.1** — новые dev-зависимости

---

## 1. Бонусные дни от рефералов

**Проблема:** `addSubscriptionDays()` напрямую продлевал подписку без обновления Remnawave и без контроля пользователя.

**Решение:** накопитель `pending_bonus_days` + ручная активация.

| Что | Где |
|---|---|
| Миграция — `users.pending_bonus_days DECIMAL(10,2)` | `backend/db_pending_bonus.sql` |
| `addSubscriptionDays()` → теперь копит в `pending_bonus_days` | `backend/services/referral.js` |
| `GET /api/subscriptions/bonus` — баланс бонусных дней | `backend/routes/subscriptions.js` |
| `POST /api/subscriptions/apply-bonus` — активация (БД + Remnawave) | `backend/routes/subscriptions.js` |
| Баннер «+N дней» + кнопка «⚡ Активировать» | `frontend/src/pages/Dashboard.jsx` (SubscriptionsSection + ReferralsSection) |

При активации: `expires_at` продлевается в БД, `expireAt`+`status:ACTIVE` обновляется в Remnawave, истекшая подписка реактивируется.

---

## 2. Страница подключения VPN (`/connect`)

| Что | Где |
|---|---|
| `GET /api/subscriptions/config` — проксирование Remnawave sub URL | `backend/routes/subscriptions.js` |
| Страница `Connect.jsx` | `frontend/src/pages/Connect.jsx` |
| Роут `/connect` (ProtectedRoute) | `frontend/src/App.jsx` |
| Кнопка «📱 Подключить VPN» в Dashboard | `frontend/src/pages/Dashboard.jsx` |

Функциональность страницы:
- Карточки статуса: тариф, дней осталось, трафик
- Ссылка подписки + QR-код
- Инструкции по платформам (iOS/Android/Windows/macOS/Linux) с рекомендованными приложениями
- Список VPN-конфигов (VLESS/Trojan) с кнопками копирования
- Автоопределение ОС пользователя
- Блок troubleshooting

---

## 3. Админ-панель (Вариант 1 — Sidebar + Routes)

| Что | Где |
|---|---|
| Layout с сайдбаром (260px desktop / drawer mobile) | `frontend/src/components/AdminLayout.jsx` |
| Защита роутов (проверка `is_admin` через `/api/me`) | `frontend/src/components/ProtectedAdminRoute.jsx` |
| Обзор: карточки статистики + быстрые действия | `frontend/src/pages/AdminOverview.jsx` |
| CRUD тарифов (PlanForm + список) | `frontend/src/pages/AdminPlans.jsx` |
| Настройки реферальной программы | `frontend/src/pages/AdminReferrals.jsx` |
| Вложенные роуты `/admin/*` | `frontend/src/App.jsx` |

Вся админ-логика вынесена из Dashboard.jsx (~820 строк удалено).

Роуты админки: `/admin` (обзор), `/admin/stats`, `/admin/users`, `/admin/payments`, `/admin/plans`, `/admin/referrals`, `/admin/notifications`, `/admin/templates`.

---

## 4. Исправление Remnawave API

| Было | Стало | Файл |
|---|---|---|
| `PATCH /api/users/{uuid}` (404) | `PATCH /api/users` (с uuid в body) | `backend/services/remnwave.js` → `updateRemnwaveUser()` |
| `/api/profile/me` (не существует) | `/api/me` | `App.jsx`, `ProtectedAdminRoute.jsx` |
| `data.is_admin` | `data.user?.is_admin` | `App.jsx`, `ProtectedAdminRoute.jsx` |

---

## 5. Dashboard — рефакторинг

- Удалено ~820 строк админ-кода из `Dashboard.jsx`
- Добавлен `Link` из react-router-dom для навигации
- `SubscriptionsSection` получает `pendingBonusDays` и `onBonusActivated` как props
- Автообновление бонусных дней каждые 60 сек (`fetchBonusDays()`)
- Кнопка «📱 Подключить VPN» вместо простого показа subscription_url

---

## 6. Схема БД — сводка изменений

```sql
-- users
ALTER TABLE users ADD COLUMN pending_bonus_days DECIMAL(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN remnwave_uuid VARCHAR;

-- subscriptions: squad_uuid, is_active, traffic_used_gb
-- referral_links, referrals, referral_rewards,
-- referral_config, referral_monthly_stats
-- (см. db_referrals.sql)
```

---

## 7. API эндпоинты — полный список

### Подписки (`/api/subscriptions`)
| Метод | Путь | Описание |
|---|---|---|
| GET | `/bonus` | Баланс бонусных дней |
| POST | `/apply-bonus` | Активация бонусных дней (БД + Remnawave) |
| GET | `/config` | Конфиг подписки (проксирование Remnawave) |
| GET | `/squads` | Список серверных групп |
| POST | `/activate` | Активация пробного периода |
| GET | `/my` | Все подписки пользователя |
| PUT | `/squad` | Смена серверной группы |

### Рефералы (`/api/referrals`)
| Метод | Путь | Описание |
|---|---|---|
| GET | `/link` | Реферальная ссылка пользователя |
| GET | `/stats` | Статистика рефералов |
| GET | `/config` | Конфигурация программы (публичная) |
| PUT | `/config` | Обновление конфигурации (админ) |
| GET | `/top` | Топ рефереров |
| POST | `/migrate` | Миграция реф. ссылок (админ) |

### Маршруты фронтенда
| Путь | Компонент | Доступ |
|---|---|---|
| `/connect` | Connect | Авторизованные |
| `/dashboard` | Dashboard (5 вкладок) | Авторизованные |
| `/admin/*` | AdminLayout + вложенные | Администраторы |
