const express = require('express')
const router = express.Router()
const { Client } = require('ssh2')
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const remnwave = require('../services/remnwave')
const net = require('net')
const { encrypt, decrypt } = require('../services/encryption')
const audit = require('../services/auditLog')
const trafficAgent = require('../services/trafficAgentInstaller')

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''
const TG_CRON_HOUR = parseInt(process.env.TG_VPS_NOTIFY_HOUR || '10', 10)
const TG_CRON_ENABLED = process.env.TG_VPS_NOTIFY_ENABLED === 'true'

const NETWORK_STATUS_CMD = [
  'set +e;',
  "BBR_STATE='disabled';",
  "if [ \"$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)\" = 'bbr' ]; then BBR_STATE='enabled'; fi;",
  "IPV6_STATE='enabled';",
  "if [ \"$(sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null)\" = '1' ] || [ \"$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null)\" = '1' ]; then IPV6_STATE='disabled'; fi;",
  'echo BBR_STATUS:$BBR_STATE;',
  'echo IPV6_STATUS:$IPV6_STATE;'
].join(' ')

const ENABLE_BBR_CMD = [
  'set +e;',
  "if ! command -v sysctl >/dev/null 2>&1; then echo 'sysctl не найден'; echo BBR_STATUS:disabled; exit 0; fi;",
  "CURRENT=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null);",
  "if [ \"$CURRENT\" != 'bbr' ]; then",
  "  (grep -q '^net.core.default_qdisc=fq' /etc/sysctl.conf 2>/dev/null || echo 'net.core.default_qdisc=fq' >> /etc/sysctl.conf) 2>/dev/null || sudo sh -c \"grep -q '^net.core.default_qdisc=fq' /etc/sysctl.conf || echo 'net.core.default_qdisc=fq' >> /etc/sysctl.conf\";",
  "  (grep -q '^net.ipv4.tcp_congestion_control=bbr' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv4.tcp_congestion_control=bbr' >> /etc/sysctl.conf) 2>/dev/null || sudo sh -c \"grep -q '^net.ipv4.tcp_congestion_control=bbr' /etc/sysctl.conf || echo 'net.ipv4.tcp_congestion_control=bbr' >> /etc/sysctl.conf\";",
  '  sysctl -w net.core.default_qdisc=fq >/dev/null 2>&1 || sudo sysctl -w net.core.default_qdisc=fq >/dev/null 2>&1;',
  '  sysctl -w net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1 || sudo sysctl -w net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1;',
  'fi;',
  "if [ \"$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)\" = 'bbr' ]; then echo BBR_STATUS:enabled; else echo BBR_STATUS:disabled; fi;",
].join(' ')

const DISABLE_IPV6_CMD = [
  'set +e;',
  "(grep -q '^net.ipv6.conf.all.disable_ipv6=1' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv6.conf.all.disable_ipv6=1' >> /etc/sysctl.conf) 2>/dev/null || sudo sh -c \"grep -q '^net.ipv6.conf.all.disable_ipv6=1' /etc/sysctl.conf || echo 'net.ipv6.conf.all.disable_ipv6=1' >> /etc/sysctl.conf\";",
  "(grep -q '^net.ipv6.conf.default.disable_ipv6=1' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv6.conf.default.disable_ipv6=1' >> /etc/sysctl.conf) 2>/dev/null || sudo sh -c \"grep -q '^net.ipv6.conf.default.disable_ipv6=1' /etc/sysctl.conf || echo 'net.ipv6.conf.default.disable_ipv6=1' >> /etc/sysctl.conf\";",
  'sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1 || sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1;',
  'sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1 || sudo sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1;',
  "if [ \"$(sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null)\" = '1' ] || [ \"$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null)\" = '1' ]; then echo IPV6_STATUS:disabled; else echo IPV6_STATUS:enabled; fi;",
].join(' ')

const CLOSE_PORTS_EXCEPT_SSH_CMD = [
  'set +e;',
  "FW_STATE='disabled';",
  'if command -v ufw >/dev/null 2>&1; then',
  '  ufw --force reset >/dev/null 2>&1 || sudo ufw --force reset >/dev/null 2>&1;',
  '  ufw default deny incoming >/dev/null 2>&1 || sudo ufw default deny incoming >/dev/null 2>&1;',
  '  ufw default allow outgoing >/dev/null 2>&1 || sudo ufw default allow outgoing >/dev/null 2>&1;',
  '  ufw allow 22/tcp >/dev/null 2>&1 || sudo ufw allow 22/tcp >/dev/null 2>&1;',
  '  ufw --force enable >/dev/null 2>&1 || sudo ufw --force enable >/dev/null 2>&1;',
  "  FW_STATE='enabled';",
  'else',
  '  if command -v iptables >/dev/null 2>&1; then',
  '    iptables -F INPUT >/dev/null 2>&1 || sudo iptables -F INPUT >/dev/null 2>&1;',
  '    iptables -P INPUT DROP >/dev/null 2>&1 || sudo iptables -P INPUT DROP >/dev/null 2>&1;',
  '    iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT >/dev/null 2>&1 || sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT >/dev/null 2>&1;',
  '    iptables -A INPUT -i lo -j ACCEPT >/dev/null 2>&1 || sudo iptables -A INPUT -i lo -j ACCEPT >/dev/null 2>&1;',
  '    iptables -A INPUT -p tcp --dport 22 -j ACCEPT >/dev/null 2>&1 || sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT >/dev/null 2>&1;',
  "    FW_STATE='enabled';",
  '  fi;',
  'fi;',
  'echo FIREWALL_SSH_ONLY:$FW_STATE;',
].join(' ')

