# Hosting Catalog Server README

Полный план внешнего проекта (отдельный сервер), который будет поставлять каталог VPS для страницы "Заказать Хостинг" в админке текущего проекта.

## 1. Цель проекта

Создать отдельный backend-сервис, который:
- агрегирует предложения VPS от одного или нескольких провайдеров;
- нормализует их к единому формату;
- отдает стабильный API-контракт для основного проекта;
- поддерживает ручную и автоматическую синхронизацию;
- ведет логи синхронизаций и ошибок;
- дает техническую базу для следующего этапа: оформления заказа VPS.

## 2. Границы ответственности

### Внешний сервер (этот будущий проект)
- Получение офферов из провайдеров.
- Нормализация и валидация данных.
- Хранение каталога и метаданных синхронизации.
- Публикация API каталога.
- Аутентификация входящих запросов.
- Мониторинг/логирование.

### Основной проект (vpn_webhome)
- Запрос каталога с внешнего сервера.
- Кэш каталога в локальной БД.
- Отображение в странице админки.
- Ручной триггер синхронизации.
- В будущем: создание заказа и связь с VPS-учетом.

## 3. Технологический стек (рекомендуемый)

- Node.js 20+
- Express
- PostgreSQL
- Axios
- Zod (валидация схем)
- Pino (структурные логи)
- node-cron (плановая синхронизация)
- Docker + docker-compose

## 4. Архитектура модулей

### 4.1 Модули
- `providers/`: адаптеры конкретных провайдеров (например, Hetzner, DO, custom).
- `services/catalogService`: orchestration синхронизации и нормализации.
- `routes/catalog`: публичный API каталога для основного проекта.
- `routes/admin`: внутренние маршруты (ручная синхронизация, health, stats).
- `db/`: миграции и запросы.
- `jobs/`: cron-задачи.

### 4.2 Поток данных
1. Cron или ручной endpoint запускает синхронизацию.
2. Сервис забирает raw-данные от провайдеров.
3. Нормализует в единый формат.
4. Upsert в БД каталога.
5. Записывает sync log.
6. Основной проект читает `/v1/catalog/offers`.

## 5. API контракт внешнего сервера

## 5.1 Auth
Рекомендуется один из вариантов:
- `Authorization: Bearer <token>`
- или `x-api-key: <token>`

Минимум: статический токен в env.

## 5.2 Endpoints

### GET /v1/catalog/offers
Назначение: вернуть активные офферы.

Параметры (опционально):
- `location`
- `provider`
- `minCpu`
- `minRamGb`
- `maxPrice`
- `sort=price_asc|price_desc|cpu_desc|ram_desc`
- `limit`
- `offset`

