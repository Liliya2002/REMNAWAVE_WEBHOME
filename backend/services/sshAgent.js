/**
 * SSH-клиент для общения с traffic-agent на нодах RemnaWave.
 *
 * Конфигурация через env:
 *   TRAFFIC_AGENT_SSH_USER             (default 'traffic-agent')
 *   TRAFFIC_AGENT_SSH_PORT             (default 22)
 *   TRAFFIC_AGENT_SSH_PRIVATE_KEY      — inline ключ (для Docker)
 *   TRAFFIC_AGENT_SSH_PRIVATE_KEY_PATH — или путь к файлу
 *   TRAFFIC_AGENT_SSH_TIMEOUT_MS       (default 10000)
 *
 * Команды (через access-log-query.sh на ноде):
 *   health()                       → 'ok' | throws
 *   lookupIp(host, username, hours) → string[] (уникальные IP)
 *   scanTorrents(host, sinceISO)    → Array<{username, ip, count}>
 */
const fs = require('fs')
const { Client } = require('ssh2')

const USER          = process.env.TRAFFIC_AGENT_SSH_USER || 'traffic-agent'
const PORT          = parseInt(process.env.TRAFFIC_AGENT_SSH_PORT || '22', 10)
const TIMEOUT_MS    = parseInt(process.env.TRAFFIC_AGENT_SSH_TIMEOUT_MS || '10000', 10)
const KEY_INLINE    = process.env.TRAFFIC_AGENT_SSH_PRIVATE_KEY
const KEY_PATH      = process.env.TRAFFIC_AGENT_SSH_PRIVATE_KEY_PATH

let cachedKey = null
function loadKey() {
  if (cachedKey) return cachedKey
  if (KEY_INLINE) {
    // Docker-friendly: ENV может содержать \n как литералы
    cachedKey = KEY_INLINE.replace(/\\n/g, '\n')
    return cachedKey
  }
  if (KEY_PATH && fs.existsSync(KEY_PATH)) {
    cachedKey = fs.readFileSync(KEY_PATH, 'utf8')
    return cachedKey
  }
  return null
}

function isConfigured() {
  return !!loadKey()
}

/**
 * Выполняет команду через SSH. Возвращает stdout (без stderr).
 * Stderr доступен в err.stderr.
 */
function exec(host, command) {
  return new Promise((resolve, reject) => {
    const key = loadKey()
    if (!key) return reject(new Error('SSH not configured (TRAFFIC_AGENT_SSH_PRIVATE_KEY[_PATH] not set)'))
    if (!host) return reject(new Error('Missing SSH host'))

    const conn = new Client()
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { conn.end() } catch {}
      reject(new Error(`SSH timeout after ${TIMEOUT_MS}ms (${host})`))
    }, TIMEOUT_MS)

    conn
      .on('ready', () => {
        // Note: command-restriction в authorized_keys всё равно перезапишет это,
        // но клиент должен передать команду через $SSH_ORIGINAL_COMMAND.
        conn.exec(command, (err, stream) => {
          if (err) {
            settled = true
            clearTimeout(timer)
            try { conn.end() } catch {}
            return reject(err)
          }
          stream
            .on('close', (code) => {
              if (settled) return
              settled = true
              clearTimeout(timer)
              try { conn.end() } catch {}
              if (code === 0) resolve(stdout.trim())
              else {
                const e = new Error(`SSH command failed (exit ${code}): ${stderr.trim() || stdout.trim()}`)
                e.exitCode = code
                e.stderr = stderr
                reject(e)
              }
            })
            .on('data', (data) => { stdout += data.toString() })
            .stderr.on('data', (data) => { stderr += data.toString() })
        })
      })
      .on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      })
      .connect({
        host,
        port: PORT,
        username: USER,
        privateKey: key,
        readyTimeout: TIMEOUT_MS,
      })
  })
}

async function health(host) {
  const out = await exec(host, 'health')
  return out === 'ok'
}

/**
 * Уникальные IP юзера за N часов на конкретной ноде.
 * @returns {Promise<string[]>}
 */
async function lookupIp(host, username, hours = 1) {
  if (!host) throw new Error('Missing host')
  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error('Invalid username')
  const h = Math.max(1, Math.min(168, parseInt(hours, 10) || 1))
  const out = await exec(host, `lookup ${username} ${h}`)
  if (!out) return []
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

/**
 * Парсит torrent-block записи.
 * @returns {Promise<Array<{username, ip, count}>>}
 */
async function scanTorrents(host, sinceISO) {
  if (!host) throw new Error('Missing host')
  if (!sinceISO || !/^\d{4}-\d{2}-\d{2}/.test(sinceISO)) throw new Error('Invalid since (YYYY-MM-DD)')
  const out = await exec(host, `scan-torrents ${sinceISO}`)
  if (!out) return []
  return out.split('\n').map(line => {
    const [username, ip, count] = line.split('\t')
    return { username, ip, count: parseInt(count, 10) || 0 }
  }).filter(r => r.username && r.ip)
}

module.exports = { isConfigured, health, lookupIp, scanTorrents }