function parseRuntimeFlags(output) {
  const text = String(output || '')
  const bbrMatch = text.match(/BBR_STATUS:(enabled|disabled)/i)
  const ipv6Match = text.match(/IPV6_STATUS:(enabled|disabled)/i)
  const firewallMatch = text.match(/FIREWALL_SSH_ONLY:(enabled|disabled)/i)

  const flags = {}
  if (bbrMatch) flags.bbr_enabled = bbrMatch[1].toLowerCase() === 'enabled'
  if (ipv6Match) flags.ipv6_disabled = ipv6Match[1].toLowerCase() === 'disabled'
  if (firewallMatch) flags.firewall_ssh_only = firewallMatch[1].toLowerCase() === 'enabled'
  return flags
}

async function persistRuntimeFlags(vpsId, flags) {
  const sets = []
  const values = []
  let idx = 1

  if (flags.bbr_enabled !== undefined) {
    sets.push(`bbr_enabled = $${idx++}`)
    values.push(flags.bbr_enabled)
  }
  if (flags.ipv6_disabled !== undefined) {
    sets.push(`ipv6_disabled = $${idx++}`)
    values.push(flags.ipv6_disabled)
  }
  if (flags.firewall_ssh_only !== undefined) {
    sets.push(`firewall_ssh_only = $${idx++}`)
    values.push(flags.firewall_ssh_only)
  }

  if (sets.length === 0) return

  sets.push('updated_at = NOW()')
  values.push(vpsId)
  await db.query(`UPDATE vps_servers SET ${sets.join(', ')} WHERE id = $${idx}`, values)
}

async function ensureVpsRuntimeColumns() {
  await db.query(`
    ALTER TABLE vps_servers
      ADD COLUMN IF NOT EXISTS bbr_enabled BOOLEAN,
      ADD COLUMN IF NOT EXISTS ipv6_disabled BOOLEAN,
      ADD COLUMN IF NOT EXISTS firewall_ssh_only BOOLEAN
  `)
}

ensureVpsRuntimeColumns().catch((err) => {
  console.error('[AdminVPS] ensure runtime columns error:', err.message)
})

// Белый список команд — только эти можно выполнять через SSH
const SSH_COMMANDS = {
  'system-info': { label: 'Информация о системе', cmd: 'uname -a && hostname && uptime' },
  'docker-ps': { label: 'Docker контейнеры', cmd: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker не установлен"' },
  'runtime-status': { label: 'Статус BBR/IPv6', cmd: NETWORK_STATUS_CMD },
  'enable-bbr': { label: 'Включить BBR', cmd: ENABLE_BBR_CMD },
  'disable-ipv6': { label: 'Отключить IPv6', cmd: DISABLE_IPV6_CMD },
  'close-ports-ssh-only': { label: 'Закрыть порты (кроме 22)', cmd: CLOSE_PORTS_EXCEPT_SSH_CMD },
  'node-status': {
    label: 'Статус RemnaWave Node',
    cmd: "if [ -f /opt/remnanode/docker-compose.yml ]; then cd /opt/remnanode && (docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null); else docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | (grep -E 'NAMES|remnanode|xray' || true); fi"
  },
  'node-start': {
    label: 'Запуск RemnaWave Node',
    cmd: "if [ -f /opt/remnanode/docker-compose.yml ]; then cd /opt/remnanode && (docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null); else docker start remnanode 2>/dev/null || echo 'Контейнер remnanode не найден'; fi"
  },
  'node-stop': {
    label: 'Остановка RemnaWave Node',
    cmd: "if [ -f /opt/remnanode/docker-compose.yml ]; then cd /opt/remnanode && (docker compose stop 2>/dev/null || docker-compose stop 2>/dev/null); else docker stop remnanode 2>/dev/null || echo 'Контейнер remnanode не найден'; fi"
  },
  'node-restart': {
    label: 'Перезапуск RemnaWave Node',
    cmd: "if [ -f /opt/remnanode/docker-compose.yml ]; then cd /opt/remnanode && (docker compose restart 2>/dev/null || docker-compose restart 2>/dev/null); else docker restart remnanode 2>/dev/null || echo 'Контейнер remnanode не найден'; fi"
  },
  'server-reboot': {
    label: 'Перезапуск сервера',
    cmd: "(sleep 1; reboot) >/dev/null 2>&1 & echo 'Перезагрузка сервера инициирована'"
  },
}

function sshExec(config, command, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      conn.end()
      reject(new Error('Таймаут подключения (15с)'))
    }, timeout)

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err) }
        stream.on('close', () => {
          clearTimeout(timer)
          conn.end()
          resolve({ stdout, stderr })
        })
        stream.on('data', (data) => { stdout += data.toString() })
        stream.stderr.on('data', (data) => { stderr += data.toString() })
      })
    })
    conn.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    const sshConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username || 'root',
      readyTimeout: 10000,
    }
    if (config.privateKey) {
      sshConfig.privateKey = config.privateKey
    } else if (config.password) {
      sshConfig.password = config.password
    }
    conn.connect(sshConfig)
  })
}

function buildRemnaNodeInstallCommand({ projectDir, installDocker, composeContent }) {
  const composeB64 = Buffer.from(composeContent, 'utf8').toString('base64')
  const dockerInstallCmd = installDocker
    ? "if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi"
    : ''

  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    dockerInstallCmd,
    'if command -v systemctl >/dev/null 2>&1; then systemctl enable docker >/dev/null 2>&1 || true; systemctl start docker >/dev/null 2>&1 || true; fi',
    `mkdir -p '${projectDir}'`,
    `cd '${projectDir}'`,
    `printf '%s' '${composeB64}' | base64 -d > docker-compose.yml`,
    "if command -v docker >/dev/null 2>&1; then docker compose up -d || docker-compose up -d; else echo 'Docker не установлен' && exit 1; fi",
    "docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null || true",
  ].filter(Boolean).join(' && ')
}

