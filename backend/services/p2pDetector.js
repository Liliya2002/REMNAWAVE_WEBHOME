/**
 * P2P/Torrent detector — периодически сканирует access.log на нодах через SSH-агент,
 * ищет записи с тегом [torrent-block] и создаёт violations level='torrent_warning' /
 * 'torrent_blocked' при превышении порога torrent_attempts_threshold.
 *
 * Точка входа — runScan(). Вызывается из cron/p2pDetector.js
 *
 * Логика:
 *   1. settings.p2p_detect_enabled? иначе — no-op
 *   2. SSH-агент настроен? иначе — no-op
 *   3. Для каждой ноды (где у admin не явно отключено block_torrents=false):
 *      - SSH scan-torrents с момента last_p2p_scan_at (или 24ч назад)
 *      - Парсим вывод: пары username/ip/count
 *   4. Группируем по username, суммируем count по нодам
 *   5. Если count >= threshold:
 *      - Создаём violation level='torrent_warning' (если ещё нет за этот period_key)
 *      - Если повторно (≥2 окна) — level='torrent_blocked' + действие из settings
 *      - В client_ips пишем найденные IP (для бана)
 *      - При torrent_action='ip_ban' и ip_ban_enabled — банит IP
 *      - При torrent_action='disable_user' — disableRemnwaveUser
 *   6. Обновляет last_p2p_scan_at и last_p2p_scan_summary
 */
const db = require('../db')
const remnwave = require('./remnwave')
const sshAgent = require('./sshAgent')
const ipBan = require('./ipBan')
const notifications = require('./notifications')
const { sendNotificationEmail } = require('./email')
const trafficGuard = require('./trafficGuard')

async function getSettings() {
  const r = await db.query('SELECT * FROM traffic_guard_settings WHERE id = 1')
  return r.rows[0]
}

function periodKey(date = new Date()) {
  // 'p2p:YYYY-MM-DD-HH' — ключ окна агрегации (час)
  const pad = (n) => String(n).padStart(2, '0')
  return `p2p:${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}`
}

async function applyTorrentAction(action, userUuid) {
  if (action === 'warn_only') return { applied: false, reason: 'warn_only' }
  if (action === 'disable_user') {
    try {
      await remnwave.disableRemnwaveUser(userUuid)
      return { applied: true, action: 'disabled_user' }
    } catch (err) {
      return { applied: false, error: err.message }
    }
  }
  if (action === 'ip_ban') {
    return { applied: false, reason: 'ip_ban_only_handled_by_collected_ips' }
  }
  return { applied: false }
}

