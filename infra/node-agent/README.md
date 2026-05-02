# Traffic Guard Node Agent

Узкий SSH-агент для чтения access.log Xray на нодах RemnaWave. Используется backend'ом панели для:

- **Phase 2** — On-demand lookup настоящего IP клиента при автоблокировке Traffic Guard
- **Phase 3** — Периодический scan на предмет P2P/torrent-нарушений

Ничего не отправляет наружу самостоятельно. Только реагирует на SSH-запросы с **whitelist-командами**.

---

## Установка на ноду (один раз на каждую)

> Предполагаем: нода уже работает по [docs.remna.st](https://docs.remna.st/) install-инструкции и стоит в `/opt/remnawave-node/`.

### 1. Открыть access.log Xray на хост-системе

В `/opt/remnawave-node/docker-compose.yml` добавить volume для логов Xray:

```yaml
services:
  remnawave-node:
    image: remnawave/node:latest
    container_name: remnawave-node
    network_mode: host
    restart: always
    env_file: .env
    volumes:
      - ./data:/var/lib/remnanode
      - ./xray-logs:/var/log/xray   # ← добавить эту строку
```

И в `/opt/remnawave-node/data/xray-config.json` (или где у вас лежит config) проверить, что Xray пишет логи:

```json
"log": {
  "loglevel": "warning",
  "access": "/var/log/xray/access.log",
  "error": "/var/log/xray/error.log"
}
```

Перезапустить ноду:

```bash
cd /opt/remnawave-node
docker compose down && docker compose up -d
```

После этого на хосте `/opt/remnawave-node/xray-logs/access.log` будет существовать и расти.

### 2. Создать unprivileged user `traffic-agent`

```bash
sudo adduser --system --no-create-home --shell /bin/bash --group traffic-agent
sudo usermod -d /opt/remnawave-node traffic-agent
sudo mkdir -p /home/traffic-agent/.ssh
sudo chown -R traffic-agent:traffic-agent /home/traffic-agent
sudo chmod 700 /home/traffic-agent/.ssh
```

Дать `traffic-agent` право читать access.log:

```bash
sudo chmod 644 /opt/remnawave-node/xray-logs/access.log
sudo setfacl -m u:traffic-agent:r-- /opt/remnawave-node/xray-logs/access.log
# ИЛИ если setfacl недоступен:
sudo chgrp traffic-agent /opt/remnawave-node/xray-logs
sudo chmod 750 /opt/remnawave-node/xray-logs
```

### 3. Установить скрипт agent

```bash
sudo cp access-log-query.sh /usr/local/bin/access-log-query.sh
sudo chmod 755 /usr/local/bin/access-log-query.sh
sudo chown root:root /usr/local/bin/access-log-query.sh
```

Если ваш путь к логам отличается — отредактируйте переменную `LOG_PATH` в скрипте либо передавайте через env при настройке authorized_keys (см. ниже).

### 4. Прописать SSH-ключ панели

На панели backend'е сгенерируйте ed25519 ключ один раз (если не сгенерирован):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/traffic-agent -N "" -C "traffic-agent@vpnwebhome-panel"
cat ~/.ssh/traffic-agent.pub
```

Скопируйте **публичный** ключ. На ноде:

```bash
sudo nano /home/traffic-agent/.ssh/authorized_keys
```

Вставьте одну строку (ВАЖНО — с `command=...` и `no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`):

```
command="/usr/local/bin/access-log-query.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty,restrict ssh-ed25519 AAAA... traffic-agent@vpnwebhome-panel
```

Это критически важно для безопасности — даже если SSH-ключ где-то утечёт, он сможет вызвать **только** этот скрипт, ничего другого.

```bash
sudo chown traffic-agent:traffic-agent /home/traffic-agent/.ssh/authorized_keys
sudo chmod 600 /home/traffic-agent/.ssh/authorized_keys
```

### 5. Открыть SSH-порт

Если у вас firewall — убедитесь что порт 22 открыт для IP backend'а (или вообще для всех, если приватный ключ известен только вам).

### 6. Проверить доступ

С панели:

```bash
ssh -i ~/.ssh/traffic-agent traffic-agent@<NODE_IP> health
# должно вернуть: ok
```

Если ошибка `Cannot read access.log` — проверьте chmod / setfacl из п.2.

### 7. Прописать на backend

В `backend/.env`:

```env
# Traffic Agent SSH
TRAFFIC_AGENT_SSH_USER=traffic-agent
TRAFFIC_AGENT_SSH_PORT=22
TRAFFIC_AGENT_SSH_PRIVATE_KEY_PATH=/path/to/traffic-agent
# ИЛИ inline (для Docker / managed окружений):
# TRAFFIC_AGENT_SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----\n"
```

Перезапустить backend.

В админке `/admin/traffic-guard` → таб **Настройки** → раздел «SSH-агент» → включить тумблер «SSH-lookup настоящего IP» → нажать **«Проверить»** для каждой ноды.

---

## Команды агента (для справки)

```bash
# Проверка работоспособности
ssh ... health
→ ok

# Получить уникальные IP юзера userweb_1 за последний час
ssh ... lookup userweb_1 1
→ 78.46.123.45
   2001:db8::1

# Получить пары username/IP с torrent-block с указанной даты
ssh ... scan-torrents 2026-04-29
→ userweb_1   78.46.123.45   12
   bad_user1   192.0.2.10     5
```

---

## Безопасность

- `traffic-agent` — unprivileged user, не имеет shell-доступа кроме `command="..."` ключа
- Скрипт делает **только** чтение access.log с whitelist-аргументами (regex-валидация)
- Не передаёт никаких данных наружу самостоятельно — только отвечает на запросы
- Параметры жёстко ограничены (HOURS до 168, USERNAME alphanumeric only)

## Troubleshooting

**`log_not_readable: ...`**
→ Проверьте `chmod` access.log + волуме в docker-compose

**`Permission denied (publickey)`**
→ Публичный ключ не в `authorized_keys` или прав 644 вместо 600

**`bad username` / `bad since`**
→ Username должен быть `[a-zA-Z0-9_-]+`. Дата — `YYYY-MM-DD` или `YYYY/MM/DD HH:MM:SS`

**Скрипт не реагирует на SSH-команду:**
→ Проверьте что в `authorized_keys` написано `command="/usr/local/bin/access-log-query.sh"` (с кавычками!)