function buildRemnaNodeDetectCommand() {
  return [
    'set +e',
    "FOUND_PATH='';",
    "for D in /opt/remnanode /opt/remnawave-node /opt/remnanode-node; do",
    "  if [ -f \"$D/docker-compose.yml\" ]; then",
    "    if grep -qiE 'remnawave/node|remnanode' \"$D/docker-compose.yml\"; then",
    "      FOUND_PATH=$D; break;",
    "    fi",
    "  fi",
    'done',
    "if [ -n \"$FOUND_PATH\" ]; then",
    "  echo NODE_FOUND:$FOUND_PATH;",
    "  cd \"$FOUND_PATH\";",
    "  docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null || true;",
    'else',
    "  if docker ps -a --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -qiE 'remnanode|remnawave/node'; then",
    "    echo NODE_FOUND:docker;",
    "    docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}' 2>/dev/null | (grep -E 'NAMES|remnanode|remnawave' || true);",
    '  else',
    "    echo NODE_NOT_FOUND;",
    '  fi',
    'fi',
  ].join(' ')
}

function buildRemnaNodeComposeLocateCommand() {
  // Build a clean multi-line bash script and base64-encode it to avoid all quoting/escaping issues
  const script = [
    'set +e',
    "FOUND_FILE=''",
    '',
    '# Method 1: docker compose ls — shows config paths for running compose projects',
    "DC_LS=$(docker compose ls 2>/dev/null | grep -iE 'remnanode|remnawave' | awk '{print $NF}' | head -1)",
    'if [ -n "$DC_LS" ] && [ -f "$DC_LS" ]; then FOUND_FILE="$DC_LS"; fi',
    '',
    '# Method 2: docker inspect working_dir label',
    'if [ -z "$FOUND_FILE" ]; then',
    "  CID=$(docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null | grep -iE 'remnanode|remnawave' | awk '{print $1}' | head -1)",
    '  if [ -n "$CID" ]; then',
    "    WDIR=$(docker inspect \"$CID\" --format '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}' 2>/dev/null)",
    '    if [ -n "$WDIR" ]; then',
    '      for F in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do',
    '        if [ -f "$WDIR/$F" ]; then FOUND_FILE="$WDIR/$F"; break; fi',
    '      done',
    '    fi',
    '  fi',
    'fi',
    '',
    '# Method 3: static well-known paths',
    'if [ -z "$FOUND_FILE" ]; then',
    '  for D in /opt/remnanode /opt/remnawave /opt/remnawave-node /opt/remnanode-node /root/remnanode; do',
    '    for F in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do',
    '      P="$D/$F"',
    '      if [ -f "$P" ]; then FOUND_FILE="$P"; break 2; fi',
    '    done',
    '  done',
    'fi',
    '',
    '# Method 4: wide recursive find',
    'if [ -z "$FOUND_FILE" ]; then',
    "  CANDIDATES=$(find /opt /root /home -maxdepth 5 -type f \\( -name 'docker-compose.yml' -o -name 'docker-compose.yaml' -o -name 'compose.yml' -o -name 'compose.yaml' \\) 2>/dev/null | head -300)",
    '  for P in $CANDIDATES; do',
    '    if [ -f "$P" ]; then FOUND_FILE="$P"; break; fi',
    '  done',
    'fi',
    '',
    '# Output result',
    'if [ -n "$FOUND_FILE" ]; then',
    '  echo "COMPOSE_FOUND:$FOUND_FILE"',
    'else',
    "  if docker ps -a --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -qiE 'remnanode|remnawave/node'; then",
    '    echo NODE_FOUND_DOCKER_ONLY',
    '  else',
    '    echo NODE_NOT_FOUND',
    '  fi',
    'fi',
  ].join('\n')

  const b64 = Buffer.from(script, 'utf8').toString('base64')
  // base64 alphabet has no special shell chars — single-quote wrapping is safe
  return `printf '%s' '${b64}' | base64 -d | bash`
}

function getSshConfigFromVps(vps) {
  return {
    host: vps.ip_address,
    port: vps.ssh_port || 22,
    username: vps.ssh_user || 'root',
    password: decrypt(vps.ssh_password) || undefined,
    privateKey: decrypt(vps.ssh_key) || undefined,
  }
}

router.use(verifyToken, verifyAdmin)

/**
 * GET /api/admin/vps
 * Список всех VPS-серверов + данные нод Remnawave
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM vps_servers ORDER BY paid_until ASC NULLS LAST, created_at DESC'
    )

    // Дешифруем SSH-данные для каждого VPS
    const decryptedRows = rows.map(row => ({
      ...row,
      ssh_password: decrypt(row.ssh_password),
      ssh_key: decrypt(row.ssh_key),
    }))

    // Получаем ноды для привязки
    let nodes = []
    try {
      nodes = await remnwave.getNodes() || []
    } catch {}

    res.json({ vps: decryptedRows, nodes })
  } catch (err) {
    console.error('[AdminVPS] list error:', err.message)
    res.status(500).json({ error: 'Ошибка загрузки VPS' })
  }
})

/**
 * POST /api/admin/vps
 * Добавить новый VPS
 */
