# shellcheck shell=bash
# vpnwebhome — общие утилиты для install.sh / manage.sh.
#
# Использование:
#   source "$(dirname "$0")/scripts/lib.sh"

# ─── Цвета ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED=$'\033[0;31m';  C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'
  C_BLUE=$'\033[0;36m'; C_BOLD=$'\033[1m';     C_DIM=$'\033[2m'
  C_NC=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_DIM=""; C_NC=""
fi

# ─── Логирование (stderr) ─────────────────────────────────────────────────────
log()  { echo -e "${C_BLUE}→${C_NC} $*" >&2; }
ok()   { echo -e "${C_GREEN}✓${C_NC} $*" >&2; }
warn() { echo -e "${C_YELLOW}!${C_NC} $*" >&2; }
err()  { echo -e "${C_RED}✗${C_NC} $*" >&2; }
step() { echo -e "\n${C_BOLD}${C_BLUE}━━ $* ━━${C_NC}\n" >&2; }
die()  { err "$*"; exit 1; }

# ─── Окружение ────────────────────────────────────────────────────────────────
require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "Запустите от root (или через sudo)"
  fi
}

is_ubuntu_or_debian() {
  [ -f /etc/os-release ] || return 1
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) return 0 ;;
    *) [[ " ${ID_LIKE:-} " == *" debian "* ]] && return 0 || return 1 ;;
  esac
}

os_name() {
  [ -f /etc/os-release ] || { echo "unknown"; return; }
  . /etc/os-release
  echo "${PRETTY_NAME:-${NAME:-} ${VERSION_ID:-}}"
}

ubuntu_version_at_least() {
  # ubuntu_version_at_least 22.04 → true если Ubuntu >= 22.04 или Debian
  local min="$1"
  [ -f /etc/os-release ] || return 1
  . /etc/os-release
  case "$ID" in
    debian) return 0 ;;
    ubuntu)
      printf '%s\n%s\n' "$min" "${VERSION_ID:-0}" | sort -V -C
      return $?
      ;;
    *) return 1 ;;
  esac
}

cpu_arch() { uname -m; }

free_disk_mb() {
  local path="${1:-/}"
  df -BM --output=avail "$path" 2>/dev/null | awk 'NR==2 {sub("M","",$1); print $1}'
}

free_mem_mb() {
  awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null
}

port_is_free() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ! ss -tln 2>/dev/null | awk '{print $4}' | grep -E -q ":${p}$"
  elif command -v netstat >/dev/null 2>&1; then
    ! netstat -tln 2>/dev/null | awk '{print $4}' | grep -E -q ":${p}$"
  else
    return 0  # нет утилиты — считаем свободен
  fi
}

cmd_exists() { command -v "$1" >/dev/null 2>&1; }

# ─── Секреты / валидация ──────────────────────────────────────────────────────
gen_secret() {
  local len="${1:-32}"
  openssl rand -hex "$len" 2>/dev/null || \
    head -c $((len * 2)) /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c $((len * 2))
}

is_valid_domain() {
  local d="$1"
  [[ "$d" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$ ]]
}

