# Настройки VPS

Этот раздел — про подготовку нового VPS под ноду RemnaWave: какие требования, как настроить ОС, как поставить агента и подключить к панели.

## Минимальные требования

| Ресурс | Значение |
|---|---|
| **OS** | Ubuntu 22.04 LTS / 24.04 LTS (рекомендуется) |
| **CPU** | 1 vCPU (для ~50 одновременных юзеров) |
| **RAM** | 1 ГБ (минимум), 2 ГБ комфортно |
| **Диск** | 20 ГБ SSD |
| **Сеть** | от 100 Мбит/с, IPv4 публичный, **порты 22/443/80 свободны** |
| **Локация** | вне юрисдикций со строгой блокировкой VPN |

## Выбор провайдера

| Провайдер | Где платить | Плюсы | Минусы |
|---|---|---|---|
| **Hetzner** | карта/SEPA | дёшево, стабильно, EU | не работает с РФ-картами |
| **Vultr** | карта/PayPal | много локаций | дороже Hetzner'а |
| **Aeza** | RU карты, СБП | удобная оплата из РФ | российская юрисдикция |
| **TimeWeb** | RU карты | RU-стек | не для всех локаций |

## Первоначальная настройка ОС

### 1. Подключиться по SSH

```bash
ssh root@<ip-vps>
```

### 2. Создать non-root пользователя (опционально, рекомендуется)

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### 3. Закрыть всё кроме нужного через `ufw`

```bash
apt update && apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH
ufw allow 443/tcp       # Xray (Reality / WS+TLS)
ufw allow 80/tcp        # HTTP (для acme/redirect)
ufw enable
ufw status
```

### 4. Отключить root-логин по паролю

В `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

Затем:

```bash
systemctl restart ssh
```

### 5. Настроить fail2ban (защита от брутфорса SSH)

```bash
apt install -y fail2ban
systemctl enable --now fail2ban
```

### 6. Установить Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

### 7. Включить BBR (улучшает throughput TCP)

```bash
echo 'net.core.default_qdisc=fq' >> /etc/sysctl.conf
echo 'net.ipv4.tcp_congestion_control=bbr' >> /etc/sysctl.conf
sysctl -p
sysctl net.ipv4.tcp_congestion_control  # должно вернуть "bbr"
```

## Установка ноды RemnaWave

### 1. Подготовить директорию

```bash
mkdir -p /opt/remnawave-node && cd /opt/remnawave-node
```

### 2. Получить **SSL_CERT** из панели

- RemnaWave → **Nodes** → **Add node**
- Заполнить **Name** (например, `de-fra-1`) и **Address** (например, IP или домен ноды)
- Скопировать сгенерированный `SSL_CERT` — длинная base64-строка

### 3. Создать `docker-compose.yml`

```yaml
services:
  node:
    image: remnawave/node:latest
    container_name: remnawave-node
    network_mode: host
    restart: always
    env_file: .env
    volumes:
      - ./data:/var/lib/remnanode
```

### 4. Создать `.env`

```bash
SSL_CERT=<base64-строка из панели>
APP_PORT=2222
```

### 5. Запустить

```bash
docker compose up -d
docker compose logs -f
```

В логах должно появиться: `Node ready, waiting for commands from panel`.

### 6. Проверить в панели

RemnaWave → **Nodes** → нода должна стать **Online** в течение ~30 секунд.

## Чек-лист готовности ноды

- [ ] `curl -I https://<ip>:443` отвечает (Reality маскируется под HTTPS)
- [ ] `ufw status` — открыты только 22, 80, 443
- [ ] `docker ps` — `remnawave-node` в статусе `Up`
- [ ] BBR включён (`sysctl net.ipv4.tcp_congestion_control` → `bbr`)
- [ ] В RemnaWave нода **Online** + назначен хотя бы один inbound
- [ ] Тестовый юзер может подключиться через эту ноду

## Мониторинг ноды

Полезные команды на самой VPS:

```bash
# Загрузка CPU / памяти / сети
htop
nethogs

# Логи Xray внутри контейнера
docker exec remnawave-node tail -f /var/log/xray/access.log

# Активные соединения
ss -tnp state established | wc -l

# Свободное место
df -h
```

## Регулярное обслуживание

| Что | Как часто |
|---|---|
| Бэкап `.env` ноды | при изменениях |
| `apt update && apt upgrade` | раз в месяц |
| `docker compose pull && up -d` для ноды | раз в 1–2 месяца |
| Проверка `ufw status` | раз в квартал |
| Просмотр логов на аномалии | раз в неделю |

## Если нода упала

1. `ssh` на VPS → `docker compose logs --tail=200`
2. Проверь, что контейнер вообще жив: `docker ps -a`
3. Если контейнер мёртв: `docker compose up -d`, потом `docker compose logs -f`
4. Если всё запустилось, но нода всё ещё **Offline** в панели:
   - Проверь, что `SSL_CERT` в `.env` совпадает с тем, что в панели
   - Проверь, что 2222 (APP_PORT) открыт между панелью и нодой
   - В RemnaWave → **Nodes** → … → **Force sync**