router.post('/', async (req, res) => {
  try {
    const { name, hosting_provider, ip_address, location, specs, monthly_cost, currency, paid_months, paid_until, node_uuid, node_name, notes, status } = req.body

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Имя VPS обязательно' })
    }

    const { ssh_user, ssh_port, ssh_password, ssh_key } = req.body
    const service_type = req.body.service_type || ''

    const { rows } = await db.query(
      `INSERT INTO vps_servers (name, hosting_provider, ip_address, location, specs, monthly_cost, currency, paid_months, paid_until, node_uuid, node_name, notes, status, ssh_user, ssh_port, ssh_password, ssh_key, service_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        name.trim(),
        hosting_provider || '',
        ip_address || '',
        location || '',
        JSON.stringify(specs || {}),
        monthly_cost || 0,
        currency || 'RUB',
        paid_months || 1,
        paid_until || null,
        node_uuid || null,
        node_name || '',
        notes || '',
        status || 'active',
        ssh_user || 'root',
        ssh_port || 22,
        encrypt(ssh_password || ''),
        encrypt(ssh_key || ''),
        service_type
      ]
    )

    await audit.write(req, 'vps.create', { type: 'vps', id: rows[0].id }, {
      name: rows[0].name, ip: rows[0].ip_address, provider: rows[0].hosting_provider
    })
    res.json({ vps: rows[0] })
  } catch (err) {
    console.error('[AdminVPS] create error:', err.message)
    res.status(500).json({ error: 'Ошибка создания VPS' })
  }
})

/**
 * POST /api/admin/vps/notify-expiring
 * Отправить уведомление в Telegram о серверах, истекающих в ближайшие 7 дней
 */
router.post('/notify-expiring', async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.status(400).json({ error: 'Telegram бот не настроен. Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env' })
    }

    const { rows } = await db.query(
      `SELECT * FROM vps_servers
       WHERE paid_until IS NOT NULL
         AND paid_until <= CURRENT_DATE + INTERVAL '7 days'
         AND paid_until >= CURRENT_DATE - INTERVAL '3 days'
       ORDER BY paid_until ASC`
    )

    if (rows.length === 0) {
      return res.json({ sent: false, message: 'Нет серверов, истекающих в ближайшие 7 дней' })
    }

    const lines = rows.map(v => {
      const d = Math.ceil((new Date(v.paid_until) - new Date()) / 86400000)
      const status = d <= 0 ? '🔴 Просрочен' : d <= 3 ? '🟠 Срочно' : '🟡 Скоро'
      return `${status} <b>${v.name}</b> (${v.hosting_provider || '—'})\n   IP: <code>${v.ip_address || '—'}</code> · До: ${new Date(v.paid_until).toLocaleDateString('ru-RU')} (${d <= 0 ? 'просрочен' : d + ' дн.'})`
    })

    const tgNotify = require('../services/telegramBot/notify')
    const result = await tgNotify.notifyAdmin('admin_vps_expiring', {
      lines: lines.join('\n\n'),
      count: rows.length,
    })
    if (!result.ok) {
      return res.status(500).json({ error: `Telegram: ${result.error || result.skipped || 'не отправлено'}` })
    }

    res.json({ sent: true, count: rows.length })
  } catch (err) {
    console.error('[AdminVPS] notify error:', err.message)
    res.status(500).json({ error: 'Ошибка отправки уведомления' })
  }
})

/**
 * GET /api/admin/vps/analytics
 * Аналитика расходов VPS
 */
router.get('/analytics', async (req, res) => {
  try {
    const byProvider = await db.query(
      `SELECT hosting_provider AS provider, currency, COUNT(*)::int AS count,
              SUM(monthly_cost)::float AS total
       FROM vps_servers
       WHERE status = 'active'
       GROUP BY hosting_provider, currency
       ORDER BY total DESC`
    )

    const byCurrency = await db.query(
      `SELECT currency, COUNT(*)::int AS count, SUM(monthly_cost)::float AS total
       FROM vps_servers WHERE status = 'active'
       GROUP BY currency ORDER BY total DESC`
    )

    const byMonth = await db.query(
      `SELECT to_char(created_at, 'YYYY-MM') AS month,
              currency, SUM(amount)::float AS total
       FROM vps_payment_history
       GROUP BY month, currency
       ORDER BY month DESC
       LIMIT 24`
    )

    res.json({
      byProvider: byProvider.rows,
      byCurrency: byCurrency.rows,
      byMonth: byMonth.rows,
    })
  } catch (err) {
    console.error('[AdminVPS] analytics error:', err.message)
    res.status(500).json({ error: 'Ошибка аналитики' })
  }
})

/**
 * POST /api/admin/vps/ping/:id
 * Проверить доступность VPS по TCP-порту 22
 */
router.post('/ping/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT ip_address, ssh_port FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'VPS не найден' })
    const vps = rows[0]
    if (!vps.ip_address) return res.status(400).json({ error: 'IP не указан' })

    const port = vps.ssh_port || 22
    const start = Date.now()
    const alive = await new Promise((resolve) => {
      const sock = new net.Socket()
      sock.setTimeout(5000)
      sock.on('connect', () => { sock.destroy(); resolve(true) })
      sock.on('timeout', () => { sock.destroy(); resolve(false) })
      sock.on('error', () => { sock.destroy(); resolve(false) })
      sock.connect(port, vps.ip_address)
    })
    const ms = Date.now() - start

    res.json({ alive, ms, ip: vps.ip_address, port })
  } catch (err) {
    console.error('[AdminVPS] ping error:', err.message)
    res.status(500).json({ error: 'Ошибка проверки' })
  }
})

/**
 * PATCH /api/admin/vps/:id
 * Обновить VPS
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const fields = req.body
    const allowed = ['name','hosting_provider','ip_address','location','specs','monthly_cost','currency','paid_months','paid_until','node_uuid','node_name','notes','status','ssh_user','ssh_port','ssh_password','ssh_key','service_type']

    const sets = []
    const vals = []
    let idx = 1

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        let val = key === 'specs' ? JSON.stringify(fields[key]) : fields[key]
        // Шифруем SSH-данные перед записью
        if (key === 'ssh_password' || key === 'ssh_key') {
          val = encrypt(val || '')
        }
        sets.push(`${key} = $${idx}`)
        vals.push(val)
        idx++
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Нет полей для обновления' })
    }

    sets.push(`updated_at = NOW()`)
    vals.push(id)

    const { rows } = await db.query(
      `UPDATE vps_servers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'VPS не найден' })
    }

    res.json({ vps: rows[0] })
  } catch (err) {
    console.error('[AdminVPS] update error:', err.message)
    res.status(500).json({ error: 'Ошибка обновления VPS' })
  }
})

/**
 * DELETE /api/admin/vps/:id
 * Удалить VPS
 */
