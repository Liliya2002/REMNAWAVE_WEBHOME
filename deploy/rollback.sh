#!/usr/bin/env bash
# rollback.sh — ручной откат к предыдущей версии.
#
# Использование:
#   bash deploy/rollback.sh v1.0.0                          — откатить код+образы
#   bash deploy/rollback.sh v1.0.0 --restore-db <backup>    — + восстановить БД из бэкапа
#   bash deploy/rollback.sh v1.0.0 --yes                    — без подтверждения
#
# По умолчанию БД НЕ восстанавливается (старая версия может быть совместима со свежей схемой).
# Если миграции несовместимы (DROP COLUMN, изменение типа) — нужен --restore-db.

set -euo pipefail

TARGET=""
RESTORE_DB=""
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)        ASSUME_YES=1 ;;
    --restore-db)    shift; RESTORE_DB="${1:?--restore-db требует путь к .sql.gz файлу}" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -15
      exit 0
      ;;
    -*)
      echo "Неизвестный флаг: $1" >&2; exit 2
      ;;
    *)
      [ -z "$TARGET" ] && TARGET="$1" || { echo "Лишний аргумент: $1" >&2; exit 2; }
      ;;
  esac
  shift
done

[ -n "$TARGET" ] || { echo "Использование: bash deploy/rollback.sh <version> [--restore-db <backup.sql.gz>] [--yes]" >&2; exit 2; }

case "$TARGET" in
  v*) TAG="$TARGET"; VER="${TARGET#v}" ;;
  *)  TAG="v${TARGET}"; VER="$TARGET" ;;
esac

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
step() { echo -e "\n${BOLD}${BLUE}━━ $* ━━${NC}"; }
log()  { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

cd "$(dirname "$0")/.."
[ -f .env ] || { err ".env не найден"; exit 1; }
set -a; . ./.env; set +a

# Проверки
git fetch --tags --quiet
if ! git rev-parse "$TAG" >/dev/null 2>&1 && ! git rev-parse "$TARGET" >/dev/null 2>&1; then
  err "Версия ${TAG} не найдена в git"
  exit 1
fi

CURRENT="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)"

if [ -n "$RESTORE_DB" ]; then
  [ -f "$RESTORE_DB" ] || { err "Файл бэкапа не найден: $RESTORE_DB"; exit 1; }
fi

# Подтверждение
echo ""
echo -e "${BOLD}Откат план:${NC}"
echo -e "  С версии:  ${YELLOW}${CURRENT}${NC}"
echo -e "  На версию: ${GREEN}${TAG}${NC}"
echo -e "  Restore DB: $([ -n "$RESTORE_DB" ] && echo "${YELLOW}${RESTORE_DB}${NC} (УНИЧТОЖИТ ТЕКУЩУЮ БД)" || echo "нет")"
echo ""

if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "Подтвердить (y/N)? " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { err "Отменено"; exit 1; }
fi

# ─── git ──────────────────────────────────────────────────────────────────────
step "git checkout ${TAG}"
git checkout "${TAG}" --quiet 2>/dev/null || git checkout "${TARGET}" --quiet
ok "HEAD → $(git rev-parse --short HEAD)"

# ─── .env ─────────────────────────────────────────────────────────────────────
step "Обновляю VERSION в .env"
if grep -q '^VERSION=' .env; then
  sed -i.bak "s/^VERSION=.*/VERSION=${VER}/" .env && rm -f .env.bak
else
  echo "VERSION=${VER}" >> .env
fi
set -a; . ./.env; set +a
ok "VERSION=${VER}"

# ─── DB restore (если задан) ──────────────────────────────────────────────────
if [ -n "$RESTORE_DB" ]; then
  step "Восстанавливаю БД из ${RESTORE_DB}"
  warn "Это уничтожит текущие данные БД."
  if [ "$ASSUME_YES" != 1 ]; then
    read -r -p "Точно? Введите 'YES' для подтверждения: " confirm
    [ "$confirm" = "YES" ] || { err "Отменено"; exit 1; }
  fi

  # Останавливаем backend чтобы он не писал в БД во время restore
  log "Останавливаю backend…"
  docker compose stop backend 2>/dev/null || true

  log "Удаляю текущую схему public…"
  docker compose exec -T db psql -U "$PGUSER" "$PGDATABASE" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $PGUSER;"

  log "Восстанавливаю из бэкапа…"
  gunzip -c "$RESTORE_DB" | docker compose exec -T db psql -U "$PGUSER" "$PGDATABASE"
  ok "БД восстановлена"
fi

# ─── docker ───────────────────────────────────────────────────────────────────
step "Pull старых образов"
docker compose pull backend frontend
ok "Готово"

step "Rolling restart"
docker compose up -d backend frontend
ok "Готово"

# ─── Smoke ────────────────────────────────────────────────────────────────────
step "Smoke test"
HEALTH_URL="http://127.0.0.1/api/health"
docker compose ps nginx 2>/dev/null | grep -q "Up\|running" || HEALTH_URL="http://127.0.0.1:4000/api/health"

WAITED=0
while [ $WAITED -lt 30 ]; do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    ok "Health OK"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
[ $WAITED -ge 30 ] && warn "Health не отвечает за 30s — проверьте логи"

step "Откат завершён"
ok "Текущая версия: ${TAG}"
docker compose ps backend frontend 2>/dev/null || true
