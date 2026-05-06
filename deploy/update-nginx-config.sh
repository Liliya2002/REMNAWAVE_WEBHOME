#!/usr/bin/env bash
# Регенерирует nginx/conf.d/app.conf из app.conf.template, подставляя ${DOMAIN} из .env.
# Вызывается автоматически из deploy.sh, но можно запустить вручную:
#   bash deploy/update-nginx-config.sh
#
# После регенерации (если конфиг изменился) делает graceful reload nginx-контейнера.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

TEMPLATE="$ROOT/nginx/conf.d/app.conf.template"
TARGET="$ROOT/nginx/conf.d/app.conf"
ENV_FILE="$ROOT/.env"

if [ ! -f "$TEMPLATE" ]; then
  echo "✖ Template не найден: $TEMPLATE"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "✖ .env не найден в $ROOT — без него не знаем DOMAIN"
  exit 1
fi

# Берём DOMAIN из .env (без source чтобы не унаследовать остальные переменные)
DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -z "$DOMAIN" ]; then
  echo "✖ DOMAIN не задан в .env"
  exit 1
fi

# Генерируем во временный файл
TMP=$(mktemp)
DOMAIN="$DOMAIN" envsubst '$DOMAIN' < "$TEMPLATE" > "$TMP"

# Если результат идентичен текущему — ничего не делаем
if [ -f "$TARGET" ] && cmp -s "$TMP" "$TARGET"; then
  rm -f "$TMP"
  echo "✓ nginx/conf.d/app.conf уже актуален"
  exit 0
fi

# Бэкап и применение
if [ -f "$TARGET" ]; then
  cp "$TARGET" "$TARGET.bak"
  echo "  бэкап: $TARGET.bak"
fi
mv "$TMP" "$TARGET"
echo "✓ nginx/conf.d/app.conf обновлён (DOMAIN=$DOMAIN)"

# Reload nginx-контейнера если он запущен
if docker compose ps nginx 2>/dev/null | grep -q "Up\|running"; then
  echo "  nginx-контейнер запущен — graceful reload..."
  if docker compose exec -T nginx nginx -t 2>&1 | tail -3; then
    docker compose exec -T nginx nginx -s reload 2>&1 | tail -1
    echo "✓ nginx reloaded"
  else
    echo "✖ nginx -t не прошёл — конфиг откачен"
    if [ -f "$TARGET.bak" ]; then mv "$TARGET.bak" "$TARGET"; fi
    exit 1
  fi
fi
