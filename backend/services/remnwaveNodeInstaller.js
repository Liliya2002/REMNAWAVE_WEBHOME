/**
 * Автоматическая установка Remnawave Node на VPS через SSH.
 *
 * Что делает:
 *   1. Коннект по SSH (паролем или ключом из vps_servers)
 *   2. Проверяет docker — если нет, ставит через get.docker.com
 *   3. Создаёт /opt/remnawave-node/{docker-compose.yml, .env}
 *   4. docker compose pull + up -d
 *   5. Открывает APP_PORT в ufw / firewalld (если есть)
 *   6. Health-check: контейнер running
 *
 * Архитектурно:
 *   - Job-store (in-memory Map) хранит активные установки. Каждая job — это
 *     поток логов через EventEmitter. Стираются через 1 час после завершения.
 *   - SSH-команды стримим построчно через `exec(stream)` — каждая строка stdout/stderr
 *     летит как событие 'log' в EventEmitter, и через SSE на фронт.
 *   - Если backend перезапустится во время установки — job теряется. Это
 *     допустимо для редкой операции; при retry установка идемпотентна.
 *
 * Зависит от:
 *   - vps_servers.{ip_address, ssh_user, ssh_port, ssh_password, ssh_key}
 *   - services/encryption.js — для расшифровки ssh_password / ssh_key
 *
 * Не зависит от Remnawave API напрямую — sslCert и appPort передаются вызывающим.
 */
const { Client } = require('ssh2')
const { EventEmitter } = require('events')
const crypto = require('crypto')
const db = require('../db')
const { decrypt } = require('./encryption')

// ─── Job store ───────────────────────────────────────────────────────────────

/**
 * Map<jobId, Job>. Job:
 *   { id, vpsId, nodeUuid, status: 'running'|'success'|'failed',
 *     logs: [{ ts, level, line }],
 *     emitter: EventEmitter (события 'log', 'done'),
 *     finishedAt?: Date }
 *
 * Subscribers (SSE-клиенты) присоединяются через emitter.on('log'/'done').
 */
const jobs = new Map()
const JOB_TTL_MS = 60 * 60 * 1000  // 1 час после завершения — потом GC

function createJob({ vpsId, nodeUuid }) {
  const id = crypto.randomBytes(8).toString('hex')
  const job = {
    id,
    vpsId,
    nodeUuid,
    status: 'running',
    logs: [],
    emitter: new EventEmitter(),
    startedAt: new Date(),
  }
  // EventEmitter по дефолту warning'ает после 10 listeners. Установка может
  // подписать SSE-клиента, потом юзер открыл вторую вкладку — еще один.
  job.emitter.setMaxListeners(50)
  jobs.set(id, job)
  return job
}

function getJob(jobId) {
  return jobs.get(jobId)
}

function pushLog(job, line, level = 'info') {
  const entry = { ts: Date.now(), level, line: String(line || '').replace(/\r?\n$/, '') }
  job.logs.push(entry)
  job.emitter.emit('log', entry)
}

function finishJob(job, status, error) {
  job.status = status
  job.finishedAt = new Date()
  if (error) job.error = String(error.message || error)
  job.emitter.emit('done', { status, error: job.error })
  // GC через TTL
  setTimeout(() => { jobs.delete(job.id) }, JOB_TTL_MS).unref?.()
}

// ─── SSH-config из vps_servers ───────────────────────────────────────────────

async function loadVpsSshConfig(vpsId) {
  const r = await db.query(
    `SELECT id, name, ip_address, ssh_user, ssh_port, ssh_password, ssh_key, status
       FROM vps_servers WHERE id = $1`,
    [vpsId]
  )
  if (r.rows.length === 0) throw new Error(`VPS #${vpsId} не найден в БД`)
  const v = r.rows[0]
  if (!v.ip_address) throw new Error(`У VPS «${v.name}» не указан ip_address`)

  // ssh_password / ssh_key хранятся зашифрованными через encrypt()
  let password, privateKey
  try { if (v.ssh_password) password = decrypt(v.ssh_password) } catch {}
  try { if (v.ssh_key) privateKey = decrypt(v.ssh_key) } catch {}

  if (!password && !privateKey) {
    throw new Error(`У VPS «${v.name}» не настроен ни SSH-пароль, ни ключ. Задай в /admin/vps.`)
  }

  return {
    name: v.name,
    host: v.ip_address,
    port: v.ssh_port || 22,
    username: v.ssh_user || 'root',
    password, privateKey,
  }
}

// ─── SSH exec helpers ────────────────────────────────────────────────────────

/**
 * Открывает SSH-коннект, держит его открытым до closeWhenDone(true) или ошибки.
 * Возвращает Promise<Client> когда соединение готово.
 */
