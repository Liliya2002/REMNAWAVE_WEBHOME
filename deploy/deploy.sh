#!/usr/bin/env bash
# deploy.sh — обновить vpnwebhome до указанной версии.
#
# Использование:
#   bash deploy/deploy.sh v1.2.0           — обновить до v1.2.0 с подтверждением
#   bash deploy/deploy.sh v1.2.0 --yes     — без интерактивного подтверждения (для скриптов)
#   bash deploy/deploy.sh v1.2.0 --no-backup — пропустить pg_dump (НЕ рекомендуется)
#   bash deploy/deploy.sh v1.2.0 --skip-migrations — не применять миграции
#
# Что делает:
#   1. Pre-flight (диск, .env, docker compose, git, IMAGE_NAMESPACE)
#   2. Бэкап БД (pre-vX.Y.Z-...)
#   3. git fetch + checkout указанного тега
#   4. Обновляет VERSION в .env
#   5. docker compose pull (новые образы)
#   6. migrate up (внутри контейнера — транзакционно)
#   7. docker compose up -d (rolling restart backend + frontend)
#   8. Smoke test /api/health
#   9. При любой ошибке — авто-откат к предыдущей версии (git, .env, compose up)
#
# Не трогает: nginx/certbot/db (только backend + frontend перезапускаются).

set -euo pipefail

# ─── Аргументы ────────────────────────────────────────────────────────────────
TARGET_VERSION=""
ASSUME_YES=0
SKIP_BACKUP=0
SKIP_MIGRATIONS=0

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)             ASSUME_YES=1 ;;
    --no-backup)          SKIP_BACKUP=1 ;;
    --skip-migrations)    SKIP_MIGRATIONS=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -30
      exit 0
      ;;
    -*)
      echo "Неизвестный флаг: $1" >&2; exit 2
      ;;
    *)
      if [ -z "$TARGET_VERSION" ]; then TARGET_VERSION="$1"
      else echo "Лишний аргумент: $1" >&2; exit 2
      fi
      ;;
  esac
  shift
done

if [ -z "$TARGET_VERSION" ]; then
  echo "Использование: bash deploy/deploy.sh <version> [--yes] [--no-backup] [--skip-migrations]" >&2
  exit 2
fi

# Принимаем как 'v1.2.0', так и '1.2.0'
case "$TARGET_VERSION" in
  v*) TAG="$TARGET_VERSION"; VERSION_NUM="${TARGET_VERSION#v}" ;;
  *)  TAG="v${TARGET_VERSION}"; VERSION_NUM="$TARGET_VERSION" ;;
esac

# ─── Утилиты вывода ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
step() { echo -e "\n${BOLD}${BLUE}━━ $* ━━${NC}"; }
log()  { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }

# ─── Pre-flight ───────────────────────────────────────────────────────────────
step "Pre-flight checks"

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
log "Project: ${PROJECT_DIR}"

# .env
[ -f .env ] || { err ".env не найден в ${PROJECT_DIR}"; exit 1; }
set -a; . ./.env; set +a

# docker
command -v docker >/dev/null || { err "docker не установлен"; exit 1; }
docker info >/dev/null 2>&1 || { err "docker daemon не доступен"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "docker compose plugin не установлен"; exit 1; }

