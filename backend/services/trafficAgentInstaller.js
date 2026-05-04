/**
 * Автоматическая установка traffic-agent на ноду через SSH (этап 1).
 *
 * Что делает:
 *   1. Генерит ed25519 keypair панели один раз и хранит в site_config (encrypted private)
 *   2. Собирает bash-скрипт идемпотентной установки и запускает его как root
 *      через существующий sshExec клиента ssh2
 *   3. Сохраняет статус (installed_at, last_health) на vps_servers
 *
 * Что НЕ делает (требуется ручной шаг админа в RemnaWave-панели):
 *   - Включение xray access.log в config-profile, прикреплённом к ноде
 *
 * Один общий keypair для всех нод. Revoke = регенерация → переустановка везде.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { promisify } = require('util')
const { Client } = require('ssh2')
const db = require('../db')
const { encrypt, decrypt } = require('./encryption')

const generateKeyPair = promisify(crypto.generateKeyPair)

const AGENT_SCRIPT_PATH = path.join(__dirname, '..', '..', 'infra', 'node-agent', 'access-log-query.sh')
const AGENT_USER = 'traffic-agent'
const AGENT_KEY_COMMENT = 'traffic-agent@vpnwebhome-panel'
const SCRIPT_DEST = '/usr/local/bin/access-log-query.sh'

// ───── 1. Keypair management ─────────────────────────────────────────────────

/**
 * Возвращает keypair панели. Генерирует при первом вызове и сохраняет в site_config.
 * Public — plaintext (это безопасно), private — encrypt() через ENCRYPTION_KEY.
 */
