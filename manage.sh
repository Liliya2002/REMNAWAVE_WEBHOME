#!/usr/bin/env bash
# vpnwebhome — меню управления установленным сервером.
#
# Запуск: sudo vpnwebhome   (через симлинк, ставится install.sh)
#         или sudo bash manage.sh из директории проекта
#
# Все операции — в TUI через whiptail, с подтверждением для деструктивных действий.

set -euo pipefail

# ─── Локализация и подключение lib ───────────────────────────────────────────
SCRIPT_PATH="$0"
if [ -L "$SCRIPT_PATH" ]; then
  SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH")"
fi
PROJECT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

# shellcheck disable=SC1091
source "${PROJECT_DIR}/scripts/lib.sh"

WT_TITLE="vpnwebhome"
WT_BACKTITLE="vpnwebhome — управление сервером"

# ─── Pre-flight ───────────────────────────────────────────────────────────────
require_setup() {
  if [ "$(id -u)" -ne 0 ]; then
    die "Запустите от root: sudo vpnwebhome"
  fi
  cd "$PROJECT_DIR"
  [ -f docker-compose.yml ] || die "В ${PROJECT_DIR} нет docker-compose.yml. Установка повреждена?"
  [ -f .env ] || die "В ${PROJECT_DIR} нет .env. Сначала запустите install.sh"
  cmd_exists docker || die "Docker не установлен"
  docker compose version >/dev/null 2>&1 || die "docker compose plugin не доступен"

  # Загружаем .env для удобства (DOMAIN, IMAGE_NAMESPACE, и т.п.)
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

# ─── Утилиты ──────────────────────────────────────────────────────────────────
# Список сервисов из docker-compose.yml
list_services() {
  docker compose config --services 2>/dev/null
}

# Запущенные сервисы (только running/healthy)
list_running_services() {
  docker compose ps --services --filter status=running 2>/dev/null
}

# Показать текст в whiptail-textbox с прокруткой
view_text() {
  local title="$1"; local text="$2"
  local tmp; tmp=$(mktemp)
  printf '%s\n' "$text" > "$tmp"
  if wt_have; then
    whiptail --backtitle "$WT_BACKTITLE" --title "$title" --textbox "$tmp" 30 100
  else
    echo ""
    echo "═══ $title ═══"
    cat "$tmp"
    echo ""
    read -r -p "Нажмите Enter…" _
  fi
  rm -f "$tmp"
}

# Запустить команду и показать вывод в textbox (с прокруткой)
run_and_show() {
  local title="$1"; shift
  local tmp; tmp=$(mktemp)
  if "$@" > "$tmp" 2>&1; then
    :
  else
    echo "" >> "$tmp"
    echo "[exit code: $?]" >> "$tmp"
  fi
  if wt_have; then
    whiptail --backtitle "$WT_BACKTITLE" --title "$title" --textbox "$tmp" 30 100
  else
    echo ""
    echo "═══ $title ═══"
    cat "$tmp"
    echo ""
    read -r -p "Нажмите Enter…" _
  fi
  rm -f "$tmp"
}

# Запустить команду в обычном терминале (для интерактивных вроде psql, less, nano)
run_interactive() {
  # Временно скрываем whiptail (clear экрана)
  clear
  echo "→ $*"
  echo ""
  "$@"
  local code=$?
  echo ""
  read -r -p "Готово (exit $code). Нажмите Enter чтобы вернуться в меню…" _
  return $code
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Статус системы
# ─────────────────────────────────────────────────────────────────────────────
action_status() {
  local out=""
  out+="── Контейнеры ──"$'\n'
  out+="$(docker compose ps 2>&1)"$'\n\n'

  out+="── /api/health ──"$'\n'
  if curl -fsS --max-time 3 http://127.0.0.1/api/health > /tmp/.health 2>/dev/null; then
    out+="$(cat /tmp/.health | jq . 2>/dev/null || cat /tmp/.health)"$'\n\n'
  elif curl -fsS --max-time 3 http://127.0.0.1:4000/api/health > /tmp/.health 2>/dev/null; then
    out+="(через :4000) $(cat /tmp/.health | jq . 2>/dev/null || cat /tmp/.health)"$'\n\n'
  else
    out+="(недоступен)"$'\n\n'
  fi
  rm -f /tmp/.health

  out+="── Диск ──"$'\n'
  out+="$(df -h "$PROJECT_DIR" /var/backups/vpn 2>/dev/null | grep -v '^Filesystem' | sort -u | head -3)"$'\n\n'

  out+="── Память ──"$'\n'
  out+="$(free -h | head -2)"$'\n\n'

  out+="── Версия ──"$'\n'
  out+="VERSION=${VERSION:-?} в .env"$'\n'
  if [ -f VERSION ]; then
    out+="VERSION=$(cat VERSION) в файле"$'\n'
  fi
  out+="$(git -C "$PROJECT_DIR" describe --tags --always 2>/dev/null || echo 'git: not a repo')"$'\n'

  view_text "Статус системы" "$out"
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. Сервисы
# ─────────────────────────────────────────────────────────────────────────────
menu_services() {
  while :; do
    local choice
    choice=$(wt_menu "Сервисы" \
      "1" "Перезапустить ВСЁ" \
      "2" "Перезапустить конкретный сервис" \
      "3" "Запустить остановленные" \
      "4" "Остановить ВСЁ" \
      "5" "Логи сервиса (live, Ctrl+C для выхода)" \
      "6" "Логи сервиса (последние 200 строк)" \
      "0" "Назад") || return 0

    case "$choice" in
      1) run_and_show "Restart all" docker compose restart ;;
      2) action_restart_one ;;
      3) run_and_show "Start stopped" docker compose up -d ;;
      4)
        if wt_yesno "Остановить ВСЕ контейнеры? Сайт станет недоступен." "default-no"; then
          run_and_show "Stop all" docker compose stop
        fi
        ;;
      5) action_logs_live ;;
      6) action_logs_tail ;;
      0) return 0 ;;
    esac
  done
}