async function runScan() {
  const startedAt = Date.now()
  const settings = await getSettings()
  if (!settings) return { ok: false, reason: 'no_settings' }
  if (!settings.p2p_detect_enabled) return { ok: false, reason: 'p2p_disabled' }
  if (!sshAgent.isConfigured()) return { ok: false, reason: 'ssh_not_configured' }

  // Получаем ноды для сканирования: все по умолчанию, но админ может ограничить через node_traffic_limits.block_torrents
  const allNodes = await remnwave.getNodes().catch(() => [])
  if (!allNodes.length) return { ok: false, reason: 'no_nodes' }

  const limitsR = await db.query('SELECT node_uuid, block_torrents FROM node_traffic_limits')
  const limitMap = new Map(limitsR.rows.map(r => [r.node_uuid, r.block_torrents]))

  // Сканируем только те ноды, где или явно включено block_torrents, или нет записи (т.е. админ не настраивал — сканируем всё)
  const nodesToScan = allNodes.filter(n => {
    const lim = limitMap.get(n.uuid)
    return lim === undefined || lim === true
  })

  // Окно сканирования — по умолчанию 24 часа (с этого времени Xray-логи актуальны)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const sinceISO = since.toISOString().slice(0, 10) // YYYY-MM-DD

  // userUuid (RW) → { username, totalCount, perNode: {nodeUuid: count}, ips: Set, nodeNames: Map }
  const userMap = new Map()
  const usersByUsername = new Map() // username -> {uuid, user_id, email}
  const errors = []

  // Подгрузим всех наших юзеров для мапинга username → user_id
  const ourUsersR = await db.query(`
    SELECT s.remnwave_user_uuid AS uuid, s.remnwave_username AS username, s.user_id, u.email
    FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.remnwave_user_uuid IS NOT NULL
  `)
  for (const row of ourUsersR.rows) {
    if (row.username) usersByUsername.set(row.username, row)
  }

  for (const node of nodesToScan) {
    if (!node.address) continue
    try {
      const records = await sshAgent.scanTorrents(node.address, sinceISO)
      for (const rec of records) {
        const userInfo = usersByUsername.get(rec.username)
        if (!userInfo) continue // RW-юзер не наш — пропускаем
        let entry = userMap.get(userInfo.uuid)
        if (!entry) {
          entry = {
            userUuid: userInfo.uuid,
            user_id: userInfo.user_id,
            email: userInfo.email,
            username: rec.username,
            totalCount: 0,
            perNode: {},
            ips: new Set(),
            nodeNames: new Map(),
          }
          userMap.set(userInfo.uuid, entry)
        }
        entry.totalCount += rec.count
        entry.perNode[node.uuid] = (entry.perNode[node.uuid] || 0) + rec.count
        entry.nodeNames.set(node.uuid, node.name)
        if (rec.ip) entry.ips.add(rec.ip)
      }
    } catch (err) {
      errors.push({ nodeUuid: node.uuid, nodeName: node.name, error: err.message })
    }
  }

  let warnings = 0
  let blocks = 0
  const threshold = settings.torrent_attempts_threshold || 5
  const pkey = periodKey()

  for (const entry of userMap.values()) {
    if (entry.totalCount < threshold) continue
    // Самая «загруженная» нода — для node_uuid в violation
    let topNodeUuid = null
    let topCount = 0
    for (const [uuid, count] of Object.entries(entry.perNode)) {
      if (count > topCount) { topCount = count; topNodeUuid = uuid }
    }
    const topNodeName = entry.nodeNames.get(topNodeUuid) || '—'
    const ipsArr = [...entry.ips]

    // Решаем уровень. Сначала всегда warning. Если уже была warning сегодня — escalate to blocked.
    const todayKey = `p2p:${new Date().toISOString().slice(0, 10)}`
    const existingR = await db.query(
      `SELECT level FROM traffic_violations
       WHERE remnwave_user_uuid = $1 AND period = 'p2p' AND period_key LIKE $2
       ORDER BY detected_at DESC`,
      [entry.userUuid, `${todayKey}%`]
    )
    const hasWarning = existingR.rows.some(r => r.level === 'torrent_warning')
    const hasBlocked = existingR.rows.some(r => r.level === 'torrent_blocked')

    let level
    if (hasBlocked) continue // уже блокирован сегодня
    else if (hasWarning) level = 'torrent_blocked'
    else level = 'torrent_warning'

    try {
      const ins = await db.query(
        `INSERT INTO traffic_violations
          (user_id, remnwave_user_uuid, username, node_uuid, node_name,
           used_bytes, limit_bytes, used_percent, level, period, period_key,
           client_ips, action_taken)
         VALUES ($1,$2,$3,$4,$5,0,0,0,$6,'p2p',$7,$8::jsonb,'pending')
         ON CONFLICT (remnwave_user_uuid, node_uuid, period_key, level) DO NOTHING
         RETURNING *`,
        [entry.user_id, entry.userUuid, entry.username, topNodeUuid, topNodeName,
         level, `${todayKey}-${level}`, JSON.stringify(ipsArr)]
      )
      const row = ins.rows[0]
      if (!row) continue

      if (level === 'torrent_blocked') {
        // Action — disable / ip_ban / warn
        const result = await applyTorrentAction(settings.torrent_action, entry.userUuid)
        // IP-ban при включенном ip_ban_enabled или torrent_action='ip_ban'
        if ((settings.ip_ban_enabled || settings.torrent_action === 'ip_ban') && ipsArr.length > 0) {
          for (const ip of ipsArr) {
            await ipBan.addAutoBan({
              ip,
              violationId: row.id,
              userId: entry.user_id,
              userUuid: entry.userUuid,
              durationHours: settings.ip_ban_duration_hours,
              reason: `P2P/torrent (${entry.totalCount} попыток)`,
            })
          }
        }
        await db.query(
          `UPDATE traffic_violations SET action_taken=$1, notes=$2 WHERE id=$3`,
          [result.applied ? (result.action || 'disabled_user') : (settings.torrent_action === 'ip_ban' ? 'ip_ban' : 'failed'),
           JSON.stringify({ totalCount: entry.totalCount, perNode: entry.perNode, applyResult: result }),
           row.id]
        )
        // Notify
        if (settings.inapp_enabled && entry.user_id) {
          await notifications.notifyTrafficBlocked(entry.user_id, {
            nodeName: topNodeName,
            usedGb: '?',
            limitGb: 'P2P-нарушение',
          }).catch(() => {})
        }
        if (settings.email_enabled && entry.email) {
          await sendNotificationEmail(entry.email, {
            subject: 'Подписка отключена — P2P/torrent',
            heading: '🚫 Обнаружено использование BitTorrent',
            body: `На нашем сервисе обнаружено использование BitTorrent (${entry.totalCount} попыток). В соответствии с правилами сервиса подписка отключена.<br><br>Если вы считаете это ошибкой — свяжитесь с поддержкой.`,
            ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
            ctaText: 'Открыть кабинет',
            accent: '#ef4444',
          }).catch(() => {})
        }
        blocks++
      } else {
        // Warning — только нотификация
        await db.query(`UPDATE traffic_violations SET action_taken='notified', notes=$1 WHERE id=$2`,
          [JSON.stringify({ totalCount: entry.totalCount, perNode: entry.perNode }), row.id])
        if (settings.inapp_enabled && entry.user_id) {
          await notifications.notifyTrafficWarning(entry.user_id, {
            nodeName: topNodeName,
            usedGb: 'P2P',
            limitGb: 'нарушение',
            percent: '!',
          }).catch(() => {})
        }
        warnings++
      }
    } catch (err) {
      console.error('[p2pDetector] insert violation failed:', err.message)
    }
  }

  const summary = `nodes:${nodesToScan.length} users:${userMap.size} warn:${warnings} block:${blocks} err:${errors.length}`
  console.log(`[p2pDetector] scan: ${summary}`)

  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    nodesScanned: nodesToScan.length,
    usersDetected: userMap.size,
    warnings, blocks,
    errors,
  }
}

module.exports = { runScan }