# git
command -v git >/dev/null || { err "git не установлен"; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { err "не git-репозиторий"; exit 1; }

if ! git diff --quiet HEAD 2>/dev/null; then
  err "В рабочем дереве есть несохранённые изменения:"
  git status -s | sed 's/^/  /' >&2
  echo "" >&2
  err "git checkout не сможет переключиться на новый тег без потери этих правок."
  err "Закоммить (git commit -a) или отбрось (git checkout -- .) и запусти deploy.sh заново."
  exit 1
fi

# IMAGE_NAMESPACE для compose
[ -n "${IMAGE_NAMESPACE:-}" ] || { err "IMAGE_NAMESPACE не задан в .env"; exit 1; }

# Диск (не менее 2 ГБ свободно)
FREE_KB=$(df -k . | awk 'NR==2 {print $4}')
FREE_MB=$((FREE_KB / 1024))
if [ "$FREE_MB" -lt 2048 ]; then
  warn "Свободно всего ${FREE_MB} MB на диске. Рекомендуется минимум 2048 MB."
  if [ "$ASSUME_YES" != 1 ]; then
    read -r -p "Продолжить (y/N)? " ans
    [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { err "Отменено"; exit 1; }
  fi
fi
ok "Disk free: ${FREE_MB} MB"

# Текущая версия
CURRENT_TAG="$(git describe --tags --exact-match 2>/dev/null || echo "")"
CURRENT_SHA="$(git rev-parse --short HEAD)"
ok "Current: ${CURRENT_TAG:-(no tag)} @ ${CURRENT_SHA}"

# Запоминаем для отката
ROLLBACK_REF="${CURRENT_TAG:-$CURRENT_SHA}"
ROLLBACK_VERSION="${CURRENT_TAG:-${CURRENT_SHA}}"
[ "${ROLLBACK_VERSION#v}" != "$ROLLBACK_VERSION" ] && ROLLBACK_VERSION="${ROLLBACK_VERSION#v}"

# Проверяем наличие тега
log "Проверяю наличие тега ${TAG}…"
git fetch --tags --quiet
if ! git rev-parse "${TAG}" >/dev/null 2>&1; then
  err "Тег ${TAG} не найден в репозитории. Опубликован ли релиз?"
  exit 1
fi
ok "Target: ${TAG}"

# ─── Подтверждение ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Деплой план:${NC}"
echo -e "  С версии:  ${YELLOW}${ROLLBACK_REF}${NC}"
echo -e "  На версию: ${GREEN}${TAG}${NC}"
echo -e "  Backup:    $([ "$SKIP_BACKUP" = 1 ] && echo "${RED}пропущен${NC}" || echo "${GREEN}да${NC}")"
echo -e "  Migrations: $([ "$SKIP_MIGRATIONS" = 1 ] && echo "${RED}пропущены${NC}" || echo "${GREEN}применятся${NC}")"
echo ""

if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "Подтвердить (y/N)? " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { err "Отменено"; exit 1; }
fi

# ─── Авто-откат при сбое ──────────────────────────────────────────────────────
BACKUP_FILE=""
ROLLBACK_NEEDED=0
DEPLOY_STARTED=0

cleanup_on_failure() {
  local exit_code=$?
  if [ $exit_code -ne 0 ] && [ $ROLLBACK_NEEDED -eq 1 ]; then
    err "Деплой упал (код $exit_code). Откатываюсь…"
    rollback
  fi
  exit $exit_code
}

rollback() {
  step "ROLLBACK к ${ROLLBACK_REF}"
  git checkout "$ROLLBACK_REF" --quiet 2>&1 | sed 's/^/  /' || warn "git checkout упал"
  if grep -q '^VERSION=' .env; then
    sed -i.bak "s/^VERSION=.*/VERSION=${ROLLBACK_VERSION#v}/" .env && rm -f .env.bak
    ok "VERSION в .env вернули на ${ROLLBACK_VERSION#v}"
  fi
  # ВАЖНО: после правки .env нужно перечитать переменные, иначе docker compose
  # ниже всё ещё видит новую VERSION в shell env и снова потянет её, а не старую.
  set -a; . ./.env; set +a

  if [ "$DEPLOY_STARTED" = 1 ]; then
    log "docker compose pull (старые образы ${VERSION})…"
    docker compose pull backend frontend 2>&1 | sed 's/^/  /' || warn "compose pull упал"
    log "docker compose up -d (откат контейнеров)…"
    docker compose up -d backend frontend 2>&1 | sed 's/^/  /' || warn "compose up упал"
  fi
  if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
    warn "БД не восстановлена автоматически. Если миграции прошли частично:"
    warn "  gunzip -c ${BACKUP_FILE} | docker compose exec -T db psql -U \$PGUSER \$PGDATABASE"
  fi
  err "Откат завершён. Проверьте: docker compose ps && curl -kL https://\$DOMAIN/api/health"
}

trap cleanup_on_failure ERR INT TERM

# ─── Backup ───────────────────────────────────────────────────────────────────
if [ "$SKIP_BACKUP" != 1 ]; then
  step "Backup БД"
  ROLLBACK_NEEDED=1
  BACKUP_FILE="$(bash deploy/backup.sh pre-deploy "${VERSION_NUM}" | tail -1)"
  ok "Backup: ${BACKUP_FILE}"
else
  warn "Backup пропущен (--no-backup)"
fi

# ─── git checkout ─────────────────────────────────────────────────────────────
step "Переключаюсь на ${TAG}"
git checkout "${TAG}" --quiet
ok "git HEAD → $(git rev-parse --short HEAD)"

# ─── Обновляем VERSION в .env ─────────────────────────────────────────────────
step "Обновляю VERSION в .env"
if grep -q '^VERSION=' .env; then
  sed -i.bak "s/^VERSION=.*/VERSION=${VERSION_NUM}/" .env && rm -f .env.bak
else
  echo "VERSION=${VERSION_NUM}" >> .env
fi
ok "VERSION=${VERSION_NUM}"

# Перечитываем .env чтобы все последующие docker compose команды видели новую VERSION
set -a; . ./.env; set +a

# ─── docker pull ──────────────────────────────────────────────────────────────
step "Pull новых образов"
docker compose pull backend frontend
ok "Образы загружены"

# ─── Миграции ─────────────────────────────────────────────────────────────────
if [ "$SKIP_MIGRATIONS" != 1 ]; then
  step "Миграции БД"
  log "Status:"
  docker compose run --rm migrate status 2>&1 | sed 's/^/  /'
  log "Применяю pending…"
  docker compose run --rm migrate up
  ok "Миграции применены"
else
  warn "Миграции пропущены (--skip-migrations)"
fi

# ─── Restart ──────────────────────────────────────────────────────────────────
step "Перезапуск backend + frontend"
DEPLOY_STARTED=1
docker compose up -d backend frontend
ok "Контейнеры перезапущены"

# Регенерируем nginx-конфиг из template если изменился (деплой нового релиза мог
# принести правки в nginx/conf.d/app.conf.template). Скрипт сам сделает reload nginx
# через `nginx -s reload` если контейнер запущен.
if [ -x ./deploy/update-nginx-config.sh ]; then
  log "Проверяю актуальность nginx/conf.d/app.conf…"
  ./deploy/update-nginx-config.sh 2>&1 | sed 's/^/  /' || warn "update-nginx-config.sh упал"
fi

# Restart nginx чтобы он переподключился к свежим IP backend/frontend.
# Иначе nginx-кеш resolver'а держит старые (мёртвые) адреса → 502 Bad Gateway.
# Делаем только если nginx уже работает (если нет — запускать его — не задача deploy.sh).
if docker compose ps nginx 2>/dev/null | grep -q "Up\|running"; then
  log "Перезапускаю nginx для обновления upstream IP…"
  docker compose restart nginx 2>&1 | sed 's/^/  /' || warn "nginx restart упал"
  ok "nginx перезапущен"
fi

# ─── Smoke test ───────────────────────────────────────────────────────────────
step "Smoke test"

# Ждём пока backend поднимется (макс 120 сек — после рестарта nginx
# нужно время + первый getNodes() в squadQuota cron'е может тормозить)
MAX_WAIT=120
WAITED=0
HEALTH_URL="http://127.0.0.1/api/health"

# Если nginx не запущен — стучим прямо на backend (но он не expose-нут наружу,
# так что попробуем через docker exec)
NGINX_UP=1
if ! docker compose ps nginx 2>/dev/null | grep -q "Up\|running"; then
  NGINX_UP=0
fi

log "Жду /api/health на ${HEALTH_URL} (макс ${MAX_WAIT}s)…"

while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  # -L: следовать редиректам (HTTP→HTTPS); -k: принять самоподписанный для localhost;
  #     если nginx отдал 301 на https — curl сходит на https://127.0.0.1, увидит cert
  #     для DOMAIN, не совпадёт с 127.0.0.1, поэтому -k нужен.
  # Если nginx не запущен — health через docker exec на backend контейнер.
  if [ "$NGINX_UP" = 1 ]; then
    HEALTH_CMD=(curl -fskSL --max-time 3 "$HEALTH_URL")
  else
    HEALTH_CMD=(docker compose exec -T backend wget -q -O - --tries=1 --timeout=3 http://127.0.0.1:4000/api/health)
  fi
  if "${HEALTH_CMD[@]}" > /tmp/.deploy_health 2>/dev/null; then
    HEALTH_VERSION=$(cat /tmp/.deploy_health | grep -oE '"version":"[^"]+"' | head -1 | sed 's/"version":"//;s/"$//')
    if [ "$HEALTH_VERSION" = "$VERSION_NUM" ]; then
      ok "Health OK, version=${HEALTH_VERSION}"
      break
    else
      warn "Health отвечает, но version=${HEALTH_VERSION} (ждём ${VERSION_NUM})…"
    fi
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

if [ "$WAITED" -ge "$MAX_WAIT" ]; then
  err "Smoke test не прошёл за ${MAX_WAIT}s"
  cat /tmp/.deploy_health 2>/dev/null || true
  exit 3
fi

rm -f /tmp/.deploy_health

# Проверяем что миграции совпадают (нет pending)
if [ "$SKIP_MIGRATIONS" != 1 ]; then
  PENDING=$(docker compose run --rm migrate status 2>&1 | grep -c PENDING || true)
  if [ "$PENDING" -gt 0 ]; then
    warn "Остались pending миграции: ${PENDING}"
  fi
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
ROLLBACK_NEEDED=0  # успех — отключаем авто-откат
trap - ERR INT TERM

step "Готово"
ok "vpnwebhome обновлён до ${TAG}"
[ -n "$BACKUP_FILE" ] && log "Backup сохранён: ${BACKUP_FILE}"
echo ""
docker compose ps backend frontend 2>/dev/null || true
echo ""
log "Логи:        docker compose logs -f backend"
log "Откат:       bash deploy/rollback.sh ${ROLLBACK_REF}"