async function ensurePanelKeyPair() {
  const r = await db.query(
    'SELECT traffic_agent_panel_public_key, traffic_agent_panel_private_key FROM site_config LIMIT 1'
  )
  const row = r.rows[0]
  if (row?.traffic_agent_panel_public_key && row?.traffic_agent_panel_private_key) {
    return {
      publicKey: row.traffic_agent_panel_public_key,
      privateKey: decrypt(row.traffic_agent_panel_private_key),
    }
  }

  // Генерим ed25519 (минимально 256-бит ключ, формат OpenSSH)
  const { publicKey, privateKey } = await generateKeyPair('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  // Конвертируем publicKey (DER) → OpenSSH формат через ssh2.utils
  // ssh2 не экспортирует utility для этого напрямую, поэтому собираем вручную.
  // ed25519 SPKI → последние 32 байта = raw key
  const rawPublic = publicKey.subarray(publicKey.length - 32)
  const opensshPublicKey = encodeOpensshEd25519PublicKey(rawPublic, AGENT_KEY_COMMENT)

  await db.query(
    `UPDATE site_config
     SET traffic_agent_panel_public_key = $1,
         traffic_agent_panel_private_key = $2
     WHERE id = (SELECT id FROM site_config LIMIT 1)`,
    [opensshPublicKey, encrypt(privateKey)]
  )

  return { publicKey: opensshPublicKey, privateKey }
}

/**
 * Кодирует raw ed25519 public key (32 байта) в OpenSSH-формат:
 *   "ssh-ed25519 AAAA<base64> comment"
 */
function encodeOpensshEd25519PublicKey(rawPublic, comment) {
  // SSH wire format: <uint32 len><data> packets
  const algorithm = Buffer.from('ssh-ed25519', 'utf8')
  const buf = Buffer.alloc(4 + algorithm.length + 4 + rawPublic.length)
  let off = 0
  buf.writeUInt32BE(algorithm.length, off); off += 4
  algorithm.copy(buf, off); off += algorithm.length
  buf.writeUInt32BE(rawPublic.length, off); off += 4
  rawPublic.copy(buf, off)
  return `ssh-ed25519 ${buf.toString('base64')} ${comment}`
}

// ───── 2. Install script builder ─────────────────────────────────────────────

function readAgentScriptContent() {
  if (!fs.existsSync(AGENT_SCRIPT_PATH)) {
    throw new Error(`Agent script not found at ${AGENT_SCRIPT_PATH}`)
  }
  return fs.readFileSync(AGENT_SCRIPT_PATH, 'utf8')
}

/**
 * Собирает идемпотентный install-скрипт. Кодируем все вложенные данные в base64,
 * чтобы не возиться с экранированием кавычек. Скрипт безопасно запускать многократно.
 */
function buildInstallScript({ scriptContent, panelPublicKey }) {
  const scriptB64 = Buffer.from(scriptContent, 'utf8').toString('base64')
  // authorized_keys строка — одна, с command-restriction
  const authLine =
    `command="${SCRIPT_DEST}",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty,restrict ${panelPublicKey}`
  const authLineB64 = Buffer.from(authLine, 'utf8').toString('base64')

  // Маркер для идемпотентного добавления: ищем по public key fingerprint
  // (сами поля могут отличаться, но base64-payload ключа уникален)
  const keyToken = panelPublicKey.split(/\s+/)[1]

  const script = [
    'set -euo pipefail',
    '',
    '# 1. Создаём system user без shell, если ещё нет',
    `if ! id -u ${AGENT_USER} >/dev/null 2>&1; then`,
    `  useradd --system --create-home --home-dir /home/${AGENT_USER} --shell /bin/bash --comment "RemnaWave traffic-agent" ${AGENT_USER}`,
    'fi',
    '',
    '# 2. Раскладываем agent-скрипт',
    `mkdir -p /usr/local/bin`,
    `printf '%s' '${scriptB64}' | base64 -d > ${SCRIPT_DEST}`,
    `chmod 0755 ${SCRIPT_DEST}`,
    `chown root:root ${SCRIPT_DEST}`,
    '',
    '# 3. Ищем установку RemnaWave Node и добавляем volume для xray-logs',
    "NODE_DIR=''",
    'for D in /opt/remnanode /opt/remnawave-node /opt/remnanode-node /root/remnanode; do',
    '  if [ -f "$D/docker-compose.yml" ]; then',
    "    if grep -qiE 'remnawave/node|remnanode' \"$D/docker-compose.yml\"; then",
    '      NODE_DIR=$D; break',
    '    fi',
    '  fi',
    'done',
    'if [ -z "$NODE_DIR" ]; then',
    '  echo "STEP_RESULT:no_node_found" >&2',
    '  exit 21',
    'fi',
    'echo "STEP_RESULT:node_dir:$NODE_DIR"',
    '',
    '# 4. Бэкап + патч docker-compose.yml — добавляем volume только если его ещё нет',
    'COMPOSE="$NODE_DIR/docker-compose.yml"',
    "TS=$(date -u +'%Y%m%d-%H%M%S')",
    'if ! grep -qE "[\'\\\"]?\\./xray-logs:/var/log/xray[\'\\\"]?" "$COMPOSE"; then',
    '  cp -a "$COMPOSE" "$COMPOSE.bak.$TS"',
    '  # Аккуратно: добавляем строку volume в первый сервис remnawave/node, после строки "volumes:"',
    '  python3 - "$COMPOSE" <<\'PYEOF\'',
    'import sys, re',
    'p = sys.argv[1]',
    "with open(p, 'r', encoding='utf-8') as f: lines = f.readlines()",
    'out = []',
    'inserted = False',
    'in_node_svc = False',
    'svc_indent = None',
    'for i, line in enumerate(lines):',
    '    out.append(line)',
    "    if not in_node_svc and re.search(r'image:\\s*\\S*(remnawave/node|remnanode)', line):",
    '        in_node_svc = True',
    "    if in_node_svc and not inserted and re.match(r'^(\\s+)volumes:\\s*$', line):",
    '        m = re.match(r\"^(\\s+)volumes:\\s*$\", line)',
    "        ind = m.group(1) + '  '",
    '        out.append(f"{ind}- ./xray-logs:/var/log/xray\\n")',
    '        inserted = True',
    "if not inserted and in_node_svc:",
    '    # services без volumes: блока — допишем в конец сервиса',
    "    out.append('    volumes:\\n')",
    "    out.append('      - ./xray-logs:/var/log/xray\\n')",
    '    inserted = True',
    "with open(p, 'w', encoding='utf-8') as f: f.writelines(out)",
    "print('inserted' if inserted else 'unchanged')",
    'PYEOF',
    '  echo "STEP_RESULT:compose_patched"',
    '  cd "$NODE_DIR"',
    '  (docker compose up -d || docker-compose up -d) >/dev/null 2>&1 || true',
    'else',
    '  echo "STEP_RESULT:compose_already_has_volume"',
    'fi',
    '',
    '# 5. Создаём директорию логов и пустой access.log если ещё нет',
    'mkdir -p "$NODE_DIR/xray-logs"',
    'touch "$NODE_DIR/xray-logs/access.log"',
    '',
    '# 6. Даём traffic-agent доступ на чтение',
    'if command -v setfacl >/dev/null 2>&1; then',
    `  setfacl -m u:${AGENT_USER}:rx "$NODE_DIR/xray-logs" 2>/dev/null || true`,
    `  setfacl -m u:${AGENT_USER}:r  "$NODE_DIR/xray-logs/access.log" 2>/dev/null || true`,
    `  setfacl -d -m u:${AGENT_USER}:r "$NODE_DIR/xray-logs" 2>/dev/null || true`,
    'else',
    '  # fallback: chgrp + chmod 750',
    `  chgrp ${AGENT_USER} "$NODE_DIR/xray-logs" 2>/dev/null || true`,
    `  chgrp ${AGENT_USER} "$NODE_DIR/xray-logs/access.log" 2>/dev/null || true`,
    '  chmod 750 "$NODE_DIR/xray-logs"',
    '  chmod 640 "$NODE_DIR/xray-logs/access.log"',
    'fi',
    '',
    '# Если LOG_PATH в скрипте отличается от реального — заменяем',
    `if [ "$NODE_DIR" != "/opt/remnanode" ]; then`,
    `  sed -i 's|/opt/remnanode/xray-logs/access.log|'"$NODE_DIR"'/xray-logs/access.log|g' ${SCRIPT_DEST}`,
    `fi`,
    '',
    '# 7. Прописываем authorized_keys (идемпотентно — по токену public key)',
    `mkdir -p /home/${AGENT_USER}/.ssh`,
    `chmod 700 /home/${AGENT_USER}/.ssh`,
    `touch /home/${AGENT_USER}/.ssh/authorized_keys`,
    `chmod 600 /home/${AGENT_USER}/.ssh/authorized_keys`,
    `if ! grep -qF '${keyToken}' /home/${AGENT_USER}/.ssh/authorized_keys; then`,
    `  printf '%s\\n' "$(printf '%s' '${authLineB64}' | base64 -d)" >> /home/${AGENT_USER}/.ssh/authorized_keys`,
    `  echo "STEP_RESULT:key_added"`,
    'else',
    `  echo "STEP_RESULT:key_already_present"`,
    'fi',
    `chown -R ${AGENT_USER}:${AGENT_USER} /home/${AGENT_USER}/.ssh`,
    '',
    '# 8. Финальная диагностика — что увидит health-check',
    `if sudo -u ${AGENT_USER} test -r "$NODE_DIR/xray-logs/access.log"; then`,
    `  echo "STEP_RESULT:log_readable_by_agent"`,
    'else',
    `  echo "STEP_RESULT:log_NOT_readable_by_agent"`,
    'fi',
    '',
    'echo "INSTALL_DONE"',
  ].join('\n')

  return script
}

function buildUninstallScript() {
  return [
    'set +e',
    `userdel -r ${AGENT_USER} 2>/dev/null || true`,
    `rm -f ${SCRIPT_DEST}`,
    `rm -rf /home/${AGENT_USER}`,
    'echo UNINSTALL_DONE',
  ].join('\n')
}

// ───── 3. SSH execution helpers ──────────────────────────────────────────────

/**
 * Запускает скрипт на ноде как root через ssh2 (sshConfig = {host, port, username, password|privateKey}).
 * Возвращает {stdout, stderr, code}.
 */
function execAsRoot(sshConfig, script, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let stdout = ''
    let stderr = ''
    let code = null
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { conn.end() } catch {}
      reject(new Error(`Install timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    conn.on('ready', () => {
      // Передаём скрипт через stdin как base64 — избегаем проблем с экранированием
      const b64 = Buffer.from(script, 'utf8').toString('base64')
      const wrapper = `printf '%s' '${b64}' | base64 -d | bash`
      conn.exec(wrapper, (err, stream) => {
        if (err) {
          if (settled) return
          settled = true; clearTimeout(timer)
          try { conn.end() } catch {}
          return reject(err)
        }
        stream.on('data', d => { stdout += d.toString() })
        stream.stderr.on('data', d => { stderr += d.toString() })
        stream.on('close', (exitCode) => {
          if (settled) return
          settled = true; clearTimeout(timer)
          code = exitCode
          try { conn.end() } catch {}
          resolve({ stdout, stderr, code })
        })
      })
    })
    conn.on('error', (err) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      reject(err)
    })

    conn.connect({
      host: sshConfig.host,
      port: sshConfig.port || 22,
      username: sshConfig.username || 'root',
      password: sshConfig.password || undefined,
      privateKey: sshConfig.privateKey || undefined,
      readyTimeout: 10000,
    })
  })
}

/**
 * Health-check через панельный приватный ключ от пользователя traffic-agent.
 * Использует уже существующий services/sshAgent.js — он читает ENV TRAFFIC_AGENT_SSH_PRIVATE_KEY.
 * Здесь делаем напрямую с ключом из БД, чтобы не зависеть от env-настройки.
 */
function execAsTrafficAgent(host, port, panelPrivateKey, command, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { conn.end() } catch {}
      reject(new Error(`Health timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          if (settled) return
          settled = true; clearTimeout(timer)
          try { conn.end() } catch {}
          return reject(err)
        }
        stream.on('data', d => { stdout += d.toString() })
        stream.stderr.on('data', d => { stderr += d.toString() })
        stream.on('close', () => {
          if (settled) return
          settled = true; clearTimeout(timer)
          try { conn.end() } catch {}
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
        })
      })
    })
    conn.on('error', (err) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      reject(err)
    })

    conn.connect({
      host, port: port || 22,
      username: AGENT_USER,
      privateKey: panelPrivateKey,
      readyTimeout: 10000,
    })
  })
}