action_restart_one() {
  local services; services=$(list_services)
  [ -z "$services" ] && { wt_msgbox "Нет сервисов" 7 50; return; }

  local items=()
  for s in $services; do
    items+=("$s" "${s}")
  done
  local svc; svc=$(wt_menu "Какой сервис перезапустить?" "${items[@]}") || return 0
  run_and_show "Restart ${svc}" docker compose restart "$svc"
}

action_logs_live() {
  local services; services=$(list_running_services)
  [ -z "$services" ] && { wt_msgbox "Нет запущенных сервисов" 7 50; return; }
  local items=()
  for s in $services; do items+=("$s" "${s}"); done
  local svc; svc=$(wt_menu "Live-логи сервиса (Ctrl+C для выхода)" "${items[@]}") || return 0
  run_interactive docker compose logs -f --tail=50 "$svc"
}

action_logs_tail() {
  local services; services=$(list_services)
  [ -z "$services" ] && return 0
  local items=("ALL" "Все сервисы (mixed)")
  for s in $services; do items+=("$s" "${s}"); done
  local svc; svc=$(wt_menu "Логи (последние 200)" "${items[@]}") || return 0

  if [ "$svc" = "ALL" ]; then
    run_and_show "Логи всех" docker compose logs --tail=200 --no-color
  else
    run_and_show "Логи ${svc}" docker compose logs --tail=200 --no-color "$svc"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. База данных
# ─────────────────────────────────────────────────────────────────────────────
menu_database() {
  while :; do
    local choice
    choice=$(wt_menu "База данных" \
      "1" "Backup сейчас (manual)" \
      "2" "Список бэкапов" \
      "3" "Восстановить из бэкапа" \
      "4" "Миграции: статус" \
      "5" "Миграции: применить pending" \
      "6" "Миграции: откатить N последних" \
      "7" "psql shell (интерактивный)" \
      "0" "Назад") || return 0

    case "$choice" in
      1) run_and_show "Backup" bash deploy/backup.sh manual ;;
      2) action_list_backups ;;
      3) action_restore_backup ;;
      4) run_and_show "migrate status" docker compose run --rm migrate status ;;
      5)
        if wt_yesno "Применить pending миграции? Будет сделан pre-deploy бэкап." "default-yes"; then
          bash deploy/backup.sh pre-deploy "manual-migration" >/dev/null 2>&1 || warn "backup упал"
          run_and_show "migrate up" docker compose run --rm migrate up
        fi
        ;;
      6) action_migrate_down ;;
      7) action_psql_shell ;;
      0) return 0 ;;
    esac
  done
}