router.delete('/:id', async (req, res) => {
  try {
    const snap = await db.query('SELECT id, name, ip_address, hosting_provider FROM vps_servers WHERE id = $1', [req.params.id])
    const { rowCount } = await db.query('DELETE FROM vps_servers WHERE id = $1', [req.params.id])
    if (rowCount === 0) {
      return res.status(404).json({ error: 'VPS не найден' })
    }
    await audit.write(req, 'vps.delete', { type: 'vps', id: req.params.id }, { before: snap.rows[0] || null })
    res.json({ success: true })
  } catch (err) {
    console.error('[AdminVPS] delete error:', err.message)
    res.status(500).json({ error: 'Ошибка удаления VPS' })
  }
})

/**
 * GET /api/admin/vps/ssh/commands
 * Список доступных SSH-команд
 */
router.get('/ssh/commands', (req, res) => {
  const commands = Object.entries(SSH_COMMANDS).map(([key, val]) => ({
    key,
    label: val.label
  }))
  res.json({ commands })
})

/**
 * POST /api/admin/vps/:id/ssh
 * Выполнить SSH-команду на VPS
 */
router.post('/:id/ssh', async (req, res) => {
  try {
    const { commandKey } = req.body

    // Проверяем что команда из белого списка
    if (!commandKey || !SSH_COMMANDS[commandKey]) {
      return res.status(400).json({ error: 'Неизвестная команда' })
    }

    // Получаем VPS из БД
    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'VPS не найден' })
    }

    const vps = rows[0]

    if (!vps.ip_address) {
      return res.status(400).json({ error: 'IP-адрес не указан' })
    }

    if (!vps.ssh_password && !vps.ssh_key) {
      return res.status(400).json({ error: 'Не указан пароль или SSH-ключ' })
    }

    const config = {
      host: vps.ip_address,
      port: vps.ssh_port || 22,
      username: vps.ssh_user || 'root',
      password: decrypt(vps.ssh_password) || undefined,
      privateKey: decrypt(vps.ssh_key) || undefined,
    }

    const cmdObj = SSH_COMMANDS[commandKey]
    console.log(`[SSH] ${vps.name} (${vps.ip_address}): ${cmdObj.label}`)

    const result = await sshExec(config, cmdObj.cmd)
    const output = result.stdout || result.stderr || '(пустой вывод)'

    const runtimeFlags = parseRuntimeFlags(output)
    if (Object.keys(runtimeFlags).length > 0) {
      await persistRuntimeFlags(req.params.id, runtimeFlags)
    }

    res.json({
      command: cmdObj.label,
      output,
      runtimeFlags,
      flagsUpdated: Object.keys(runtimeFlags).length > 0,
    })
  } catch (err) {
    console.error('[SSH] Error:', err.message)
    const msg = err.message.includes('authentication')
      ? 'Ошибка аутентификации — проверьте логин/пароль/ключ'
      : err.message.includes('ECONNREFUSED')
        ? 'Сервер отклонил подключение'
        : err.message.includes('EHOSTUNREACH') || err.message.includes('ETIMEDOUT')
          ? 'Сервер недоступен'
          : err.message
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /api/admin/vps/:id/install-remnanode
 * Автоматическая установка RemnaWave Node по SSH
 */
router.post('/:id/install-remnanode', async (req, res) => {
  try {
    const projectDir = (req.body.projectDir || '/opt/remnanode').trim()
    const composeContent = req.body.composeContent || ''
    const installDocker = req.body.installDocker !== false

    if (!composeContent || composeContent.trim().length < 40) {
      return res.status(400).json({ error: 'Вставьте docker-compose.yml из панели RemnaWave' })
    }
    if (!/^\/[a-zA-Z0-9_\-/.]+$/.test(projectDir)) {
      return res.status(400).json({ error: 'Некорректный путь проекта. Пример: /opt/remnanode' })
    }

    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'VPS не найден' })
    }

    const vps = rows[0]
    if (!vps.ip_address) {
      return res.status(400).json({ error: 'IP-адрес не указан' })
    }
    if (!vps.ssh_password && !vps.ssh_key) {
      return res.status(400).json({ error: 'Не указан пароль или SSH-ключ' })
    }

    const config = {
      host: vps.ip_address,
      port: vps.ssh_port || 22,
      username: vps.ssh_user || 'root',
      password: decrypt(vps.ssh_password) || undefined,
      privateKey: decrypt(vps.ssh_key) || undefined,
    }

    const installCmd = buildRemnaNodeInstallCommand({ projectDir, installDocker, composeContent })
    const result = await sshExec(config, `bash -lc "${installCmd.replace(/\"/g, '\\\"')}"`, 180000)

    const persisted = await db.query(
      `UPDATE vps_servers
       SET service_type = 'node',
           notes = CASE
             WHEN notes IS NULL OR notes = '' THEN $1
             ELSE notes || E'\n' || $1
           END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, service_type`,
      [`RemnaWave Node установлен. Директория: ${projectDir}`, req.params.id]
    )

    if (!persisted.rows.length) {
      throw new Error('Установка выполнена, но не удалось сохранить статус VPS в БД')
    }

    res.json({
      success: true,
      output: result.stdout || result.stderr || '(пустой вывод)',
      projectDir,
      persisted: true,
      nextStep: 'Откройте RemnaWave Panel -> Nodes -> Management и завершите создание ноды (Step 5)'
    })
  } catch (err) {
    console.error('[RemnaNode Install] Error:', err.message)
    const msg = err.message.includes('authentication')
      ? 'Ошибка аутентификации SSH — проверьте логин/пароль/ключ'
      : err.message.includes('ECONNREFUSED')
        ? 'Сервер отклонил SSH-подключение'
        : err.message.includes('EHOSTUNREACH') || err.message.includes('ETIMEDOUT')
          ? 'Сервер недоступен по сети'
          : err.message
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /api/admin/vps/:id/sync-node-status
 * Проверяет, установлена ли RemnaWave Node на VPS, и синхронизирует service_type
 */
router.post('/:id/sync-node-status', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'VPS не найден' })
    }

    const vps = rows[0]
    if (!vps.ip_address) {
      return res.status(400).json({ error: 'IP-адрес не указан' })
    }
    if (!vps.ssh_password && !vps.ssh_key) {
      return res.status(400).json({ error: 'Не указан пароль или SSH-ключ' })
    }

    const config = {
      host: vps.ip_address,
      port: vps.ssh_port || 22,
      username: vps.ssh_user || 'root',
      password: decrypt(vps.ssh_password) || undefined,
      privateKey: decrypt(vps.ssh_key) || undefined,
    }

    const detectCmd = buildRemnaNodeDetectCommand()
    const result = await sshExec(config, `bash -lc "${detectCmd.replace(/\"/g, '\\\"')}"`, 30000)
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()

    const foundMatch = output.match(/NODE_FOUND:([^\n\r]+)/)
    if (!foundMatch) {
      return res.status(400).json({
        error: 'RemnaWave Node на сервере не обнаружена',
        output: output || 'NODE_NOT_FOUND'
      })
    }

    const detectedPath = foundMatch[1].trim()

    const persisted = await db.query(
      `UPDATE vps_servers
       SET service_type = 'node',
           notes = CASE
             WHEN notes IS NULL OR notes = '' THEN $1
             ELSE notes || E'\n' || $1
           END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, service_type`,
      [`Синхронизация: RemnaWave Node подтверждена (${detectedPath})`, req.params.id]
    )

    if (!persisted.rows.length) {
      return res.status(500).json({ error: 'Нода найдена, но не удалось обновить статус в БД' })
    }

    res.json({
      success: true,
      detectedPath,
      output: output || '(пустой вывод)',
      serviceType: 'node'
    })
  } catch (err) {
    console.error('[Sync Node Status] Error:', err.message)
    const msg = err.message.includes('authentication')
      ? 'Ошибка аутентификации SSH — проверьте логин/пароль/ключ'
      : err.message.includes('ECONNREFUSED')
        ? 'Сервер отклонил SSH-подключение'
        : err.message.includes('EHOSTUNREACH') || err.message.includes('ETIMEDOUT')
          ? 'Сервер недоступен по сети'
          : err.message
    res.status(500).json({ error: msg })
  }
})

