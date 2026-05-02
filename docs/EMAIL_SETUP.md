# Подключение почты (SMTP) — Yandex / Mail.ru / Gmail

Полная инструкция по настройке отправки писем из проекта **vpnwebhome**. Используется для:

- Подтверждения email при регистрации (6-значный код)
- Восстановления пароля (ссылка на сброс)
- Уведомлений Traffic Guard (warning при 80%, blocked при 100%)
- Уведомлений Squad Quotas (исчерпание лимита, восстановление сервера)
- Системных писем

---

## Содержание

1. [Что уже готово в проекте](#что-уже-готово-в-проекте)
2. [Что нужно от вашего сервера](#что-нужно-от-вашего-сервера)
3. [Yandex (рекомендую для РФ)](#yandex)
4. [Mail.ru](#mailru)
5. [Gmail](#gmail)
6. [Включение тумблера в админке](#включение-тумблера-в-админке)
7. [Проверка отправки](#проверка-отправки)
8. [Troubleshooting](#troubleshooting)
9. [Лимиты провайдеров](#лимиты-провайдеров)
10. [Альтернативы — transactional-сервисы](#альтернативы)
11. [Использование своего домена](#использование-своего-домена)

---

## Что уже готово в проекте

Не нужно ничего писать руками — **вся инфраструктура уже работает**:

| Компонент | Где |
|---|---|
| SMTP-клиент через `nodemailer` | [`backend/services/email.js`](../backend/services/email.js) |
| Генерация 6-значных кодов + TTL 10 мин + max 5 попыток | `email_verifications` table |
| Rate-limit 60 сек на повторную отправку на тот же email | в `sendVerificationCode()` |
| `POST /auth/send-code` — отправка кода для регистрации | [`backend/routes/auth.js`](../backend/routes/auth.js) |
| `POST /auth/register` — проверяет `emailCode` если включено в `site_config` | [`backend/routes/auth.js`](../backend/routes/auth.js) |
| Отправка ссылки восстановления пароля | `sendPasswordResetEmail()` |
| Универсальная функция нотификаций | `sendNotificationEmail()` |
| HTML-шаблон письма (dark theme + brand) | внутри `email.js` |
| UI на странице регистрации | [`frontend/src/pages/Register.jsx`](../frontend/src/pages/Register.jsx) |
| Тумблер «Требовать подтверждение email» в админке | `/admin/settings` → таб «Проект» |

**Что нужно сделать вам:**
1. Получить SMTP-креды у провайдера
2. Прописать их в `backend/.env`
3. Перезапустить backend
4. Включить тумблер в админке

---

## Что нужно от вашего сервера

### 1. Открытые исходящие порты

Backend подключается к SMTP-серверу провайдера — нужен исходящий доступ к одному из портов:

| Порт | Тип | Когда использовать |
|---|---|---|
| **465** | SMTPS (SSL с самого начала) | Yandex, Mail.ru, Gmail |
| **587** | STARTTLS (открытое подключение → переключение на TLS) | Gmail (классика), резерв для всех |
| **25** | Plain SMTP | **Не используем** — большинство хостеров блокируют, спам-prone |

Большинство VPS-хостеров (Hetzner, Vultr, AWS, DigitalOcean, Aeza, TimeWeb) **разрешают** 465/587 по умолчанию. Дешёвые/shared-хостинги иногда блокируют.

### Проверка с сервера

```bash
# С backend-сервера (под пользователем приложения)
nc -zv smtp.yandex.ru 465 && echo "✓ Yandex 465 OK"
nc -zv smtp.mail.ru 465 && echo "✓ Mail.ru 465 OK"
nc -zv smtp.gmail.com 587 && echo "✓ Gmail 587 OK"
```

Должно вернуть `Connection to ... succeeded` (или аналогичное). Если **timeout** — пишите в поддержку хостера, чтобы открыли. Обычно открывают за 1 час по запросу.

### 2. Корректный DNS

`smtp.yandex.ru`, `smtp.mail.ru`, `smtp.gmail.com` должны резолвиться. По умолчанию работает на любом нормальном Linux. Если не резолвится — проверьте `/etc/resolv.conf`.

### 3. Никаких MTA / postfix / exim

Backend — **SMTP-клиент**, не сервер. Свой почтовый сервер на машине **не нужен**. Если случайно стоит и слушает 25-й порт — отключите, чтобы не было лишней атак-поверхности:

```bash
sudo systemctl stop postfix && sudo systemctl disable postfix
sudo systemctl stop exim4   && sudo systemctl disable exim4
```

---

## Yandex

**Рекомендую для РФ.** Бесплатно для личного `@yandex.ru` адреса. ~500 писем/день.

### Шаг 1. Создать почтовый ящик

Если ещё нет — зарегистрируйтесь на [mail.yandex.ru](https://mail.yandex.ru). Рекомендую **отдельный** ящик типа `noreply.vpnwebhome@yandex.ru` чтобы не смешивать с личной почтой.

### Шаг 2. Включить 2FA

Без 2FA пароли приложений недоступны.

1. Открыть [id.yandex.ru/security](https://id.yandex.ru/security)
2. «Двухфакторная аутентификация» → **Включить**
3. Привязать телефон и приложение Яндекс.Ключ (или Google Authenticator)

### Шаг 3. Создать пароль приложения

1. [id.yandex.ru/security/app-passwords](https://id.yandex.ru/security/app-passwords)
2. **Создать новый пароль**
3. Выбрать **«Почта»**
4. Имя: `vpnwebhome backend`
5. Скопировать **16-значный пароль БЕЗ ПРОБЕЛОВ**

⚠️ Пароль показывается **один раз**. Если потеряли — придётся создавать новый.

### Шаг 4. Прописать в `backend/.env`

```env
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply.vpnwebhome@yandex.ru
SMTP_PASS=xxxxxxxxxxxxxxxx
SMTP_FROM=noreply.vpnwebhome@yandex.ru
```

> `SMTP_USER` и `SMTP_FROM` должны **совпадать** для бесплатного аккаунта Яндекса. Иначе письма не уйдут.

### Шаг 5. Перезапустить backend

```bash
docker compose restart backend
# или вручную:
pkill -f "node index.js"
cd backend && node index.js &
```

В логах должно быть тихо (никаких ошибок про SMTP при старте).

---

## Mail.ru

Аналогично Яндексу. Бесплатно для `@mail.ru` / `@inbox.ru` / `@list.ru` / `@bk.ru`.

### Шаг 1. Создать ящик

[mail.ru](https://mail.ru) → регистрация. Рекомендую отдельный ящик: `noreply.vpnwebhome@mail.ru`.

### Шаг 2. Включить 2FA

1. **Настройки** → **Безопасность** → **Двухфакторная аутентификация**
2. Привязать телефон, подтвердить SMS-кодом

### Шаг 3. Создать пароль приложения

1. **Настройки** → **Безопасность** → **Пароли для внешних приложений**
2. **Добавить пароль**
3. Имя: `vpnwebhome backend`
4. Скопировать пароль (одноразово!)

### Шаг 4. Прописать в `backend/.env`

```env
SMTP_HOST=smtp.mail.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply.vpnwebhome@mail.ru
SMTP_PASS=xxxxxxxxxxxxxxxx
SMTP_FROM=noreply.vpnwebhome@mail.ru
```

### Шаг 5. Перезапустить backend

Как в инструкции Яндекса.

---

## Gmail

Хорош для **зарубежной аудитории**. Доставляемость отличная. Бесплатно ~500 писем/день.

> ⚠️ **Внимание для РФ-юзеров:** Google периодически блокирует SMTP-доступ из России. Если backend стоит на VPS в РФ — Gmail может не работать. Для VPS вне РФ (EU/US) — работает стабильно.

### Шаг 1. Создать аккаунт Google

Если ещё нет — [accounts.google.com/signup](https://accounts.google.com/signup). Рекомендую отдельный аккаунт `noreply.vpnwebhome@gmail.com`.

### Шаг 2. Включить 2FA

1. [myaccount.google.com/security](https://myaccount.google.com/security)
2. **Двухэтапная аутентификация** → Включить
3. Подтвердить через SMS / Authenticator

### Шаг 3. Создать App Password

1. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (открывается только если 2FA включена)
2. **Select app** → **Mail**
3. **Select device** → **Other** → имя `vpnwebhome backend`
4. **Generate** → скопировать 16-значный пароль (форматом `xxxx xxxx xxxx xxxx`)
5. **При вставке в .env удалить пробелы**

### Шаг 4. Прописать в `backend/.env`

Gmail работает на двух портах одинаково — выбирайте 465 (рекомендую):

```env
# Вариант 1: SSL/SMTPS (рекомендую)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply.vpnwebhome@gmail.com
SMTP_PASS=xxxxxxxxxxxxxxxx
SMTP_FROM=noreply.vpnwebhome@gmail.com

# Вариант 2: STARTTLS (если 465 заблокирован)
# SMTP_PORT=587
# SMTP_SECURE=false
```

### Шаг 5. Перезапустить backend

Как выше.

---

## Включение тумблера в админке

После того как SMTP настроен и backend перезапущен:

1. Открыть `/admin/settings`
2. Таб **«Проект»** или **«Безопасность»** (зависит от версии)
3. Найти чекбокс **«Требовать подтверждение email»**
4. Поставить галочку ✅
5. **Сохранить**

После этого:
- На `/register` появится поле «Код подтверждения» и кнопка «Отправить код»
- Без валидного кода регистрация не пройдёт (будет ошибка `Требуется код подтверждения email`)
- Существующие зарегистрированные юзеры могут логиниться без подтверждения (поле `users.email_confirmed=false` ничего не блокирует — только новые регистрации)

---

## Проверка отправки

### Способ 1. Прямой тест из node

```bash
cd backend
node -e "
const e = require('./services/email');
e.sendVerificationCode('your-real-email@example.com').then(r => console.log(r))
"
```

Ожидаемое:
- В консоли `{ ok: true }`
- На `your-real-email@example.com` за 5-30 секунд приходит письмо с темой **«Код подтверждения — Guard VPN»** и 6-значным кодом

Если **ошибка** — см. [Troubleshooting](#troubleshooting).

### Способ 2. Через API

```bash
# С любой машины
curl -X POST http://localhost:4000/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"your-real-email@example.com"}'
```

Ожидаемое: `{"ok":true,"message":"Код отправлен на email"}`

### Способ 3. Полный flow в браузере

1. Включить тумблер в админке (см. выше)
2. Открыть `/register` (как новый юзер — лучше в incognito)
3. Ввести email
4. Нажать **«Отправить код»**
5. Проверить почту (включая папку **«Спам»**!)
6. Ввести код, заполнить форму, зарегистрироваться

---

## Troubleshooting

### `535 Authentication failed` / `535 Login failure`

Неверный логин или app-password.

- **Проверь:** `SMTP_USER` это полный email (`name@yandex.ru`), не просто `name`
- **Проверь:** `SMTP_PASS` без пробелов и без кавычек
- **Перегенерируй app-password** (старый мог быть скомпрометирован или истёк)
- **Yandex:** убедись что 2FA реально включена

### `Connection timeout` / `ETIMEDOUT`

Порт заблокирован хостером или сетью.

- Проверь `nc -zv smtp.yandex.ru 465` с самого backend-сервера
- Если timeout — пиши в поддержку хостера: «прошу разрешить исходящие подключения на порты 465 и 587»
- Альтернатива: использовать transactional-сервис (Resend / Postmark) который ходит по HTTPS-API на порту 443 (его никто не блокирует)

### `EAUTH` или `Username and Password not accepted`

- **Gmail:** возможно пытаешься использовать обычный пароль вместо App Password — это не работает с 2024 года
- **Mail.ru:** возможно не активирован «доступ внешним приложениям» в настройках безопасности

### `Self-signed certificate` / `unable to verify`

- Установи `SMTP_SECURE=true` для порта 465
- Или `SMTP_SECURE=false` для порта 587 (тогда STARTTLS произойдёт автоматически)

### Письмо ушло, но не пришло (даже не в спам)

- Проверь что **отправитель** в письме — это **тот же** email что в `SMTP_USER` (для Yandex/Mail.ru это обязательно для бесплатных аккаунтов)
- Проверь логи backend: `docker compose logs backend | grep -i smtp` — там видны ошибки отправки

### Письмо ушло в спам

- Это **нормально** для первых писем с нового аккаунта (репутация низкая, прогревается за 1-2 недели)
- Для значительного улучшения: используй свой домен с SPF/DKIM/DMARC (см. ниже)
- Тестовому юзеру попроси добавить отправителя в контакты

### Rate-limit 60 сек

- Это **наша** защита от спама — не баг
- Один email может получать код не чаще раза в минуту
- Можно поправить в `services/email.js` если очень нужно

---

## Лимиты провайдеров

| Провайдер | Писем/день (free) | Писем/час | Размер | Получателей в письме |
|---|---|---|---|---|
| **Yandex** | ~500 | ~150 | 30 МБ | 30 |
| **Mail.ru** | ~500 | ~150 | 25 МБ | 30 |
| **Gmail** | 500 | ~100 | 25 МБ | 100 |

Для **подтверждения регистрации** этого с большим запасом (даже 100 регистраций/день — это 100 писем). Для **массовых рассылок** — нужен платный план или transactional-сервис.

---

## Альтернативы

Для серьёзного продакшна с >500 писем/день рекомендую **transactional email service**. Они работают по HTTPS-API (их никто не блокирует), отлично доставляются, дают аналитику.

| Сервис | Free quota | Цена дальше | Где |
|---|---|---|---|
| **Resend** | 3,000 / мес, 100/день | $20/мес = 50K | resend.com |
| **Postmark** | 100 в месяц для теста | $15/мес = 10K | postmarkapp.com |
| **SendGrid** | 100/день навсегда | $19.95/мес = 50K | sendgrid.com |
| **Mailgun** | 1,000/мес 1-й месяц | $35/мес = 50K | mailgun.com |
| **Brevo** (бывш. Sendinblue) | 300/день навсегда | €19/мес = 20K | brevo.com |

Все они работают как **SMTP relay** — то есть в `.env` просто меняется хост/логин/пароль, код проекта переписывать не надо. Например, для Resend:

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=re_your_api_key_here
SMTP_FROM=noreply@yourdomain.com
```

---

## Использование своего домена

Для отправки от `noreply@yourdomain.com` (а не от `@yandex.ru`) есть два пути:

### Путь 1. Yandex 360 для бизнеса (платно)

- Подключить домен в Yandex 360
- Цена: ~189₽/мес/пользователь (минимум 1)
- Прописать в DNS своего домена `MX`, `SPF`, `DKIM`, `DMARC` (Yandex даст готовые значения)
- Создать ящик `noreply@yourdomain.com`
- В `.env` использовать его

### Путь 2. Transactional-сервис (Resend / Postmark / SendGrid)

- Все они дают возможность отправлять с любого вашего домена после **верификации**
- Верификация = добавить TXT-запись в DNS
- Free tier обычно достаточный для регистрации
- Не зависит от РФ-блокировок

### Путь 3. Без своего домена (быстрый старт)

- Просто отправляй с `@yandex.ru` адреса
- В письме `From:` будет `noreply.vpnwebhome@yandex.ru`
- Доставляемость — нормальная
- Никаких DNS-настроек

**Я бы советовал Путь 3 для старта**, переход на свой домен — когда юзеров станет 100+ и репутация будет важна.

---

## Чек-лист после настройки

- [ ] Создан отдельный почтовый ящик (не личный)
- [ ] Включена 2FA в аккаунте провайдера
- [ ] Создан и сохранён App Password
- [ ] Прописан в `backend/.env` (без пробелов в пароле)
- [ ] `SMTP_USER` и `SMTP_FROM` совпадают (для Yandex/Mail.ru)
- [ ] Перезапущен backend
- [ ] `nc -zv smtp.PROVIDER:PORT` отвечает «succeeded»
- [ ] Тестовая отправка через `node -e "..."` возвращает `{ ok: true }`
- [ ] Письмо реально пришло (включая спам)
- [ ] Включён тумблер «Требовать подтверждение email» в админке
- [ ] Прошёл тестовую регистрацию в incognito

---

## Что дальше

После того как почта работает — её можно использовать в:

1. **Регистрация** — уже включается тумблером (см. выше)
2. **Восстановление пароля** — на `/forgot-password` уже работает (если SMTP настроен)
3. **Уведомления Traffic Guard** — `/admin/traffic-guard` → Settings → ✅ Email-уведомления
4. **Уведомления Squad Quotas** — тот же тумблер email
5. **Системные нотификации** — например, уведомление об истечении подписки

Если возникнут проблемы — смотрите [Troubleshooting](#troubleshooting) выше или открывайте Issue в GitHub.
