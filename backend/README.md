# Backend

Express API с интеграцией Remnwave API для управления VPN серверами и соединениями.

Endpoints:
- `POST /auth/register` — регистрация (body: { email, password })
- `POST /auth/login` — логин (body: { email, password }) -> { token }
- `GET /api/status` — статус сервера
- `GET /api/me` — текущий пользователь (требует Bearer token)
- `GET /servers` — список VPN-серверов (из Remnwave API или заглушки)
- `GET /servers/:id` — получить информацию о сервере и конфигурацию
- `GET /servers/:id/config` — получить конфигурацию подписки (требует токен)
- `GET /subscriptions/plans` — список тарифов
- `POST /subscriptions/subscribe` — подписка на тариф
- `GET /connections` — текущие соединения пользователя (требует токен)
- `POST /connections` — создать новое соединение (требует токен)
- `DELETE /connections/:id` — закрыть соединение (требует токен)

Remnwave API интеграция:
- URL конфигурируется через `REMNWAVE_API_URL` env var (по умолчанию https://api.remnawave.com)
- Токен аутентификации: `REMNWAVE_API_TOKEN` env var
- Если Remnwave API недоступен, используются mock-данные

.env файл:
```
PORT=4000
JWT_SECRET=your_secret_here
REMNWAVE_API_URL=https://api.remnawave.com
REMNWAVE_API_TOKEN=your_token_here
REMNWAVE_SECRET_KEY=cookie_key:cookie_value
```

Параметры:
- `REMNWAVE_API_TOKEN` — токен аутентификации API
- `REMNWAVE_SECRET_KEY` — опционально, для cookie-авторизации в формате `key:value`

Запуск:
```
cd backend
npm install
node index.js
```

Docker:
```
docker build -t vpn-backend:latest -f Dockerfile .
docker run -p 4000:4000 -e REMNWAVE_API_TOKEN=your_token vpn-backend:latest
```
