# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# deploy-runner — отдельный сервис для запуска deploy.sh с UI.
#
# В контейнере должны быть:
#   - node (для server.js)
#   - docker-cli + compose plugin (deploy.sh использует 'docker compose ...')
#   - git (deploy.sh делает git fetch / checkout)
#   - bash, curl, wget (для smoke-теста)
#
# Project (с deploy.sh + .env + git репо) монтируется как volume в /project.
# Docker socket монтируется в /var/run/docker.sock.
# ─────────────────────────────────────────────────────────────────────────────

FROM docker:27-cli-alpine3.20

ARG VERSION=0.0.0-dev
ARG BUILD_SHA=
ARG BUILD_DATE=

LABEL org.opencontainers.image.title="vpnwebhome-deploy-runner" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${BUILD_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# В docker:27-cli-alpine3.20 уже есть docker-cli и docker-cli-compose.
# Добавляем node, git, bash и tini.
RUN apk add --no-cache nodejs npm git bash tini curl wget

WORKDIR /app

# Только server.js — никаких зависимостей не ставится (npm install не нужен)
COPY package.json server.js ./

ENV NODE_ENV=production \
    RUNNER_PORT=4100 \
    PROJECT_DIR=/project

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - --tries=1 --timeout=2 http://127.0.0.1:4100/healthz > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