function openConnection(sshConfig, { readyTimeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { conn.end() } catch {}
      reject(new Error(`SSH ready timeout after ${readyTimeout}ms`))
    }, readyTimeout)

    conn.once('ready', () => {
      if (settled) return
      settled = true; clearTimeout(timer)
      resolve(conn)
    })
    // ВАЖНО: постоянный (on, не once) обработчик ошибок. ssh2 может эмитить
    // 'error' повторно и уже ПОСЛЕ settle (напр. при обрыве во время exec).
    // Без слушателя такой 'error' = unhandled → падение всего процесса.
    conn.on('error', (err) => {
      if (settled) {
        console.warn('[NodeInstaller] SSH error after settle:', err.message)
        try { conn.end() } catch {}
        return
      }
      settled = true; clearTimeout(timer)
      reject(err)
    })

    conn.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      password: sshConfig.password || undefined,
      privateKey: sshConfig.privateKey || undefined,
      readyTimeout,
      // tryKeyboard позволяет авторизацию keyboard-interactive с паролем — некоторые VPS
      keepaliveInterval: 5000,
    })
  })
}

/**
 * Выполнить shell-команду через уже открытый client'ом.
 * Каждая строка stdout/stderr → onLine(level, line).
 * Возвращает { code, stdout, stderr }.
 */
