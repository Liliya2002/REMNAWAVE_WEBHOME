# Подтверждение Email при регистрации

## Что изменилось

При регистрации теперь требуется подтвердить email 6-значным кодом. Форма стала двухшаговой:

1. Пользователь заполняет логин, email, пароль → нажимает «Получить код на email»
2. На почту приходит код → пользователь вводит его → аккаунт создаётся с `email_confirmed = true`

## Настройка SMTP

Добавьте в `backend/.env` реальные данные почтового сервера:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com
```

### Примеры для разных провайдеров

**Gmail** (нужен «Пароль приложения» → https://myaccount.google.com/apppasswords):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

**Yandex**:
```
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_SECURE=true
```

**Mail.ru**:
```
SMTP_HOST=smtp.mail.ru
SMTP_PORT=465
SMTP_SECURE=true
```

## Миграция БД

Если таблица ещё не создана:

```bash
psql -h 127.0.0.1 -p 5433 -U root -d vpn_webdb -f backend/db_email_verification.sql
```

## Изменённые файлы

| Файл | Что изменилось |
|------|----------------|
| `backend/services/email.js` | Новый сервис отправки кодов через SMTP |
| `backend/routes/auth.js` | + `POST /auth/send-code`, регистрация требует `emailCode` |
| `backend/db_email_verification.sql` | Таблица `email_verifications` |
| `frontend/src/pages/Register.jsx` | 2-шаговая форма с вводом кода |
| `frontend/src/services/auth.js` | + функция `sendEmailCode()`, `register()` принимает `emailCode` |
| `backend/.env` | + SMTP-переменные |

## API

### POST /auth/send-code
Отправляет код на email. Не требует авторизации.

```json
{ "email": "user@example.com" }
```
Ответ: `{ "ok": true, "message": "Код отправлен на email" }`

Rate-limit: 1 запрос / 60 сек на один email.

### POST /auth/register (обновлён)
Теперь требует поле `emailCode`:

```json
{
  "login": "username",
  "email": "user@example.com",
  "password": "Pass1234",
  "emailCode": "123456",
  "referralCode": "опционально"
}
```

## Защита

- Код действует 10 минут
- Максимум 5 попыток ввода, потом код аннулируется
- Повторная отправка не чаще 1 раза в 60 секунд
- Старые коды удаляются при генерации нового