// ───── 4. Public flows ───────────────────────────────────────────────────────

/**
 * Полный install flow для одной ноды.
 * @returns {steps, healthOk, healthMessage}
 */
async function installOnVps(vps) {
  const startedAt = Date.now()
  const baseResult = {
    ok: false,
    steps: [],
    healthOk: false,
    healthMessage: '',
    error: null,        // { code, hint }
    raw: { stdout: '', stderr: '' },
    durationMs: 0,
  }

  let publicKey, privateKey
  try {
    ({ publicKey, privateKey } = await ensurePanelKeyPair())
  } catch (e) {
    return { ...baseResult, healthMessage: e.message,
      error: { code: 'panel_keypair_failed', hint: 'Не удалось сгенерировать/прочитать keypair панели. Проверь ENCRYPTION_KEY в .env и доступ к БД.' },
      durationMs: Date.now() - startedAt,
    }
  }

  const sshConfig = {
    host: vps.ip_address,
    port: vps.ssh_port || 22,
    username: vps.ssh_user || 'root',
    password: decrypt(vps.ssh_password) || undefined,
    privateKey: decrypt(vps.ssh_key) || undefined,
  }
  if (!sshConfig.password && !sshConfig.privateKey) {
    return { ...baseResult, healthMessage: 'no_ssh_credentials',
      error: { code: 'no_ssh_credentials', hint: 'У VPS не заданы ни SSH-пароль, ни приватный ключ. Открой карточку VPS и заполни поле «SSH пароль» или «SSH ключ».' },
      durationMs: Date.now() - startedAt,
    }
  }

  const installScript = buildInstallScript({
    scriptContent: readAgentScriptContent(),
    panelPublicKey: publicKey,
  })

  let sshResult
  try {
    sshResult = await execAsRoot(sshConfig, installScript, 120000)
  } catch (e) {
    const cls = classifyError({ message: e.message })
    return { ...baseResult, healthMessage: e.message,
      error: cls || { code: 'ssh_exec_failed', hint: 'Ошибка SSH при выполнении установочного скрипта.' },
      durationMs: Date.now() - startedAt,
    }
  }

  const steps = parseSteps(sshResult.stdout)
  baseResult.steps = steps
  baseResult.raw = { stdout: sshResult.stdout.slice(-1500), stderr: sshResult.stderr.slice(-1500) }

  if (sshResult.code !== 0) {
    const cls = classifyError({
      stdout: sshResult.stdout, stderr: sshResult.stderr, code: sshResult.code,
    })
    return { ...baseResult,
      healthMessage: `Install exited with code ${sshResult.code}`,
      error: cls || { code: `exit_${sshResult.code}`, hint: 'Скрипт завершился с ошибкой. Раскрой «Подробности» чтобы увидеть stderr.' },
      durationMs: Date.now() - startedAt,
    }
  }

  // Скрипт прошёл — пробуем health через traffic-agent
  try {
    const h = await execAsTrafficAgent(vps.ip_address, vps.ssh_port || 22, privateKey, 'health')
    if (h.stdout === 'ok') {
      return { ...baseResult, ok: true, healthOk: true, healthMessage: 'ok', durationMs: Date.now() - startedAt }
    }
    const healthMsg = h.stderr || h.stdout || 'unknown'
    const cls = classifyError({ stderr: h.stderr, stdout: h.stdout })
    return { ...baseResult,
      ok: true, // скрипт-то отработал — это лишь финальная проверка
      healthOk: false,
      healthMessage: healthMsg,
      error: cls || { code: 'health_unknown', hint: 'Health-check не вернул "ok". Открой инструкцию по последнему шагу.' },
      durationMs: Date.now() - startedAt,
    }
  } catch (e) {
    const cls = classifyError({ message: e.message })
    return { ...baseResult,
      ok: true,
      healthOk: false,
      healthMessage: e.message,
      error: cls || { code: 'health_ssh_failed', hint: 'Не удалось подключиться под пользователем traffic-agent — возможно SSH-ключ ещё не применился. Подожди 10-15 секунд и нажми «Перепроверить».' },
      durationMs: Date.now() - startedAt,
    }
  }
}

