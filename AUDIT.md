# Полный аудит безопасности и качества — VPN Webhome

**Дата аудита:** 2026-04-25
**Объём:** backend, frontend, mobile (React Native), БД PostgreSQL, инфраструктура (Docker, CI/CD)
**Метод:** статический анализ кода + ревью схемы БД + анализ конфигураций

Всего найдено **~130 проблем** разной степени критичности.

| Severity | Количество |
|---|---|
| CRITICAL | 12 |
| HIGH | ~40 |
| MEDIUM | ~45 |
| LOW | ~30 |

---

## Содержание

- [Блокеры — исправить в течение 24 часов](#блокеры--исправить-в-течение-24-часов)
- [HIGH — в текущем спринте](#high--в-текущем-спринте)
- [MEDIUM — в ближайшем релизе](#medium--в-ближайшем-релизе)
- [LOW / Best Practices](#low--best-practices)
- [План действий](#план-действий)

---

## Блокеры — исправить в течение 24 часов

### Финансовые риски

#### 1. Реальные Platega credentials лежат в `backend/.env`
**Файл:** [backend/.env](backend/.env)

`PLATEGA_MERCHANT_ID` и `PLATEGA_SECRET` хранятся в открытом виде. Если репозиторий публичный или .env когда-либо попал в git — credentials скомпрометированы.

**Действия:**
- Немедленно ротировать ключи в личном кабинете Platega
- Проверить `git log --all -- backend/.env` и `git log -p -S "PLATEGA_SECRET"`
- Если файл был в git — использовать `git filter-repo` для полного удаления из истории
- Добавить pre-commit hook (`git-secrets` / `detect-secrets`)

---

#### 2. Webhook верификация подписи отключена
**Файл:** [backend/routes/webhooks.js:70-74](backend/routes/webhooks.js#L70-L74)

`VERIFY_WEBHOOKS=false` в .env → любой может прислать fake webhook и активировать подписки или зачислить баланс.

```javascript
const cfg = await getWebhookConfig()
if (cfg.verify) {
  if (!signature || !(await verifyWebhookSignature(req, signature))) {
    return res.status(401).json({ error: 'Invalid signature' })
  }
}
```

**Действия:** Установить `VERIFY_WEBHOOKS=true`, сделать проверку обязательной (без флага).

---

#### 3. Двойное зачисление баланса через webhook (topup)
**Файл:** [backend/routes/payments.js:503-621](backend/routes/payments.js#L503-L621)

Idempotency-проверка смотрит `payment.status === 'completed'`, но для TOPUP-платежей операции зачисления баланса повторяются при повторной отправке webhook с тем же ID — если между двумя webhook'ами баланс ещё не был зафиксирован в транзакции.

**Действия:**
- Добавить уникальный индекс на `provider_payment_id`
- Вся обработка webhook в одной транзакции с `FOR UPDATE`
- Отдельный флаг `webhook_processed_at` независимый от `status`

---

#### 4. Сумма в webhook не сверяется с суммой в БД
**Файл:** [backend/routes/payments.js:565](backend/routes/payments.js#L565)

Webhook может прийти с любой суммой, система не сравнивает её с ожидаемой суммой платежа из БД.

**Действия:** При приёме webhook добавить проверку `if (webhook.amount !== payment.amount) reject`.

---

#### 5. Topup: сумма из `req.body` без верхней границы
**Файл:** [backend/routes/payments.js:293-350](backend/routes/payments.js#L293-L350)

Есть нижняя граница (10 ₽), нет верхней.

```javascript
const amount = Number(req.body?.amount || 0)
if (!Number.isFinite(amount) || amount <= 0) { ... }
if (amount < 10) { ... }
// нет проверки amount > MAX
```

**Действия:** Добавить `MAX_TOPUP` (например, 100 000 ₽) + проверить на шаг/кратность.

---

#### 6. `activateSubscription` вызывается вне транзакции платежа
**Файл:** [backend/routes/payments.js:599-611](backend/routes/payments.js#L599-L611)

```javascript
await client.query('COMMIT');  // платёж зафиксирован
client.release();

if (status === 'CONFIRMED' && payment && payment.payment_type !== 'topup') {
  await activateSubscription(payment);  // может упасть
}
```

Если активация упадёт — платёж `completed`, но подписка не активирована, деньги списаны а VPN не работает.

**Действия:** Перенести активацию внутрь транзакции либо выполнять через job queue с гарантированным повтором.

---

#### 7. Self-referral — пользователь фармит бонусы сам у себя
**Файл:** [backend/routes/auth.js:138-154](backend/routes/auth.js#L138-L154)

Нет проверки `referrer_id !== new_user_id`. Пользователь создаёт второй аккаунт со своим реферкодом и получает бонусы.

**Действия:**
- Добавить проверку в код регистрации
- БД constraint: `ALTER TABLE referrals ADD CONSTRAINT ck_no_self_referral CHECK (referrer_id != referred_user_id)`

---

### Безопасность

#### 8. `ENCRYPTION_KEY` не задан → SSH-данные VPS в БД открытым текстом
**Файл:** [backend/services/encryption.js:8-26](backend/services/encryption.js#L8-L26)

```javascript
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    console.error('[SECURITY] ENCRYPTION_KEY не задан!')
    return null
  }
  return crypto.createHash('sha256').update(key).digest()
}

// В encrypt():
if (!key) return text  // fallback без шифрования
```

Все SSH-пароли и приватные ключи VPS хранятся в БД plain text. При утечке БД компрометируются все VPS.

**Действия:**
- Сгенерировать `ENCRYPTION_KEY` (`openssl rand -hex 32`)
- Добавить в .env и .env.example
- Миграция: перешифровать все существующие SSH-данные
- Убрать fallback `return text` — лучше падать, чем молча писать plain text

---

#### 9. Release APK подписан debug keystore
**Файл:** [VpnMobile/android/app/build.gradle:91-104](VpnMobile/android/app/build.gradle#L91-L104)

```gradle
signingConfig signingConfigs.debug  // в release блоке
```

Debug keystore имеет хардкод-пароль `android`. Любой может пересобрать подделанную версию приложения и распространить троянский VPN под видом вашего.

**Действия:**
- Создать отдельный release keystore
- Хранить в GitHub Secrets / защищённом месте, не в репо
- Отдельные signingConfigs для debug и release

---

#### 10. Cleartext HTTP разрешён в release Android
**Файл:** [VpnMobile/android/app/build.gradle](VpnMobile/android/app/build.gradle)

`manifestPlaceholders = [usesCleartextTraffic: "true"]` для release → все запросы можно перехватить.

**Действия:**
- `usesCleartextTraffic: false` для release
- Использовать `network_security_config.xml` для точечных исключений (только localhost для debug)

---

#### 11. JWT хранится в AsyncStorage (мобилка)
**Файл:** [VpnMobile/src/api/auth.ts:11,27](VpnMobile/src/api/auth.ts#L11)

AsyncStorage — это SharedPreferences / NSUserDefaults, читается при root/jailbreak.

**Действия:** Мигрировать на `react-native-keychain` (iOS Keychain / Android Keystore).

---

#### 12. Нет HTTPS в docker-compose
**Файл:** [docker-compose.yml](docker-compose.yml)

Backend на `:4000`, frontend (nginx) на `:80` — всё без TLS. JWT и пароли передаются в plain text.

**Действия:** Добавить nginx/traefik как reverse proxy с Let's Encrypt, редирект 80→443, HSTS.

---

## HIGH — в текущем спринте

### Backend — безопасность

- **JWT:** нет проверки минимальной длины `JWT_SECRET`, нет blacklist/revocation, TTL 8 часов. Файл: [backend/middleware.js:17-19](backend/middleware.js#L17), [backend/routes/auth.js:201](backend/routes/auth.js#L201). Сократить до 15–60 минут, добавить refresh token.
- **Нет CSRF защиты** на POST/PUT/DELETE. Если перейдёте на cookie-based auth — обязательно.
- **SSH private keys расшифровываются в память** при каждом подключении, конфиг может попасть в логи. Файл: [backend/routes/admin-vps.js:301-322](backend/routes/admin-vps.js#L301).
- **Сброс пароля слабее регистрации:** 6 символов vs 8+буквы+цифры. Файл: [backend/routes/auth.js:420-435](backend/routes/auth.js#L420).
- **X-Forwarded-For без `app.set('trust proxy')`** — IP в сессиях можно спуфить. Файл: [backend/routes/sessions.js:20](backend/routes/sessions.js#L20).
- **Rate limit in-memory** — не работает за несколькими инстансами / LB. Нужен Redis-store для `express-rate-limit`.
- **Нет structured logging** (pino/winston) — только `console.log`. Логи теряются при рестарте, нет ротации, есть утечки чувствительных данных.
- **Нет мониторинга:** ни Sentry, ни Prometheus, ни uptime checks.

### Backend — бизнес-логика

- **Нет state machine для платежей** — возможны переходы `completed → pending`, `refunded → completed`. Файл: [backend/routes/payments.js:543-557](backend/routes/payments.js#L543).
- **`is_active` подписок синхронизируется только middleware при запросе пользователя** — истёкшие подписки остаются активными в БД месяцами. Нужен cron.
- **Referral reward начисляется до подтверждения webhook** — при refund бонус не откатывается. Файлы: [backend/services/payment.js:203-214](backend/services/payment.js#L203), [backend/services/referral.js:216-319](backend/services/referral.js#L216).
- **Admin создаёт подписки/начисляет баланс без audit log** — невозможно отследить злоупотребления. Файл: [backend/routes/admin-users.js](backend/routes/admin-users.js).
- **Нет защиты от циклов в рефералах** — возможны A→B→C→A. Файл: [backend/db_referrals.sql](backend/db_referrals.sql).
- **Wallet: не все места используют `FOR UPDATE`** — race conditions при admin-операциях одновременно с платежом. Файл: [backend/routes/admin-users.js:264-302](backend/routes/admin-users.js#L264).

### Backend — инфраструктура

- **Нет backend-тестов в CI** — `echo "No tests defined"`. Файл: [.github/workflows/nodejs.yml:30](.github/workflows/nodejs.yml#L30).
- **Нет migration tool** — 15 raw SQL-файлов, порядок не документирован, нет rollback.
- **Нет backup стратегии БД** в docker-compose.

### БД (PostgreSQL)

- **Везде `TIMESTAMP` вместо `TIMESTAMPTZ`** во всех 15 таблицах → потеря TZ при миграции между серверами.
- **Нет CHECK constraints на суммы** → `payments.amount`, `wallet_transactions.amount` могут быть отрицательными.
- **Нет `CHECK (referrer_id != referred_user_id)`** в таблице `referrals`.
- **`user_sessions.token_hash` без UNIQUE** — один токен может соответствовать нескольким сессиям.
- **`password_hash VARCHAR(128)`** — мало для Argon2/scrypt (нужно 255).
- **Баг миграции:** `gen_code.code` вместо `code`. Файл: [backend/db_referral_migration.sql:14](backend/db_referral_migration.sql#L14) — миграция упадёт при запуске.
- **INSERT планов без `ON CONFLICT`** — дубли при повторном запуске. Файл: [backend/db_plans.sql:58-62](backend/db_plans.sql#L58).
- **Нет cleanup функций** для expired sessions / password_reset_tokens / email_verifications — таблицы растут бесконечно.
- **Разнородные numeric-типы для денег:** `DECIMAL(10,2)` / `NUMERIC(10,2)` / `NUMERIC(12,2)`. Унифицировать на `NUMERIC(12,2)`.

### Frontend

- **JWT в `localStorage`** (~50+ мест) — XSS приводит к краже токена. Нужны httpOnly cookies.
- **`window.location.href = '/login'` внутри async fetch** — гонки при 401. Файл: [frontend/src/services/api.js:15,30](frontend/src/services/api.js#L15).
- **`ProtectedAdminRoute` — только клиентская проверка.** UX, не security. Проверять на backend каждый admin-endpoint.
- **`PaymentSuccess`/`PaymentFailed` рендерят URL-параметры без валидации с сервера** — манипуляция статусом. Запрашивать статус у backend по payment ID.
- **`vite-plugin-obfuscator`** — малоизвестная зависимость (проверить на malicious code), агрессивная обфускация мешает debugging.
- **Устаревшие зависимости:** `lucide-react ^1.7.0`, `react-router-dom ^6.14.1` — обновить.
- **Нет ErrorBoundary** — любая рантайм-ошибка = белый экран.
- **CSP/HSTS не настроены** в nginx/Dockerfile frontend.

### Mobile (VpnMobile)

- **ProGuard/minification выключен в release** (`enableProguardInReleaseBuilds = false`) — код легко декомпилируется.
- **Нет SSL pinning** — HTTPS без pinning уязвим к MITM с подложным CA.
- **`console.log` с токенами/ошибками в production.** Файлы: [VpnMobile/src/screens/HomeScreen.tsx:24,43,46](VpnMobile/src/screens/HomeScreen.tsx#L24), [LoginScreen.tsx:26](VpnMobile/src/screens/LoginScreen.tsx#L26).
- **Hardcoded `http://10.0.2.2:4000`** — работает только на Android эмуляторе. Файл: [VpnMobile/src/api/index.ts:5](VpnMobile/src/api/index.ts#L5).
- **Почти нет тестов**, не запускаются в CI.

---

## MEDIUM — в ближайшем релизе

### Backend

- Brute-force email-кодов (6 цифр, нет rate-limit на verify). Файл: [backend/services/email.js:21-23](backend/services/email.js#L21).
- Webhook endpoint без rate-limit — DoS на verify signature. Файл: [backend/index.js:111](backend/index.js#L111).
- Реферальные коды с низкой энтропией (2⁴⁸). Файл: [backend/services/referral.js:7](backend/services/referral.js#L7).
- Bcrypt rounds: 12 при регистрации, 10 при reset — унифицировать.
- Нет проверки двойной активной подписки per user — UNIQUE constraint или `FOR UPDATE` в `activateSubscription`.
- Telegram auth: check-then-insert race. Файл: [backend/routes/auth.js:272-276](backend/routes/auth.js#L272). Использовать `INSERT ... ON CONFLICT`.
- Password reset token не привязан к IP/UA. Файл: [backend/routes/auth.js:396-399](backend/routes/auth.js#L396).
- Сброс пароля не уведомляет email.
- Синхронизация squads только вручную — нужен cron.
- Float vs Decimal в расчётах баланса — везде использовать NUMERIC или decimal.js.

### БД

- Валюта без CHECK/ENUM — можно сохранить `"FAKE_CURRENCY"`.
- Status платежей VARCHAR без CHECK — возможны невалидные статусы.
- Нет composite индексов `(user_id, is_active, created_at DESC)` — медленные dashboard-запросы.
- FK без `ON DELETE` на `admin_broadcasts`, `site_templates`, `config_history` → блокируют удаление пользователей.
- Нет soft delete consistency — у `users`/`payments` нет `deleted_at`.
- TEXT без ограничений — нужны CHECK на `LENGTH()`.
- JSONB без schema validation.

### Frontend

- **Google Analytics ID из API инжектится в `<script>`** без валидации → XSS при компрометации backend. Файл: [frontend/src/contexts/SiteConfigContext.jsx:119-126](frontend/src/contexts/SiteConfigContext.jsx#L119).
- **Custom CSS из API инжектится без санитайза** — потенциал phishing/clickjacking. Файл: [frontend/src/contexts/SiteConfigContext.jsx:103-108](frontend/src/contexts/SiteConfigContext.jsx#L103).
- Нет catch-all 404 route. Файл: [frontend/src/App.jsx:184-212](frontend/src/App.jsx#L184).
- Retry logic без exponential backoff (3с константа). Файл: [frontend/src/services/api.js:9-46](frontend/src/services/api.js#L9).
- Double-submit не защищён в topup. Файл: [frontend/src/pages/dashboard/BalanceSection.jsx:96-126](frontend/src/pages/dashboard/BalanceSection.jsx#L96).
- Telegram Widget глобальная callback на `window` — race при одновременных рендерах. Файл: [frontend/src/components/TelegramLoginButton.jsx:13-17](frontend/src/components/TelegramLoginButton.jsx#L13).
- Валидация пароля только на клиенте (Register/ResetPassword).
- Нет `autocomplete="new-password"` / `current-password` на password-полях.
- 4 параллельных запроса каждые 30с в Dashboard — объединить в один endpoint. Файл: [frontend/src/pages/Dashboard.jsx:19-32](frontend/src/pages/Dashboard.jsx#L19).

### Инфраструктура

- **Нет `.dockerignore`** в backend/frontend — риск копирования `.env` и `node_modules` в образ.
- **GitHub Actions pinned на `@v4`/`@v3`** (minor), не на patch/sha — supply chain risk.
- **Docker images только `:latest`** — нет versioning по commit/semver, нет rollback.
- **Нет healthcheck на frontend контейнере** в docker-compose.
- **Frontend Dockerfile:** нет `USER`, нет HEALTHCHECK, нет security scan.
- **Мобилка:** минимум тестов, jest.config минимален, не запускаются в CI.
- **`.gitignore` мобилки не полный** — нет `*.keystore`, `signing.properties`, `build/`.

---

## LOW / Best Practices

- API versioning (`/api/v1/`) отсутствует.
- `JSON.parse` без try/catch. Файл: [frontend/src/pages/AdminVPS.jsx:166,776](frontend/src/pages/AdminVPS.jsx#L166).
- `target="_blank"` без `rel="noopener noreferrer"` в части footer-ссылок. Файл: [frontend/src/App.jsx:242-245](frontend/src/App.jsx#L242).
- Alt-тексты пустые, нет aria-label — accessibility.
- Все строки hardcoded на русском — нет i18n.
- Error messages отдают `error.message` наружу — утечка внутренностей.
- Отсутствует Dependabot/Renovate.
- Нет OpenAPI/Swagger docs.
- `.sixth/` — пустая директория в репо, удалить или в .gitignore.
- **Корневой [package.json](package.json)** — не используется ни в docker, ни в CI, содержит mix RN+nodemailer+axios. Удалить.
- Нет SBOM (Software Bill of Materials) в CI.
- `.vscode/extensions.json` отсутствует — нет рекомендаций для команды.
- Нет docker-compose.override.yml для dev-окружения.
- VpnMobile Node.js `>=22.11.0` — очень новый, лучше LTS 20.x.

---

## План действий

### Неделя 1 — stop the bleeding

1. **Ротировать Platega credentials** + проверить git history
2. Включить `VERIFY_WEBHOOKS=true` + обязательная HMAC-проверка
3. Сгенерировать `ENCRYPTION_KEY`, перешифровать SSH-данные
4. Исправить self-referral + webhook idempotency + сверка сумм
5. Перенести `activateSubscription` в транзакцию платежа
6. Отключить cleartext HTTP в Android release, поднять release keystore
7. Поднять HTTPS через nginx/traefik + Let's Encrypt

### Неделя 2–3

8. httpOnly cookies вместо localStorage для JWT
9. Добавить backend-тесты (auth, payments, webhooks) + запуск в CI
10. Перевести SQL на migration tool (Knex / db-migrate):
    - Исправить `TIMESTAMP → TIMESTAMPTZ`
    - Добавить `CHECK (amount > 0)` на финансовые колонки
    - Унифицировать numeric-типы на `NUMERIC(12,2)`
    - `UNIQUE` на `user_sessions.token_hash`
    - Исправить баг в [db_referral_migration.sql:14](backend/db_referral_migration.sql#L14)
11. Cron для деактивации истёкших подписок
12. Audit log для admin-операций
13. Redis-store для `express-rate-limit`

### Месяц 2

14. SSL pinning + Keychain в мобилке
15. ProGuard, отдельный release keystore
16. Мониторинг (Sentry + Prometheus) + structured logging (pino)
17. DB backup (cron с pg_dump в S3/GCS)
18. State machine для платежей
19. Обновить зависимости фронта (lucide-react, react-router-dom)
20. Проверить `vite-plugin-obfuscator` на благонадёжность

### Оценка трудоёмкости

Примерно **60–80 часов работы** для закрытия CRITICAL + HIGH. MEDIUM и LOW — ещё ~80 часов, но не блокируют запуск в production после устранения критичных.

---

## Методология

Аудит проведён 5 параллельными проходами по коду:

1. Backend security (auth, JWT, encryption, SQL injection, webhooks, rate limiting, secrets)
2. Backend business logic (payments, subscriptions, referrals, Remnwave integration, concurrency)
3. БД (схема 15 таблиц, индексы, constraints, миграции, PII, финансовые данные)
4. Frontend (React + Vite, роутинг, auth, XSS, obfuscation, зависимости)
5. Infrastructure + Mobile (Docker, CI/CD, .gitignore, React Native, Android/iOS config)

Каждый проход читал реальные файлы кода, не полагался на документацию.
