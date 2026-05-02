#!/bin/bash
# Traffic Guard agent — узкий скрипт для чтения access.log Xray.
#
# Вызывается через SSH с command-restriction:
#   command="/usr/local/bin/access-log-query.sh",no-port-forwarding,...
#       ssh-ed25519 AAAA... traffic-agent@panel
#
# SSH передаёт оригинальную команду в env $SSH_ORIGINAL_COMMAND.
# Команды (whitelist):
#   health                          — проверка работоспособности
#   lookup <username> <hours>       — IP-адреса юзера за N часов (sort -u)
#   scan-torrents <since-ISO>       — пары "username <TAB> ip <TAB> count" из torrent-block
#
# Параметризация через env (можно править прямо в этом файле):
#   ACCESS_LOG_PATH — путь к access.log на хосте.
#                     По умолчанию — стандартный путь куда RemnaWave Node пишет
#                     при условии что в его docker-compose добавлен volume:
#                       volumes: ["./xray-logs:/var/log/xray"]
#                     Тогда на хосте лог лежит в ./xray-logs/access.log
#                     внутри директории установки ноды (обычно /opt/remnawave-node).

set -euo pipefail

LOG_PATH="${ACCESS_LOG_PATH:-/opt/remnawave-node/xray-logs/access.log}"
MAX_HOURS=168
MAX_BYTES=$((50 * 1024 * 1024))   # 50 MiB на запрос — достаточно для 1ч активной ноды

CMD="${SSH_ORIGINAL_COMMAND:-$*}"
read -ra ARGS <<< "$CMD" || true
SUB="${ARGS[0]:-}"

usage_and_exit() {
  echo "usage: health | lookup <username> <hours> | scan-torrents <since-ISO>" >&2
  exit 2
}

case "$SUB" in
  health)
    if [ -r "$LOG_PATH" ]; then
      echo "ok"
      exit 0
    fi
    echo "log_not_readable: $LOG_PATH" >&2
    exit 1
    ;;

  lookup)
    USERNAME="${ARGS[1]:-}"
    HOURS="${ARGS[2]:-1}"
    [ -z "$USERNAME" ] && usage_and_exit
    [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "bad username" >&2; exit 1; }
    [[ "$HOURS" =~ ^[0-9]+$ ]] || HOURS=1
    if [ "$HOURS" -lt 1 ] || [ "$HOURS" -gt "$MAX_HOURS" ]; then HOURS=1; fi

    SIZE=$((HOURS * MAX_BYTES))
    if [ "$SIZE" -gt $((MAX_BYTES * 24)) ]; then SIZE=$((MAX_BYTES * 24)); fi

    tail -c "$SIZE" "$LOG_PATH" 2>/dev/null \
      | grep -F "email: ${USERNAME}" \
      | awk '{
          # Формат: "2026/04/29 16:23:11 78.46.123.45:51234 accepted ..."
          ip=$3; sub(/:.*/, "", ip);
          if (ip ~ /^[0-9a-fA-F.:]+$/) print ip
        }' \
      | sort -u
    ;;

  scan-torrents)
    SINCE="${ARGS[1]:-}"
    [ -z "$SINCE" ] && usage_and_exit
    # Принимаем YYYY-MM-DD или YYYY/MM/DD HH:MM:SS
    [[ "$SINCE" =~ ^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2} ]] || { echo "bad since" >&2; exit 1; }

    # Convert YYYY-MM-DD → YYYY/MM/DD (формат Xray)
    SINCE_XRAY="${SINCE//-//}"

    # Грепаем строки с torrent-block tag, фильтруем по дате
    grep -F "[torrent-block]" "$LOG_PATH" 2>/dev/null \
      | awk -v since="$SINCE_XRAY" '$1" "$2 >= since' \
      | awk '{
          ip=$3; sub(/:.*/, "", ip);
          for (i=1; i<=NF; i++) if ($i == "email:") { user=$(i+1); break }
          if (user && ip ~ /^[0-9a-fA-F.:]+$/) print user "\t" ip
        }' \
      | sort \
      | uniq -c \
      | awk '{print $2"\t"$3"\t"$1}'
    ;;

  *)
    usage_and_exit
    ;;
esac
