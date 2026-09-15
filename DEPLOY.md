# Deploy guide

Production-деплой через Docker-образы из `ghcr.io`.

## Архитектура

```
GitHub                              Сервер (prod)
──────                              ─────────────
git tag v1.0.0                      docker compose pull
   ↓                                docker compose run --rm migrate
GitHub Actions                      docker compose up -d
   ↓                                ↓
ghcr.io/owner/                      Containers running:
  vpnwebhome-backend:1.0.0           - db (postgres)
  vpnwebhome-frontend:1.0.0          - backend (Node)
   ↓                                  - frontend (nginx + SPA)
GitHub Release v1.0.0                - nginx (TLS reverse-proxy)
                                     - certbot (renew)
```

## Подготовка сервера (один раз)

### Системные требования

- Ubuntu 22.04+ / Debian 12+
- 2+ vCPU, 4 GB RAM, 20 GB SSD
- Docker Engine 24+, Docker Compose plugin v2.20+
- Открыты порты 80, 443

### Установка Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
# logout / login
```

### Клон репозитория

```bash
mkdir -p /opt/vpnwebhome && cd /opt/vpnwebhome
git clone https://github.com/<OWNER>/<REPO>.git .
git checkout v1.0.0  # последний релиз
```

### Конфиг

```bash
cp backend/.env.example .env
nano .env
```

Минимально обязательные:

```bash
# БД
PGUSER=vpn_user
PGPASSWORD=<openssl rand -hex 24>
PGDATABASE=vpn_db

# Безопасность
JWT_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
WEBHOOK_SECRET=<openssl rand -hex 32>

# Домен и CORS
DOMAIN=example.com
CORS_ORIGINS=https://example.com
VITE_API_URL=https://example.com

# Docker images
IMAGE_NAMESPACE=<owner>/<repo>      # ВАШ репозиторий, lowercase
VERSION=1.0.0

# Remnawave / Platega — по своим credentials
REMNWAVE_API_URL=https://panel.example.com
REMNWAVE_API_TOKEN=...
PLATEGA_SHOP_ID=...
PLATEGA_API_KEY=...

# (опционально) проверка обновлений в /admin/system
GITHUB_REPO=<owner>/<repo>
```

### Авторизация в ghcr.io

Для публичного репозитория — не нужна. Для приватного:

```bash
echo $GITHUB_PAT | docker login ghcr.io -u <username> --password-stdin
```

### TLS-сертификат (первый раз)

См. [nginx/README.md](nginx/README.md) — выдача через certbot webroot.

## Первичный запуск

```bash
cd /opt/vpnwebhome

# 1. Тянем образы
docker compose pull

# 2. Запускаем БД
docker compose up -d db

# 3. Применяем миграции
docker compose run --rm migrate up

# 4. Поднимаем всё
docker compose up -d

# 5. Smoke test
curl -f http://localhost/api/health
# {"ok":true,"version":"1.0.0",...}

# 6. Логи
docker compose logs -f backend
```

## Обновление

### Шаг 1. Обновляемся в git

```bash
cd /opt/vpnwebhome
git fetch --tags
git checkout v1.1.0
```

### Шаг 2. Обновляем `.env`

В нём обновляем `VERSION`:

```bash
nano .env  # VERSION=1.1.0
```

Сравниваем с актуальным `.env.example` — могли появиться новые обязательные переменные:

```bash
diff <(grep -oE '^[A-Z_]+=' backend/.env.example | sort) \
     <(grep -oE '^[A-Z_]+=' .env | sort)
```

### Шаг 3. Бэкап БД

```bash
docker compose exec -T db pg_dump -U $PGUSER $PGDATABASE | gzip > /var/backups/vpn/pre-v1.1.0-$(date +%Y%m%d-%H%M%S).sql.gz
```

### Шаг 4. Тянем новые образы

```bash
docker compose pull backend frontend
```

### Шаг 5. Применяем миграции

```bash
docker compose run --rm migrate status   # посмотреть pending
docker compose run --rm migrate up
```

При ошибке — миграция откатится транзакционно. Если что-то пошло совсем плохо:

```bash
docker compose run --rm migrate down
# или восстановиться из бэкапа
gunzip -c /var/backups/vpn/pre-v1.1.0-...sql.gz | docker compose exec -T db psql -U $PGUSER $PGDATABASE
```

### Шаг 6. Перезапускаем приложение

```bash
docker compose up -d backend frontend
```

Compose заменит контейнеры. Кратковременный 5-15 сек даунтайм.

### Шаг 7. Smoke test

```bash
curl -f https://example.com/api/health
docker compose ps
docker compose logs --tail=50 backend
```

Если health красный — откат:

```bash
git checkout v1.0.0
sed -i 's/^VERSION=.*/VERSION=1.0.0/' .env
docker compose pull backend frontend
# для отката миграций — см. шаг 5
docker compose up -d backend frontend
```

## Откат к предыдущей версии

```bash
cd /opt/vpnwebhome
git checkout v1.0.0
sed -i 's/^VERSION=.*/VERSION=1.0.0/' .env