function execStreaming(conn, command, { onLine, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`exec timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    conn.exec(command, (err, stream) => {
      if (err) {
        if (settled) return
        settled = true; clearTimeout(timer)
        return reject(err)
      }

      let stdoutBuf = '', stderrBuf = ''
      const flushLines = (buf, level) => {
        const parts = buf.split(/\r?\n/)
        const incomplete = parts.pop() // последняя — возможно неполная
        for (const ln of parts) {
          if (ln !== '' && onLine) onLine(level, ln)
        }
        return incomplete
      }

      stream.on('data', d => {
        stdout += d.toString()
        stdoutBuf += d.toString()
        stdoutBuf = flushLines(stdoutBuf, 'info')
      })
      stream.stderr.on('data', d => {
        stderr += d.toString()
        stderrBuf += d.toString()
        stderrBuf = flushLines(stderrBuf, 'warn')
      })
      stream.on('close', (code) => {
        if (settled) return
        settled = true; clearTimeout(timer)
        // Финальные incomplete-куски
        if (stdoutBuf && onLine) onLine('info', stdoutBuf)
        if (stderrBuf && onLine) onLine('warn', stderrBuf)
        resolve({ code, stdout, stderr })
      })
    })
  })
}

// ─── Шаблоны файлов на VPS ───────────────────────────────────────────────────

const COMPOSE_YML = `services:
  remnawave-node:
    image: remnawave/node:latest
    container_name: remnawave-node
    hostname: remnawave-node
    restart: always
    network_mode: host
    env_file:
      - .env
`

function buildEnvFile(appPort, sslCert) {
  // SSL_CERT — длинная base64-строка. Кладём в кавычках — bash не любит спецсимволы
  return `APP_PORT=${appPort}\nSSL_CERT="${sslCert}"\n`
}

// ─── Bash-скрипт установки ───────────────────────────────────────────────────

/**
 * Идемпотентный скрипт. Запускается через `bash -s` со stdin (компактнее чем
 * пихать всё одной командой). Все шаги логируются с префиксом [STEP] чтобы
 * фронт мог их парсить и подсвечивать.
 */
function buildInstallScript({ appPort, sslCert }) {
  const envContent = buildEnvFile(appPort, sslCert)
  // base64 — самый надёжный способ передать многострочные файлы через bash без проблем с экранированием
  const envB64 = Buffer.from(envContent, 'utf8').toString('base64')
  const composeB64 = Buffer.from(COMPOSE_YML, 'utf8').toString('base64')

  return `#!/bin/bash
set -euo pipefail

log() { printf '[STEP] %s\\n' "$1"; }
err() { printf '[ERR ] %s\\n' "$1" 1>&2; }

# 1. Docker
log "Проверка docker"
if ! command -v docker >/dev/null 2>&1; then
  log "Docker не найден, устанавливаю через get.docker.com"
  if ! command -v curl >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq curl
  fi
  curl -fsSL https://get.docker.com | sh
  log "Docker установлен"
else
  log "Docker уже установлен: $(docker --version)"
fi

# 2. Docker Compose v2
if ! docker compose version >/dev/null 2>&1; then
  log "Docker Compose v2 не найден, ставлю плагин"
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin || true
fi

# 3. Создаём директорию и файлы
log "Создаю /opt/remnawave-node"
mkdir -p /opt/remnawave-node
cd /opt/remnawave-node

echo '${composeB64}' | base64 -d > docker-compose.yml
echo '${envB64}' | base64 -d > .env
chmod 600 .env

# 4. Pull image (отдельно от up чтобы фронт видел прогресс загрузки)
log "Загружаю образ remnawave/node:latest"
docker compose pull

# 5. Up
log "Запускаю контейнер"
docker compose up -d --force-recreate

# 6. Firewall — ufw
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  log "ufw активен — открываю порт ${appPort}/tcp"
  ufw allow ${appPort}/tcp >/dev/null
fi

# 7. Firewall — firewalld (RHEL/CentOS)
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  log "firewalld активен — открываю порт ${appPort}/tcp"
  firewall-cmd --permanent --add-port=${appPort}/tcp >/dev/null
  firewall-cmd --reload >/dev/null
fi

# 8. Health-check: дать 5 секунд и проверить что контейнер running
sleep 5
STATE=$(docker inspect -f '{{.State.Status}}' remnawave-node 2>/dev/null || echo 'not-found')
if [ "$STATE" = "running" ]; then
  log "Контейнер запущен. Жду первого подключения к панели..."
  log "OK: установка завершена"
  exit 0
else
  err "Контейнер не запустился: state=$STATE"
  docker compose logs --tail=20 remnawave-node 1>&2 || true
  exit 1
fi
`
}

// ─── Главный flow ─────────────────────────────────────────────────────────────

/**
 * Запустить установку в фоне. Возвращает jobId сразу — клиент подписывается на SSE.
 *
 * @param {object} opts
 *   - vpsId      — id из vps_servers
 *   - appPort    — порт remnawave-node-агента (default 2222)
 *   - sslCert    — SSL_CERT из GET /api/keygen Remnawave-панели
 *   - nodeUuid   — UUID созданной ноды (для записи в vps_servers.node_uuid после успеха)
 */
async function startInstallJob({ vpsId, appPort, sslCert, nodeUuid }) {
  if (!vpsId) throw new Error('vpsId обязателен')
  if (!appPort || !Number.isInteger(appPort)) throw new Error('appPort обязателен (integer)')
  if (!sslCert) throw new Error('sslCert обязателен')

  const job = createJob({ vpsId, nodeUuid })
  // Запускаем в background — не await
  runInstall(job, { vpsId, appPort, sslCert, nodeUuid }).catch(err => {
    pushLog(job, `Установка прервана: ${err.message}`, 'error')
    finishJob(job, 'failed', err)
  })
  return job
}

async function runInstall(job, { vpsId, appPort, sslCert, nodeUuid }) {
  let sshConfig
  try {
    pushLog(job, `Загружаю конфиг VPS #${vpsId}`)
    sshConfig = await loadVpsSshConfig(vpsId)
    pushLog(job, `Цель: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`)
  } catch (err) {
    return finishJob(job, 'failed', err)
  }

  let conn
  try {
    pushLog(job, 'Подключаюсь по SSH...')
    conn = await openConnection(sshConfig)
    pushLog(job, 'SSH-соединение установлено', 'success')
  } catch (err) {
    pushLog(job, `Не удалось подключиться: ${err.message}`, 'error')
    return finishJob(job, 'failed', err)
  }

  try {
    const script = buildInstallScript({ appPort, sslCert })
    // Передаём скрипт через stdin (`bash -s` тут не нужен — пишем через base64 + decode + exec)
    const b64 = Buffer.from(script, 'utf8').toString('base64')
    const wrapper = `printf '%s' '${b64}' | base64 -d | bash`

    const result = await execStreaming(conn, wrapper, {
      timeoutMs: 600_000, // 10 мин на всё про всё (включая docker pull)
      onLine: (level, line) => {
        // Префиксы [STEP], [ERR ] из bash → подсвечиваем
        if (line.startsWith('[STEP]')) pushLog(job, line.slice(7).trim(), 'step')
        else if (line.startsWith('[ERR ]')) pushLog(job, line.slice(7).trim(), 'error')
        else pushLog(job, line, level === 'warn' ? 'warn' : 'info')
      },
    })

    if (result.code !== 0) {
      pushLog(job, `Скрипт завершился с кодом ${result.code}`, 'error')
      return finishJob(job, 'failed', new Error(`Install script exited with code ${result.code}`))
    }

    // Привязываем VPS к Remnawave-ноде в нашей БД
    if (nodeUuid) {
      try {
        await db.query(
          `UPDATE vps_servers SET node_uuid = $1, updated_at = NOW() WHERE id = $2`,
          [nodeUuid, vpsId]
        )
        pushLog(job, `Привязано: vps_servers.node_uuid=${nodeUuid}`, 'success')
      } catch (err) {
        pushLog(job, `⚠ Установка прошла, но не удалось обновить связь в БД: ${err.message}`, 'warn')
      }
    }

    pushLog(job, '✅ Установка завершена успешно', 'success')
    finishJob(job, 'success')
  } catch (err) {
    pushLog(job, `Ошибка выполнения: ${err.message}`, 'error')
    finishJob(job, 'failed', err)
  } finally {
    try { conn.end() } catch {}
  }
}

