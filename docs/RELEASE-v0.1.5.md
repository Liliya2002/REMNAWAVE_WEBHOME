# Release v0.1.5 — Traffic Guard 2.0 + Plan Tiers + Squad Quotas

**Дата:** 2026-04-30
**Кодовое имя:** _Traffic Guard 2.0_

Большое расширение системы автоматического контроля трафика. Объединяет три независимых, но
дополняющих друг друга подсистемы. Все три можно использовать **по отдельности** — каждая
включается своим тумблером в админке.

| Подсистема | Что делает | Зависимости |
|---|---|---|
| **Phase 1 — IP-bans** | Запоминает IP при регистрации, авто-банит нарушителей, блокирует ре-регистрацию с забаненных IP | _нет_ (работает из коробки) |
| **Phase 2 — SSH-агент** | Точечно тянет настоящий IP клиента из access.log на ноде | требует ручной установки агента на каждую ноду |
| **Phase 3 — P2P-детекция** | Периодически сканирует access.log на торренты, выписывает санкции | требует Phase 2 + ручной настройки routing-rule в RemnaWave |
| **Plan Tiers + Change-plan** | Уровни тарифов + возможность менять тариф (upgrade/downgrade/swap) с пропорциональным пересчётом цены | _нет_ |
| **Squad Quotas** | Per-server лимиты ГБ в каждом тарифе + авто-отключение/восстановление + покупка доп. трафика | _нет_ |
| **Email Confirmation flow** | Re-confirmation banner для уже зарегистрированных юзеров + admin toggle + статистика | требует SMTP в `.env` |
| **RemnaWave Metadata Sync** | Стабильный username `userweb_<8 цифр>` + email/Telegram/HWID-limit передаются в RW и синкаются при изменениях | _нет_ |
| **Dashboard: connected devices** | Список устройств юзера + лимит из тарифа + кнопка удаления | _нет_ |

---

## Содержание