/**
 * GET /api/admin/vps/:id/node-compose
 * Прочитать docker-compose.yml установленной RemnaWave Node
 */
router.get('/:id/node-compose', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'VPS не найден' })

    const vps = rows[0]
    if (!vps.ip_address) return res.status(400).json({ error: 'IP-адрес не указан' })
    if (!vps.ssh_password && !vps.ssh_key) return res.status(400).json({ error: 'Не указан пароль или SSH-ключ' })

    const config = getSshConfigFromVps(vps)

    const locateRes = await sshExec(config, buildRemnaNodeComposeLocateCommand(), 40000)
    const locateOutput = `${locateRes.stdout || ''}\n${locateRes.stderr || ''}`.trim()
    const composeMatch = locateOutput.match(/COMPOSE_FOUND:([^\n\r]+)/)

    if (!composeMatch) {
      if (locateOutput.includes('NODE_FOUND_DOCKER_ONLY')) {
        // Container found but no compose file on disk — open editor in create mode
        return res.json({
          success: true,
          path: '/opt/remnanode/docker-compose.yml',
          content: '',
          createMode: true,
        })
      }
      return res.status(400).json({ error: 'RemnaWave Node на сервере не обнаружена', output: locateOutput || 'NODE_NOT_FOUND' })
    }

    const composeFilePath = composeMatch[1].trim()
    if (!composeFilePath.startsWith('/')) {
      return res.status(400).json({
        error: 'Обнаружен некорректный путь compose файла',
        attemptedPath: composeFilePath,
        output: locateOutput
      })
    }

    const readCmd = `cat '${composeFilePath}' 2>/dev/null || sudo cat '${composeFilePath}' 2>/dev/null`
    const readRes = await sshExec(config, readCmd, 30000)
    const content = (readRes.stdout || '').trim()
    if (!content) {
      return res.status(500).json({
        error: 'Файл docker-compose.yml пустой или не читается',
        attemptedPath: composeFilePath,
        output: (readRes.stderr || '').trim() || locateOutput || '(stderr пуст)'
      })
    }

    res.json({ success: true, path: composeFilePath, content })
  } catch (err) {
    console.error('[Node Compose Read] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * PATCH /api/admin/vps/:id/node-compose
 * Обновить docker-compose.yml и опционально применить docker compose up -d
 */
router.patch('/:id/node-compose', async (req, res) => {
  try {
    const composeContent = req.body.composeContent || ''
    const restart = req.body.restart !== false

    if (!composeContent || composeContent.trim().length < 30) {
      return res.status(400).json({ error: 'Содержимое docker-compose.yml пустое или слишком короткое' })
    }
    if (composeContent.length > 1024 * 1024) {
      return res.status(400).json({ error: 'Файл слишком большой (максимум 1MB)' })
    }

    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'VPS не найден' })

    const vps = rows[0]
    if (!vps.ip_address) return res.status(400).json({ error: 'IP-адрес не указан' })
    if (!vps.ssh_password && !vps.ssh_key) return res.status(400).json({ error: 'Не указан пароль или SSH-ключ' })

    const config = getSshConfigFromVps(vps)

    const locateRes = await sshExec(config, buildRemnaNodeComposeLocateCommand(), 40000)
    const locateOutput = `${locateRes.stdout || ''}\n${locateRes.stderr || ''}`.trim()
    const composeMatch = locateOutput.match(/COMPOSE_FOUND:([^\n\r]+)/)

    let composeFilePath
    if (composeMatch) {
      composeFilePath = composeMatch[1].trim()
      if (!composeFilePath.startsWith('/')) {
        return res.status(400).json({
          error: 'Обнаружен некорректный путь compose файла',
          attemptedPath: composeFilePath,
          output: locateOutput
        })
      }
    } else if (locateOutput.includes('NODE_FOUND_DOCKER_ONLY')) {
      // File not found on disk — allow creating at the targetPath provided by client
      const targetPath = (req.body.targetPath || '').trim()
      if (!targetPath || !targetPath.startsWith('/')) {
        return res.status(400).json({ error: 'Укажите корректный путь для сохранения docker-compose.yml' })
      }
      composeFilePath = targetPath
    } else {
      return res.status(400).json({ error: 'RemnaWave Node на сервере не обнаружена', output: locateOutput || 'NODE_NOT_FOUND' })
    }

    const composeDir = composeFilePath.split('/').slice(0, -1).join('/') || '/'
    const composeB64 = Buffer.from(composeContent, 'utf8').toString('base64')
    const writeScript = [
      'set -e',
      `mkdir -p '${composeDir}' 2>/dev/null || sudo mkdir -p '${composeDir}'`,
      `cd '${composeDir}'`,
      `if [ -f '${composeFilePath}' ]; then cp '${composeFilePath}' '${composeFilePath}.bak.'$(date +%s) 2>/dev/null || true; fi`,
      `printf '%s' '${composeB64}' | base64 -d > '${composeFilePath}' || printf '%s' '${composeB64}' | base64 -d | sudo tee '${composeFilePath}' >/dev/null`,
      restart ? 'docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null' : 'echo "Файл сохранён без перезапуска"',
      'docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null || true',
    ].join('\n')

    const writeB64 = Buffer.from(writeScript, 'utf8').toString('base64')
    const writeRes = await sshExec(config, `printf '%s' '${writeB64}' | base64 -d | bash`, 120000)
    const output = `${writeRes.stdout || ''}\n${writeRes.stderr || ''}`.trim()

    res.json({
      success: true,
      path: composeFilePath,
      restarted: restart,
      output: output || '(пустой вывод)'
    })
  } catch (err) {
    console.error('[Node Compose Update] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/vps/:id/renew
 * Продлить VPS на N месяцев
 */
router.post('/:id/renew', async (req, res) => {
  try {
    const { id } = req.params
    const { months, note } = req.body
    const renewMonths = Math.max(1, Math.min(120, Number(months) || 1))

    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [id])
    if (rows.length === 0) return res.status(404).json({ error: 'VPS не найден' })

    const vps = rows[0]
    const oldDate = vps.paid_until
    // Если дата в прошлом или null — считаем от сегодня
    const baseDate = oldDate && new Date(oldDate) > new Date() ? new Date(oldDate) : new Date()
    const newDate = new Date(baseDate)
    newDate.setMonth(newDate.getMonth() + renewMonths)
    const newDateStr = newDate.toISOString().split('T')[0]

    // Обновляем VPS
    await db.query(
      'UPDATE vps_servers SET paid_until = $1, paid_months = paid_months + $2, updated_at = NOW() WHERE id = $3',
      [newDateStr, renewMonths, id]
    )

    // Записываем в историю
    await db.query(
      `INSERT INTO vps_payment_history (vps_id, action, months, old_paid_until, new_paid_until, amount, currency, admin_user, note)
       VALUES ($1, 'renewal', $2, $3, $4, $5, $6, $7, $8)`,
      [id, renewMonths, oldDate || null, newDateStr, vps.monthly_cost * renewMonths, vps.currency || 'RUB', req.user?.username || 'admin', note || '']
    )

    const { rows: updated } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [id])
    await audit.write(req, 'vps.renew', { type: 'vps', id }, {
      months: renewMonths, paid_until_before: oldDate, paid_until_after: newDateStr,
      amount: vps.monthly_cost * renewMonths, currency: vps.currency || 'RUB'
    })
    res.json({ vps: updated[0] })
  } catch (err) {
    console.error('[AdminVPS] renew error:', err.message)
    res.status(500).json({ error: 'Ошибка продления VPS' })
  }
})

/**
 * GET /api/admin/vps/:id/history
 * История оплат VPS
 */
router.get('/:id/history', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM vps_payment_history WHERE vps_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.id]
    )
    res.json({ history: rows })
  } catch (err) {
    console.error('[AdminVPS] history error:', err.message)
    res.status(500).json({ error: 'Ошибка загрузки истории' })
  }
})