async function checkVps(vps) {
  const startedAt = Date.now()
  try {
    const { privateKey } = await ensurePanelKeyPair()
    const h = await execAsTrafficAgent(vps.ip_address, vps.ssh_port || 22, privateKey, 'health')
    if (h.stdout === 'ok') {
      return { ok: true, message: 'ok', durationMs: Date.now() - startedAt }
    }
    const msg = h.stderr || h.stdout || 'no response'
    const cls = classifyError({ stderr: h.stderr, stdout: h.stdout })
    return { ok: false, message: msg, error: cls, durationMs: Date.now() - startedAt }
  } catch (e) {
    const cls = classifyError({ message: e.message })
    return { ok: false, message: e.message, error: cls, durationMs: Date.now() - startedAt }
  }
}

async function uninstallOnVps(vps) {
  const startedAt = Date.now()
  const sshConfig = {
    host: vps.ip_address,
    port: vps.ssh_port || 22,
    username: vps.ssh_user || 'root',
    password: decrypt(vps.ssh_password) || undefined,
    privateKey: decrypt(vps.ssh_key) || undefined,
  }
  try {
    const r = await execAsRoot(sshConfig, buildUninstallScript(), 30000)
    return {
      ok: r.code === 0,
      raw: { stdout: r.stdout.slice(-1500), stderr: r.stderr.slice(-1500) },
      durationMs: Date.now() - startedAt,
    }
  } catch (e) {
    const cls = classifyError({ message: e.message })
    return {
      ok: false, message: e.message, error: cls,
      durationMs: Date.now() - startedAt,
    }
  }
}

