#!/usr/bin/env bash
# install-cron.sh — устанавливает crontab для ежедневного бэкапа.
# Запуск (от root или того же пользователя что владеет /opt/vpnwebhome):
#   bash deploy/install-cron.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRON_LINE="0 3 * * * cd ${PROJECT_DIR} && /usr/bin/env bash deploy/backup.sh daily >> /var/log/vpnwebhome-backup.log 2>&1"
TAG="# vpnwebhome-backup"

# Текущий crontab
EXISTING="$(crontab -l 2>/dev/null || true)"

if echo "$EXISTING" | grep -q "$TAG"; then
  echo "Crontab уже содержит запись vpnwebhome-backup:"
  echo "$EXISTING" | grep -A1 "$TAG"
  echo ""
  echo "Чтобы переустановить — удалите её через 'crontab -e' и запустите снова."
  exit 0
fi

# Добавляем
{
  echo "$EXISTING"
  echo "$TAG"
  echo "$CRON_LINE"
} | crontab -

echo "✓ Установлено:"
echo "  $CRON_LINE"
echo ""
echo "Логи: /var/log/vpnwebhome-backup.log"
echo "Удаление: crontab -e (удалите строки с маркером $TAG)"
