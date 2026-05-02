/**
 * IP-bans для Traffic Guard.
 *
 * Источники банов:
 *   - 'manual'         — вручную добавлен админом
 *   - 'auto_violation' — автомат при создании blocked-violation
 *
 * Длительность:
 *   - expires_at = NULL — пока активна связанная блокировка (resolved_at снимет ban)
 *   - expires_at = TIMESTAMP — N часов от создания (settings.ip_ban_duration_hours)
 *
 * Cleanup:
 *   - cleanupExpired() — удаляет истёкшие, вызывается из cron'а Traffic Guard
 *   - removeBansByViolation(violationId) — снимает ban при resolve violation
 */
const db = require('../db')

async function isIpBanned(ip) {
  if (!ip) return null
  const r = await db.query(
    `SELECT id, ip, reason, source, expires_at FROM banned_ips
     WHERE ip = $1 AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [ip]
  )
  return r.rows[0] || null
}

/**
 * Manual ban. Если `expiresAt` null — бессрочный.
 */
async function addManualBan({ ip, reason, expiresAt, createdBy, notes }) {
  if (!ip) throw new Error('Missing ip')
  const r = await db.query(
    `INSERT INTO banned_ips (ip, reason, source, expires_at, created_by, notes)
     VALUES ($1, $2, 'manual', $3, $4, $5)
     ON CONFLICT (ip) DO UPDATE SET
       reason     = EXCLUDED.reason,
       source     = 'manual',
       expires_at = EXCLUDED.expires_at,
       created_by = COALESCE(EXCLUDED.created_by, banned_ips.created_by),
       notes      = EXCLUDED.notes
     RETURNING *`,
    [ip, reason || null, expiresAt || null, createdBy || null, notes || null]
  )
  return r.rows[0]
}

/**
 * Авто-бан после blocked-violation. Использует registration_ip юзера.
 * Если durationHours = 0 → expires_at = NULL (пока активна блокировка).
 */
async function addAutoBan({ ip, violationId, userId, userUuid, durationHours, reason }) {
  if (!ip) return null
  const expiresAt = durationHours > 0
    ? new Date(Date.now() + durationHours * 3600 * 1000)
    : null
  try {
    const r = await db.query(
      `INSERT INTO banned_ips
        (ip, reason, source, related_violation_id, related_user_id, related_user_uuid, expires_at)
       VALUES ($1, $2, 'auto_violation', $3, $4, $5, $6)
       ON CONFLICT (ip) DO UPDATE SET
         related_violation_id = COALESCE(EXCLUDED.related_violation_id, banned_ips.related_violation_id),
         related_user_id      = COALESCE(EXCLUDED.related_user_id, banned_ips.related_user_id),
         related_user_uuid    = COALESCE(EXCLUDED.related_user_uuid, banned_ips.related_user_uuid),
         expires_at = CASE
           WHEN banned_ips.source = 'manual' THEN banned_ips.expires_at
           ELSE EXCLUDED.expires_at
         END
       RETURNING *`,
      [ip, reason || 'Превышение лимита трафика', violationId || null, userId || null, userUuid || null, expiresAt]
    )
    return r.rows[0]
  } catch (err) {
    console.error('[ipBan] addAutoBan error:', err.message)
    return null
  }
}

async function removeBan(id) {
  await db.query('DELETE FROM banned_ips WHERE id = $1', [id])
}

/**
 * Снимает все авто-баны связанные с конкретной violation (при resolve).
 * Manual-баны остаются — их снимает только админ напрямую.
 */
async function removeBansByViolation(violationId) {
  if (!violationId) return 0
  const r = await db.query(
    `DELETE FROM banned_ips
     WHERE related_violation_id = $1 AND source = 'auto_violation'
     RETURNING id`,
    [violationId]
  )
  return r.rowCount
}

async function cleanupExpired() {
  const r = await db.query(
    `DELETE FROM banned_ips
     WHERE expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`
  )
  return r.rowCount
}

async function listBans({ activeOnly, search, limit = 100, offset = 0 } = {}) {
  const where = []
  const params = []
  let idx = 1
  if (activeOnly === true) {
    where.push(`(expires_at IS NULL OR expires_at > NOW())`)
  } else if (activeOnly === false) {
    where.push(`expires_at IS NOT NULL AND expires_at < NOW()`)
  }
  if (search) {
    where.push(`(ip LIKE $${idx} OR reason ILIKE $${idx} OR related_user_uuid = $${idx + 1})`)
    params.push(`%${search}%`, search)
    idx += 2
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const r = await db.query(
    `SELECT b.*, u.email AS user_email, u.login AS user_login,
            cb.email AS created_by_email, cb.login AS created_by_login
     FROM banned_ips b
     LEFT JOIN users u  ON u.id  = b.related_user_id
     LEFT JOIN users cb ON cb.id = b.created_by
     ${whereSql}
     ORDER BY b.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  )
  const totalR = await db.query(
    `SELECT COUNT(*)::int AS n FROM banned_ips ${whereSql}`,
    params
  )
  return { items: r.rows, total: totalR.rows[0].n }
}

module.exports = {
  isIpBanned,
  addManualBan,
  addAutoBan,
  removeBan,
  removeBansByViolation,
  cleanupExpired,
  listBans,
}
