# Release guide

Как выпускать обновления `vpnwebhome` после первого релиза `v0.1.0`.

Все команды локальные — для Windows `cmd.exe`. Серверные команды отдельно помечены 🖥️.

---

## TL;DR — стандартный релиз

```cmd
cd c:\myproject\vpnwebhome

REM 1. Локально проверь что всё работает (backend + frontend на dev)
REM 2. Подними версию в VERSION файле
REM    Выбери: 0.1.0 → 0.1.1 (bugfix) | 0.2.0 (feature) | 1.0.0 (breaking)

REM 3. Коммит и пуш
git add -A
git commit -m "release: v0.1.1 — описание изменений"
git push origin main

REM 4. Тег и пуш тега
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions автоматически:
- соберёт 3 Docker-образа с тегами `0.1.1`, `0.1`, `0`, `latest`, `sha-xxx`
- запушит в `ghcr.io/liliya2002/remnawave_webhome-*`
- создаст GitHub Release с auto-generated release notes

После 5-10 минут — можно деплоить на сервере 🖥️:

```bash
# на сервере /opt/vpnwebhome
sudo vpnwebhome
# Меню → 4. Обновление → 2. Обновить до версии → введи v0.1.1
```

---

## Версионирование (semver)

`MAJOR.MINOR.PATCH`

| Тип изменения | Когда | Пример |
|---|---|---|
| **PATCH** `0.1.0 → 0.1.1` | Багфиксы, мелкие правки UI, изменения в логе | Починил кнопку «Обновить» |
| **MINOR** `0.1.x → 0.2.0` | Новые фичи, backwards-совместимые | Добавил оплату Stripe |
| **MAJOR** `0.x.y → 1.0.0` | Breaking changes: удаление API, новая схема БД без миграции, смена URL | Переход на новую auth-систему |

Для предрелизов используй суффикс: `v1.0.0-rc1`, `v1.0.0-beta`. Workflow автоматически помечает их как `prerelease` на GitHub.

---

## Стандартный flow (с пояснением)

### Шаг 1. Подготовка

Перед релизом убедись что в `main` нет несохранённого мусора:

```cmd
git status
git log --oneline -5
```

Если есть локальные коммиты — это нормально, главное чтобы рабочее дерево было чистым (`git status` должен показывать `nothing to commit`).

### Шаг 2. Обнови `VERSION`

Открой [VERSION](VERSION) в корне репо и поменяй число:

```
0.1.1
```

(Без `v` префикса! Тег при пуше — `v0.1.1`, а в файле `0.1.1`.)

### Шаг 3. (опционально) CHANGELOG.md

Если ведёшь changelog — допиши секцию для новой версии:

```markdown
## v0.1.1 — 2026-04-28

### Fixed
- Кнопка «Обновить» в /admin/system теперь работает
- Корректный auto-reconnect SSE после рестарта backend

### Added
- ...
```

### Шаг 4. Коммит и пуш main

```cmd
git add VERSION CHANGELOG.md
git add -A
git commit -m "release: v0.1.1"
git push origin main
```

Это запустит билд с тегом `:edge` (для тестов на staging если есть). Подожди ~5 минут и проверь:
https://github.com/Liliya2002/REMNAWAVE_WEBHOME/actions

Все 3 job-а должны быть зелёные. Если красные — **НЕ тегируй**, сначала разберись.

### Шаг 5. Тег и пуш тега

```cmd
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions запустит ещё один билд с тегами `0.1.1`/`0.1`/`0`/`latest` и создаст Release.

Проверка:
- https://github.com/Liliya2002/REMNAWAVE_WEBHOME/actions — все green
- https://github.com/Liliya2002?tab=packages — у каждого образа должен появиться тег `0.1.1`

### Шаг 6. Deploy на сервер

🖥️ На production сервере:

```bash
sudo vpnwebhome
# Меню:
#  4. Обновление
#  → 2. Обновить до версии
#  → введи: v0.1.1
#  → подтверди
```

deploy.sh сделает: бэкап БД → checkout v0.1.1 → docker pull → миграции → restart → smoke test. На любой ошибке — авто-откат к предыдущей версии.

Альтернативно через UI — `/admin/system` → баннер «Доступно обновление» → кнопка «Обновить сейчас».

---

## Когда нужна миграция БД

Если в обновлении ты:
- Добавил новую таблицу
- Изменил колонку (тип, default, nullable)
- Добавил/удалил индекс или constraint

→ **обязательно** создай миграцию:

```cmd
cd c:\myproject\vpnwebhome\backend
npm run migrate:create -- name_of_change
```

Это создаст пару файлов в [backend/migrations/](backend/migrations/):
- `0023_name_of_change.up.sql`
- `0023_name_of_change.down.sql`

Заполни их SQL-ом, протестируй локально:

```cmd
npm run migrate:status
npm run migrate:up
```

Затем (важно!) проверь что rollback работает:

```cmd
npm run migrate:down
npm run migrate:up
```

После этого commit + push + tag по обычной схеме.

На сервере при `sudo vpnwebhome → Обновление → Обновить до версии` миграции применятся автоматически (deploy.sh вызывает `migrate up` перед рестартом backend).

---

## Hotfix flow (срочный фикс прямо в проде)

Если в проде нашли критичный баг и нужен срочный релиз без всех изменений в main:

```cmd
cd c:\myproject\vpnwebhome

REM 1. Создай hotfix-ветку от тега последнего релиза
git checkout -b hotfix/v0.1.2 v0.1.1

REM 2. Внеси минимальные правки. Закоммить.
git add -A
git commit -m "hotfix: критичный баг X"

REM 3. Подними VERSION
REM    (вручную в файле: 0.1.1 → 0.1.2)
git add VERSION
git commit -m "release: v0.1.2"

REM 4. Тег и пуш сразу
git tag v0.1.2
git push origin hotfix/v0.1.2
git push origin v0.1.2
```

GitHub Actions соберёт `:0.1.2` / `:latest`. На сервере деплоим как обычно.

После того как hotfix применён в проде — **не забудь смержить hotfix обратно в main**, иначе фикс потеряется в следующем релизе:

```cmd
git checkout main
git merge hotfix/v0.1.2
git push origin main
git branch -d hotfix/v0.1.2
git push origin --delete hotfix/v0.1.2
```

---

## Если релиз сломал прод (rollback)

🖥️ На сервере:

```bash
sudo vpnwebhome
# Меню → 4. Обновление → 3. Откат к предыдущей версии
# Введи: v0.1.0  (или другая стабильная)
```

Если миграция несовместима — выбери в меню «Восстановить БД из бэкапа» и укажи `pre-v0.1.1-*.sql.gz` (он создаётся автоматически перед каждым deploy).

CLI-альтернатива:

```bash
cd /opt/vpnwebhome
bash deploy/rollback.sh v0.1.0
# или с восстановлением БД:
bash deploy/rollback.sh v0.1.0 --restore-db /var/backups/vpn/pre-v0.1.1-*.sql.gz
```

---

## Удаление сломанного релиза

Если ты запушил тег с багом и НИКТО ещё не успел задеплоить:

```cmd
REM Удалить тег локально + на GitHub
git tag -d v0.1.1
git push origin :refs/tags/v0.1.1

REM Удалить GitHub Release (через сайт):
REM https://github.com/Liliya2002/REMNAWAVE_WEBHOME/releases → Edit → Delete

REM Удалить пакеты в ghcr.io (через сайт):
REM https://github.com/Liliya2002?tab=packages → пакет → Manage versions → 0.1.1 → Delete
```

Затем фикси код, обновляй `VERSION`, и тег **с тем же номером** (или повышай патч):

```cmd
git tag v0.1.1
git push origin v0.1.1
```

---

## Pre-release / staging тесты

Если хочешь обкатать релиз перед `latest`:

```cmd
git tag v0.2.0-rc1
git push origin v0.2.0-rc1
```

Workflow собирает образ как **prerelease** в GitHub Releases. Тег `:latest` НЕ обновляется.

🖥️ На staging-сервере деплоим явно:

```bash
sudo vpnwebhome → Обновление → Обновить до версии → v0.2.0-rc1
```

После того как rc проверен — повторяем без суффикса:

```cmd
git tag v0.2.0
git push origin v0.2.0
```

---

## Чек-лист перед каждым релизом

- [ ] Локально работает: `npm run dev` в `frontend/` + `node index.js` в `backend/`
- [ ] Локальная БД мигрирует чисто: `npm run migrate:status` показывает 0 pending
- [ ] Если есть новые миграции — `migrate:down` потом `migrate:up` отрабатывает без ошибок
- [ ] `VERSION` обновлён
- [ ] (опц.) `CHANGELOG.md` дописан
- [ ] `git status` чистый
- [ ] Прошлый релиз стабилен (нет известных регрессий)
- [ ] У сервера достаточно свободного места: `df -h /var/lib/docker /var/backups/vpn`
- [ ] Включена ветка `Read and write permissions` для GitHub Actions

---

## Частые ошибки и их фикс

### Workflow упал на push в ghcr.io: 403 Forbidden

**Причина:** `Settings → Actions → General → Workflow permissions` стоит на «Read repository contents».
**Фикс:** переключи на «Read and write permissions», Save, перезапусти workflow.

### `docker compose pull` на сервере: «manifest unknown»

**Причина:** в `.env` указана `VERSION=` несуществующая, или пакет ещё не публичный.
**Фикс:**
```bash
🖥️ # Проверь что версия существует:
curl -s https://ghcr.io/v2/liliya2002/remnawave_webhome-backend/tags/list | jq

# И что пакет публичный (если нет — сделай через настройки)
```

### Миграция упала на проде, но локально работала

**Причина:** в проде уже есть данные, которые не вписываются в новую схему (например NOT NULL без default на колонке с пустыми строками).
**Фикс:**
- Авто-откат deploy.sh уже отработал — проверь `docker compose ps` что старая версия поднята
- Допиши миграцию: добавь UPDATE для нормализации данных перед ALTER
- Тестируй на копии прод-БД локально перед следующим релизом

### Force-push в main после релиза

**Никогда** не делай `git push --force` в main после того как тег уже опубликован — это сломает истории и линки в Releases.
Если что-то поломалось — сделай новый коммит сверху и патч-релиз.

### Forgot to update VERSION

Тег `v0.1.2` запушен, но в `VERSION` всё ещё `0.1.1`. На сервере `/api/health` покажет `version: "0.1.1"`.
**Фикс:** запушь патч-релиз `v0.1.3` сразу с правильным `VERSION`. Не редактируй применённый тег.

---

## Связанные документы

- [DEPLOY.md](DEPLOY.md) — первичная установка и архитектура deploy
- [deploy/README.md](deploy/README.md) — справочник по deploy/backup/rollback скриптам
- [backend/migrations/](backend/migrations/) — все миграции БД