// ─── Обновление ноды ──────────────────────────────────────────────────────────

/**
 * Скрипт обновления. Автоопределяет каталог (/opt/remnanode или /opt/remnawave-node),
 * делает pull → down → up -d, показывает статус и логи. Логи следим ограниченно
 * (timeout), чтобы задача завершалась, а не висела на `logs -f`.
 */
function buildUpdateScript() {
  return `#!/bin/bash
set -uo pipefail
log() { printf '[STEP] %s\\n' "$1"; }
err() { printf '[ERR ] %s\\n' "$1" 1>&2; }

DIR=""
for d in /opt/remnanode /opt/remnawave-node /opt/remnawave; do
  if [ -f "$d/docker-compose.yml" ]; then DIR="$d"; break; fi
done
if [ -z "$DIR" ]; then err "docker-compose.yml не найден (/opt/remnanode, /opt/remnawave-node, /opt/remnawave)"; exit 1; fi
log "Каталог ноды: $DIR"
cd "$DIR"

log "Текущий образ:"
docker compose images 2>/dev/null || true

log "Загружаю свежий образ (docker compose pull)"
docker compose pull

log "Останавливаю (docker compose down)"
docker compose down

log "Запускаю (docker compose up -d)"
docker compose up -d

sleep 4
STATE=$(docker inspect -f '{{.State.Status}}' remnanode 2>/dev/null || docker inspect -f '{{.State.Status}}' remnawave-node 2>/dev/null || echo 'unknown')
log "Статус контейнера: $STATE"

log "Логи (следим ~20с):"
timeout 20 docker compose logs -f --tail=40 --no-color 2>&1 || true

if [ "$STATE" = "running" ]; then
  log "OK: нода обновлена и запущена"
  exit 0
else
  err "Контейнер не в состоянии running (state=$STATE)"
  docker compose logs --tail=30 --no-color 1>&2 || true
  exit 1
fi
`
}

async function runUpdate(job, { vpsId }) {
  let sshConfig
  try {
    pushLog(job, `Загружаю конфиг VPS #${vpsId}`)
    sshConfig = await loadVpsSshConfig(vpsId)
    pushLog(job, `Цель: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`)
  } catch (err) {
    return finishJob(job, 'failed', err)
  }

  let conn
  try {
    pushLog(job, 'Подключаюсь по SSH...')
    conn = await openConnection(sshConfig)
    pushLog(job, 'SSH-соединение установлено', 'success')
  } catch (err) {
    pushLog(job, `Не удалось подключиться: ${err.message}`, 'error')
    return finishJob(job, 'failed', err)
  }

  try {
    const script = buildUpdateScript()
    const b64 = Buffer.from(script, 'utf8').toString('base64')
    const wrapper = `printf '%s' '${b64}' | base64 -d | bash`
    const result = await execStreaming(conn, wrapper, {
      timeoutMs: 600_000,
      onLine: (level, line) => {
        if (line.startsWith('[STEP]')) pushLog(job, line.slice(7).trim(), 'step')
        else if (line.startsWith('[ERR ]')) pushLog(job, line.slice(7).trim(), 'error')
        else pushLog(job, line, level === 'warn' ? 'warn' : 'info')
      },
    })
    if (result.code !== 0) {
      pushLog(job, `Скрипт завершился с кодом ${result.code}`, 'error')
      return finishJob(job, 'failed', new Error(`Update script exited with code ${result.code}`))
    }
    pushLog(job, '✅ Нода обновлена', 'success')
    finishJob(job, 'success')
  } catch (err) {
    pushLog(job, `Ошибка выполнения: ${err.message}`, 'error')
    finishJob(job, 'failed', err)
  } finally {
    try { conn.end() } catch {}
  }
}

/**
 * Запустить обновление ноды в фоне. Возвращает job (jobId для SSE-стрима).
 */
async function startUpdateJob({ vpsId }) {
  if (!vpsId) throw new Error('vpsId обязателен')
  const job = createJob({ vpsId, nodeUuid: null })
  runUpdate(job, { vpsId }).catch(err => {
    pushLog(job, `Обновление прервано: ${err.message}`, 'error')
    finishJob(job, 'failed', err)
  })
  return job
}

module.exports = {
  startInstallJob,
  startUpdateJob,
  getJob,
  // Низкоуровневые — на случай если кому-то нужны:
  loadVpsSshConfig,
  buildInstallScript,
}
