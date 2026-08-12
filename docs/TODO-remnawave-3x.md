# RemnaWave 3.x: план перехода

Составлено 03.08.2026 по итогам разведки. **Пока ничего не делаем** — версия 3.0
вышла 31.07.2026, за четыре дня уже два патча, стоит дать ей отстояться.

## Где мы сейчас

Панель на **2.8.x или ниже**. Определено по форме ответа API:
у пользователей есть поле `uuid`, а эндпоинтов 3.x (`/api/system/config`,
`/api/stats/digest`, `/api/connections`) нет — все отдают 404.

Проверить версию заново можно так: если в `GET /api/users` у объекта
пользователя есть `uuid` — это 2.x; в 3.x его убрали.

## Релизы

| Версия | Дата |
|---|---|
| 3.2.0 | 03.08.2026 |
| 3.1.0 | 01.08.2026 |
| **3.0.0** | 31.07.2026 — мажорная, ломающая |
| 2.8.1 | 13.07.2026 |

## ⚠️ Что сломается при обновлении

Из changelog 3.0.0 — прямо касается `backend/services/remnwave.js`:

- **`Replace all users routes to use id instead of uuid`**
- **`Drop user uuid, rename user id column in database`**

Поле `uuid` у пользователей удалено, маршруты переведены на числовой `id`.
У нас на `uuid` завязаны `getRemnwaveUserByUuid`, удаление, включение/отключение,
сброс трафика, отзыв подписки, работа с HWID — почти весь пользовательский блок.

Прочее ломающее:

- `change status codes for delete requests` — изменились коды ответа
- `Remove NodesTrafficUsageHistory module` — модуль истории трафика нод удалён
- `Rename ip-control module to connections`
- `Rename methods in ApiTokensController`
- `Move some subscription settings to response headers`
- **`Block startup without breaking-changes acknowledgement env`** — панель 3.x
  не стартует, пока в её `.env` не подтвердить осознание ломающих изменений

Отдельно: в нашей БД хранятся ссылки на пользователей RemnaWave — миграция
затронет и данные, не только код.

## Что нового можно взять

**Полезное сразу:**
- `Add extend user expiration date functionality` — продление подписки одним
  вызовом вместо чтения-изменения-записи; упростит `activateSubscription`
- `Add stats digest functionality with new endpoint` — готовая сводка вместо
  нескольких наших запросов
- `Add system configuration endpoint` (3.2.0)
- `new bandwidth stats routes` — переработанная статистика трафика
- `Enhance subscription request history with new fields` (3.1.0)

**Инфраструктурное:**
- `Redis Streams export` для трафика, запросов подписок и подключений нод —
  события потоком вместо опроса. Потенциально снимает нагрузку с
  `cron/trafficSnapshots` и `services/squadQuota`
- `Additional webhook URLs in notifications` — несколько адресов вебхуков
- `Route stats interceptor`, `echSockopt` в TLS, `includeProxies` для Singbox

**HWID:** усилена валидация формата, ограничение длины `user-agent` (512),
добавлен IP запроса в фильтры устройств.

## План перехода

**Этап 1 — разведка (без риска).** Поднять RemnaWave 3.2.0 отдельным тестовым
экземпляром в Docker, снять OpenAPI-схему, сверить с нашими ~40 вызовами,
составить точный список несовместимостей. На боевой панели Swagger закрыт
(`/api-json`, `/openapi.json` → 404), поэтому схему берём с тестовой.

**Этап 2 — адаптация кода.** Перевести `remnwave.js` на `id` вместо `uuid`,
поправить коды удаления и переименованные методы. Клиент должен **определять
версию панели** и работать с обеими — иначе обновление станет операцией
«всё или ничего».

**Этап 3 — миграция данных.** Найти в нашей БД все ссылки на пользователей
RemnaWave, подготовить перенос на новые идентификаторы.

**Этап 4 — новые возможности.** После стабильного перехода: продление одним
вызовом, digest-статистика, при желании Redis Streams вместо опроса.

## Рекомендация

Не обновлять панель сейчас. Разумно сделать этапы 1–2 заранее, чтобы к моменту
обновления код уже умел работать с обеими версиями.

## Ссылки

- Репозиторий: https://github.com/remnawave/backend (релизы, changelog)
- Панель: https://github.com/remnawave/panel
- Документация: https://docs.rw (бывший remna.st, редирект)