# Восстановить БД из бэкапа (если миграции были несовместимы)
gunzip -c /var/backups/vpn/pre-v1.1.0-*.sql.gz | docker compose exec -T db psql -U $PGUSER $PGDATABASE

docker compose pull
docker compose up -d
```

## Бэкапы

### Ручной

```bash
docker compose exec -T db pg_dump -U $PGUSER $PGDATABASE | gzip > /var/backups/vpn/manual-$(date +%Y%m%d-%H%M%S).sql.gz
```

### По крону (предлагается)

```cron
0 3 * * * cd /opt/vpnwebhome && docker compose exec -T db pg_dump -U vpn_user vpn_db | gzip > /var/backups/vpn/daily-$(date +\%Y\%m\%d).sql.gz && find /var/backups/vpn -name 'daily-*.sql.gz' -mtime +14 -delete
```

## Локальная разработка через docker compose

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# ВАЖНО: в .env поставьте IMAGE_NAMESPACE=local/vpnwebhome (или любое — он не используется при build:)
docker compose up --build
```

Override-файл пересоберёт образы из локальных исходников. Backend будет на `:4000`, frontend на `:8080`.

## Логи

Всё пишется в stdout контейнеров — отдельных файлов на диске проект не заводит.

```bash
docker compose logs -f backend          # следить за backend
docker compose logs --tail=200 nginx    # последние 200 строк nginx
docker compose logs -f                  # всё сразу
docker compose logs backend 2>&1 >/dev/null   # только ВНИМАНИЕ и ОШИБКА
```

Формат строки — время, уровень, раздел, суть:

```
12.09 17:04:22  инфо      [Запуск] Бэкенд запущен и слушает порт 4000
12.09 17:04:31  запрос    POST /api/payments/webhook → 200 · 45 мс · 176.15.22.8 · вебхук оплаты
12.09 17:04:33  ВНИМАНИЕ  POST /auth/login → 401 · 12 мс · 176.15.22.8 · вход в аккаунт · не авторизован
12.09 17:05:02  ОШИБКА    [Рассылки] Не удалось отправить — сторона не ответила вовремя (ETIMEDOUT)
```

`ВНИМАНИЕ` и `ОШИБКА` идут в stderr — их можно отделить, как показано выше.

**Кто что пишет.** Один запрос не должен попадать в лог трижды, поэтому роли
разведены:

| Источник | Что пишет |
|---|---|
| backend | каждый запрос к API — с номером пользователя и назначением |
| nginx (edge) | только 4xx/5xx и ответы дольше 2 с; успешные молчат |
| nginx внутри frontend | ничего: он за edge-nginx, всё было бы третьей копией |
| Postgres | ошибки; запись каждого чекпоинта отключена |

Успешные загрузки страниц и статики не пишутся нигде — осознанный размен:
для счётчиков посещаемости лог контейнера всё равно не годится, а объём они
давали основной. Вернуть полную запись на время разбора: в `nginx/nginx.conf`
заменить `if=$do_log` на `if=1` в `access_log` и перезапустить nginx
(`docker compose up -d --force-recreate nginx`).

Опросы, которые backend не пишет: `/api/health`, `/api/maintenance/status`,
`/api/admin/public/config`, статика. Как только такой запрос отвечает ошибкой
или тормозит — он в логе появляется.

Пароли, токены и ключи в лог не попадают: значения маскируются, тело запроса
не пишется вообще, а от query-строки остаётся только пометка `(+параметры)` —
там ездят одноразовые токены входа.

### nginx

Пишет в том же стиле, в общий поток:

