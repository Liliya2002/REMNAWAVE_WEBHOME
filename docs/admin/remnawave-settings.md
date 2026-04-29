# Настройки RemnaWave

Этот раздел — про общие настройки панели RemnaWave: подключение к API, токены, бэкапы, обновление панели.

## Подключение нашего бэкенда к RemnaWave

В файле `backend/.env` должны быть три переменные:

```bash
REMNWAVE_API_URL=https://panel.example.com
REMNWAVE_API_TOKEN=<bearer-token>
REMNWAVE_SECRET_KEY=<secret-for-callbacks>
```

| Переменная | Где взять |
|---|---|
| `REMNWAVE_API_URL` | URL твоей панели RemnaWave, без слэша на конце |
| `REMNWAVE_API_TOKEN` | RemnaWave → **Settings** → **API tokens** → **Create** (нужны права на users + nodes) |
| `REMNWAVE_SECRET_KEY` | RemnaWave → **Settings** → **Webhooks / Callbacks** — для верификации webhook-подписей |

После изменения этих переменных — **рестарт backend**:

```bash
docker compose restart backend
# или вручную:
pkill -f "node index.js" && cd backend && node index.js &
```

При старте backend в логах должны быть три зелёных галочки:

```
[Remnwave] API_URL: https://panel.example.com
[Remnwave] API_TOKEN: ✓ Configured
[Remnwave] SECRET_KEY: ✓ Configured
```

## Создание API-токена в RemnaWave

1. **Settings** → **API tokens** → **Create token**
2. **Name**: `vpnwebhome-backend` (любое осмысленное)
3. **Scopes** (нужные нашему бэкенду):
   - `users:read`, `users:write`
   - `nodes:read`
   - `subscriptions:read`, `subscriptions:write`
   - `inbounds:read`
4. **Save** → скопировать токен **сразу** (потом не покажется).

## SSL для панели

RemnaWave обязательно за TLS. Если ставил через установщик — сертификат уже выпущен через Let's Encrypt. Проверка:

```bash
echo | openssl s_client -connect panel.example.com:443 2>/dev/null | openssl x509 -noout -dates
```

Должны быть валидные `notBefore` / `notAfter`.

## Бэкап базы RemnaWave

Бэкап нужен **до каждого обновления панели**. Команда:

```bash
docker exec -t <remnawave-postgres-container> \
  pg_dump -U postgres remnawave \
  | gzip > /backups/remnawave-$(date +%F-%H%M).sql.gz
```

Можно повесить на cron:

```cron
0 3 * * * /usr/local/bin/remnawave-backup.sh
```

## Обновление панели RemnaWave

> ⚠️ **Перед обновлением**: сделай бэкап БД (см. выше).

Стандартный путь обновления:

```bash
cd /opt/remnawave
docker compose pull
docker compose up -d
docker compose logs -f panel
```

Дождаться `Listening on port 8000` (или какой у тебя сконфигурирован).

## Ноды (Nodes)

Каждая нода RemnaWave — отдельный VPS, на котором стоит **remnawave-node** (агент). См. раздел **«Настройки VPS»** для развёртывания самой ноды.

Полезные действия в админке RemnaWave:

| Действие | Где |
|---|---|
| Добавить ноду | Nodes → Add node |
| Перезапустить Xray на ноде | Nodes → … → Restart Xray |
| Посмотреть live-логи ноды | Nodes → … → Logs |
| Принудительная пересинхронизация | Nodes → … → Force sync |

## Webhooks / Callbacks

Если хочешь получать уведомления в наш backend (например, "пользователь превысил лимит трафика") — настрой callback URL:

- RemnaWave → **Settings** → **Webhooks**
- URL: `https://shop.cdn-yandex.top/api/webhooks/remnawave`
- Secret: тот же, что в `REMNWAVE_SECRET_KEY`

## Чек-лист здоровья панели

- [ ] Панель открывается по HTTPS, нет warning'ов сертификата
- [ ] `GET /api/system` возвращает `{"status":"ok"}`
- [ ] Все ноды в статусе **Online**
- [ ] Свежие бэкапы за последние 24 часа
- [ ] В логах панели нет ERROR за последний час

## Полезные ссылки

- [RemnaWave docs](https://docs.remna.st/)
- [API reference](https://docs.remna.st/api/)
- [Telegram-сообщество RemnaWave](https://t.me/remnawave)
