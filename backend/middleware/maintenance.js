/**
 * maintenanceGuard — режет публичный доступ когда включён maintenance_mode.
 *
 * Логика:
 *   1. Если maintenance OFF → пропускаем всё.
 *   2. Если ON:
 *      - Whitelisted пути (ниже) пропускаются всегда — например /auth/login,
 *        /api/admin/*, /api/maintenance/status, /api/health, статика.
 *      - Для остальных пытаемся декодировать JWT и проверить is_admin → пропускаем.
 *      - Иначе — 503 с JSON { maintenance: true, message }.
 *
 * Применяется в index.js до всех "защищаемых" роутов.
 */
const jwt = require('jsonwebtoken')
const db = require('../db')
const maint = require('../services/maintenance')

// Что доступно ВСЕГДА, даже в техработах:
const ALLOWED = [
  /^\/api\/health$/,
  /^\/api\/maintenance(\/|$)/,
  /^\/api\/admin(\/|$)/,
  /^\/api\/me$/,
  /^\/auth\/login$/,
  /^\/auth\/forgot-password$/,
  /^\/auth\/reset-password$/,
  /^\/uploads\//,
  /^\/sitemap\.xml$/,
  /^\/robots\.txt$/,
]

async function isAdminFromToken(req) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return false
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (!decoded?.id) return false
    const r = await db.query('SELECT is_admin FROM users WHERE id = $1', [decoded.id])
    return !!r.rows[0]?.is_admin
  } catch {
    return false
  }
}

async function maintenanceGuard(req, res, next) {
  let status
  try {
    status = await maint.getStatus()
  } catch {
    return next() // fail-open
  }

  if (!status.maintenance) return next()

  for (const re of ALLOWED) {
    if (re.test(req.path)) return next()
  }

  if (await isAdminFromToken(req)) return next()

  return res.status(503).json({
    maintenance: true,
    message: status.message,
  })
}

module.exports = maintenanceGuard
