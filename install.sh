#!/usr/bin/env bash
# vpnwebhome — установщик с нуля для Ubuntu 22.04+ / Debian 12+.
#
# Использование:
#   sudo bash install.sh                              — интерактивная установка
#   sudo bash install.sh --repo URL                   — задать source репозитория
#   sudo bash install.sh --branch main --dir /opt/x   — кастомные параметры
#   sudo bash install.sh --unattended                 — без вопросов (читает из ENV/флагов)
#
# Что делает:
#   ФАЗА A (текущая): pre-flight, детект существующей установки, wizard ввода.
#                     Никаких изменений в системе, в конце показывает summary и выходит.
#   ФАЗА B+ (далее):  apt install, docker, генерация .env, compose up, миграции, admin user, TLS.

set -euo pipefail

# ─── Параметры по умолчанию ───────────────────────────────────────────────────
DEFAULT_DIR="/opt/vpnwebhome"
DEFAULT_BRANCH="main"
DEFAULT_VERSION="latest"

# ─── Аргументы CLI ────────────────────────────────────────────────────────────
ARG_REPO=""
ARG_BRANCH="$DEFAULT_BRANCH"
ARG_DIR="$DEFAULT_DIR"
ARG_UNATTENDED=0
ARG_PHASE="all"

usage() {
  cat <<EOF
vpnwebhome installer

Использование: sudo bash install.sh [options]

Опции:
  --repo URL           git URL репозитория (например https://github.com/owner/vpnwebhome.git)
  --branch NAME        ветка / тег (default: main)
  --dir PATH           директория установки (default: /opt/vpnwebhome)
  --unattended         неинтерактивный режим (читает из ENV-переменных)
  --phase a|b|c|all    запустить только определённую фазу (для отладки)
  -h, --help           эта справка

Текущая версия: ФАЗА A — без выполнения реальной установки.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)       ARG_REPO="${2:?--repo требует значение}"; shift 2 ;;
    --branch)     ARG_BRANCH="${2:?--branch требует значение}"; shift 2 ;;
    --dir)        ARG_DIR="${2:?--dir требует значение}"; shift 2 ;;
    --unattended) ARG_UNATTENDED=1; shift ;;
    --phase)      ARG_PHASE="${2:?--phase требует значение}"; shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *)            echo "Неизвестный параметр: $1" >&2; usage; exit 2 ;;
  esac
done

# ─── lib.sh ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/scripts/lib.sh"

WT_TITLE="vpnwebhome installer"
WT_BACKTITLE="vpnwebhome — Ubuntu/Debian setup"

# ─── Состояние, наполняется wizard-ом ─────────────────────────────────────────
declare -A CFG=(
  [INSTALL_DIR]=""
  [REPO]=""
  [BRANCH]=""
  [VERSION]=""
  [DOMAIN]=""
  [ADMIN_EMAIL]=""
  [ADMIN_LOGIN]=""
  [ADMIN_PASSWORD]=""     # будет очищена после генерации .env
  [GITHUB_REPO]=""
  [IMAGE_NAMESPACE]=""
  # Опциональные интеграции
  [REMNWAVE_API_URL]=""
  [REMNWAVE_API_TOKEN]=""
  [PLATEGA_SHOP_ID]=""
  [PLATEGA_API_KEY]=""
  [TELEGRAM_BOT_TOKEN]=""
  [TELEGRAM_CHAT_ID]=""
  [SMTP_HOST]=""
  [SMTP_PORT]=""
  [SMTP_USER]=""
  [SMTP_PASS]=""
  # Auto-сгенерированные
  [PG_PASSWORD]=""
  [JWT_SECRET]=""
  [ENCRYPTION_KEY]=""
  [WEBHOOK_SECRET]=""
  [DEPLOY_TOKEN]=""
)

# Какие интеграции пользователь выбрал в чек-листе
INTEGRATIONS=""

# ─────────────────────────────────────────────────────────────────────────────
# ФАЗА A.1 — Welcome
# ─────────────────────────────────────────────────────────────────────────────
welcome_screen() {
  step "Welcome"
  wt_msgbox \
"Добро пожаловать в установщик vpnwebhome.

Этот скрипт развернёт production-окружение на Ubuntu 22.04+ или Debian 12+:

  • Docker + Docker Compose
  • PostgreSQL (контейнер)
  • Backend + Frontend + nginx + deploy-runner
  • TLS-сертификат через Let's Encrypt
  • Daily backup БД через cron

Установка интерактивная — будут заданы вопросы.
Выход из любого диалога: Esc или Cancel.

ВАЖНО: текущая ФАЗА A — только сбор настроек, без реальных изменений в системе." 17 72
}

