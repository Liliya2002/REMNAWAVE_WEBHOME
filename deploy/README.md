# deploy/

Скрипты для production-deploy.

## Файлы

| Файл | Назначение |
|---|---|
| `deploy.sh`       | Полный deploy с pre-flight, бэкапом, миграциями, smoke-тестом и авто-откатом |
| `rollback.sh`     | Ручной откат к указанной версии (опционально с restore БД) |
| `backup.sh`       | pg_dump + ротация. Используется внутри deploy.sh, и можно отдельно |
| `install-cron.sh` | Устанавливает crontab для daily backup в 03:00 |

## Типичный сценарий обновления

```bash
cd /opt/vpnwebhome
bash deploy/deploy.sh v1.2.0
```

Что происходит:

1. Pre-flight (диск, .env, docker, git)
2. Запрос подтверждения
3. `pg_dump` → `/var/backups/vpn/pre-v1.2.0-*.sql.gz`
4. `git checkout v1.2.0`
5. Обновление `VERSION` в `.env`
6. `docker compose pull backend frontend`
7. `docker compose run --rm migrate up`
8. `docker compose up -d backend frontend`
9. Smoke test `/api/health` — ждёт пока вернётся 200 с правильной версией
10. На любой ошибке — авто-откат

## Bypass-режимы

```bash
bash deploy/deploy.sh v1.2.0 --yes               # без подтверждения (для ansible/CI)
bash deploy/deploy.sh v1.2.0 --no-backup         # пропустить pg_dump (НЕ рекомендуется)
bash deploy/deploy.sh v1.2.0 --skip-migrations   # без миграций (только код)
```

## Откат

Если deploy упал в середине — он сам откатит. Если уже всё применилось, но что-то не так:

```bash
# Простой откат (если миграции совместимы с обеими версиями):
bash deploy/rollback.sh v1.1.0

# Полный откат с восстановлением БД:
bash deploy/rollback.sh v1.1.0 --restore-db /var/backups/vpn/pre-v1.2.0-*.sql.gz
```

## Бэкапы

```bash
bash deploy/backup.sh                     # daily (применяется ротация 14 дней)
bash deploy/backup.sh manual              # ручной (без ротации)
bash deploy/backup.sh pre-deploy v1.2.0   # pre-deploy (хранится 30 дней)
```

Установить cron (раз в день в 03:00):

```bash
bash deploy/install-cron.sh
```

Проверить:

```bash
crontab -l | grep vpnwebhome
tail -f /var/log/vpnwebhome-backup.log
```

## Восстановление

```bash
gunzip -c /var/backups/vpn/manual-20260427.sql.gz | \
  docker compose exec -T db psql -U $PGUSER $PGDATABASE
```
