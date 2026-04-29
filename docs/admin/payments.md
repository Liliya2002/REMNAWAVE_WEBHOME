# Настройки платёжных систем

В нашем проекте по умолчанию подключена **Platega**. Этот раздел — про то, как её настроить, как добавить альтернативные системы и что проверить перед запуском в боевой режим.

## Platega

[Platega](https://platega.io) — российский эквайринг с поддержкой банковских карт и СБП.

### Получение ключей

1. Зарегистрируйся на [platega.io](https://platega.io) → пройди верификацию мерчанта.
2. Личный кабинет → **API** → **Создать новый ключ**.
3. Сохрани:
   - `MERCHANT_ID`
   - `API_KEY` (Secret)
   - `WEBHOOK_SECRET`

### Настройка backend

В `backend/.env`:

```bash
PLATEGA_MERCHANT_ID=<merchant-id>
PLATEGA_API_KEY=<secret-key>
PLATEGA_WEBHOOK_SECRET=<webhook-secret>
PLATEGA_BASE_URL=https://app.platega.io   # для прода
# PLATEGA_BASE_URL=https://sandbox.platega.io   # для тестов
```

После изменений — **рестарт backend**.

### Настройка webhook'а в кабинете Platega

- **URL**: `https://shop.cdn-yandex.top/api/payments/webhook/platega`
- **События**: `payment.success`, `payment.failed`
- **Secret**: тот же, что в `PLATEGA_WEBHOOK_SECRET`

### Тест в sandbox

1. Переключи `PLATEGA_BASE_URL` на sandbox.
2. Сделай тестовый платёж в админке → **Тарифы** → выбери план → **Купить**.
3. Должен прийти webhook → в логах backend появится:
   ```
   [Platega] payment.success orderId=<...> amount=<...>
   ```
4. Подписка пользователя автоматически активируется.

### Возможные ошибки

| Симптом | Причина | Решение |
|---|---|---|
| `401 Unauthorized` при создании платежа | Неверный API_KEY | Перепроверь ключ, убедись, что нет пробелов |
| Webhook приходит, но баланс не пополняется | Неверная подпись | Проверь `PLATEGA_WEBHOOK_SECRET` |
| Webhook не приходит | Не открыт публично | Проверь, что URL отвечает на `POST` (нужен HTTPS!) |
| Платёж в статусе "ожидание" вечно | Cron не работает | Проверь `cron/expireSubscriptions.js` |

## YooKassa (опционально)

> Не подключено по умолчанию. Если нужно — добавь интеграцию руками.

Этапы:

1. Зарегистрироваться в ЮKassa → получить `shopId` + `secretKey`.
2. Установить `@a2seven/yoo-checkout` или сделать прямые вызовы по API.
3. В `backend/services/payments.js` добавить ветку для YooKassa наряду с существующей Platega.
4. Webhook URL: `/api/payments/webhook/yookassa`.

## CryptoBot / NowPayments (для крипты)

Если нужны USDT/BTC оплаты — рекомендуется **CryptoBot** (для пользователей в Telegram) или **NowPayments** (для веб-формы).

### CryptoBot

- Создать бота через [@CryptoBot](https://t.me/CryptoBot) → `/createapp`.
- В кабинете: получить `API_TOKEN`.
- В backend: при оплате вызвать `createInvoice`, перенаправить пользователя в Telegram → после оплаты webhook вернёт статус.

### NowPayments

- Регистрация на [nowpayments.io](https://nowpayments.io).
- API ключ + IPN secret.
- Поддерживает 100+ криптовалют, есть конвертация в стейблкоины.

## Чек-лист перед запуском в боевой режим

- [ ] `PLATEGA_BASE_URL=https://app.platega.io` (не sandbox!)
- [ ] Webhook URL зарегистрирован в кабинете Platega
- [ ] HTTPS на основном домене работает (без ошибок сертификата)
- [ ] Тестовый платёж на 1₽ прошёл успешно (или vice versa — отменился через `payment.failed`)
- [ ] В админке → **Платежи** виден журнал транзакций
- [ ] Юзер после успешной оплаты получает активную подписку
- [ ] Уведомление о платеже приходит в админ-чат (если настроено)

## Что делать если платёж "застрял"

1. Админка → **Платежи** → найди транзакцию по `orderId`.
2. Открой кабинет Platega → **Транзакции** → найди тот же `orderId`.
3. Сравни статусы:
   - **У нас "ожидание", у Platega "успешно"** → не дошёл webhook. Перепроверь URL/secret. Можно вручную подтянуть статус через "Синхронизировать".
   - **У нас "успешно", у Platega "отменено"** → расхождение. Возможно был возврат. Свяжись с поддержкой Platega.
   - **У обоих "ожидание" дольше 1 часа** → пользователь не доплатил. Платёж автоматически отменится.

## Полезные ссылки

- [Platega API docs](https://platega.io/docs/api)
- [ЮKassa API](https://yookassa.ru/developers)
- [NowPayments API](https://nowpayments.io/api)
- [@CryptoBot docs](https://help.crypt.bot/crypto-pay-api)