// ───── 5. Step parsing & error classification ────────────────────────────────

/**
 * Шаги install-скрипта — карта KEY → читаемое описание.
 * STEP_RESULT-маркеры в bash-скрипте используют эти ключи.
 */
const STEP_LABELS = {
  // raw markers from bash:
  node_dir:                    'Найдена установка ноды',
  no_node_found:               'Нода не найдена в /opt/remnanode и других стандартных путях',
  compose_patched:             'Добавлен volume xray-логов в docker-compose',
  compose_already_has_volume:  'Volume xray-логов уже был в docker-compose',
  key_added:                   'SSH-ключ панели добавлен в authorized_keys',
  key_already_present:         'SSH-ключ панели уже был в authorized_keys',
  log_readable_by_agent:       'Доступ к access.log из под traffic-agent — есть',
  log_NOT_readable_by_agent:   'Доступ к access.log из под traffic-agent — НЕТ',
}

/**
 * Парсит STEP_RESULT строки из stdout установочного скрипта.
 * Возвращает массив структурированных шагов.
 */
function parseSteps(stdout) {
  const steps = []
  for (const line of String(stdout).split('\n')) {
    const m = line.match(/^STEP_RESULT:(.+)$/)
    if (!m) continue
    const raw = m[1].trim()
    // node_dir:/opt/remnanode → key=node_dir, detail=/opt/remnanode
    const colonIdx = raw.indexOf(':')
    const key = colonIdx > 0 ? raw.slice(0, colonIdx) : raw
    const detail = colonIdx > 0 ? raw.slice(colonIdx + 1) : null
    const label = STEP_LABELS[key] || key
    const ok = !key.startsWith('no_') && !key.includes('NOT_')
    steps.push({ key, label, detail, ok })
  }
  return steps
}

