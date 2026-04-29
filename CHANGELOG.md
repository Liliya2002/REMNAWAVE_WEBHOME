# Changelog — VPN Webhome

> Все ключевые изменения проекта, сгруппированные по фичам

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
