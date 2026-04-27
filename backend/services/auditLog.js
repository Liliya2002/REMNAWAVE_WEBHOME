/**
 * Сервис журналирования действий администратора.
 *
 * Использование (в роутах):
 *   const audit = require('../services/auditLog')
 *   await audit.write(req, 'user.update', { type: 'user', id: userId }, { before, after })
 *
 * Схема таблицы admin_audit_log создаётся миграцией 0019_admin_audit.
 * Если запись не получилась — логируем в console.error, основную операцию не блокируем.
 */
const db = require('../db')

function clientIp(req) {
  if (!req) return null
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    null
  )
}

async function getAdminLogin(adminId) {
  if (!adminId) return null
  try {
    const r = await db.query('SELECT login FROM users WHERE id = $1', [adminId])
    return r.rows[0]?.login || null
  } catch {
    return null
  }
}

/**
 * Записать строку аудита.
 * @param {object} req — express request (для admin_id, ip, user-agent)
 * @param {string} action — например 'user.update'
 * @param {{type:string, id?:string|number}} target
 * @param {object} [changes] — { before, after } или произвольные детали
 */
async function write(req, action, target = {}, changes = {}) {
  try {
    const adminId = req?.userId || null
    const adminLogin = await getAdminLogin(adminId)
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, admin_login, action, target_type, target_id, changes, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        adminId,
        adminLogin,
        action,
        target.type || null,
        target.id != null ? String(target.id) : null,
        changes || {},
        clientIp(req),
        req?.headers?.['user-agent'] || null
      ]
    )
  } catch (err) {
    console.error('[Audit] write failed:', err.message)
  }
}

/**
 * Diff двух объектов: возвращает только поля, которые изменились.
 * Удобно для { before: pickChanged(...), after: pickChanged(...) }.
 */
function diff(before, after, keys) {
  const b = {}, a = {}
  for (const k of keys) {
    const bv = before?.[k]
    const av = after?.[k]
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k] = bv
      a[k] = av
    }
  }
  return { before: b, after: a, changed: Object.keys(a) }
}

module.exports = { write, diff }