action_list_backups() {
  local dir="${BACKUP_DIR:-/var/backups/vpn}"
  if [ ! -d "$dir" ]; then
    wt_msgbox "Папки бэкапов нет: $dir" 7 60
    return
  fi
  local list
  list=$(ls -lh "$dir"/*.sql.gz 2>/dev/null | awk '{printf "%-10s %s %s %s  %s\n", $5, $6, $7, $8, $NF}')
  if [ -z "$list" ]; then
    list="(нет бэкапов в $dir)"
  fi
  view_text "Бэкапы в $dir" "$list"
}

action_restore_backup() {
  local dir="${BACKUP_DIR:-/var/backups/vpn}"
  [ -d "$dir" ] || { wt_msgbox "Папки бэкапов нет: $dir" 7 60; return; }

  # Список файлов
  mapfile -t files < <(ls -1t "$dir"/*.sql.gz 2>/dev/null | head -20)
  if [ ${#files[@]} -eq 0 ]; then
    wt_msgbox "Нет файлов *.sql.gz в $dir" 7 60
    return
  fi

  local items=()
  for f in "${files[@]}"; do
    local size; size=$(du -h "$f" | cut -f1)
    items+=("$f" "$(basename "$f") (${size})")
  done

  local file; file=$(wt_menu "Какой бэкап восстановить? (последние 20)" "${items[@]}") || return 0

  if ! wt_yesno "Восстановить $(basename "$file")?

ЭТО УНИЧТОЖИТ ТЕКУЩИЕ ДАННЫЕ БД!
Перед восстановлением будет сделан manual-бэкап текущего состояния." "default-no"; then
    return
  fi

  local confirm
  confirm=$(wt_input "Введите слово RESTORE для подтверждения:" "")
  [ "$confirm" = "RESTORE" ] || { wt_msgbox "Отменено" 7 40; return; }

  step "Restore из ${file}"
  log "Делаю manual-backup текущего состояния…"
  bash deploy/backup.sh manual >/dev/null 2>&1 || warn "backup не сделан"

  log "Останавливаю backend…"
  docker compose stop backend deploy-runner 2>/dev/null || true

  log "DROP SCHEMA public CASCADE; CREATE SCHEMA public…"
  docker compose exec -T db psql -U "$PGUSER" "$PGDATABASE" -c \
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${PGUSER};" \
    || { err "DROP/CREATE schema упал"; docker compose start backend deploy-runner; return; }

  log "Восстанавливаю из ${file}…"
  if gunzip -c "$file" | docker compose exec -T db psql -U "$PGUSER" "$PGDATABASE" > /tmp/restore.log 2>&1; then
    ok "БД восстановлена"
  else
    err "Восстановление упало. Лог: /tmp/restore.log (последние строки):"
    tail -20 /tmp/restore.log
  fi

  log "Запускаю backend обратно…"
  docker compose start backend deploy-runner
  wt_msgbox "Восстановление завершено. Проверьте /api/health через minute." 8 70
}

action_migrate_down() {
  local n
  n=$(wt_input "Сколько последних миграций откатить?" "1") || return
  [[ "$n" =~ ^[0-9]+$ ]] || { wt_msgbox "Введите число" 7 40; return; }
  if ! wt_yesno "Откатить ${n} миграций? Будет сделан pre-deploy бэкап." "default-no"; then
    return
  fi
  bash deploy/backup.sh pre-deploy "before-migrate-down" >/dev/null 2>&1 || warn "backup упал"
  run_and_show "migrate down ${n}" docker compose run --rm migrate down "$n"
}

action_psql_shell() {
  run_interactive docker compose exec db psql -U "$PGUSER" "$PGDATABASE"
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. Обновление
# ─────────────────────────────────────────────────────────────────────────────
menu_update() {
  while :; do
    local choice
    choice=$(wt_menu "Обновление" \
      "1" "Проверить новые версии" \
      "2" "Обновить до версии (deploy.sh)" \
      "3" "Откат к предыдущей версии (rollback.sh)" \
      "4" "История deploy-ов (через deploy-runner)" \
      "0" "Назад") || return 0

    case "$choice" in
      1) action_check_versions ;;
      2) action_run_deploy ;;
      3) action_run_rollback ;;
      4) action_deploy_history ;;
      0) return 0 ;;
    esac
  done
}

action_check_versions() {
  local current="${VERSION:-?}"
  local out=""
  out+="Текущая VERSION в .env: ${current}"$'\n\n'

  if [ -d .git ]; then
    log "git fetch --tags…"
    git fetch --tags --quiet 2>/dev/null || true
    local tags
    tags=$(git tag -l 'v*' --sort=-v:refname | head -10)
    if [ -n "$tags" ]; then
      out+="Доступные теги (последние 10):"$'\n'
      for t in $tags; do
        local marker="  "
        [ "${t#v}" = "$current" ] && marker="* "
        out+="${marker}${t}"$'\n'
      done
    else
      out+="Тегов в репо нет."$'\n'
    fi
  else
    out+="(не git-репо, проверка через git недоступна)"$'\n'
  fi

  if [ -n "${GITHUB_REPO:-}" ]; then
    out+=$'\n'"GitHub Releases (через API):"$'\n'
    if cmd_exists curl && cmd_exists jq; then
      local releases
      releases=$(curl -fsS --max-time 5 \
        "https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=5" 2>/dev/null \
        | jq -r '.[] | "  " + .tag_name + " — " + .name + " (" + (.published_at[:10]) + ")"' 2>/dev/null)
      if [ -n "$releases" ]; then
        out+="$releases"$'\n'
      else
        out+="  (не удалось получить релизы)"$'\n'
      fi
    fi
  fi

  view_text "Версии" "$out"
}

action_run_deploy() {
  local v
  v=$(wt_input "На какую версию обновить? (например v1.2.0)" "${VERSION:-latest}") || return
  [ -n "$v" ] || return

  if ! wt_yesno "Запустить deploy на ${v}?

Что произойдёт:
  • Бэкап БД
  • git checkout ${v}
  • docker compose pull
  • Применение миграций
  • Перезапуск backend + frontend
  • Smoke test

При сбое — авто-откат." "default-yes"; then
    return
  fi

  # Запускаем в обычном терминале с цветным выводом
  run_interactive bash deploy/deploy.sh "$v" --yes
}

action_run_rollback() {
  local v
  v=$(wt_input "На какую версию откатиться? (тег или короткий SHA)" "") || return
  [ -n "$v" ] || return

  local restore_db=""
  if wt_yesno "Восстановить БД из бэкапа? (нужно при несовместимых миграциях)" "default-no"; then
    local dir="${BACKUP_DIR:-/var/backups/vpn}"
    mapfile -t files < <(ls -1t "$dir"/pre-*.sql.gz 2>/dev/null | head -10)
    if [ ${#files[@]} -gt 0 ]; then
      local items=()
      for f in "${files[@]}"; do items+=("$f" "$(basename "$f")"); done
      restore_db=$(wt_menu "Какой pre-deploy бэкап?" "${items[@]}") || return
    fi
  fi

  if [ -n "$restore_db" ]; then
    run_interactive bash deploy/rollback.sh "$v" --restore-db "$restore_db" --yes
  else
    run_interactive bash deploy/rollback.sh "$v" --yes
  fi
}

action_deploy_history() {
  if [ -z "${DEPLOY_TOKEN:-}" ]; then
    wt_msgbox "DEPLOY_TOKEN не задан в .env — deploy-runner недоступен." 7 70
    return
  fi
  local out
  out=$(curl -fsS --max-time 5 \
    -H "X-Deploy-Token: ${DEPLOY_TOKEN}" \
    "http://127.0.0.1:4100/runs" 2>/dev/null \
    || docker compose exec -T deploy-runner wget -q -O - \
       --header "X-Deploy-Token: ${DEPLOY_TOKEN}" http://localhost:4100/runs 2>/dev/null)

  if [ -z "$out" ]; then
    wt_msgbox "deploy-runner не отвечает" 7 50
    return
  fi

  local pretty
  pretty=$(echo "$out" | jq -r '.runs[] | "[\(.status | ascii_upcase[0:3])] \(.startedAt[:19])  \(.version)  exit=\(.exitCode // "—")  runId=\(.runId)"' 2>/dev/null)

  if [ -z "$pretty" ]; then
    pretty="$out"
  fi

  view_text "История deploy-ов" "$pretty"
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. SSL
# ─────────────────────────────────────────────────────────────────────────────
menu_ssl() {
  while :; do
    local choice
    choice=$(wt_menu "SSL / Let's Encrypt" \
      "1" "Информация о сертификате" \
      "2" "Renew (попытка обновить)" \
      "3" "Force renew (пере-выпустить даже не истёкший)" \
      "4" "Issue с нуля (если cert не выпускался)" \
      "0" "Назад") || return 0

    case "$choice" in
      1) action_cert_info ;;
      2) run_and_show "certbot renew" docker compose run --rm --entrypoint certbot certbot renew --webroot -w /var/www/certbot ;;
      3) run_and_show "certbot renew --force" docker compose run --rm --entrypoint certbot certbot renew --force-renewal --webroot -w /var/www/certbot ;;
      4) action_cert_issue ;;
      0) return 0 ;;
    esac
  done
}

action_cert_info() {
  local domain="${DOMAIN:-}"
  if [ -z "$domain" ]; then
    wt_msgbox "DOMAIN не задан в .env" 7 50; return
  fi
  local out
  out=$(docker compose run --rm --entrypoint sh certbot -c \
    "if [ -f /etc/letsencrypt/live/${domain}/fullchain.pem ]; then \
       echo 'Файл: /etc/letsencrypt/live/${domain}/fullchain.pem'; \
       echo ''; \
       openssl x509 -in /etc/letsencrypt/live/${domain}/fullchain.pem -noout -text \
         | grep -E 'Subject:|Issuer:|Not Before|Not After|DNS:' \
         | head -10; \
       echo ''; \
       echo 'Дни до истечения:'; \
       expire_epoch=\$(date -d \"\$(openssl x509 -in /etc/letsencrypt/live/${domain}/fullchain.pem -noout -enddate | cut -d= -f2)\" +%s); \
       now_epoch=\$(date +%s); \
       echo \$(( (expire_epoch - now_epoch) / 86400 )); \
     else \
       echo 'Сертификат для ${domain} не найден'; \
     fi" 2>&1)
  view_text "SSL info" "$out"
}

action_cert_issue() {
  local domain="${DOMAIN:-}"
  local email="${ADMIN_EMAIL:-}"
  if [ -z "$domain" ]; then
    wt_msgbox "DOMAIN не задан в .env" 7 50; return
  fi
  if [ -z "$email" ]; then
    email=$(wt_input "Email для Let's Encrypt:" "") || return
  fi

  if ! wt_yesno "Выпустить сертификат для ${domain} (email: ${email})?

DNS A-запись для ${domain} должна указывать на этот сервер.
Порт 80 должен быть доступен снаружи." "default-yes"; then
    return
  fi

  step "Issue cert"
  if docker compose run --rm --entrypoint certbot certbot certonly \
       --webroot -w /var/www/certbot \
       -d "$domain" --email "$email" \
       --agree-tos --no-eff-email --non-interactive; then
    log "Переключаю nginx на HTTPS-config…"
    DOMAIN="$domain" envsubst '$DOMAIN' \
      < nginx/conf.d/app.conf.template \
      > nginx/conf.d/app.conf
    docker compose exec -T nginx nginx -s reload
    wt_msgbox "Сертификат выпущен и nginx переключён на HTTPS." 7 60
  else
    wt_msgbox "Выпуск сертификата не удался. Проверьте DNS и доступность порта 80." 7 70
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# 6. Конфигурация (.env)
# ─────────────────────────────────────────────────────────────────────────────
action_edit_config() {
  if ! cmd_exists nano && ! cmd_exists vi; then
    wt_msgbox "Не установлен ни nano, ни vi" 7 50; return
  fi
  local editor="nano"
  cmd_exists nano || editor="vi"

  local checksum_before; checksum_before=$(md5sum .env | cut -d' ' -f1)
  cp .env .env.editing.bak

  run_interactive "$editor" .env

  local checksum_after; checksum_after=$(md5sum .env | cut -d' ' -f1)
  if [ "$checksum_before" = "$checksum_after" ]; then
    rm -f .env.editing.bak
    wt_msgbox "Изменений нет." 7 40
    return
  fi

  # Diff
  local diff_out
  diff_out=$(diff -u .env.editing.bak .env || true)
  rm -f .env.editing.bak

  view_text "Изменения в .env" "$diff_out"

  if wt_yesno "Перезапустить контейнеры чтобы применить изменения?" "default-yes"; then
    local svc_choice
    svc_choice=$(wt_menu "Какие сервисы перезапустить?" \
      "all"     "Все" \
      "backend" "Только backend" \
      "back+fe" "backend + frontend" \
      "skip"    "Не перезапускать (применится при следующем рестарте)") || return

    case "$svc_choice" in
      all)     run_and_show "Restart all" docker compose up -d --force-recreate ;;
      backend) run_and_show "Restart backend" docker compose up -d --force-recreate backend ;;
      back+fe) run_and_show "Restart backend+frontend" docker compose up -d --force-recreate backend frontend ;;
      skip) ;;
    esac
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# 7. Сменить пароль администратора
# ─────────────────────────────────────────────────────────────────────────────
action_reset_admin() {
  local email login p1 p2

  email=$(wt_input "Email админа (существующего или нового):" "${ADMIN_EMAIL:-}") || return
  is_valid_email "$email" || { wt_msgbox "Некорректный email" 7 40; return; }

  login=$(wt_input "Login админа:" "admin") || return
  is_valid_login "$login" || { wt_msgbox "Некорректный login" 7 40; return; }

  while :; do
    p1=$(wt_password "Новый пароль (мин. 8 символов):") || return
    if [ ${#p1} -lt 8 ]; then wt_msgbox "Слишком короткий" 7 40; continue; fi
    p2=$(wt_password "Повторите:") || return
    if [ "$p1" = "$p2" ]; then break; fi
    wt_msgbox "Пароли не совпадают" 7 40
  done

  step "Создание/обновление admin"
  if docker compose run --rm \
      -e ADMIN_EMAIL="$email" \
      -e ADMIN_LOGIN="$login" \
      -e ADMIN_PASSWORD="$p1" \
      -e ADMIN_OVERWRITE=1 \
      -e PGHOST=db \
      --entrypoint "node" \
      backend scripts/create_admin.js > /tmp/admin.log 2>&1; then
    view_text "Готово" "$(cat /tmp/admin.log)"
  else
    view_text "Ошибка" "$(cat /tmp/admin.log)"
  fi
  rm -f /tmp/admin.log
  p1=""; p2=""
}

# ─────────────────────────────────────────────────────────────────────────────
# 8. Логи всех сервисов (last 100)
# ─────────────────────────────────────────────────────────────────────────────
action_show_all_logs() {
  run_and_show "Логи всех сервисов (последние 100)" \
    docker compose logs --tail=100 --no-color
}

# ─────────────────────────────────────────────────────────────────────────────
# 9. Удалить установку
# ─────────────────────────────────────────────────────────────────────────────
action_uninstall() {
  if ! wt_yesno "ПОЛНОЕ УДАЛЕНИЕ vpnwebhome.

Будут уничтожены:
  • все контейнеры (db, backend, frontend, nginx, certbot, deploy-runner)
  • volumes (включая БД!)
  • сетки docker
  • директория установки ${PROJECT_DIR}
  • crontab daily backup
  • симлинк /usr/local/bin/vpnwebhome

ЭТО НЕОБРАТИМО.

Бэкапы в /var/backups/vpn НЕ удаляются.

Продолжить?" "default-no"; then
    return
  fi

  local confirm
  confirm=$(wt_input "Введите слово DELETE для подтверждения:" "")
  [ "$confirm" = "DELETE" ] || { wt_msgbox "Отменено" 7 40; return; }

  if wt_yesno "Сделать финальный бэкап БД перед удалением?" "default-yes"; then
    log "Делаю финальный бэкап…"
    bash deploy/backup.sh manual 2>/dev/null || warn "backup упал"
  fi

  step "Удаление…"
  log "docker compose down -v --remove-orphans…"
  docker compose down -v --remove-orphans 2>&1 | tail -5

  log "Удаляю crontab…"
  crontab -l 2>/dev/null | grep -v 'vpnwebhome-backup' | crontab - 2>/dev/null || true

  log "Удаляю симлинк /usr/local/bin/vpnwebhome…"
  rm -f /usr/local/bin/vpnwebhome

  # ВАЖНО: PROJECT_DIR — это где лежит manage.sh. Переходим в /tmp перед rm -rf
  cd /tmp
  log "Удаляю директорию ${PROJECT_DIR}…"
  rm -rf "$PROJECT_DIR"

  echo ""
  ok "vpnwebhome удалён."
  echo ""
  echo "Бэкапы БД в /var/backups/vpn — не тронуты, удалите вручную если не нужны."
  echo ""
  exit 0
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
main_menu() {
  while :; do
    local choice
    choice=$(wt_menu "vpnwebhome — управление

Директория: ${PROJECT_DIR}
Версия:     ${VERSION:-?}
Домен:      ${DOMAIN:-?}" \
      "1" "Статус системы" \
      "2" "Сервисы (restart / logs)" \
      "3" "База данных (backup / restore / migrate)" \
      "4" "Обновление" \
      "5" "SSL / Let's Encrypt" \
      "6" "Редактировать .env" \
      "7" "Сменить пароль администратора" \
      "8" "Логи всех сервисов (last 100)" \
      "9" "УДАЛИТЬ установку" \
      "0" "Выход") || break

    case "$choice" in
      1) action_status ;;
      2) menu_services ;;
      3) menu_database ;;
      4) menu_update ;;
      5) menu_ssl ;;
      6) action_edit_config ;;
      7) action_reset_admin ;;
      8) action_show_all_logs ;;
      9) action_uninstall ;;
      0) break ;;
    esac
  done
  clear
  echo "Пока."
}

main() {
  require_setup
  wt_ensure || true
  main_menu
}

main "$@"
