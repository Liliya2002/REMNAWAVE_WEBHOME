# Changelog — VPN Webhome

> Все ключевые изменения проекта, сгруппированные по фичам

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
