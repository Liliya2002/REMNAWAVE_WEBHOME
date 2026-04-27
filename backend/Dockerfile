# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Backend image для vpnwebhome
#
# Build args (передаются из CI):
#   VERSION    — семвер из git tag (например 1.2.0). По умолчанию читается из VERSION файла.
#   BUILD_SHA  — git SHA коммита (полный)
#   BUILD_DATE — ISO 8601 дата сборки (UTC)
# ─────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: deps ─────────────────────────────────────────────────────────────
# Кешируется отдельно от исходников: меняем package.json — пересобираем зависимости
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force


# ─── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

ARG VERSION=0.0.0-dev
ARG BUILD_SHA=
ARG BUILD_DATE=

# OCI labels — стандартные метаданные для registry
LABEL org.opencontainers.image.title="vpnwebhome-backend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${BUILD_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# wget нужен для HEALTHCHECK; tini — для корректной обработки сигналов в node-процессе
RUN apk add --no-cache wget tini

WORKDIR /app

# Зависимости из deps-стейджа
COPY --from=deps /app/node_modules ./node_modules

# Исходники (учитываем .dockerignore — node_modules, .env, и т.д. не попадут)
COPY . .

# VERSION файл — services/version.js его читает на старте.
# Кладём в /VERSION чтобы версия не зависела от cwd.
COPY VERSION /VERSION

# Build-args в ENV — version.js предпочтёт их над файлом/git
ENV VERSION=${VERSION} \
    BUILD_SHA=${BUILD_SHA} \
    BUILD_DATE=${BUILD_DATE} \
    NODE_ENV=production \
    PORT=4000

# Non-root пользователь
RUN addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app

USER app

EXPOSE 4000

# Docker HEALTHCHECK: дёргает /api/health, возвращает 200 (код 0) или fail (код 1)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - --tries=1 --timeout=4 http://127.0.0.1:4000/api/health > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