// ─── Cron: авто-уведомление в Telegram ───
async function sendExpiryNotification() {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return

    const { rows } = await db.query(
      `SELECT * FROM vps_servers
       WHERE paid_until IS NOT NULL
         AND paid_until <= CURRENT_DATE + INTERVAL '7 days'
         AND paid_until >= CURRENT_DATE - INTERVAL '3 days'
       ORDER BY paid_until ASC`
    )
    if (rows.length === 0) return

    const lines = rows.map(v => {
      const d = Math.ceil((new Date(v.paid_until) - new Date()) / 86400000)
      const status = d <= 0 ? '🔴 Просрочен' : d <= 3 ? '🟠 Срочно' : '🟡 Скоро'
      return `${status} <b>${v.name}</b> (${v.hosting_provider || '—'})\n   IP: <code>${v.ip_address || '—'}</code> · До: ${new Date(v.paid_until).toLocaleDateString('ru-RU')} (${d <= 0 ? 'просрочен' : d + ' дн.'})`
    })

    const tgNotify = require('../services/telegramBot/notify')
    const r = await tgNotify.notifyAdmin('admin_vps_expiring', {
      lines: lines.join('\n\n'),
      count: rows.length,
    })
    if (r.ok) console.log(`[VPS Cron] Отправлено уведомление: ${rows.length} серверов`)
    else console.warn(`[VPS Cron] notifyAdmin: ${r.error || r.skipped}`)
  } catch (err) {
    console.error('[VPS Cron] Ошибка:', err.message)
  }
}

