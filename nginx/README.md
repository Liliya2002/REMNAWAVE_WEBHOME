# Nginx + Let's Encrypt — production deploy

Чек-лист первичной выдачи TLS-сертификата (одноразовая операция).

## 0. Подготовка

Должны быть выполнены:

- DNS A-запись `${DOMAIN}` указывает на IP сервера.
- Открыты порты 80/tcp и 443/tcp на сервере (firewall, security group).
- В `.env` заданы `DOMAIN` и `CORS_ORIGINS` (см. `backend/.env.example`).

## 1. Подготовить конфиг под свой домен

```bash
# из корня проекта
DOMAIN=example.com envsubst '$DOMAIN' < nginx/conf.d/app.conf.template > nginx/conf.d/app.conf
```

Если `envsubst` нет — просто скопируйте файл и руками замените `${DOMAIN}` на ваш домен.

## 2. Запустить nginx без HTTPS-блока (только 80, для ACME challenge)

При самом первом запуске сертификата ещё нет, и nginx упадёт на `ssl_certificate`. Решение:

1. Временно закомментировать `server { listen 443 ... }` блок целиком в `nginx/conf.d/app.conf`.
2. Запустить:

```bash
docker compose up -d db backend frontend nginx
```

3. Проверить что `http://${DOMAIN}/.well-known/acme-challenge/test` отвечает 404 (а не connection refused).

## 3. Получить сертификат

```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d example.com \
  --email you@example.com \
  --agree-tos --no-eff-email
```

При успехе сертификат окажется в volume `certbot_certs` под `/etc/letsencrypt/live/example.com/`.

## 4. Включить HTTPS

1. Раскомментировать `server { listen 443 ... }` блок в `nginx/conf.d/app.conf`.
2. Перезагрузить nginx:

```bash
docker compose exec nginx nginx -s reload
```

3. Открыть `https://${DOMAIN}` — должен отвечать фронт.

## 5. (опционально) Включить HSTS

После того как HTTPS точно работает и вы готовы навсегда форсировать TLS — раскомментировать строку
`add_header Strict-Transport-Security ...` в `app.conf`.

## Auto-renew

`certbot` сервис в docker-compose проверяет обновление каждые 12 часов; nginx раз в 6 часов делает `reload` и подхватывает новые ключи. Ничего вручную делать не нужно.

## Локальная разработка

В dev режиме nginx + certbot не нужны. Используйте только `db + backend + frontend`:

```bash
docker compose up db backend
# фронт отдельно: cd frontend && npm run dev
```

В этом случае оставьте `DOMAIN=localhost` и `VITE_API_URL=http://localhost:4000`.
