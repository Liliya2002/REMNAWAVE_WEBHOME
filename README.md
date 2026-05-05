# VPN Webhome

Полноценный self-hosted SaaS-каркас для VPN-сервиса на базе [RemnaWave](https://remna.st):
веб-кабинет пользователя, админ-панель, биллинг, реферальная программа,
многоуровневый Traffic Guard и интеграция с Yandex Cloud для управления нодами.

> **Текущая версия:** см. [VERSION](VERSION) · **Changelog:** [CHANGELOG.md](CHANGELOG.md)

## Стек

| Слой | Технологии |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS, react-router, Helmet, Lucide icons, CodeMirror |
| **Backend** | Node 20, Express, PostgreSQL, jsonwebtoken, bcrypt, nodemailer, ssh2, axios |
| **Mobile** | React Native (`VpnMobile/`) |
| **Infra** | Docker, docker-compose, nginx (TLS + Let's Encrypt), GitHub Actions, GHCR |
| **External APIs** | RemnaWave Panel API, Yandex Cloud (Compute / VPC / Billing / IAM), Telegram Bot API, Платёжные провайдеры (Platega) |

## Возможности

### Кабинет пользователя

- **Регистрация / вход** по email или через Telegram
  - Case-insensitive логин и email (`Vasya`, `vasya`, `VASYA` — один пользователь)
  - Подтверждение email кодом (опционально)
  - CapsLock-warning на форме входа
- **Подписки** — Free Trial + платные тарифы с автопродлением
  - График потребления трафика (24ч, 7д, 30д)
  - Squad Quotas — лимиты по серверам с возможностью покупки доп. ГБ
  - Смена тарифа с расчётом доплаты / возврата
- **Подключённые устройства** — управление HWID-привязками
- **Реферальная программа** с процентом от платежей и бонусными днями
- **Колесо удачи** (опц.)
- **Уведомления** в личном кабинете + push в Telegram
- **Mobile bottom-nav** — фиксированная панель на мобилке с подсветкой активной вкладки
- Светлая / тёмная тема

### Админ-панель (`/admin`)

- **Пользователи** — поиск, фильтры, баланс, история подписок и платежей, метаданные RemnaWave
- **Тарифы** — CRUD планов, tier-система, цвета
- **Реферальная программа** — настройки процентов, лимитов, бонус-дней
- **Серверы и хостинг:**
  - **RemnaWave** — синхронизация нод, squads, traffic-stats
  - **VPS** — управление по SSH, установка ноды одной кнопкой, Traffic Agent
  - **Yandex Cloud** — мульти-аккаунт (OAuth + SA-key), VM CRUD, публичные IP, биллинг с грантами, поиск IP в CIDR
  - **Заказ хостинга** — каталог offer'ов
- **Лендинги** — визуальный редактор HTML с DOMPurify-санитайзером, SEO-теги, OG, JSON-LD, audit-log
- **Главная страница как лендинг** — любой лендинг можно сделать главной; есть кнопка «Импорт текущей главной»
- **Traffic Guard 2.0** — авто-блокировка превышений per-node / per-plan / per-squad с разными стратегиями
- **P2P-детектор** — torrent-block через SSH-агент на нодах
- **IP-баны** — банлист по IP с привязкой к нарушениям
- **Аудит-лог** всех действий админов
- **Состояние системы** — мониторинг

### Yandex Cloud интеграция (`/admin/yandex-cloud`)

- **Мульти-аккаунт** — несколько YC-аккаунтов одновременно (OAuth и Service Account JSON)
- **Опциональный SOCKS5 per-account** — все запросы идут через прокси
- **VM** — list / create / start / stop / restart / delete с цветовой статус-плашкой
  - Создание VM: 9 семейств образов, 4 пресета CPU/RAM, public IP toggle, SSH-ключ из сохранённых
- **Публичные IP** — alloc / reserve (static) / release / attach
- **Биллинг** — баланс + грант (ручной ввод, т.к. YC API не отдаёт), статус автоплатежа, deep-link на пополнение
- **Поиск IP в CIDR** — background-job, hard-cap 50 попыток, поддержка нескольких CIDR (textarea + загрузка из `.txt`), сохранённые списки per account
- **Сохранённые SSH-ключи** per account с дедупом по fingerprint
- **Privacy mode** — toggle для записи видео: блюрит все IP, ID, CIDR, имена

### Traffic Agent

Узкий SSH-агент на нодах RemnaWave для:
- **Phase 2** — on-demand lookup настоящего IP клиента при автоблокировке
- **Phase 3** — периодический scan на P2P/torrent-нарушения

Установка одной кнопкой из админки, журнал попыток с classification ошибок.
Подробнее: [infra/node-agent/README.md](infra/node-agent/README.md)

## Быстрый старт

Требования: **Node 20.19+**, **PostgreSQL 14+**, доступ к работающей RemnaWave-панели.

### 1. Клонирование и зависимости

```bash
git clone https://github.com/Liliya2002/REMNAWAVE_WEBHOME.git
cd REMNAWAVE_WEBHOME

# Backend deps
cd backend && npm install && cd ..

# Frontend deps
cd frontend && npm install && cd ..
```

### 2. Конфигурация

Создай `backend/.env` (минимум):

```env
# PostgreSQL
PGHOST=localhost
PGPORT=5432
PGUSER=vpn_user
PGPASSWORD=secret
PGDATABASE=vpn_db

# JWT
JWT_SECRET=<openssl rand -hex 32>

# Шифрование sensitive данных в БД (SSH-пароли, OAuth-токены, SA-ключи)
ENCRYPTION_KEY=<openssl rand -hex 32>

# RemnaWave Panel
REMNWAVE_API_URL=https://your-panel.example.com
REMNWAVE_API_TOKEN=<your_token>
REMNWAVE_SECRET_KEY=cookie_key:cookie_value  # опционально

# Email (можно оставить пустым в dev)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user
SMTP_PASS=pass
SMTP_FROM=noreply@example.com

# Frontend URL (для генерации ссылок в письмах)
FRONTEND_URL=http://localhost:5173
```

Полный список переменных — см. [backend/.env.example](backend/.env.example).

### 3. Миграции БД

```bash
cd backend
npm run migrate:status   # посмотреть какие применены
npm run migrate:up       # накатить все pending
```

### 4. Запуск dev

```bash
# Терминал 1 — backend
cd backend && npm start

# Терминал 2 — frontend
cd frontend && npm run dev
```

Открыть: [http://localhost:5173/](http://localhost:5173/)

Backend API: [http://localhost:4000/](http://localhost:4000/)

### 5. Создание первого админа

После регистрации первого пользователя через UI — выдай админку через psql:
```sql
UPDATE users SET is_admin = true WHERE login = 'твой_логин';
```

## Production деплой

### Docker Compose

```bash
# Скопировать продовый .env
cp .env.production.example .env

# Конфиг nginx — заменить ${DOMAIN} на свой
sed "s|\${DOMAIN}|your.domain.com|g" nginx/conf.d/app.conf.template > nginx/conf.d/app.conf

# Получить SSL-сертификат
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d your.domain.com

# Поднять
docker compose up -d
```

### Готовые образы из GHCR

При push'е тэга `vX.Y.Z` GitHub Actions собирает и публикует образы:

```
ghcr.io/liliya2002/remnawave_webhome-backend:v0.1.8
ghcr.io/liliya2002/remnawave_webhome-frontend:v0.1.8
ghcr.io/liliya2002/remnawave_webhome-deploy-runner:v0.1.8
```

Use `latest` тэг для последнего стабильного.

### Релиз через `deploy.sh`

```bash
git fetch && git checkout v0.1.8
bash deploy/deploy.sh v0.1.8
```

Что делает скрипт:
1. Pull новых образов из GHCR
2. Применяет миграции БД
3. Rolling restart backend + frontend + nginx
4. Smoke-test на `/api/health` (timeout 120s)

## Структура проекта

```
.
├── backend/                  # Node/Express API
│   ├── routes/              # endpoint'ы по модулям (auth, users, vps, yandex-cloud, ...)
│   ├── services/            # бизнес-логика (remnwave, email, encryption, yandexCloud/, ...)
│   ├── middleware/          # auth, maintenance, ip-ban, landing-ssr
│   ├── cron/                # Cron-задачи (expireSubscriptions, trafficGuard, p2pDetector, squadQuota)
│   ├── migrations/          # SQL миграции (numbered)
│   └── scripts/migrate.js   # CLI для миграций
├── frontend/                # React/Vite SPA
│   ├── src/pages/          # страницы (Dashboard, Admin*, Login, Register, ...)
│   ├── src/pages/dashboard/  # секции личного кабинета
│   ├── src/components/     # переиспользуемые
│   ├── src/services/       # API-клиенты
│   └── src/contexts/       # React Context (Theme, SiteConfig, Notifications)
├── VpnMobile/               # React Native клиент
├── infra/node-agent/        # SSH-агент для нод (Traffic Guard / P2P)
├── nginx/                   # nginx-конфиги (template для compose)
├── deploy/                  # Скрипты деплоя
├── docs/                    # Документация по релизам и фичам
├── docker-compose.yml       # Production compose
├── VERSION                  # Текущая версия
└── CHANGELOG.md             # История релизов
```

## Миграции БД

Используется самодельный runner с advisory-lock и SHA-256 checksum-проверкой:

```bash
npm run migrate:status      # показать состояние
npm run migrate:up [count]  # применить pending (или count следующих)
npm run migrate:down [count] # откатить N последних (default 1)
npm run migrate:create <name> # создать пустой шаблон NNNN_<name>.up/.down.sql
npm run migrate:bootstrap   # пометить все существующие как applied (для миграции старого прода)
npm run migrate:verify      # проверить checksum применённых
```

Каждая миграция выполняется в одной транзакции. Изменение применённого файла → abort с понятной ошибкой.

## Документация

- [CHANGELOG.md](CHANGELOG.md) — история всех релизов
- [docs/](docs/) — детальные release-notes и заметки по фичам
- [infra/node-agent/README.md](infra/node-agent/README.md) — установка Traffic Agent на ноду
- API endpoints: см. соответствующие `backend/routes/*.js`

## Лицензия

Проприетарный проект.

## Контакты

Issues и feature-requests — через GitHub Issues этого репозитория.
