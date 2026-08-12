<div align="center">

<img src="frontend/public/icon-192.png" width="96" alt="VPN Webhome" />

# VPN Webhome

**Готовый self-hosted сервис продажи VPN поверх панели [RemnaWave](https://remna.st)**

Сайт с личным кабинетом · админ-панель · Telegram-бот · приём платежей ·
управление серверами у нескольких хостеров · ИИ-ассистент поддержки

[![Build](https://github.com/Liliya2002/REMNAWAVE_WEBHOME/actions/workflows/build-images.yml/badge.svg)](https://github.com/Liliya2002/REMNAWAVE_WEBHOME/actions/workflows/build-images.yml)
![Node](https://img.shields.io/badge/Node-20.19%2B-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)

Текущая версия — в [VERSION](VERSION) · история изменений — в [CHANGELOG.md](CHANGELOG.md)

</div>

---

## Что это

RemnaWave отлично раздаёт VPN, но не умеет его **продавать**. Этот проект
закрывает всё остальное: витрину с тарифами, регистрацию и оплату, личный
кабинет с ключами и статистикой трафика, бота в Telegram, панель администратора
и обвязку вокруг инфраструктуры — от заказа VPS до уведомления «нода упала»
через полсекунды после падения.

Всё разворачивается одним `docker compose up` на своём сервере. Никаких внешних
SaaS в контуре, кроме тех, что вы сами подключите ключами.

---

## Возможности

<table>
<tr><td width="50%" valign="top">

### 👤 Кабинет пользователя

- Регистрация по email или в один клик через **Telegram** (бот, Mini App, OIDC)
- Подписки: пробный период, платные тарифы, смена тарифа с пересчётом
- Ключи и QR-коды подключения, управление привязанными устройствами (HWID)
- Графики трафика за 24 ч / 7 д / 30 д, квоты по сквадам с докупкой гигабайт
- Реферальная программа: процент с платежей и бонусные дни
- Уведомления в кабинете и пушем в Telegram
- Светлая и тёмная тема, **PWA для iPhone** — ярлык на домашнем экране
  запускается как приложение

</td><td width="50%" valign="top">

### 🛠️ Админ-панель `/admin`

- Пользователи, тарифы, платежи, рефералы, рассылки, аудит действий
- Два вида интерфейса на выбор (классический и сайдбар), переключается в шапке
- **Админский режим** — сайт закрывается для всех, кроме администраторов
- Конструктор лендингов с санитайзером и SEO-разметкой, любой лендинг
  можно сделать главной страницей
- **Конструктор конфигов** RemnaWave: сборка JSON профиля с генерацией
  ключей Reality
- Настройки платёжек, Telegram-бота и провайдеров — **в базе, не в `.env`**

</td></tr>
<tr><td valign="top">

### 🌐 Серверы и инфраструктура

- **RemnaWave** — синхронизация нод, сквадов и статистики
- **VPS** — управление по SSH, установка ноды одной кнопкой, внешний
  health-check через check-host.net, напоминания об оплате
- **Yandex Cloud** — мультиаккаунт (OAuth и сервисные аккаунты), CRUD
  виртуалок, публичные IP, биллинг, поиск свободного IP в CIDR
- **Selectel**, **RUVDS** — баланс, серверы, уведомления
- **Bedolaga Bot** — мониторинг стороннего бота продаж: пользователи,
  подписки, промокоды, тикеты
- Уведомления о низком балансе у провайдеров с настраиваемым порогом
  и интервалом повтора

</td><td valign="top">

### 🤖 Автоматика

- **ИИ-ассистент поддержки** — сам отвечает на тикеты, решает когда диалог
  завершён, закрывает старое. Запросы о возврате денег **никогда** не
  обрабатывает автоматически — эскалирует человеку
- **Вебхуки RemnaWave** — «нода упала / поднялась / добавлена» приходят
  в Telegram мгновенно, без опроса панели
- **Traffic Guard** — автоблокировка превышений по ноде, тарифу и скваду
- **P2P-детектор** — блокировка торрентов агентом на нодах
- Одиннадцать фоновых задач: продление, снапшоты трафика, здоровье VPS,
  балансы провайдеров, синхронизация промокодов

</td></tr>
</table>

---

## Стек

| Слой | Технологии |
|---|---|
| **Backend** | Node 20, Express, PostgreSQL (чистый `pg`, без ORM), JWT, grammY, ssh2, Anthropic SDK |
| **Frontend** | React 18, Vite, Tailwind CSS, react-router, Lucide, CodeMirror |
| **Мобильное** | React Native (`VpnMobile/`) + PWA для iOS |
| **Инфраструктура** | Docker Compose, nginx с Let's Encrypt, GitHub Actions → GHCR |
| **Внешние API** | RemnaWave, Yandex Cloud, Selectel, RUVDS, Telegram Bot API, Platega |

Масштаб: **41** роут, **33** сервиса, **11** кронов, **33** миграции, **43** страницы фронта.

---

## Быстрый старт

Нужны **Node 20.19+**, **PostgreSQL 14+** и доступ к работающей панели RemnaWave.

```bash
git clone https://github.com/Liliya2002/REMNAWAVE_WEBHOME.git
cd REMNAWAVE_WEBHOME

cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
```

Минимальный `backend/.env` — полный список в [backend/.env.example](backend/.env.example):

```env
PGHOST=localhost
PGPORT=5432
PGUSER=vpn_user
PGPASSWORD=secret
PGDATABASE=vpn_db

JWT_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>

REMNWAVE_API_URL=https://your-panel.example.com
REMNWAVE_API_TOKEN=<token>

FRONTEND_URL=http://localhost:5173
```

> ⚠️ **`ENCRYPTION_KEY` обязателен.** Без него SSH-пароли, токены провайдеров
> и ключи платёжек лягут в базу **открытым текстом** — сервис запустится и
> только предупредит в логе.

```bash
cd backend && npm run migrate:up   # накатить схему
cd backend && npm start            # API на :4000
cd frontend && npm run dev         # SPA на :5173, проксирует /api на бэкенд
```

Первому зарегистрированному пользователю выдайте права:

```sql
UPDATE users SET is_admin = true WHERE login = 'ваш_логин';
```

### Что настраивается не в `.env`

Ключи, которые меняются на живом проекте, лежат в базе и правятся из админки —
перезапуск не нужен:

| Что | Где в админке | Таблица |
|---|---|---|
| Платёжная система | Настройки → Платёжки | `payment_settings` |
| Telegram-бот и тексты уведомлений | `/admin/telegram` | `telegram_settings` |
| ИИ-ассистент | `/admin/ai/connection` | `ai_assistant_settings` |
| Аккаунты хостеров | страница провайдера | `*_accounts` |

Секреты всегда проходят через `services/encryption.js`; наружу отдаётся флаг
`has_*`, а не значение.

---

## Продакшн

### Docker Compose

```bash
sed "s|\${DOMAIN}|your.domain.com|g" \
  nginx/conf.d/app.conf.template > nginx/conf.d/app.conf

docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot -d your.domain.com

docker compose up -d
```

Поднимаются: `db`, `migrate` (одноразовый), `backend`, `frontend`, `nginx`,
`certbot`, `deploy-runner`.

### Релиз

```bash
# локально
echo 0.2.0 > VERSION           # поднять версию
git commit -am "release: v0.2.0"
git tag v0.2.0 && git push origin main --tags
```

Push тега запускает GitHub Actions: собираются образы в GHCR и создаётся
GitHub Release.

```
ghcr.io/liliya2002/remnawave_webhome-backend:v0.2.0
ghcr.io/liliya2002/remnawave_webhome-frontend:v0.2.0
ghcr.io/liliya2002/remnawave_webhome-deploy-runner:v0.2.0
```

На сервере:

```bash
cd /opt/vpnwebhome && bash deploy/deploy.sh v0.2.0
```

Скрипт сам делает бэкап базы, тянет образы, применяет миграции, перезапускает
сервисы, прогоняет smoke-тест `/api/health` и **откатывается при сбое**.
Ручной откат — `deploy/rollback.sh`.

---

## Структура

```
backend/
  routes/       HTTP-эндпоинты; admin-*.js — всё под /api/admin/*
  services/     бизнес-логика и клиенты внешних API
  cron/         фоновые задачи, стартуют из index.js
  middleware/   admin-only гвард, бан IP, SSR лендингов
  migrations/   нумерованные .up.sql / .down.sql
frontend/src/
  pages/        страницы, включая Admin*.jsx
  components/   переиспользуемые компоненты
  contexts/     SiteConfig, Notification, Theme, Effects, AdminUi
  config/       adminNav.js — единый источник меню админки
frontend/scripts/
                gen-pwa-icons.py — пересборка иконок и splash для PWA
VpnMobile/      React Native приложение
infra/          node-agent — SSH-агент для нод (Traffic Guard, P2P)
deploy/         deploy.sh, backup.sh, rollback.sh
nginx/          конфиг и шаблон app.conf.template
docs/           заметки по фичам и планы
```

### Фоновые задачи

| Задача | Интервал | Что делает |
|---|---|---|
| `expireSubscriptions` | 5 мин | снимает истёкшие подписки |
| `squadQuota`, `p2pDetector` | 5 мин | квоты по сквадам, детект торрентов |
| `vpsHealth` | 10 мин | внешняя проверка доступности VPS |
| `aiTickets` | 10 мин | ответы ИИ на тикеты поддержки |
| `trafficGuard` | 15 мин | блокировка превышений трафика |
| `vpsExpiry` | 30 мин | напоминания об оплате серверов |
| `selectelBalance`, `ycBalance` | 60 мин | балансы провайдеров |
| `bedolagaPromoSync` | настраивается | синхронизация промокодов |
| `trafficSnapshots` | 24 ч | снимки трафика для графиков |

---

## Миграции

Свой раннер: одна транзакция на миграцию, advisory-lock и проверка SHA-256.
**Уже применённый файл править нельзя** — раннер остановится с ошибкой
несовпадения контрольной суммы.

```bash
npm run migrate:status          # что применено
npm run migrate:up [N]          # накатить все pending или N следующих
npm run migrate:down [N]        # откатить N последних (по умолчанию 1)
npm run migrate:create <имя>    # создать пару NNNN_<имя>.up/.down.sql
npm run migrate:verify          # сверить контрольные суммы
npm run migrate:bootstrap       # пометить существующие как применённые
```

---

## Разработка

Договорённости, которые стоит соблюдать:

- Общение и комментарии в коде — **по-русски**.
- Ретраи — только для GET. Повтор POST может создать второй сервер,
  отправить рассылку дважды или списать деньги повторно.
- Перед массовыми действиями (рассылка, слияние аккаунтов, удаление) —
  подтверждение и dry-run.
- Новый пункт меню админки: `frontend/src/config/adminNav.js` + роут в `App.jsx`.
- Новые эндпоинты провайдеров — по образцу `admin-selectel.js`.
- Пустая строка в `PUT` для секрета означает «не менять».

**Telegram-вход, Mini App, вебхуки и PWA на iOS локально не проверить** —
нужен публичный HTTPS. Диагностика по логам:

```bash
docker compose logs --tail=50 backend
```

Известные грабли, каждая из которых уже стоила времени, собраны в
[CLAUDE.md](CLAUDE.md) — читать перед тем, как трогать авторизацию через
Telegram, режим обслуживания, фиксированное позиционирование в шапке или
пул PostgreSQL.

---

## Документация

- [CHANGELOG.md](CHANGELOG.md) — история релизов
- [CLAUDE.md](CLAUDE.md) — карта проекта и грабли
- [docs/](docs/) — планы и заметки по фичам
- [infra/node-agent/README.md](infra/node-agent/README.md) — установка агента на ноду
- [deploy/README.md](deploy/README.md) — деплой и откат

## Лицензия

Проприетарный проект. Все права защищены.

---

<div align="center">
<sub>Вопросы и предложения — через GitHub Issues репозитория.</sub>
</div>