```
2026-09-12T14:13:18+07:00  запрос    nginx  GET /api/plans -> 200 . 0.004 с . 176.15.22.8 "Mozilla/5.0 ..."
2026-09-12T14:13:18+07:00  ОШИБКА    nginx  GET /api/stats -> 502 . 0.001 с . 176.15.22.8 . backend не ответил "..."
```

Молчит про `/api/health` и статику (`/assets/`, css/js/картинки/шрифты), пока
они отдаются успешно: иначе лог — сплошной поток обращений к бандлу, и ротация
съедает полезные записи в разы быстрее. Упавший health-check и отвалившаяся
статика в лог попадают.

Строка запроса (`?…`) не пишется — вместо неё пометка `(+параметры)`. Это не
косметика: через параметры ходят одноразовые токены (`/auth/tg-login?t=…`,
`/reset-password?token=…`), и запись такого лога — готовый вход в чужой
аккаунт, пока токен жив.

Два следствия, о которых стоит знать:

- Формат нестандартный, поэтому анализаторы вроде GoAccess его не разберут.
  Если понадобятся, верните `log_format main` в `nginx/nginx.conf` — но тогда
  вместе с ним вернётся и запись токенов.
- `error_log` переведён с `notice` на `warn`: на `notice` nginx сыплет
  сообщениями о каждом срабатывании `limit_req`, и настоящие проблемы тонут.

### Настройки

В `.env`: `LOG_LEVEL` (debug/info/warn/error) и `LOG_TZ` — часовой пояс меток
времени, по умолчанию `Europe/Moscow`. `LOG_TZ` управляет обоими сразу: backend
читает её сам, а nginx получает через `TZ` в `docker-compose.yml`, поэтому
метки времени в двух логах совпадают. `debug` на боевом сервере включать только
на время разбора: он быстро забивает лог.

**Ротация.** У каждого сервиса в `docker-compose.yml` стоит предел 20 МБ × 5
файлов — не больше 100 МБ на сервис и около 700 МБ на весь стек. `install.sh`
дополнительно кладёт `/etc/docker/daemon.json` с пределом 10 МБ × 3 для всех
контейнеров хоста, включая запущенные мимо compose. Существующий `daemon.json`
скрипт не трогает — если он у вас есть, проверьте лимит сами:

```bash
cat /etc/docker/daemon.json
du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail
```

Действия администратора отдельно пишутся в базу (таблица `admin_audit_log`,
страница **Админка → Журнал аудита**) — это единственное, что переживает
пересоздание контейнеров.

## Разбор ИИ-рассылок

По логам контейнера про планировщик почти ничего не понять: в stdout уходит одна
строка на прогон, а прогон раз в сутки — за неделю семь строк, и те теряются при
ротации. Вся история лежит в базе, и её собирает отдельный отчёт:

```bash
docker compose exec backend node scripts/broadcast-ai-report.js
docker compose exec backend node scripts/broadcast-ai-report.js --days 30
docker compose exec backend node scripts/broadcast-ai-report.js --full
```

Показывает настройки (режим, холостой ход, пороги, когда был последний прогон),
сводку прогонов по исходам, **сгруппированные ошибки с датой последней**, причины
молчания, что заблокировали проверки, судьбу предложений и что не ушло при
отправке. В конце — список замечаний с указанием, где чинить.

Только чтение: ни одного изменения в базе и ни одного обращения к API бота,
запускать можно сколько угодно раз.

Живые строки по ходу работы (пока не ушли в ротацию):

```bash
docker compose logs backend | grep "Broadcast-AI"
```

## Полезное

| Действие | Команда |
|---|---|
| Логи backend | `docker compose logs -f backend` |
| Только ошибки backend | `docker compose logs backend 2>&1 >/dev/null` |
| Размер логов на диске | `du -sh /var/lib/docker/containers/*/*-json.log \| sort -h` |
| Войти в БД | `docker compose exec db psql -U $PGUSER $PGDATABASE` |
| Status миграций | `docker compose run --rm migrate status` |
| Применить миграции | `docker compose run --rm migrate up` |
| Откатить 1 миграцию | `docker compose run --rm migrate down 1` |
| Health check | `curl https://example.com/api/health` |
| Переподнять backend | `docker compose up -d backend` |
| Освободить место от старых образов | `docker image prune -a` |
