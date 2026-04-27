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

## Полезное

| Действие | Команда |
|---|---|
| Логи backend | `docker compose logs -f backend` |
| Войти в БД | `docker compose exec db psql -U $PGUSER $PGDATABASE` |
| Status миграций | `docker compose run --rm migrate status` |
| Применить миграции | `docker compose run --rm migrate up` |
| Откатить 1 миграцию | `docker compose run --rm migrate down 1` |
| Health check | `curl https://example.com/api/health` |
| Переподнять backend | `docker compose up -d backend` |
| Освободить место от старых образов | `docker image prune -a` |
