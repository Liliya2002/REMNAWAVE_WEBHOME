# VPN Webhome

Проект — каркас сайта VPN-сервиса с фронтендом на React/Vite и бэкендом на Express с интеграцией Remnwave API.

## Основное

- **Frontend**: `frontend/` (Vite, React, Tailwind, Dockerfile)
- **Backend**: `backend/` (Express, auth, Remnwave API интеграция, маршруты)
- **Remnwave API интеграция**: управление серверами, соединениями и подписками
- **CI**: GitHub Actions workflows в `.github/workflows/`

## Быстрый старт

Запуск локально (требуется Node 20+):

Frontend:
```
cd frontend
npm install
npm run dev
```

Backend:
```
cd backend
npm install
node index.js
```

После запуска:
- Frontend доступен на http://localhost:5173
- Backend доступен на http://localhost:4000

## Remnwave API

Интеграция с Remnwave для управления VPN серверами.

Для включения:
1. Установите Remnwave Panel или используйте облачный сервис
2. Настройте переменные окружения в `backend/.env`:
   ```
   REMNWAVE_API_URL=https://your-api.com
   REMNWAVE_API_TOKEN=your_token
   REMNWAVE_SECRET_KEY=cookie_key:cookie_value  # опционально
   ```
3. Перезапустите backend

Параметр `REMNWAVE_SECRET_KEY` используется для cookie-авторизации (формат `key:value`).

## Страницы

- `/` — главная страница с описанием
- `/pricing` — тарифные планы
- `/servers` — доступные VPN серверы (из Remnwave API или mock)
- `/connections` — управление активными соединениями (нужна аутентификация)
- `/dashboard` — профиль пользователя и статистика (нужна аутентификация)
- `/auth` — вход/регистрация

## Docker

Сборка образов:
```
docker build -t vpn-backend:latest -f backend/Dockerfile .
docker build -t vpn-frontend:latest -f frontend/Dockerfile .
```

Запуск backend в Docker:
```
docker run -p 4000:4000 \
  -e REMNWAVE_API_URL=https://api.com \
  -e REMNWAVE_API_TOKEN=token \
  vpn-backend:latest
```

## CI / Deploy

GitHub Actions workflows автоматически при push в main:
- `nodejs.yml` — тестирование (Node.js CI)
- `docker-build.yml` — сборка Docker образов

## Документация

- [Backend README](backend/README.md) — API endpoints
- [Frontend README](frontend/README.md) — UI компоненты
