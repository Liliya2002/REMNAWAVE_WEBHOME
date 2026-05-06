# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Frontend image для vpnwebhome (Vite SPA + nginx)
# ─────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

ARG VITE_API_URL=
ARG VITE_TELEGRAM_BOT_NAME=
ARG VERSION=0.0.0-dev
ARG BUILD_SHA=
ARG BUILD_DATE=

WORKDIR /app

# Зависимости отдельным слоем — для кеша
COPY package.json package-lock.json* ./
RUN npm ci

# Исходники
COPY . .

# Прокидываем версию в Vite-сборку как VITE_-переменные (фронт сможет их прочитать через import.meta.env)
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_TELEGRAM_BOT_NAME=${VITE_TELEGRAM_BOT_NAME} \
    VITE_VERSION=${VERSION} \
    VITE_BUILD_SHA=${BUILD_SHA} \
    VITE_BUILD_DATE=${BUILD_DATE}

RUN npm run build


# ─── Stage 2: nginx serve ──────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

ARG VERSION=0.0.0-dev
ARG BUILD_SHA=
ARG BUILD_DATE=

LABEL org.opencontainers.image.title="vpnwebhome-frontend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${BUILD_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# Свой nginx config для SPA-фолбэка (history-mode роутинг)
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Статика
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Healthcheck: nginx отдаёт index.html
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - --tries=1 --timeout=2 http://127.0.0.1:80/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
