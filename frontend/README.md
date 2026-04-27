# Frontend

Frontend на Vite + React + Tailwind.

Установка:

```
cd frontend
npm install
npm run dev
```

Docker build & run:

```
docker build -t vpn-frontend:latest -f Dockerfile .
docker run -p 8080:80 vpn-frontend:latest
```

Приложение будет доступно на http://localhost:8080

CI: `docker-build.yml` собирает образ frontend и backend и сохраняет их как артефакты в workflow.

Style guide and components:

- См. [frontend/design/style-guide.md](design/style-guide.md)
- Компоненты в `src/components` (Button, Hero)