# ─────────────────────────────────────────────────────────────────────────────
# ФАЗА A.2 — Pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────
preflight_checks() {
  step "Pre-flight"
  local errors=() warnings=() info=()

  # OS
  local osname; osname=$(os_name)
  if is_ubuntu_or_debian; then
    info+=("OS:           ${osname}")
  else
    errors+=("Не Ubuntu/Debian: ${osname}")
  fi

  # root
  if [ "$(id -u)" -eq 0 ]; then
    info+=("Privileges:   root")
  else
    errors+=("Скрипт должен быть запущен от root (sudo bash install.sh)")
  fi

  # arch
  local arch; arch=$(cpu_arch)
  case "$arch" in
    x86_64|amd64) info+=("Architecture: ${arch}") ;;
    aarch64|arm64) info+=("Architecture: ${arch} (поддерживается)") ;;
    *) errors+=("Архитектура ${arch} не поддерживается (нужен amd64 или arm64)") ;;
  esac

  # disk
  local disk_mb; disk_mb=$(free_disk_mb /)
  if [ -n "$disk_mb" ] && [ "$disk_mb" -ge 20480 ]; then
    info+=("Disk free:    ${disk_mb} MB")
  elif [ -n "$disk_mb" ] && [ "$disk_mb" -ge 5120 ]; then
    warnings+=("Свободно ${disk_mb} MB на /. Рекомендуется минимум 20 GB.")
    info+=("Disk free:    ${disk_mb} MB (мало)")
  else
    errors+=("Недостаточно места на /: ${disk_mb:-?} MB (нужно минимум 5 GB)")
  fi

  # memory
  local mem_mb; mem_mb=$(free_mem_mb)
  if [ -n "$mem_mb" ] && [ "$mem_mb" -ge 2048 ]; then
    info+=("RAM free:     ${mem_mb} MB")
  elif [ -n "$mem_mb" ]; then
    warnings+=("Свободно ${mem_mb} MB RAM. Рекомендуется минимум 2 GB.")
    info+=("RAM free:     ${mem_mb} MB (мало)")
  fi

  # ports
  for port in 80 443; do
    if port_is_free "$port"; then
      info+=("Port ${port}:    свободен")
    else
      warnings+=("Порт ${port} уже занят. Установка не сможет поднять nginx/certbot.")
    fi
  done

  # docker (предупреждение если уже есть)
  if cmd_exists docker; then
    info+=("Docker:       найден ($(docker --version 2>/dev/null | head -1))")
  else
    info+=("Docker:       будет установлен")
  fi

  # Сборка отчёта
  local report=""
  for line in "${info[@]}";     do report+="✓ ${line}"$'\n'; done
  if [ ${#warnings[@]} -gt 0 ]; then
    report+=$'\n'
    for line in "${warnings[@]}"; do report+="! ${line}"$'\n'; done
  fi
  if [ ${#errors[@]} -gt 0 ]; then
    report+=$'\n'
    for line in "${errors[@]}";  do report+="✗ ${line}"$'\n'; done
    wt_textbox "Pre-flight: ОШИБКИ" "${report}"
    die "Pre-flight checks провалены"
  fi

  if [ ${#warnings[@]} -gt 0 ]; then
    report+=$'\n'"Продолжить установку с предупреждениями?"
    wt_textbox "Pre-flight" "${report}"
    if [ "$ARG_UNATTENDED" -ne 1 ]; then
      wt_yesno "Продолжить с предупреждениями?" "default-yes" || die "Прервано пользователем"
    fi
  else
    wt_textbox "Pre-flight: всё ок" "${report}"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# ФАЗА A.3 — Детект существующей установки
# ─────────────────────────────────────────────────────────────────────────────
detect_existing_install() {
  step "Detect existing install"
  local dir="$ARG_DIR"

  if [ ! -d "$dir" ]; then
    log "Свежая установка в ${dir}"
    return 0
  fi

  if [ -f "${dir}/.env" ] && [ -f "${dir}/docker-compose.yml" ]; then
    # Похоже на существующую установку
    local choice
    choice=$(wt_menu "В ${dir} обнаружена существующая установка.

Что делаем?" \
      "abort"     "Отмена (закрыть установщик)" \
      "manage"    "Открыть меню управления (manage.sh)" \
      "reinstall" "Переустановить (бэкап старого .env, новые настройки)")

    case "$choice" in
      abort) die "Отменено пользователем" ;;
      manage)
        if [ -x "${dir}/manage.sh" ]; then
          exec "${dir}/manage.sh"
        else
          die "manage.sh не найден или не исполняемый в ${dir}"
        fi
        ;;
      reinstall)
        log "Переустановка: текущий .env будет сохранён как .env.bak.YYYYMMDD-HHMMSS"
        ;;
    esac
  elif [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    # Папка есть, но не похожа на нашу установку
    if ! wt_yesno "В ${dir} есть какие-то файлы, но это не похоже на vpnwebhome.

Содержимое будет сохранено, установка продолжится в эту же папку.

Продолжить?" "default-no"; then
      die "Отменено"
    fi
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# ФАЗА A.4 — Wizard ввода данных
# ─────────────────────────────────────────────────────────────────────────────
ask_install_dir() {
  while :; do
    local val; val=$(wt_input "Директория установки:" "$ARG_DIR") || die "Прервано"
    if [[ "$val" =~ ^/[a-zA-Z0-9_/.-]+$ ]]; then
      CFG[INSTALL_DIR]="$val"; break
    fi
    wt_msgbox "Некорректный путь. Используйте абсолютный путь типа /opt/vpnwebhome." 8 60
  done
}

ask_repo() {
  local default="${ARG_REPO:-}"
  while :; do
    local val; val=$(wt_input \
"Git-URL репозитория проекта vpnwebhome.
Например: https://github.com/owner/vpnwebhome.git" "$default") || die "Прервано"
    if is_valid_repo_url "$val"; then
      # Нормализация: добавим .git если не указан
      [[ "$val" =~ \.git$ ]] || val="${val%/}.git"
      CFG[REPO]="$val"
      break
    fi
    wt_msgbox "Некорректный URL.
Допустимы: https://github.com/owner/repo.git
           git@github.com:owner/repo.git" 9 60
  done
}

ask_branch() {
  CFG[BRANCH]=$(wt_input "Ветка или тег для установки:" "$ARG_BRANCH") || die "Прервано"
  [ -z "${CFG[BRANCH]}" ] && CFG[BRANCH]="$ARG_BRANCH"
}

ask_version() {
  local val; val=$(wt_input \
"Версия Docker-образов в ghcr.io.

Используйте 'latest' для последней стабильной, или 'v1.2.0' для конкретной." \
    "$DEFAULT_VERSION") || die "Прервано"
  [ -z "$val" ] && val="$DEFAULT_VERSION"
  CFG[VERSION]="$val"
}

ask_domain() {
  while :; do
    local val; val=$(wt_input \
"Домен (без https://). DNS A-запись должна указывать на этот сервер.
Пример: vpn.example.com" "") || die "Прервано"
    if is_valid_domain "$val"; then
      CFG[DOMAIN]="$val"; break
    fi
    wt_msgbox "Некорректный домен. Пример: vpn.example.com" 8 60
  done
}

ask_admin_email() {
  while :; do
    local val; val=$(wt_input \
"Email администратора.
Используется для:
  - Let's Encrypt сертификата
  - первого пользователя в БД (admin)
  - SMTP-уведомлений (если настроишь)" "") || die "Прервано"
    if is_valid_email "$val"; then
      CFG[ADMIN_EMAIL]="$val"; break
    fi
    wt_msgbox "Некорректный email. Пример: admin@example.com" 8 60
  done
}

ask_admin_login() {
  while :; do
    local val; val=$(wt_input \
"Логин первого администратора (для входа в админку).
3-32 символа: латиница, цифры, _" "admin") || die "Прервано"
    if is_valid_login "$val"; then
      CFG[ADMIN_LOGIN]="$val"; break
    fi
    wt_msgbox "Логин: 3-32 символа [a-zA-Z0-9_]" 8 60
  done
}

ask_admin_password() {
  while :; do
    local p1 p2
    p1=$(wt_password "Пароль админа (минимум 8 символов):") || die "Прервано"
    if [ ${#p1} -lt 8 ]; then
      wt_msgbox "Пароль слишком короткий (минимум 8 символов)." 7 60
      continue
    fi
    p2=$(wt_password "Повторите пароль:") || die "Прервано"
    if [ "$p1" != "$p2" ]; then
      wt_msgbox "Пароли не совпадают." 7 60
      continue
    fi
    CFG[ADMIN_PASSWORD]="$p1"
    break
  done
}

ask_github_repo() {
  # Извлекаем owner/repo из git URL для дефолта
  local default=""
  if [[ "${CFG[REPO]:-}" =~ github\.com[:/]+([^/]+)/([^/.]+) ]]; then
    default="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  fi

  local val; val=$(wt_input \
"GitHub repo (формат owner/repo) — для проверки обновлений в админке.
Можно оставить пустым и заполнить позже через manage.sh." "$default") || die "Прервано"
  CFG[GITHUB_REPO]="$val"

  # IMAGE_NAMESPACE = тот же owner/repo (lowercase) — pull из ghcr.io
  if [ -n "$val" ]; then
    CFG[IMAGE_NAMESPACE]=$(echo "$val" | tr '[:upper:]' '[:lower:]')
  else
    while :; do
      local ns; ns=$(wt_input \
"IMAGE_NAMESPACE для ghcr.io (формат owner/repo, lowercase).
Это путь к образам, которые тянем при docker compose pull.
Пример: artur-bulikyan/vpnwebhome" "") || die "Прервано"
      if is_valid_namespace "$ns"; then
        CFG[IMAGE_NAMESPACE]="$ns"; break
      fi
      wt_msgbox "Некорректный namespace. Формат: owner/repo (только lowercase, цифры, ._-)" 8 60
    done
  fi
}

ask_optional_integrations() {
  INTEGRATIONS=$(wt_checklist \
"Опциональные интеграции — отметьте те, что хотите настроить сейчас.
Незаполненные можно настроить позже через manage.sh → Configuration." \
    "remnawave" "Remnawave (URL панели + API token)"        "ON" \
    "platega"   "Platega (приём платежей: shop_id + key)"   "OFF" \
    "telegram"  "Telegram bot (уведомления админу)"         "OFF" \
    "smtp"      "SMTP (email-уведомления пользователям)"    "OFF") || INTEGRATIONS=""
}

ask_remnawave() {
  CFG[REMNWAVE_API_URL]=$(wt_input \
"Remnawave API URL.
Пример: https://panel.example.com" "") || true
  CFG[REMNWAVE_API_TOKEN]=$(wt_password "Remnawave API token:") || true
}

ask_platega() {
  CFG[PLATEGA_SHOP_ID]=$(wt_input "Platega SHOP_ID:" "") || true
  CFG[PLATEGA_API_KEY]=$(wt_password "Platega API key:") || true
}

ask_telegram() {
  CFG[TELEGRAM_BOT_TOKEN]=$(wt_password "Telegram BOT_TOKEN (от @BotFather):") || true
  CFG[TELEGRAM_CHAT_ID]=$(wt_input \
"Telegram CHAT_ID (целое число, можно с минусом для групп):" "") || true
}

ask_smtp() {
  CFG[SMTP_HOST]=$(wt_input "SMTP host:" "smtp.gmail.com") || true
  CFG[SMTP_PORT]=$(wt_input "SMTP port:" "587") || true
  CFG[SMTP_USER]=$(wt_input "SMTP user (email отправителя):" "") || true
  CFG[SMTP_PASS]=$(wt_password "SMTP пароль:") || true
}

run_wizard() {
  step "Wizard — настройка установки"

  ask_install_dir
  ask_repo
  ask_branch
  ask_version
  ask_domain
  ask_admin_email
  ask_admin_login
  ask_admin_password
  ask_github_repo
  ask_optional_integrations

  for tag in $INTEGRATIONS; do
    case "$tag" in
      remnawave) ask_remnawave ;;
      platega)   ask_platega ;;
      telegram)  ask_telegram ;;
      smtp)      ask_smtp ;;
    esac
  done

  # Auto-generated secrets (только сообщаем, что сгенерируем — само генерирование на phase B)
  CFG[PG_PASSWORD]="<auto: openssl rand -hex 24>"
  CFG[JWT_SECRET]="<auto: openssl rand -hex 32>"
  CFG[ENCRYPTION_KEY]="<auto: openssl rand -hex 32>"
  CFG[WEBHOOK_SECRET]="<auto: openssl rand -hex 32>"
  CFG[DEPLOY_TOKEN]="<auto: openssl rand -hex 32>"
}

# ─────────────────────────────────────────────────────────────────────────────
# ФАЗА A.5 — Финальный summary + подтверждение
# ─────────────────────────────────────────────────────────────────────────────
final_review() {
  step "Review"

  local mask_pass="********"
  local pass_set; pass_set=$([ -n "${CFG[ADMIN_PASSWORD]}" ] && echo "$mask_pass" || echo "(не задан)")

  local report
  report="$(cat <<EOF
СВОДКА УСТАНОВКИ — проверьте перед стартом

Куда:
  Директория:        ${CFG[INSTALL_DIR]}
  Репо:              ${CFG[REPO]}
  Ветка:             ${CFG[BRANCH]}
  Версия образов:    ${CFG[VERSION]}

Домен:
  Domain:            ${CFG[DOMAIN]}
  Admin email:       ${CFG[ADMIN_EMAIL]} (для Let's Encrypt и admin user)

Первый администратор:
  Login:             ${CFG[ADMIN_LOGIN]}
  Password:          ${pass_set}

Docker registry:
  GITHUB_REPO:       ${CFG[GITHUB_REPO]:-(не задан, проверка обновлений отключена)}
  IMAGE_NAMESPACE:   ${CFG[IMAGE_NAMESPACE]}

Auto-генерируются:
  PGPASSWORD, JWT_SECRET, ENCRYPTION_KEY, WEBHOOK_SECRET, DEPLOY_TOKEN

Опциональные интеграции:
  Remnawave:  $([ -n "${CFG[REMNWAVE_API_URL]}" ] && echo "${CFG[REMNWAVE_API_URL]}" || echo "(пропущено)")
  Platega:    $([ -n "${CFG[PLATEGA_SHOP_ID]}" ] && echo "shop_id=${CFG[PLATEGA_SHOP_ID]}" || echo "(пропущено)")
  Telegram:   $([ -n "${CFG[TELEGRAM_BOT_TOKEN]}" ] && echo "(настроен)" || echo "(пропущено)")
  SMTP:       $([ -n "${CFG[SMTP_HOST]}" ] && echo "${CFG[SMTP_HOST]}:${CFG[SMTP_PORT]}" || echo "(пропущено)")
EOF
)"

  wt_textbox "Финальная проверка" "$report"

  if [ "$ARG_UNATTENDED" -ne 1 ]; then
    wt_yesno "Подтвердить и начать установку?" "default-yes" || die "Отменено пользователем"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# ФАЗА B — реальная установка
# ═════════════════════════════════════════════════════════════════════════════
#
# Структура:
#   B.1  apt пакеты + Docker
#   B.2  git clone (или обновление)
#   B.3  .env генерация
#   B.4  nginx config (HTTP-only)
#   B.5  docker compose pull + db + migrate + admin user
#   B.6  поднять backend/frontend/deploy-runner/nginx (HTTP)
#   B.7  TLS issue через certbot
#   B.8  nginx config (HTTPS) + reload
#   B.9  cron + symlink
#   B.10 финальный summary

# ─── B.1 — apt пакеты + Docker ─────────────────────────────────────────────────
phase_b_install_deps() {
  step "B.1 — Установка системных пакетов и Docker"

  log "apt update…"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq

  log "Базовые пакеты (curl, git, openssl, gettext-base, jq, cron, ca-certificates)…"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl git openssl gettext-base jq cron ca-certificates gnupg lsb-release \
    || die "apt-get install не удался"

  systemctl enable --now cron >/dev/null 2>&1 || true

  if cmd_exists docker; then
    ok "Docker уже установлен: $(docker --version 2>/dev/null | head -1)"
  else
    log "Устанавливаю Docker через get.docker.com…"
    curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "Не удалось установить Docker"
    ok "Docker установлен: $(docker --version 2>/dev/null | head -1)"
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log "Устанавливаю docker-compose-plugin…"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 \
      || die "Не удалось установить docker-compose-plugin"
  fi
  ok "docker compose: $(docker compose version | head -1)"

  systemctl enable --now docker >/dev/null 2>&1 || true
}

# ─── B.2 — git clone / обновление ──────────────────────────────────────────────
phase_b_get_source() {
  step "B.2 — Получение исходников"

  local dir="${CFG[INSTALL_DIR]}"

  # Если запускаем из существующего клона репо — просто используем его
  if [ -d "${SCRIPT_DIR}/.git" ] && [ -f "${SCRIPT_DIR}/docker-compose.yml" ] && [ "${SCRIPT_DIR}" != "${dir}" ]; then
    log "install.sh запущен из репо ${SCRIPT_DIR}, копирую в ${dir}"
    mkdir -p "$dir"
    # копируем содержимое включая .git, исключая .env (если был) и node_modules
    rsync -a --exclude='.env' --exclude='node_modules' --exclude='backend/uploads' "${SCRIPT_DIR}/" "${dir}/" 2>/dev/null || \
      cp -a "${SCRIPT_DIR}/." "${dir}/"
    cd "$dir"
    git checkout "${CFG[BRANCH]}" --quiet 2>/dev/null || true
  elif [ -d "${dir}/.git" ]; then
    log "Существующий клон в ${dir} — обновляю"
    cd "$dir"
    git fetch --all --tags --quiet
    git checkout "${CFG[BRANCH]}" --quiet || die "Ветка/тег ${CFG[BRANCH]} не найдена"
    if git symbolic-ref -q HEAD >/dev/null; then
      git pull --ff-only --quiet || warn "git pull не сделался fast-forward, пропускаю"
    fi
  else
    log "git clone ${CFG[REPO]} в ${dir}…"
    mkdir -p "$dir"
    git clone --branch "${CFG[BRANCH]}" --quiet "${CFG[REPO]}" "$dir" \
      || die "Не удалось склонировать репозиторий"
    cd "$dir"
  fi

  # Нормализация прав
  chmod +x "${dir}/install.sh" "${dir}/manage.sh" 2>/dev/null || true
  chmod +x "${dir}/scripts/lib.sh" "${dir}/scripts"/*.js 2>/dev/null || true
  chmod +x "${dir}/deploy"/*.sh 2>/dev/null || true

  ok "Исходники готовы в ${dir}"
}

# ─── B.3 — генерация .env ──────────────────────────────────────────────────────
phase_b_generate_env() {
  step "B.3 — .env"
  local dir="${CFG[INSTALL_DIR]}"
  cd "$dir"

  # Бэкап существующего .env
  if [ -f .env ]; then
    local backup_file=".env.bak.$(date +%Y%m%d-%H%M%S)"
    cp .env "$backup_file"
    log "Существующий .env сохранён в ${backup_file}"
  fi

  log "Генерирую секреты…"
  CFG[PG_PASSWORD]=$(gen_secret 24)
  CFG[JWT_SECRET]=$(gen_secret 32)
  CFG[ENCRYPTION_KEY]=$(gen_secret 32)
  CFG[WEBHOOK_SECRET]=$(gen_secret 32)
  CFG[DEPLOY_TOKEN]=$(gen_secret 32)

  log "Записываю .env в ${dir}/.env"
  umask 077
  cat > .env <<EOF
# Сгенерировано install.sh $(date -u +'%Y-%m-%dT%H:%M:%SZ')
# Не коммитить в git!

# ─── Server ──────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=4000
DOMAIN=${CFG[DOMAIN]}
FRONTEND_URL=https://${CFG[DOMAIN]}
VITE_API_URL=https://${CFG[DOMAIN]}
CORS_ORIGINS=https://${CFG[DOMAIN]}

# ─── База данных ────────────────────────────────────────────────────────────
PGUSER=vpn_user
PGPASSWORD=${CFG[PG_PASSWORD]}
PGDATABASE=vpn_db
PGHOST=db
PGPORT=5432

# ─── Безопасность ───────────────────────────────────────────────────────────
JWT_SECRET=${CFG[JWT_SECRET]}
ENCRYPTION_KEY=${CFG[ENCRYPTION_KEY]}
WEBHOOK_SECRET=${CFG[WEBHOOK_SECRET]}
DEPLOY_TOKEN=${CFG[DEPLOY_TOKEN]}

# ─── Docker ─────────────────────────────────────────────────────────────────
IMAGE_REGISTRY=ghcr.io
IMAGE_NAMESPACE=${CFG[IMAGE_NAMESPACE]}
VERSION=${CFG[VERSION]}
DEPLOY_RUNNER_URL=http://deploy-runner:4100

# ─── GitHub (для проверки обновлений в админке) ─────────────────────────────
GITHUB_REPO=${CFG[GITHUB_REPO]}
# GITHUB_TOKEN= # опционально, если репо приватный или для повышения rate-limit

# ─── Remnawave ──────────────────────────────────────────────────────────────
REMNWAVE_API_URL=${CFG[REMNWAVE_API_URL]}
REMNWAVE_API_TOKEN=${CFG[REMNWAVE_API_TOKEN]}
# REMNWAVE_SECRET_KEY=

# ─── Платежи (Platega) ──────────────────────────────────────────────────────
PLATEGA_SHOP_ID=${CFG[PLATEGA_SHOP_ID]}
PLATEGA_API_KEY=${CFG[PLATEGA_API_KEY]}

# ─── Telegram ───────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=${CFG[TELEGRAM_BOT_TOKEN]}
TELEGRAM_CHAT_ID=${CFG[TELEGRAM_CHAT_ID]}
# TG_VPS_NOTIFY_ENABLED=true
# TG_VPS_NOTIFY_HOUR=10

# ─── Email (SMTP) ───────────────────────────────────────────────────────────
SMTP_HOST=${CFG[SMTP_HOST]}
SMTP_PORT=${CFG[SMTP_PORT]}
SMTP_USER=${CFG[SMTP_USER]}
SMTP_PASS=${CFG[SMTP_PASS]}
SMTP_FROM=${CFG[SMTP_USER]}
EOF
  chmod 600 .env

  # Очищаем чувствительное из памяти
  CFG[ADMIN_PASSWORD_BAK]="${CFG[ADMIN_PASSWORD]}"  # сохраним для следующего шага
  ok ".env создан, права 600"
}

# ─── B.4 — nginx HTTP-only config ─────────────────────────────────────────────
phase_b_nginx_http() {
  step "B.4 — nginx config (HTTP-only для первого старта)"
  local dir="${CFG[INSTALL_DIR]}"
  cd "$dir"

  if [ ! -f nginx/conf.d/app-bootstrap.conf.template ]; then
    die "Не найден nginx/conf.d/app-bootstrap.conf.template (репозиторий неполный?)"
  fi

  DOMAIN="${CFG[DOMAIN]}" envsubst '$DOMAIN' \
    < nginx/conf.d/app-bootstrap.conf.template \
    > nginx/conf.d/app.conf

  ok "nginx/conf.d/app.conf создан (HTTP-only)"
}

# ─── B.5 — docker compose pull + db + migrate + admin user ────────────────────
phase_b_pull_and_db() {
  step "B.5 — Docker pull + БД + миграции + admin"
  local dir="${CFG[INSTALL_DIR]}"
  cd "$dir"

  log "docker compose pull (тянем образы из ghcr.io)…"
  docker compose pull --quiet || die "docker compose pull упал. Проверьте IMAGE_NAMESPACE и доступ к ghcr.io"

  log "docker compose up -d db…"
  docker compose up -d db
  log "Жду пока БД станет healthy (макс 60 сек)…"
  local waited=0
  while [ "$waited" -lt 60 ]; do
    local health
    health=$(docker compose ps --format json db 2>/dev/null | jq -r '.Health // .[0].Health // "unknown"' 2>/dev/null || echo "unknown")
    case "$health" in
      healthy) ok "БД готова"; break ;;
      *) sleep 2; waited=$((waited + 2)) ;;
    esac
  done
  if [ "$waited" -ge 60 ]; then
    die "БД не стала healthy за 60 сек"
  fi

  log "Применяю миграции…"
  docker compose run --rm migrate up || die "Миграции упали"

  log "Создаю первого admin user…"
  docker compose run --rm \
    -e ADMIN_EMAIL="${CFG[ADMIN_EMAIL]}" \
    -e ADMIN_LOGIN="${CFG[ADMIN_LOGIN]}" \
    -e ADMIN_PASSWORD="${CFG[ADMIN_PASSWORD_BAK]}" \
    -e PGHOST=db \
    --entrypoint "node" \
    backend scripts/create_admin.js \
    || die "Создание admin не удалось"

  # Очищаем пароль из памяти
  CFG[ADMIN_PASSWORD]=""
  CFG[ADMIN_PASSWORD_BAK]=""
}

# ─── B.6 — backend / frontend / deploy-runner / nginx (HTTP) ───────────────────
phase_b_start_app() {
  step "B.6 — Запуск backend / frontend / deploy-runner / nginx"
  cd "${CFG[INSTALL_DIR]}"

  docker compose up -d backend frontend deploy-runner nginx
  ok "Контейнеры подняты"

  # Smoke на /api/health через nginx (порт 80)
  log "Жду /api/health…"
  local waited=0
  while [ "$waited" -lt 60 ]; do
    if curl -fsS --max-time 3 "http://127.0.0.1/api/health" >/dev/null 2>&1; then
      ok "Backend отвечает (через nginx :80)"
      break
    fi
    sleep 2; waited=$((waited + 2))
  done
  [ "$waited" -lt 60 ] || warn "Backend не ответил за 60 сек, но продолжаем"
}

# ─── B.7 — TLS через certbot ──────────────────────────────────────────────────
phase_b_tls() {
  step "B.7 — Let's Encrypt"
  cd "${CFG[INSTALL_DIR]}"

  local domain="${CFG[DOMAIN]}"
  local email="${CFG[ADMIN_EMAIL]}"

  log "Запрашиваю сертификат для ${domain} (email: ${email})…"
  if docker compose run --rm certbot certonly \
      --webroot -w /var/www/certbot \
      -d "$domain" \
      --email "$email" \
      --agree-tos --no-eff-email \
      --non-interactive \
      --keep-until-expiring; then
    ok "Сертификат выпущен"
    return 0
  fi

  warn "certbot не смог выпустить сертификат."
  warn "Возможные причины: DNS A-запись ${domain} не указывает на этот сервер,"
  warn "                   или порт 80 недоступен снаружи."
  warn "Установка продолжится в HTTP-режиме. Запустите выпуск позже:"
  warn "  cd ${CFG[INSTALL_DIR]} && bash manage.sh → SSL → Renew now"
  CFG[TLS_FAILED]=1
}

# ─── B.8 — nginx full config (HTTPS) + reload ─────────────────────────────────
phase_b_nginx_https() {
  step "B.8 — nginx config (HTTPS)"

  if [ "${CFG[TLS_FAILED]:-0}" = "1" ]; then
    warn "TLS не выпущен — оставляю nginx в HTTP-режиме"
    return 0
  fi

  cd "${CFG[INSTALL_DIR]}"
  if [ ! -f nginx/conf.d/app.conf.template ]; then
    die "Не найден nginx/conf.d/app.conf.template"
  fi

  DOMAIN="${CFG[DOMAIN]}" envsubst '$DOMAIN' \
    < nginx/conf.d/app.conf.template \
    > nginx/conf.d/app.conf

  log "nginx -s reload…"
  if docker compose exec -T nginx nginx -t >/dev/null 2>&1; then
    docker compose exec -T nginx nginx -s reload
    ok "nginx переключён на HTTPS"
  else
    warn "nginx config test упал. Откатываю на HTTP-only:"
    DOMAIN="${CFG[DOMAIN]}" envsubst '$DOMAIN' \
      < nginx/conf.d/app-bootstrap.conf.template \
      > nginx/conf.d/app.conf
    docker compose exec -T nginx nginx -s reload || true
    CFG[TLS_FAILED]=1
  fi
}

# ─── B.9 — cron + symlink ─────────────────────────────────────────────────────
phase_b_cron_symlink() {
  step "B.9 — cron daily backup + symlink"
  cd "${CFG[INSTALL_DIR]}"

  if [ -x deploy/install-cron.sh ]; then
    bash deploy/install-cron.sh || warn "Не удалось установить cron, но это не критично"
  fi

  # Симлинк /usr/local/bin/vpnwebhome
  if [ -f manage.sh ]; then
    ln -sf "${CFG[INSTALL_DIR]}/manage.sh" /usr/local/bin/vpnwebhome
    chmod +x manage.sh
    ok "Команда 'sudo vpnwebhome' теперь открывает меню управления"
  else
    warn "manage.sh не найден — симлинк не создан"
  fi
}

# ─── B.10 — финальный summary ─────────────────────────────────────────────────
phase_b_summary() {
  step "B.10 — Готово"

  local proto="https"
  local note=""
  if [ "${CFG[TLS_FAILED]:-0}" = "1" ]; then
    proto="http"
    note="
ВНИМАНИЕ: TLS не выпущен. Сайт работает по HTTP.
Чтобы выпустить сертификат позже:
  sudo vpnwebhome → SSL → Renew now"
  fi

  local body
  body="$(cat <<EOF
✓ vpnwebhome успешно установлен!

URL:           ${proto}://${CFG[DOMAIN]}
Admin login:   ${CFG[ADMIN_LOGIN]}
Admin email:   ${CFG[ADMIN_EMAIL]}
Установлен в:  ${CFG[INSTALL_DIR]}

Дальше:

  1. Откройте ${proto}://${CFG[DOMAIN]} в браузере
  2. Войдите в админку под ${CFG[ADMIN_LOGIN]}
  3. Управление сервером:  sudo vpnwebhome
${note}

Полезные команды:
  sudo vpnwebhome                            — меню управления
  cd ${CFG[INSTALL_DIR]} && docker compose ps      — статус
  cd ${CFG[INSTALL_DIR]} && docker compose logs -f backend
  bash ${CFG[INSTALL_DIR]}/deploy/backup.sh manual — ручной бэкап БД

Auto:
  - daily backup в 03:00 → /var/backups/vpn/
  - certbot renew каждые 12 часов
EOF
)"

  wt_textbox "Установка завершена" "$body"
  ok "Установка завершена"
  echo ""
  echo "$body"
  echo ""
}

# ─── Оркестрация фазы B ───────────────────────────────────────────────────────
phase_b_run_all() {
  phase_b_install_deps
  phase_b_get_source
  phase_b_generate_env
  phase_b_nginx_http
  phase_b_pull_and_db
  phase_b_start_app
  phase_b_tls
  phase_b_nginx_https
  phase_b_cron_symlink
  phase_b_summary
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
main() {
  # Гарантируем whiptail (или fallback)
  wt_ensure || true

  welcome_screen
  preflight_checks
  detect_existing_install
  run_wizard
  final_review
  phase_b_run_all
}

main "$@"