if (TG_CRON_ENABLED) {
  // Проверяем каждый час, отправляем в TG_CRON_HOUR по UTC
  setInterval(() => {
    const now = new Date()
    if (now.getUTCHours() === TG_CRON_HOUR && now.getUTCMinutes() < 5) {
      sendExpiryNotification()
    }
  }, 5 * 60 * 1000) // проверка каждые 5 минут
  console.log(`[VPS Cron] Авто-уведомления включены, час отправки: ${TG_CRON_HOUR}:00 UTC`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Traffic Agent — автоматическая установка SSH-агента на ноду
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/vps/traffic-agent/public-key
 * Возвращает публичный ключ панели — на случай ручной установки.
 * Генерирует keypair при первом вызове.
 */
router.get('/traffic-agent/public-key', async (req, res) => {
  try {
    const { publicKey } = await trafficAgent.ensurePanelKeyPair()
    res.json({ publicKey })
  } catch (err) {
    console.error('[TrafficAgent] public-key error:', err.message)
    res.status(500).json({ error: 'Не удалось получить публичный ключ' })
  }
})

/**
 * POST /api/admin/vps/:id/traffic-agent/install
 * Запускает идемпотентный install-скрипт на ноде через root SSH.
 * Сохраняет статус (installed_at, last_health, last_check) в vps_servers.
 */
router.post('/:id/traffic-agent/install', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'VPS не найден' })
    const vps = rows[0]

    if (!vps.ip_address) return res.status(400).json({ error: 'У VPS не задан ip_address' })

    const r = await trafficAgent.installOnVps(vps)

    // Статус для записи: ok/health_failed/failed/partial
    const status = r.ok && r.healthOk ? 'ok'
                 : r.ok && !r.healthOk ? 'health_failed'
                 : (r.steps && r.steps.length > 0) ? 'partial'
                 : 'failed'

    const logId = await trafficAgent.logAttempt({
      vpsId: vps.id, adminId: req.userId,
      action: 'install', status,
      errorCode: r.error?.code || null,
      errorHint: r.error?.hint || null,
      steps: r.steps || [],
      healthOk: r.healthOk, healthMsg: r.healthMessage,
      stdout: r.raw?.stdout, stderr: r.raw?.stderr,
      durationMs: r.durationMs,
    })

    // Состояние ноды на карточке: traffic_agent_installed_at ставим только если scripts отработал
    const installedAt = r.ok ? new Date() : null
    await db.query(
      `UPDATE vps_servers
         SET traffic_agent_installed_at = COALESCE($1, traffic_agent_installed_at),
             traffic_agent_last_health  = $2,
             traffic_agent_last_check   = NOW()
       WHERE id = $3`,
      [installedAt, (r.healthOk ? 'ok' : (r.healthMessage || 'unknown')).slice(0, 64), req.params.id]
    )

    audit.write(req, 'vps.traffic_agent_install',
      { type: 'vps', id: vps.id },
      { ok: r.ok, healthOk: r.healthOk, status, errorCode: r.error?.code }
    ).catch(() => {})

    res.json({ ...r, logId, status })
  } catch (err) {
    console.error('[TrafficAgent] install error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/vps/:id/traffic-agent/check
 * Health-check агента: SSH под traffic-agent + команда `health`.
 */
router.post('/:id/traffic-agent/check', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'VPS не найден' })
    const vps = rows[0]

    const h = await trafficAgent.checkVps(vps).catch(e => ({ ok: false, message: e.message }))

    await trafficAgent.logAttempt({
      vpsId: vps.id, adminId: req.userId,
      action: 'check',
      status: h.ok ? 'ok' : 'health_failed',
      errorCode: h.error?.code || null,
      errorHint: h.error?.hint || null,
      healthOk: h.ok, healthMsg: h.message,
      durationMs: h.durationMs,
    })

    await db.query(
      `UPDATE vps_servers
         SET traffic_agent_last_health = $1, traffic_agent_last_check = NOW()
       WHERE id = $2`,
      [(h.ok ? 'ok' : (h.message || 'unknown')).slice(0, 64), req.params.id]
    )
    res.json(h)
  } catch (err) {
    console.error('[TrafficAgent] check error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/admin/vps/:id/traffic-agent
 * Удаляет агент с ноды (userdel + удаление скрипта).
 */
router.delete('/:id/traffic-agent', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'VPS не найден' })
    const vps = rows[0]

    const r = await trafficAgent.uninstallOnVps(vps)

    await trafficAgent.logAttempt({
      vpsId: vps.id, adminId: req.userId,
      action: 'uninstall',
      status: r.ok ? 'ok' : 'failed',
      errorCode: r.error?.code || null,
      errorHint: r.error?.hint || null,
      stdout: r.raw?.stdout, stderr: r.raw?.stderr,
      durationMs: r.durationMs,
    })

    await db.query(
      `UPDATE vps_servers
         SET traffic_agent_installed_at = NULL,
             traffic_agent_last_health = NULL,
             traffic_agent_last_check = NOW()
       WHERE id = $1`,
      [req.params.id]
    )
    audit.write(req, 'vps.traffic_agent_uninstall',
      { type: 'vps', id: vps.id },
      { ok: r.ok }
    ).catch(() => {})
    res.json(r)
  } catch (err) {
    console.error('[TrafficAgent] uninstall error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/vps/:id/traffic-agent/log?limit=20
 * Возвращает последние попытки для конкретной ноды.
 */
router.get('/:id/traffic-agent/log', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const r = await db.query(
      `SELECT l.id, l.action, l.status, l.error_code, l.error_hint,
              l.steps, l.health_ok, l.health_msg,
              l.stdout_tail, l.stderr_tail,
              l.duration_ms, l.started_at, l.finished_at,
              u.login AS admin_login
         FROM traffic_agent_install_log l
         LEFT JOIN users u ON u.id = l.admin_id
        WHERE l.vps_id = $1
        ORDER BY l.started_at DESC
        LIMIT $2`,
      [req.params.id, limit]
    )
    res.json({ entries: r.rows })
  } catch (err) {
    console.error('[TrafficAgent] log error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