/**
 * Карта известных ошибок → код + подсказка. Если ничего не подошло,
 * возвращаем null — UI покажет stderr/stdout как есть.
 */
function classifyError({ message = '', stderr = '', stdout = '', code = 0 }) {
  const all = `${message}\n${stderr}\n${stdout}`.toLowerCase()

  // SSH connection
  if (/connect\s+(econnrefused|etimedout)|all configured authentication methods failed|permission denied/i.test(all)) {
    if (/permission denied/i.test(all)) {
      return {
        code: 'ssh_auth_denied',
        hint: 'Не удалось зайти на ноду по SSH. Проверь ssh_user / ssh_password / ssh_key в карточке VPS — либо они изменились, либо не были установлены вообще.',
      }
    }
    if (/econnrefused/i.test(all)) {
      return {
        code: 'ssh_refused',
        hint: 'SSH-порт ноды не отвечает (connection refused). Проверь, что нода жива и порт SSH (по умолчанию 22) открыт.',
      }
    }
    return {
      code: 'ssh_timeout',
      hint: 'SSH-соединение упало по таймауту. Возможно нода недоступна, либо firewall блокирует наш IP. Запусти Ping в карточке VPS.',
    }
  }
  if (/ssh\s+timeout|install timeout|health timeout/i.test(all)) {
    return {
      code: 'install_timeout',
      hint: 'Скрипт не успел отработать за 120 секунд. Обычно это значит что Docker/нода долго перезапускаются. Попробуй ещё раз — повторный запуск идемпотентный.',
    }
  }
  if (/no_node_found|step_result:no_node_found/i.test(all)) {
    return {
      code: 'no_node_found',
      hint: 'Скрипт не нашёл установку RemnaWave Node. Проверял пути: /opt/remnanode, /opt/remnawave-node, /opt/remnanode-node, /root/remnanode. Если у тебя нестандартный путь — установи ноду через «Установить RemnaWave Node» либо передай путь вручную.',
    }
  }
  if (/python3:\s+command not found|python3 not found/i.test(all)) {
    return {
      code: 'no_python',
      hint: 'На ноде нет python3 (он нужен для аккуратной правки docker-compose.yml). Поставь его: apt-get install -y python3 — и запусти установку повторно.',
    }
  }
  if (/setfacl:\s+command not found/i.test(all)) {
    // Не блокирует — мы делаем fallback на chgrp/chmod. Возвращаем null.
    return null
  }
  if (/log_not_readable_by_agent|log_not_readable/i.test(all)) {
    return {
      code: 'log_not_readable',
      hint: 'access.log пока не существует или недоступен для чтения. Это нормально на первом шаге — открой config-profile в RemnaWave-панели, добавь блок "log" с access:"/var/log/xray/access.log" и сохрани. Потом нажми «Перепроверить».',
    }
  }
  if (code !== 0 && code !== null) {
    return {
      code: `exit_${code}`,
      hint: `Скрипт упал с exit-кодом ${code}. Раскрой "Подробности" чтобы увидеть последние строки stderr.`,
    }
  }
  return null
}

// ───── 6. Persistent log ─────────────────────────────────────────────────────

/**
 * Записывает попытку в traffic_agent_install_log.
 * @returns id записи
 */
async function logAttempt({
  vpsId, adminId = null, action, status,
  errorCode = null, errorHint = null,
  steps = [], healthOk = null, healthMsg = null,
  stdout = '', stderr = '', durationMs = null,
}) {
  try {
    const r = await db.query(
      `INSERT INTO traffic_agent_install_log
        (vps_id, action, status, error_code, error_hint, steps,
         health_ok, health_msg, stdout_tail, stderr_tail,
         duration_ms, admin_id, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
       RETURNING id`,
      [
        vpsId, action, status, errorCode, errorHint,
        JSON.stringify(steps),
        healthOk, (healthMsg || '').slice(0, 500),
        String(stdout || '').slice(-1500),
        String(stderr || '').slice(-1500),
        durationMs, adminId,
      ]
    )
    return r.rows[0].id
  } catch (err) {
    console.error('[TrafficAgent] log write error:', err.message)
    return null
  }
}

module.exports = {
  ensurePanelKeyPair,
  installOnVps,
  checkVps,
  uninstallOnVps,
  classifyError,
  logAttempt,
  STEP_LABELS,
}