is_valid_email() {
  local e="$1"
  [[ "$e" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
}

is_valid_login() {
  local l="$1"
  [[ "$l" =~ ^[a-zA-Z0-9_]{3,32}$ ]]
}

is_valid_repo_url() {
  local u="$1"
  [[ "$u" =~ ^https?://.+\.git$|^git@[^:]+:.+\.git$|^https?://github\.com/[^/]+/[^/]+/?$ ]]
}

is_valid_namespace() {
  # owner/repo lowercase
  local n="$1"
  [[ "$n" =~ ^[a-z0-9._-]+/[a-z0-9._-]+$ ]]
}

# ─── whiptail wrappers ────────────────────────────────────────────────────────
# Если whiptail отсутствует — функции пытаются установить newt; иначе fallback на read.

WT_TITLE="${WT_TITLE:-vpnwebhome installer}"
WT_BACKTITLE="${WT_BACKTITLE:-vpnwebhome v0.1.0}"

wt_have() { cmd_exists whiptail; }

wt_ensure() {
  if ! wt_have; then
    log "whiptail не найден, устанавливаю newt…"
    if cmd_exists apt-get; then
      DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq whiptail >/dev/null 2>&1 || \
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq newt >/dev/null 2>&1 || true
    fi
    if ! wt_have; then
      warn "whiptail не установлен. Использую упрощённый текстовый режим."
      return 1
    fi
    ok "whiptail установлен"
  fi
  return 0
}

wt_msgbox() {
  # wt_msgbox "text" [height] [width]
  local text="$1"; local h="${2:-12}"; local w="${3:-72}"
  if wt_have; then
    whiptail --backtitle "$WT_BACKTITLE" --title "$WT_TITLE" --msgbox "$text" "$h" "$w"
  else
    echo ""
    echo "$text"
    echo ""
    read -r -p "Нажмите Enter…" _
  fi
}

wt_yesno() {
  # wt_yesno "text" [default-yes|default-no] → exit 0 = yes
  local text="$1"; local default="${2:-default-yes}"
  if wt_have; then
    local extra=()
    [ "$default" = "default-no" ] && extra=(--defaultno)
    whiptail --backtitle "$WT_BACKTITLE" --title "$WT_TITLE" "${extra[@]}" --yesno "$text" 12 72
  else
    local hint="(Y/n)"
    [ "$default" = "default-no" ] && hint="(y/N)"
    echo ""
    read -r -p "$text $hint " ans
    if [ "$default" = "default-no" ]; then
      [ "$ans" = "y" ] || [ "$ans" = "Y" ]
    else
      [ "$ans" != "n" ] && [ "$ans" != "N" ]
    fi
  fi
}

wt_input() {
  # wt_input "prompt" [default] → echo результат на stdout
  local prompt="$1"; local default="${2:-}"
  if wt_have; then
    whiptail --backtitle "$WT_BACKTITLE" --title "$WT_TITLE" \
      --inputbox "$prompt" 10 72 "$default" 3>&1 1>&2 2>&3
  else
    local val=""
    while [ -z "$val" ]; do
      read -r -p "$prompt [$default]: " val
      val="${val:-$default}"
    done
    echo "$val"
  fi
}

wt_password() {
  # wt_password "prompt" → echo результат на stdout
  local prompt="$1"
  if wt_have; then
    whiptail --backtitle "$WT_BACKTITLE" --title "$WT_TITLE" \
      --passwordbox "$prompt" 10 72 3>&1 1>&2 2>&3
  else
    local val=""
    read -r -s -p "$prompt: " val
    echo "" >&2
    echo "$val"
  fi
}

wt_menu() {
  # wt_menu "prompt" "tag1" "label1" "tag2" "label2" ...  → echo выбранный tag
  local prompt="$1"; shift
  if wt_have; then
    whiptail --backtitle "$WT_BACKTITLE" --title "$WT_TITLE" \
      --menu "$prompt" 18 72 8 "$@" 3>&1 1>&2 2>&3
  else
    echo ""
    echo "$prompt"
    local i=1; local tags=()
    while [ $# -gt 0 ]; do
      echo "  $i) $2"
      tags+=("$1")
      shift 2 || break
      i=$((i + 1))
    done
    local choice=""
    while ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#tags[@]}" ]; do
      read -r -p "Выбор [1-${#tags[@]}]: " choice
    done
    echo "${tags[$((choice - 1))]}"
  fi
}

wt_checklist() {
  # wt_checklist "prompt" "tag1" "label1" "ON|OFF" "tag2" "label2" "ON|OFF" ...
  # echo пробел-разделённый список выбранных тегов (без кавычек)
  local prompt="$1"; shift
  if wt_have; then
    local raw
    raw=$(whiptail --backtitle "$WT_BACKTITLE" --title "$WT_TITLE" \
      --checklist "$prompt" 18 72 8 "$@" 3>&1 1>&2 2>&3) || return 1
    # whiptail возвращает в формате "tag1" "tag2" — снимаем кавычки
    echo "$raw" | tr -d '"'
  else
    echo ""
    echo "$prompt"
    local i=1; local tags=(); local labels=(); local defaults=()
    while [ $# -gt 0 ]; do
      tags+=("$1"); labels+=("$2"); defaults+=("$3")
      shift 3 || break
      i=$((i + 1))
    done
    local out=()
    for j in "${!tags[@]}"; do
      local def="${defaults[$j]}"
      local hint="y/n"
      [ "$def" = "ON" ] && hint="Y/n"
      read -r -p "  ${labels[$j]} [$hint]: " ans
      ans="${ans:-$def}"
      if [ "$ans" = "y" ] || [ "$ans" = "Y" ] || [ "$ans" = "ON" ]; then
        out+=("${tags[$j]}")
      fi
    done
    echo "${out[*]}"
  fi
}

wt_textbox() {
  # wt_textbox "title" "text"  — большой текстовый блок (для финального summary)
  local title="$1"; local text="$2"
  if wt_have; then
    local tmp; tmp=$(mktemp)
    echo "$text" > "$tmp"
    whiptail --backtitle "$WT_BACKTITLE" --title "$title" --textbox "$tmp" 24 78
    rm -f "$tmp"
  else
    echo ""
    echo "═══ $title ═══"
    echo "$text"
    echo ""
    read -r -p "Нажмите Enter…" _
  fi
}

# ─── .env helpers ─────────────────────────────────────────────────────────────
env_get() {
  # env_get FILE KEY → echo value (или пусто)
  local file="$1"; local key="$2"
  [ -f "$file" ] || { echo ""; return; }
  awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

env_set() {
  # env_set FILE KEY VALUE — атомарно обновляет/добавляет KEY=VALUE
  local file="$1"; local key="$2"; local value="$3"
  if [ -f "$file" ] && grep -q "^${key}=" "$file"; then
    # Экранирование для sed
    local escaped; escaped=$(printf '%s\n' "$value" | sed 's:[\\/&]:\\&:g')
    sed -i.bak "s/^${key}=.*/${key}=${escaped}/" "$file" && rm -f "${file}.bak"
  else
    echo "${key}=${value}" >> "$file"
  fi
}