Ответ:
```json
{
  "offers": [
    {
      "id": "hetzner-cx22-de-fsn1",
      "title": "CX22",
      "provider": "Hetzner",
      "location": "DE-FSN1",
      "cpu": 2,
      "ram_gb": 4,
      "disk_gb": 40,
      "bandwidth_tb": 20,
      "price_monthly": 4.99,
      "currency": "EUR",
      "stock_status": "in_stock",
      "is_active": true,
      "updated_at": "2026-04-01T10:30:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

### GET /v1/catalog/health
Назначение: health check.

Ответ:
```json
{
  "ok": true,
  "service": "hosting-catalog-server",
  "timestamp": "2026-04-01T10:30:00.000Z"
}
```

### POST /v1/admin/sync
Назначение: ручной запуск синхронизации.
Требует admin token.

Ответ:
```json
{
  "success": true,
  "fetchedCount": 120,
  "changedCount": 18,
  "durationMs": 2430
}
```

### GET /v1/admin/sync-logs
Назначение: последние логи синхронизаций.

## 6. Схема БД внешнего сервера

### 6.1 Таблица offers
Поля:
- `id` PK
- `offer_key` unique
- `title`
- `provider`
- `location`
- `cpu` int
- `ram_gb` numeric
- `disk_gb` numeric
- `bandwidth_tb` numeric
- `price_monthly` numeric
- `currency`
- `stock_status`
- `is_active` bool
- `raw` jsonb
- `source_updated_at` timestamp
- `created_at`, `updated_at`

Индексы:
- `offer_key`
- `(is_active, price_monthly)`
- `(provider, location)`

### 6.2 Таблица sync_logs
Поля:
- `id`
- `status` (`success`/`error`)
- `message`
- `fetched_count`
- `changed_count`
- `duration_ms`
- `started_at`
- `finished_at`
- `created_at`

## 7. Нормализация данных

Для каждого провайдера делаем mapper в общий DTO:
- `offer_key`: стабильный уникальный ключ;
- числовые поля приводим к `number`;
- currency в верхний регистр;
- stock_status в enum: `in_stock`, `low_stock`, `out_of_stock`, `unknown`;
- дефолты для пустых полей.

Ошибочные записи не должны ломать всю синхронизацию:
- сохраняем warning в лог;
- пропускаем только поврежденную запись.

## 8. Безопасность

- Обязательная проверка токена на всех non-public endpoints.
- Лимиты запросов (rate limit).
- CORS с allowlist.
- Валидация query/body через schema.
- Таймауты исходящих HTTP-запросов к провайдерам.
- Маскирование секретов в логах.

## 9. Надежность и производительность

- Timeout на провайдеров: 5-15s.
- Retries с backoff для временных ошибок.
- Batch upsert в транзакции.
- Идемпотентность sync endpoint.
- Пагинация выдачи каталога.
- Отдача ETag/Cache-Control (опционально).

## 10. Логирование и мониторинг

Логи:
- start/end синхронизации;
- количество fetched/changed/skipped;
- ошибки провайдеров;
- время выполнения.

Метрики (минимум):
- `catalog_sync_duration_ms`
- `catalog_sync_errors_total`
- `catalog_offers_active_total`

## 11. Деплой

## 11.1 Env
- `PORT`
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- `CATALOG_API_TOKEN`
- `ADMIN_API_TOKEN`
- `CORS_ORIGINS`
- `SYNC_CRON`
- `SYNC_TIMEOUT_MS`

## 11.2 Docker
- multi-stage build
- healthcheck endpoint
- restart policy always

## 11.3 Rollout
1. Прогнать миграции.
2. Поднять сервис.
3. Проверить `/v1/catalog/health`.
4. Выполнить `/v1/admin/sync`.
5. Проверить, что основной проект получает каталог.

## 12. План развития (этап 2: заказы)

Добавить:
- `POST /v1/orders` (создание заказа VPS)
- `GET /v1/orders/:id`
- webhook/callback от провайдера
- хранение заказа и финального server payload
- статусы: `pending`, `provisioning`, `ready`, `failed`

Взаимодействие с основным проектом:
- основной проект создает заявку;
- внешний проект возвращает `external_order_id`;
- после `ready` основной проект получает параметры сервера и создает запись в `vps_servers`.

## 13. Acceptance criteria для первого релиза

- Работает `GET /v1/catalog/offers`.
- Работает `POST /v1/admin/sync`.
- Есть upsert в БД.
- Есть sync logs.
- Есть auth token проверка.
- Есть health endpoint.
- Контракт совместим с текущим `admin-hosting` роутом в vpn_webhome.

## 14. Совместимость с текущим vpn_webhome

Текущий backend-адаптер уже ожидает и умеет нормализовать:
- `id`/`uuid`/`slug`
- `title`/`name`
- `cpu`/`vcpu`/`cores`
- `ram_gb`/`ram`/`memory_gb`
- `disk_gb`/`disk`/`storage_gb`
- `price_monthly`/`monthly_price`/`price`
- `location`/`region`
- `provider`/`vendor`

Это позволяет запустить первый вариант внешнего сервера без жесткой привязки к одному формату.