1. [Общая архитектура](#общая-архитектура)
2. [Phase 1 — IP-bans](#phase-1--ip-bans)
3. [Phase 2 — SSH-агент](#phase-2--ssh-агент)
4. [Phase 3 — P2P/Torrent детекция](#phase-3--p2ptorrent-детекция)
5. [Plan Tiers + Change-plan](#plan-tiers--change-plan)
6. [Squad Quotas — per-server лимиты + авто-отключение](#squad-quotas--per-server-лимиты--авто-отключение)
7. [Email Confirmation flow](#email-confirmation-flow)
8. [RemnaWave Metadata Sync](#remnawave-metadata-sync)
9. [Dashboard: подключённые устройства](#dashboard-подключённые-устройства)
10. [Брендинг](#брендинг)
11. [Прочие фиксы](#прочие-фиксы)
12. [Upgrade-path с v0.1.4](#upgrade-path-с-v014)
13. [Privacy / юридические моменты](#privacy--юридические-моменты)
14. [Troubleshooting](#troubleshooting)
15. [FAQ](#faq)

---

## Общая архитектура

```
┌────────────────────┐         ┌──────────────────┐         ┌─────────────┐
│  Web (frontend)    │  HTTPS  │  Backend (Node)  │  HTTPS  │  RemnaWave  │
│  /admin/traffic-*  │ ──────> │   /api/admin/*   │ ──────> │   panel API │
└────────────────────┘         │                  │         └──────┬──────┘
                                │  - trafficGuard  │                │
                                │  - p2pDetector   │                ▼
                                │  - sshAgent      │         ┌─────────────┐
                                │  - ipBan         │   SSH   │  Node (Xray)│
                                │                  │ ──────> │  + agent.sh │
                                └──────────────────┘         └─────────────┘
                                         │
                                         │ Postgres
                                         ▼
                              ┌──────────────────────┐
                              │ traffic_guard_settings│
                              │ node_traffic_limits   │
                              │ plan_traffic_limits   │
                              │ traffic_violations    │
                              │ banned_ips            │
                              │ users.registration_ip │
                              └──────────────────────┘
```

**Где что хранится:**

- **traffic_guard_settings** — singleton, глобальные тумблеры и параметры всех трёх фаз
- **node_traffic_limits** — per-node лимиты + `block_torrents` toggle для Phase 3
- **plan_traffic_limits** — per-tariff лимиты
- **traffic_violations** — журнал всех нарушений (трафик + P2P), с `client_ips JSONB`
- **banned_ips** — текущие IP-баны (manual + auto)
- **users.registration_ip** — IP с которого юзер зарегался

---

## Phase 1 — IP-bans

### Зачем
Защита от нарушителей трафик-лимитов которые попытаются перерегистрироваться с того же IP
после блокировки. Если юзер прокачал лимит и был отключён в RemnaWave — его регистрационный
IP попадает в `banned_ips`. Любая новая попытка регистрации с этого IP отклоняется.

### Что хранится
Только когда **активна** блокировка:
- IP с которого юзер зарегистрировался — в `users.registration_ip` (постоянно, как часть аккаунта)
- IP связанные с конкретным нарушением — в `traffic_violations.client_ips` (массив) и `banned_ips`

После разблокировки auto-cleanup убирает связанные IP-баны.

### Как включить

`/admin/traffic-guard` → таб **Настройки** → раздел **«Авто-бан IP при превышении»**:

1. ✅ Тумблер **«Авто-банить IP нарушителей»**
2. **Длительность бана (часов)** — `0` = пока активна блокировка юзера, `>0` = N часов
3. **Сохранить**

### Что происходит при срабатывании

```
   Юзер прокачал лимит (например, 100 ГБ на ноде Switzerland за месяц)
                            │
                            ▼
              [Cron Traffic Guard tick — каждые 15 мин]
                            │
                            ▼
      Создаётся traffic_violations level=blocked
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   disableRemnwaveUser(uuid)    Если ip_ban_enabled:
   (юзер не сможет              addAutoBan(registration_ip)
   подключаться)                  + (Phase 2) SSH-lookup → ещё IP
              │                           │
              └─────────────┬─────────────┘
                            ▼
              Email + in-app нотификация
```

### Manual управление IP-банами

**Таб «Бан по IP»** в `/admin/traffic-guard`:

- Список всех banned_ips — manual + auto, с фильтрами (active/expired/all) и поиском
- Кнопка **«+ Забанить IP вручную»** — модалка с полями:
  - **IP-адрес** (IPv4 или IPv6)
  - **Причина** (опционально)
  - **Длительность (часов)** — пусто/0 = бессрочный
  - **Заметки** (видны только админам)
- На каждой карточке: ✏ редактировать (можно изменить срок и заметки) и 🗑 удалить (снять бан)

**Различие manual ↔ auto:**

- **`source='manual'`** — создан админом. Auto-cleanup не трогает (пока сам не снимет).
- **`source='auto_violation'`** — создан системой. Снимается:
  - При manual unblock через `/violations/:id/unblock` (admin кликнул «Разблокировать» в табе «Заблокированные»)
  - При auto-unblock в новый период (cron)
  - Когда `expires_at < NOW()` (если задан срок)

### Чек-лист после включения

- [ ] В Settings включил `ip_ban_enabled`, выбрал длительность
- [ ] Создал тестового юзера → перевёл лимит → дождался cron tick (или нажал "Запустить проверку")
- [ ] В табе «Заблокированные» появился новый violation с client_ip badge
- [ ] В табе «Бан по IP» появилась запись с `source: auto`
- [ ] Попробовал зарегаться с того же IP — получил **HTTP 403** с сообщением «Регистрация с этого IP-адреса временно ограничена»
- [ ] Снял блокировку через UI — IP пропал из banned_ips

---

## Phase 2 — SSH-агент

### Зачем
RemnaWave API **не отдаёт client IP** ни в одном endpoint (мы проверили все возможные пути — `/api/users/:uuid`, `/api/users/online`, `/api/sessions`, `/api/hwid/devices` и т.д.).
Реальные IP подключений лежат **только** на самих нодах в access.log Xray. SSH-агент — это
**безопасный точечный мостик** для on-demand чтения этого лога.

**Что НЕ делает агент:**
- ❌ не отправляет данные сам (push'ит — только бэкенд тянет)
- ❌ не логирует подключения постоянно (только on-demand при срабатывании Traffic Guard или ручной кнопке админа)
- ❌ не имеет доступа ни к чему кроме access.log (через unprivileged user + command-restriction)

### Архитектура SSH

```
┌──────────────────┐               ┌──────────────────────┐
│  Backend         │  SSH (port 22)│   Node (RemnaWave)   │
│                  │  ──────────>  │                      │
│  ssh2 client     │  ed25519 key  │  user: traffic-agent │
│                  │               │  shell: forced       │
│  TRAFFIC_AGENT_  │               │  command="..."       │
│  SSH_PRIVATE_KEY │               │   ↓                  │
│                  │               │  /usr/local/bin/     │
│                  │               │  access-log-query.sh │
│                  │               │   ↓ читает           │
│                  │               │  ./xray-logs/        │
│                  │               │   access.log         │
└──────────────────┘               └──────────────────────┘
```

### Установка на ноду

> Полная инструкция: [`infra/node-agent/README.md`](../infra/node-agent/README.md). Краткая выжимка ниже.

#### 1. Открыть xray-logs наружу контейнера

В `/opt/remnawave-node/docker-compose.yml`:

```yaml
services:
  remnawave-node:
    image: remnawave/node:latest
    network_mode: host
    restart: always
    env_file: .env
    volumes:
      - ./data:/var/lib/remnanode
      - ./xray-logs:/var/log/xray   # ← добавить эту строку
```

В config Xray (где у вас лежит — обычно через RemnaWave-панель):

```json
"log": {
  "loglevel": "warning",
  "access": "/var/log/xray/access.log",
  "error":  "/var/log/xray/error.log"
}
```

Перезапустить: `docker compose down && docker compose up -d`.

#### 2. Создать unprivileged user

```bash
sudo adduser --system --no-create-home --shell /bin/bash --group traffic-agent
sudo mkdir -p /home/traffic-agent/.ssh
sudo chown -R traffic-agent:traffic-agent /home/traffic-agent
sudo chmod 700 /home/traffic-agent/.ssh
sudo setfacl -m u:traffic-agent:r-- /opt/remnawave-node/xray-logs/access.log
```

#### 3. Установить агент-скрипт

```bash
sudo cp infra/node-agent/access-log-query.sh /usr/local/bin/
sudo chmod 755 /usr/local/bin/access-log-query.sh
sudo chown root:root /usr/local/bin/access-log-query.sh
```

#### 4. SSH-ключ с command-restriction

На бэкенде сгенерировать (один раз для всего проекта):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/traffic-agent -N ""
cat ~/.ssh/traffic-agent.pub
```

На ноде в `/home/traffic-agent/.ssh/authorized_keys`:

```
command="/usr/local/bin/access-log-query.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty,restrict ssh-ed25519 AAAA... traffic-agent@panel
```

**Critical:** обратите внимание на `command="..."` — ЭТО гарантирует что даже если ключ
утечёт, его можно использовать **только** для вызова этого узкого скрипта.

```bash
sudo chmod 600 /home/traffic-agent/.ssh/authorized_keys
sudo chown traffic-agent:traffic-agent /home/traffic-agent/.ssh/authorized_keys
```

#### 5. Прописать на бэкенде

В `backend/.env`:

```env
TRAFFIC_AGENT_SSH_USER=traffic-agent
TRAFFIC_AGENT_SSH_PORT=22
TRAFFIC_AGENT_SSH_PRIVATE_KEY_PATH=/home/yourbackend/.ssh/traffic-agent
# Или для Docker:
# TRAFFIC_AGENT_SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END..."
```

Перезапустить backend.

#### 6. Включить и проверить

`/admin/traffic-guard` → **Настройки** → раздел **«SSH-агент»**:

1. ✅ Тумблер «Включить SSH-lookup настоящих IP при автоблокировке»
2. Кнопка **«Проверить SSH на всех нодах»** — должна показать ✓ для каждой ноды
3. Сохранить

### Команды агента

| Команда | Что возвращает |
|---|---|
| `health` | `ok` если access.log читается |
| `lookup <username> <hours>` | Уникальные IP юзера за N часов (max 168 = 7 дней) |
| `scan-torrents <since-ISO>` | Пары `username\tip\tcount` для строк с `[torrent-block]` (Phase 3) |

Параметры жёстко валидируются:
- username — `[a-zA-Z0-9_-]+`
- hours — целое от 1 до 168
- since — формат YYYY-MM-DD

### Использование в админке

**Когда срабатывает Traffic Guard блок** — автоматически:
- Резолвится `lastConnectedNodeUuid` из RemnaWave для юзера
- SSH-lookup вытаскивает реальные IP за последний час
- Все IP попадают в `traffic_violations.client_ips` и (если `ip_ban_enabled`) в `banned_ips`

**Кнопка «Получить реальный IP»** — в карточке юзера → таб **Трафик** → секция Traffic Guard:
- Делает SSH-lookup на лету (24-часовое окно)
- Показывает найденные IP в cyan-плашке
- Не пишет ничего в БД (только показ)

### Чек-лист после установки

- [ ] `ssh -i ~/.ssh/traffic-agent traffic-agent@<NODE_IP> health` → `ok`
- [ ] Test SSH в админке показывает зелёные ✓ для всех нод
- [ ] Сделал тест на blocked-violation → в `client_ips` violations есть IP **из ноды** (не только registration_ip)
- [ ] Кнопка «Получить реальный IP» в карточке юзера показывает реальный IP

---

## Phase 3 — P2P/Torrent детекция

### Зачем
Пользователи иногда качают торренты через VPN, что приводит к:
- DMCA-уведомлениям от хостеров (которые могут блокировать ноду или вашего хостера)
- Резкому росту трафика → заблокировка по обычному `traffic_blocked`
- Юридическим проблемам в некоторых юрисдикциях

Решение: **блок BitTorrent на уровне Xray** + наша система детектит и **наказывает нарушителя**.

### Как это работает

**Часть 1 — собственно блок (настраивается админом в RemnaWave):**

Xray-core имеет встроенную детекцию BitTorrent через sniffing. Достаточно добавить
routing-rule, чтобы все BT-соединения отправлялись в blackhole (не работали).

**Часть 2 — детекция нарушителей (наш сервис):**

Каждые N минут (настраивается, default 5) cron `p2pDetector`:
1. Через SSH-агент на каждой ноде вызывает `scan-torrents <ISO-date>`
2. Парсит вывод — пары `username/ip/count` для строк с `[torrent-block]`
3. Сопоставляет username с нашими юзерами
4. Если у юзера накопилось `>= torrent_attempts_threshold` попыток → создаёт violation:
   - **Первый раз** в день → `level='torrent_warning'` + email/in-app
   - **Повтор** в тот же день → `level='torrent_blocked'` + действие из `torrent_action`

### Действия при torrent_blocked

| `torrent_action` | Что делает |
|---|---|
| `warn_only` | Только нотификация, без санкций |
| `disable_user` | Отключает юзера в RemnaWave + IP-бан если `ip_ban_enabled` |
| `ip_ban` | Только IP-бан собранных IP (юзер остаётся в RW активным) |

### Как настроить

#### Шаг 1. Включить блок торрентов в Xray (один раз на ноду)

В RemnaWave-панели → **Configs** → ваш config → раздел `routing`:

```json
"routing": {
  "rules": [
    {
      "type": "field",
      "protocol": ["bittorrent"],
      "outboundTag": "torrent-block"
    }
  ]
},
"outbounds": [
  { "tag": "torrent-block", "protocol": "blackhole" }
]
```

В каждом `inbound` где хочешь включить детекцию:

```json
"sniffing": {
  "enabled": true,
  "destOverride": ["http", "tls", "quic", "bittorrent"],
  "metadataOnly": false
}
```

> Этот же снипет в админке доступен по клику на «Как настроить блокировку торрентов в RemnaWave» в разделе **P2P / Torrent детекция** в Settings.

Сохрани и пересинхронизируй ноду. Xray начнёт писать в access.log:

```
2026/04/30 10:23:45 78.46.123.45:51234 rejected tcp:tracker.openbittorrent.com:80 [torrent-block] email: bad_user1
```

#### Шаг 2. Включить детекцию в админке

`/admin/traffic-guard` → **Настройки** → раздел **«P2P / Torrent детекция»**:

1. ✅ Тумблер «Включить P2P-детекцию»
2. **Интервал сканирования** — default 5 мин (1-1440)
3. **Порог попыток до санкции** — сколько попыток BT-соединений за окно triggers warning. Default 5
4. **Действие при превышении** — warn_only / disable_user / ip_ban
5. Сохранить

#### Шаг 3. Per-node toggle (опционально)

В табе **Лимиты по нодам** для каждой ноды:
- ✅ **«Сканировать на нарушения»** — включить P2P-скан для этой ноды
- ❌ — выключить (юзеры на этой ноде могут качать торренты)

Это полезно если у тебя есть **«премиальные»** ноды где торренты разрешены, и **«обычные»** где нет.

### Manual scan

Кнопка **«Запустить P2P-скан»** в Settings (видна когда P2P включено) — запускает scan на всех включённых нодах сразу. Полезно после изменения конфигов.

### Чек-лист после настройки

- [ ] В RemnaWave config настроен `routing` rule + sniffing с `bittorrent`
- [ ] Тестовый клиент запустил BitTorrent → в access.log на ноде появились `[torrent-block]` строки
- [ ] В админке включил P2P-детекцию + per-node `block_torrents`
- [ ] Через `/p2p-scan-now` — увидел `users:N` в результате (где N — наши торрент-юзеры)
- [ ] В табе **Нарушения** появились записи с фильтром «Warning (P2P)»
- [ ] Юзер получил email-нотификацию
- [ ] При повторе в тот же день — `torrent_blocked` + действие применилось

---

## Plan Tiers + Change-plan

Система **уровней тарифов** и **функция смены тарифа** прямо из личного кабинета, с
пропорциональным пересчётом цены и сроков.

### Зачем

Раньше юзер мог только купить новую подписку (с нуля по полной цене) — невозможно было перейти
с дешёвого тарифа на дорогой за разницу, или наоборот без потери оставшихся дней. Теперь:

- **Upgrade** (Basic → Pro): юзер платит **только разницу** за оставшийся срок
- **Downgrade** (Pro → Basic): срок **увеличивается** (конвертация кредита в дни)
- **Swap** (тот же tier, другие планы — например Pro-EU → Pro-US): пересчёт если цены разные

### Как работают tier'ы

Каждый тариф имеет:
- `tier` (число) — уровень иерархии. 0 = Trial, 1+ = платные
- `tier_label` (строка) — human-readable: "Basic" / "Pro" / "Premium"
- `sort_order` (число) — порядок внутри одного tier (для UI)
- `color` (hex) — цветовая метка для карточек

**5 пресетов** в форме редактирования (можно кастомизировать):
- Tier 0 — Trial — серый
- Tier 1 — Basic — cyan
- Tier 2 — Pro — синий
- Tier 3 — Premium — фиолетовый
- Tier 4 — Ultimate — оранжевый

### Расчёт смены тарифа

```
daysLeft     = осталось дней до expires_at
dailyOld     = price_monthly_old / 30
dailyNew     = price_monthly_new / 30

refundCredit = daysLeft × dailyOld   # виртуальный кредит за неисп. дни
newCost      = daysLeft × dailyNew   # стоимость нового на оставшийся срок
```

**Upgrade или swap-дороже** (`dailyNew >= dailyOld`):
```
payDifference = max(0, newCost − refundCredit)
newDaysLeft   = daysLeft  (срок не меняется при period='remaining')
```

**Downgrade или swap-дешевле** (`dailyNew < dailyOld`):
```
payDifference = 0  (никогда не доплачиваем)
newDaysLeft   = floor(refundCredit / dailyNew)  (больше дней!)
```

**Опциональный добавочный период** (period = 'monthly' / 'quarterly' / 'yearly'):
```
+30/91/365 дней по цене нового тарифа
payDifference += addCost
newDaysLeft   += addDays
```

### Гарантии при смене тарифа

- ✅ `traffic_used_gb` **сохраняется** (только лимит обновляется) — иначе можно качать → менять → ещё качать
- ✅ `activeInternalSquads` **обновляется** в RemnaWave автоматически (новые серверы становятся доступны)
- ✅ Если оплата с баланса — атомарная транзакция (rollback при сбое RemnaWave) с возвратом средств
- ✅ Если оплата через Platega — pending payment с metadata, webhook применяет смену после `completed`
- ✅ Webhook идемпотентен (тот же статус повторно — пропускается)

### UI юзера: «Сменить тариф»

`/dashboard` → секция «Подписка» → кнопка **«Сменить тариф»** (видна на активной не-trial подписке) → 3-шаговая модалка:

**Шаг 1 — Выбор тарифа.** Grid со всеми активными нон-trial тарифами. Цветные tier-badges,
подсказки upgrade/downgrade/swap, текущий тариф помечен "текущий" и недоступен для выбора.

**Шаг 2 — Выбор периода.** 4 варианта:
- «Только разница за оставшиеся дни» — срок не меняется, доплачиваем разницу
- «+30 дней с пересчётом»
- «+91 день с пересчётом»
- «+365 дней с пересчётом»

**Шаг 3 — Оплата.** Live-расчёт с детализацией:
- Тип операции (upgrade/downgrade/swap) с цветной плашкой
- Кредит за неиспользованные дни
- Стоимость нового на оставшийся срок
- Стоимость доп. периода (если выбран)
- **Итого к оплате**
- Новый срок (`expires_at`)
- Способ оплаты — баланс (если хватает) или Platega gateway
- Если payDifference == 0 — кнопка «Применить бесплатно» без оплаты

### UI админа: новый дизайн `/admin/plans`

**Карточный grid** с группировкой по tier:
- Каждая группа — отдельный заголовок с tier-цветом + кол-вом тарифов
- Карточки тарифов с верхней цветной полосой (по tier color)
- Дополнительные badges: `trial`, `paused`
- Цена за месяц крупно + цены за квартал/год мелко
- Stats row: ГБ трафика, кол-во серверов, кол-во features
- Кнопки: «Изменить» / Pause/Play / Удалить

**Drag-and-drop** для tier и sort_order:
- Перетаскиваешь карточку из одной группы в другую → меняется `tier`
- Перетаскиваешь внутри одной группы → меняется `sort_order`
- Бэкенд endpoint `POST /api/plans/reorder` обновляет несколько строк за одну транзакцию

**Форма редактирования** — двухколоночный layout:

**Левая колонка** — форма с группами:
- **Основное** — название, tier_label, описание, флаг trial
- **Уровень тарифа** — 5 пресетов tier (визуальные карточки) + кастомные tier/sort_order/color
- **Цены** — три поля с авто-расчётом скидок (3 мес, год)
- **Лимит трафика**
- **Сервера/Squads** — multiselect с чекбоксами из RemnaWave
- **Возможности** — tag-input

**Правая колонка** — `PlanPreviewCard` в реальном времени:
- Цвет акцента из выбранного tier preset
- Цена крупным шрифтом
- Все features
- Иконки серверов/трафика
- Бейджи trial/tier

### Добавлено в API

```
POST /api/plans/reorder           — bulk-обновление tier/sort_order
POST /api/subscriptions/calculate-change   — preview расчёта (без побочных эффектов)
POST /api/subscriptions/change             — apply (balance|gateway)
```

### Чек-лист для админа после обновления

- [ ] Зайти в `/admin/plans` — старые тарифы должны иметь tier=0 по умолчанию
- [ ] Назначить tier'ы своим тарифам через «Изменить» (или drag-and-drop)
- [ ] Проверить порядок отображения на публичной странице `/pricing`
- [ ] Зарегистрировать тестового юзера → купить базовый тариф → попробовать сменить на Pro в Dashboard
- [ ] Убедиться что в RemnaWave обновились `activeInternalSquads` после смены

### Backwards compatibility

- Существующие тарифы получают `tier=0`, `sort_order=0`, `color=NULL` — продолжают работать как обычно
- Существующие подписки получают `plan_id` через backfill (matching по `plan_name`)
- Старый flow покупки тарифа (создать новую подписку через `/api/payments/create`) не затронут

---

## Squad Quotas — per-server лимиты + авто-отключение

Дополнительный контур контроля поверх существующих лимитов RemnaWave (которые работают
**только глобально на пользователя**). Каждый тариф может задать лимит ГБ на каждый из
своих squad'ов отдельно. Cron мониторит, отключает, восстанавливает.

### Зачем

Бизнес-кейс: например, тариф "Pro" (200 ГБ общий) включает 5 серверов. Без squad-quota
юзер может **выкачать все 200 ГБ через один сервер** — что нагружает один кластер
несоразмерно. Со squad-quota можно: "по 40 ГБ на каждый сервер, итого 200". Если юзер
прокачал 40 ГБ на сервере DE-1 — этот сервер автоматически отключается (squad убирается
из его `activeInternalSquads`), но остальные 4 продолжают работать.

### Как работает

```
   Cron tick (каждые N мин — настраивается)
            │
            ▼
   Для каждой active-подписки:
   ├─ resolve squad→nodes mapping (через intersect inbound UUIDs, кеш 10 мин)
   ├─ getUserBandwidthStats(uuid, period_start, today) — per-node трафик
   ├─ Сложить per-node bytes по squad'ам
   ├─ Upsert subscription_squad_state.used_bytes
   └─ enforce:
       ├─ used > 100% AND !disabled → disable + remove squad from RW + notify
       ├─ used <= 100% AND disabled → reactivate + add squad back to RW + notify
       └─ used >= warn% AND !warned_80_at → warning notify + mark warned
```

### Mapping squad ↔ nodes (важный нюанс)

RemnaWave **не отдаёт прямой mapping** squad → nodes. Мы выводим его через **intersect inbound UUIDs**:
- Squad имеет `inbounds[]` (получаем через `/api/internal-squads/{uuid}`)
- Каждая нода имеет `configProfile.activeInbounds[]` (получаем через `/api/nodes/{uuid}`)
- Если node.activeInbound.uuid входит в squad.inbounds[].uuid → нода относится к squad'у

Кешируем результат на 10 минут (`resolveSquadNodeMap()` в [`services/squadQuota.js`]).

### Период сброса

Настраивается в админке `/admin/traffic-guard` → Settings → раздел Squad Quotas:
- **`calendar_month`** (default) — сбрасывается 1 числа каждого месяца. period_key = `'2026-04'`
- **`subscription_period`** — окно 30 дней с момента активации подписки. period_key = `'2026-04-15'`

При наступлении нового периода cron автоматически создаёт **новые `subscription_squad_state` rows** —
все squad'ы реактивируются, used_bytes начинают с нуля.

### Покупка доп. трафика юзером

В Dashboard → подписка → секция «Лимиты по серверам» → на каждой карточке кнопка **«Купить +ГБ»**:

- Открывается `TopupTrafficModal` с **двумя режимами**:
  - **Flexible** (default) — slider + ручной ввод 1-1000 ГБ
  - **Packs** — фиксированные кнопки 10/25/50/100/250 ГБ
  - Выбор делает админ в settings (`squad_topup_mode`)
- Live-расчёт цены: `gb × ₽/ГБ`
  - **Цена** берётся из `plan_squad_limits.topup_price_per_gb` если задана, иначе из `traffic_guard_settings.squad_topup_default_price`
- Способ оплаты — **баланс** (мгновенно, atomic transaction) или **Platega gateway** (создаёт pending payment типа `squad_traffic_topup`, webhook применяет)
- При успехе: `extra_gb += gb_amount`, если был `is_disabled` — auto-reactivate, журнал в `squad_traffic_purchases`

### Купленный трафик сгорает в конце периода

Это сознательный выбор (как у мобильных операторов). Если хотите перенос — в `squadQuota.runScan` логику ресета можно расширить.

### Admin: ручное управление

В `/admin/users/:id` → таб **Трафик** → секция **Squad Quotas**:

- Карточка на каждый squad с прогресс-баром, used/total, состоянием
- **«Восстановить»** — manual reactivate даже если usage > limit (audit log)
- **«Сброс счётчика»** — обнулить `used_bytes` за текущий период (если ошиблись с лимитом)
- **«Подарить ГБ»** — модалка ввода кол-ва GB и заметки. Бесплатно от админа, source=`admin_gift`, audit log

История покупок и подарков отображается ниже — за последние 50 операций.

### Admin: установка лимитов в тарифе

В `/admin/plans` → редактирование тарифа → выбираешь squad'ы → ниже появляется секция **«Лимиты per-squad (опционально)»**:

Для каждого выбранного squad'а:
- **Лимит ГБ** — 0 = без per-squad лимита (только общий из плана)
- **Цена ₽/ГБ override** — оставить пустым = берём из settings
- **Разрешить покупку доп.** — toggle

Сохранение тарифа автоматически синхронизирует `plan_squad_limits` через `PUT /api/plans/:id/squad-limits` (bulk).

### Чек-лист после включения

- [ ] В `/admin/traffic-guard` → Settings → раздел **Squad Quotas** включить тумблер
- [ ] Выбрать стратегию периода (`calendar_month` рекомендую)
- [ ] Выставить дефолтную цену ₽/ГБ
- [ ] В одном тарифе — задать `limit_gb` на 1-2 squad'а для теста
- [ ] Подождать первый cron tick (или перезапустить backend — он стартует немедленно после)
- [ ] У тестового юзера должна появиться секция «Лимиты по серверам» в Dashboard
- [ ] Прокачать > limit → squad должен отключиться
- [ ] Купить доп. трафик → squad должен реактивироваться

### Backwards compatibility

- По умолчанию `squad_quota_enabled = FALSE` — фича выключена пока не включишь
- Существующие тарифы получают пустой `plan_squad_limits` — лимиты не применяются
- Существующие подписки не получают `subscription_squad_state` пока cron не зашёл — никаких side-effects

---

## Email Confirmation flow

Расширение существующей системы подтверждения email (которая ранее работала только для регистрации) — теперь покрывает уже зарегистрированных юзеров и даёт админу полный контроль.

### Что нового

| Компонент | Где |
|---|---|
| Re-confirmation banner в Dashboard для юзеров с `email_confirmed=false` | [`frontend/src/components/EmailConfirmBanner.jsx`] |
| `POST /auth/send-confirmation-code` (для авторизованного юзера) | [`backend/routes/auth.js`] |
| `POST /auth/confirm-email` — подтверждение кодом | [`backend/routes/auth.js`] |
| `PUT /api/admin/users/:id/email-confirmed` — admin toggle | [`backend/routes/admin-users.js`] |
| Stat-card «Без подтверждения email» в `/admin` overview | [`frontend/src/pages/AdminOverview.jsx`] |
| Toggle email_confirmed в карточке юзера → таб «Профиль» | [`frontend/src/pages/AdminUserCard.jsx`] |
| `unconfirmedEmails` в `/api/admin/stats` | [`backend/routes/admin-stats.js`] |
| `email_confirmed=false` авто-сбрасывается при смене email юзером | [`backend/routes/api.js`] |

### Sync в RemnaWave

При **подтверждении email** или **привязке Telegram** аккаунта — fire-and-forget update RW user для всех его активных подписок, чтобы в RemnaWave-панели тоже отображались актуальные `email` / `telegramId`.

### Документация SMTP

Отдельный файл [`docs/EMAIL_SETUP.md`](EMAIL_SETUP.md) — пошаговые инструкции для:
- **Yandex Mail** (рекомендуется для РФ)
- **Mail.ru**
- **Gmail** (с предупреждением про РФ-блокировки)
- **Transactional-сервисы**: Resend, Postmark, SendGrid, Mailgun, Brevo
- **Свой домен** через Yandex 360 или transactional

Включает troubleshooting (`535 Auth failed`, `ETIMEDOUT`, app passwords), лимиты провайдеров, проверку `nc -zv smtp.X:465`.

---

## RemnaWave Metadata Sync

Теперь подписка в RemnaWave содержит **полный набор метаданных** юзера, и они синхронизируются автоматически при изменениях.

### Стабильный username `userweb_<8 цифр>`

Раньше: `userweb_{user_id}` — предсказуемо, легко перебирается, выдаёт количество регистраций. Теперь: 8 случайных цифр (вероятность коллизии ~1e-8 при 100M юзерах), хранится в `users.remnwave_username` один раз и переиспользуется во всех будущих подписках того же юзера.

| Что | Где |
|---|---|
| Migration: `users.remnwave_username VARCHAR(50) UNIQUE` | в `0003_release_v0.1.5` |
| `services/remnwaveUsername.js`: `generate8Digits`, `getOrCreateUsername`, `resolveUsernameForUser`, `getRemnwaveMetadata` | [`backend/services/remnwaveUsername.js`] |
| Backwards compat: legacy `userweb_<id>` юзеры детектятся в RW и backfill'атся в `users.remnwave_username` | в `resolveUsernameForUser()` |

### Email и Telegram передаются в RW

При создании / обновлении подписки → `email` (если `email_confirmed=true`) и `telegramId` (если `users.telegram_id` задан) автоматически передаются в `createRemnwaveUser`/`updateRemnwaveUser`. Юзер увидит свои контакты в RemnaWave-панели в карточке подписки.

При **подтверждении email** или **привязке Telegram** — push-update в RW для активных подписок (см. главу выше).

### HWID Device Limit per plan

| Что | Где |
|---|---|
| Migration: `plans.hwid_device_limit INTEGER NULLABLE` (NULL = без лимита) | в `0003_release_v0.1.5` |
| Поле «Лимит устройств (HWID)» в форме редактирования тарифа | [`frontend/src/components/PlanForm.jsx`] |
| Sync при создании / смене подписки / изменении плана | [`backend/services/payment.js`], [`backend/services/planSync.js`] |

### Plan Sync Service

Когда админ меняет `squad_uuids`, `traffic_gb` или `hwid_device_limit` в плане → fire-and-forget `syncPlanToSubscriptions(planId)` обновляет всех активных юзеров с этим планом в RemnaWave. С уважением к **squad-quota disabled state** — отключённые за overage squad'ы не реактивируются sync'ом.

| Что | Где |
|---|---|
| `services/planSync.js`: `syncPlanToSubscriptions`, `needsSync` | [`backend/services/planSync.js`] |
| Авто-trigger из `PUT /api/plans/:id` если изменились ключевые поля | [`backend/routes/plans.js`] |
| Manual trigger `POST /api/plans/:id/resync-subscriptions` | [`backend/routes/plans.js`] |

---

## Dashboard: подключённые устройства

Новый раздел в `/dashboard` → таб «Подписка» — список активных устройств юзера с возможностью удаления.

| Что | Где |
|---|---|
| `GET /api/subscriptions/devices` — список устройств активной подписки + лимит | [`backend/routes/subscriptions.js`] |
| `DELETE /api/subscriptions/devices/:hwid` — удалить устройство | [`backend/routes/subscriptions.js`] |
| `DevicesSection.jsx` — UI: иконка платформы, модель, ОС, user-agent, дата подключения, кнопка удаления | [`frontend/src/components/DevicesSection.jsx`] |

### Что отображается

Для каждого устройства показываем поля которые отдаёт RemnaWave HWID-API:
- `hwid` — UUID устройства
- `platform` — Windows / Android / iOS / Linux / macOS
- `osVersion` — например `10_10.0.19045`
- `deviceModel` — например `DESKTOP-6R0D30L_x86_64`
- `userAgent` — User-Agent VPN-клиента (`Happ/2.9.0/Windows/...`)
- `createdAt` — когда устройство впервые подключилось

### Индикация лимита

- Счётчик `N / limit` в заголовке секции
- Жёлтый баннер если N == limit («Достигнут лимит — удалите одно из существующих»)
- Красный баннер если N > limit (overage — крайне редко, может быть после migration)

---

## Брендинг

| Что | Где |
|---|---|
| Favicon: глобус + замочек в cyan→blue gradient | [`frontend/public/favicon.svg`] |
| Logo: геральдический щит с буквой V (фэнтези стиль) | [`frontend/public/logo.svg`] |
| Авто-fallback в шапке: `config.site_logo_url \|\| '/logo.svg'` | [`frontend/src/App.jsx`] |
| `support_email` / `support_telegram` теперь выводятся в footer + Maintenance | [`frontend/src/App.jsx`], [`frontend/src/components/MaintenanceGate.jsx`] |
| Адаптивные настройки в админке (favicon/logo URL): дефолт = проектные иконки, hint с размерами | [`frontend/src/components/TemplateBuilder.jsx`] |

---

## Прочие фиксы

### `authFetch` — Content-Type автоматически

[`frontend/src/services/api.js`] — добавлен auto-header `Content-Type: application/json` если в `options.body` есть string. **Фикс silent 400** на `calculate-change` и других POST-запросах: без header'а Express body-parser возвращал `req.body = {}`.

### Rate limiters подняты

| Limiter | Было / 15min | Стало / 15min |
|---|---|---|
| `globalLimiter` | 300 | 1000 |
| `adminLimiter` | 100 | 500 |
| `paymentLimiter` | 30 | 300 |

### Прогресс-бары трафика

`Math.round((used / limit) * 100)` округлял `0.19% → 0%`, и бар получал `width: 0%` (невидимый). Теперь:
- Точный raw% для CSS-ширины
- В тексте: `≥1` → целое число, `0 < % < 1` → «<1%», `0` → «0»
- `minWidth: 4-6px` гарантирует видимую полоску при низком потреблении

### `/api/subscriptions/my` — live данные из RemnaWave

Раньше отдавало `traffic_used_gb` из БД (обновлялось только cron'ом раз в 24 часа → юзер всегда видел старое). Теперь — live-fetch `userTraffic.usedTrafficBytes` из RW с in-memory кешем 60 сек на uuid.

### `/api/subscriptions/traffic-history` — daily breakdown из RW

Раньше отдавало точки из `subscription_traffic_snapshots` (одна точка в сутки → пустой график у новых юзеров). Теперь — `bandwidth-stats/users/{uuid}` с дневной разбивкой за весь период (7/30/90 дней). Fallback на snapshots если RW недоступен.

### Dashboard: новый порядок секций

| # | Секция |
|---|---|
| 1 | Карточка тарифа (название, дни, прогресс трафика, кнопка «Сменить тариф») |
| 2 | Подключённые устройства (новое) |
| 3 | Потребление трафика (график) |
| 4 | Ссылка подписки + кнопка «Подключить VPN» |
| ~~5~~ | ~~«Серверная группа»~~ — удалено как избыточное |

### Migration consolidation

После итераций фиксов в одной разработке у нас накопилось 6 миграций (`0003_ip_ban` … `0008_subscription_traffic_decimal`). Все они объединены в **одну** [`0003_release_v0.1.5`] для будущих установок — три миграции вместо девяти. dev-инстансы получили UPDATE `schema_migrations` (стирание старых записей + INSERT новой с актуальной SHA-256).

---

## Upgrade-path с v0.1.4

### 1. Pull
```bash
cd /opt/vpnwebhome
git pull origin main
git checkout v0.1.5
```

### 2. Migrations
```bash
cd backend
node scripts/migrate.js up
# Применит ОДНУ объединённую миграцию:
#   0003_release_v0.1.5
# (содержит все 6 промежуточных шагов: ip_ban, ssh+p2p, plan_tiers,
#  squad_quotas, remnwave_metadata, decimal_traffic)
```

### 3. ENV
В `backend/.env` добавить (опционально, если будете использовать SSH-агент):

```env
TRAFFIC_AGENT_SSH_USER=traffic-agent
TRAFFIC_AGENT_SSH_PORT=22
TRAFFIC_AGENT_SSH_PRIVATE_KEY_PATH=/path/to/key
```

### 4. Restart backend

```bash
docker compose restart backend  # или ваш аналог
```

В логах должно появиться:
```
[TrafficGuard] watchdog started
[P2PDetector] watchdog started
```

### 5. Что **не** включается автоматически

Все три фазы по умолчанию **выключены** (default `enabled=FALSE`):
- `ip_ban_enabled` — выключен
- `ssh_lookup_enabled` — выключен
- `p2p_detect_enabled` — выключен

Это значит после обновления ничего не меняется в поведении — нужно **сознательно** включить
каждую фазу в `/admin/traffic-guard` → Settings.

### Backwards compatibility

- Существующие violations / banned данные сохраняются.
- Старые лимиты в `node_traffic_limits` работают как раньше (поле `block_torrents` default `FALSE`).
- Конфиг `traffic_guard_settings` сохраняется (новые колонки получают defaults).

---

## Privacy / юридические моменты

В корне репо лежит [`docs/privacy-policy-draft.md`](privacy-policy-draft.md) — draft Privacy Policy
для ручной интеграции. Перед публикацией его нужно:

- [ ] Заменить плейсхолдеры (`YOUR_DOMAIN`, `YOUR_LEGAL_ENTITY`)
- [ ] Согласовать с юристом
- [ ] Создать страницу `/p/privacy-policy` (через лендинги в админке)
- [ ] Заменить footer-link `«Политика»` на эту страницу
- [ ] В Register.jsx добавить чекбокс «Согласен с обработкой моего IP-адреса»

### Что важно знать

1. **IP — это персональные данные** (по 152-ФЗ и GDPR). Хранение требует:
   - Legal basis — у нас «legitimate interest» (защита от злоупотреблений)
   - Согласие пользователя при регистрации (явный checkbox)
   - Retention policy — IP в `banned_ips` хранятся пока активен бан, после — удаляются
   - Право на удаление по запросу

2. **Phase 1** хранит IP при каждой регистрации **постоянно** (как часть аккаунта). Это требует
   явного согласия в форме регистрации.

3. **Phase 2** не хранит IP массово — только on-demand при нарушении или ручном запросе админа.
   Сохраняется только если есть violation.

4. **Phase 3** не хранит каждое торрент-подключение — только агрегаты `count` в violations
   (Xray уже отбросил BT через blackhole).

5. **Маркетинг ↔ реальность**: если на сайте написано «no-logs» — это **противоречит** хранению
   IP. Перепроверь маркетинговые тексты.

---

## Troubleshooting

### Phase 1: IP-bans

**Симптом:** Юзер попал в blocked, но `client_ips` пустой
- ❓ `ip_ban_enabled` выключен в Settings — включи
- ❓ У юзера `users.registration_ip = NULL` (зарегся до v0.1.5) — нужно вручную проставить или дождаться нарушения с Phase 2 SSH-lookup

**Симптом:** Регистрация с забаненного IP проходит
- ❓ Backend не перезапущен после миграции — рестарт
- ❓ `req.ip` не передаётся правильно — проверь `app.set('trust proxy', 1)` в backend/index.js (если за nginx)

**Симптом:** Авто-cleanup не убирает истёкшие IP
- TrafficGuard tick происходит раз в `cron_interval_minutes` (default 15). Если хочется быстрее — нажми «Запустить проверку лимитов».

### Phase 2: SSH-агент

**Симптом:** «Проверить SSH на нодах» возвращает `ok: false` для всех
- ❓ `TRAFFIC_AGENT_SSH_PRIVATE_KEY[_PATH]` не задано в `.env` — добавь и перезапусти backend
- ❓ Backend не имеет сетевого доступа к ноде по 22 — проверь firewall

**Симптом:** SSH работает, но `lookup` возвращает пусто
- ❓ Юзер не подключался к этой ноде в окне (по умолчанию 1 час). Увеличь окно.
- ❓ Xray пишет лог не туда (проверь `LOG_PATH` в `access-log-query.sh`)
- ❓ Volume для xray-logs не смонтирован — `docker compose exec remnawave-node ls /var/log/xray` должно показать файл

**Симптом:** `log_not_readable: ...`
- chmod на access.log: `sudo setfacl -m u:traffic-agent:r-- /opt/remnawave-node/xray-logs/access.log`

**Симптом:** `Permission denied (publickey)`
- В `authorized_keys` неправильный формат (нет `command="..."`) или права не 600

### Phase 3: P2P-детекция

**Симптом:** P2P-скан работает, но `users:0` всегда
- ❓ В RemnaWave не настроен routing-rule — посмотри `[torrent-block]` в access.log на ноде:
  ```bash
  sudo grep "torrent-block" /opt/remnawave-node/xray-logs/access.log | head
  ```
  Если пусто — Xray не блокирует BT (rule не работает) → проверь sniffing + routing
- ❓ `block_torrents` выключен у всех нод в табе «Лимиты по нодам»
- ❓ Юзер использует другие протоколы (UDP-trackers без HTTP — Xray sniffing их не ловит)

**Симптом:** Слишком много false-positives
- Увеличь `torrent_attempts_threshold` (default 5 → 20)
- Увеличь `p2p_scan_interval_minutes` чтобы данные накапливались дольше

**Симптом:** Действие `disable_user` не применилось
- Смотри `notes` violation — там JSON с результатом `applyResult`
- Возможно RemnaWave API не отвечает — проверь логи backend

---

## FAQ

**Q: Можно ли использовать только Phase 1 без SSH-агента?**
A: Да. Phase 1 работает независимо. Просто IP будет только из `users.registration_ip` (без SSH-lookup настоящих).

**Q: Что если у меня одна нода и я не хочу ставить SSH-агент?**
A: Не включай Phase 2 (`ssh_lookup_enabled = false`). Phase 1 будет банить registration_ip — этого достаточно для защиты от ре-регистрации.

**Q: Phase 3 без Phase 2 будет работать?**
A: Нет. P2P-детекция читает access.log через тот же SSH-агент. Phase 3 требует Phase 2 настроенной.

**Q: Можно ли проверить IP юзера руками без блокировки его?**
A: Да. В карточке юзера → таб **Трафик** → кнопка **«Получить реальный IP»**. Это on-demand SSH-запрос, никаких записей в БД не создаёт.

**Q: Юзер за CGNAT (1 IP = много людей). Что будет?**
A: Если этот IP был забанен — все остальные с того же CGNAT-IP не смогут зарегаться. Это **проблема** IP-банов в принципе. Решение: ставь короткий `ip_ban_duration_hours` (например, 24-48), чтобы CGNAT-сосед не страдал вечно.

**Q: Что если RemnaWave недоступен?**
A: Traffic Guard tick пропустит проверку (запишет `last_check_status='error'`). После восстановления — продолжит работать. IP-баны не зависят от RemnaWave (хранятся локально), middleware на регистрацию работает всегда.

**Q: Я случайно забанил легитимного юзера — что делать?**
A: `/admin/traffic-guard` → таб **«Заблокированные»** или **«Бан по IP»** → найти запись → 🗑 «Снять бан». Manual unblock также снимет связанный IP-бан.

**Q: Xray-конфиг с torrent-block может что-то сломать?**
A: Может **случайно** заблокировать легитимные приложения, использующие p2p (BitTorrent для лицензионных раздач, IPFS, некоторые игры). Тестируй на одной ноде сначала. Эти ноды можно пометить `block_torrents=false` в админке если хочешь оставить P2P там.

**Q: Сколько хранятся данные?**
A:
- `users.registration_ip` — до удаления аккаунта
- `traffic_violations` — навсегда (журнал, не чистится)
- `banned_ips` (auto) — до разблокировки + до `expires_at`
- `banned_ips` (manual) — до удаления админом
- Access.log Xray — определяется ротацией Xray (по умолчанию никакая, можно настроить logrotate)

---

## Что дальше (потенциальные следующие фичи)

Не реализовано в v0.1.5, но идеи на будущее:

- **Sidecar-агент** на нодах для realtime-стриминга всех подключений (не on-demand). Даст полную аналитику, но сильно повышает privacy/legal weight.
- **GeoIP enrichment** — показывать страну/ASN рядом с IP в админке для контекста
- **CGNAT-detection** — не банить IP если он в известных CGNAT-блоках
- **API для пользователя** «удалить мой IP из логов» — соответствие GDPR
- **Дашборд P2P-аналитики** — топ-нарушителей, графики, паттерны
- **Whitelist IP** — есть `banned_ips`, можно добавить `whitelisted_ips` (которые никогда не банятся)
- **Webhook на blocked-events** — для интеграции с Telegram-ботом, Slack и т.д.

---

**Конец документа.** Если что-то непонятно или нужна доработка — открывай Issue в [GitHub](https://github.com/Liliya2002/REMNAWAVE_WEBHOME) или пиши в support.
