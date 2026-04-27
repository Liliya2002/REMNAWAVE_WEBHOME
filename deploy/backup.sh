#!/usr/bin/env bash
# backup.sh — снимает pg_dump БД и сохраняет в /var/backups/vpn/.
#
# Использование:
#   bash deploy/backup.sh                    — создаёт daily-YYYYMMDD-HHMMSS.sql.gz
#   bash deploy/backup.sh pre-deploy v1.2.0  — создаёт pre-v1.2.0-YYYYMMDD-HHMMSS.sql.gz
#   bash deploy/backup.sh manual             — создаёт manual-YYYYMMDD-HHMMSS.sql.gz
#
# ENV (читаются из .env через docker compose):
#   PGUSER, PGDATABASE     — креды БД
#
# Ротация: файлы старше BACKUP_RETENTION_DAYS дней удаляются (по умолчанию 14).
# Префикс pre-* при ротации не удаляется (deploy-бэкапы храним дольше).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/vpn}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

# ─── Утилиты ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${BLUE}[backup]${NC} $*"; }
ok()   { echo -e "${GREEN}[backup] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[backup] !${NC} $*"; }
err()  { echo -e "${RED}[backup] ✗${NC} $*" >&2; }

# ─── Сценарий ─────────────────────────────────────────────────────────────────
SCENARIO="${1:-daily}"
EXTRA_TAG="${2:-}"

# Тип файла → префикс имени
case "$SCENARIO" in
  daily)       PREFIX="daily" ;;
  manual)      PREFIX="manual" ;;
  pre-deploy)  PREFIX="pre-${EXTRA_TAG:-unknown}" ;;
  *)           PREFIX="$SCENARIO" ;;
esac

TS="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/${PREFIX}-${TS}.sql.gz"

# ─── Pre-flight ────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

# Загружаем .env если он рядом
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

if [ -z "${PGUSER:-}" ] || [ -z "${PGDATABASE:-}" ]; then
  err "PGUSER / PGDATABASE не заданы (проверьте .env)"
  exit 1
fi

# Проверяем доступность docker compose и сервиса db
if ! command -v docker >/dev/null 2>&1; then
  err "docker не установлен"
  exit 1
fi

if ! docker compose ps -q db | grep -q .; then
  err "Сервис db не запущен (docker compose up -d db)"
  exit 1
fi

# ─── pg_dump ──────────────────────────────────────────────────────────────────
log "Дамп ${PGDATABASE} → ${FILE}"
START=$(date +%s)

if docker compose exec -T db pg_dump -U "$PGUSER" "$PGDATABASE" | gzip > "$FILE"; then
  SIZE=$(du -h "$FILE" | cut -f1)
  DURATION=$(($(date +%s) - START))
  ok "Создан ${FILE} (${SIZE}, ${DURATION}с)"
else
  err "pg_dump упал"
  rm -f "$FILE"
  exit 2
fi

# ─── Ротация ──────────────────────────────────────────────────────────────────
# Удаляем daily старше RETENTION_DAYS дней. pre-* и manual оставляем (архив).
DELETED=$(find "$BACKUP_DIR" -name "daily-*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log "Удалено старых daily-бэкапов: ${DELETED}"
fi

# Для pre-* — храним 30 дней (больше чем daily, чтобы откатиться можно было даже на старую версию)
DELETED_PRE=$(find "$BACKUP_DIR" -name "pre-*.sql.gz" -mtime +30 -print -delete | wc -l)
if [ "$DELETED_PRE" -gt 0 ]; then
  log "Удалено старых pre-deploy бэкапов: ${DELETED_PRE}"
fi

# Сводка
TOTAL=$(find "$BACKUP_DIR" -name "*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
log "Всего бэкапов: ${TOTAL} (${TOTAL_SIZE})"

# Экспортируем путь — deploy.sh его использует для отката
echo "$FILE"
