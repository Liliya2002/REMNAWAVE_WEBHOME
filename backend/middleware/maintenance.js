/**
 * maintenanceGuard — режет публичный доступ когда включён maintenance_mode
 * ИЛИ admin_only_mode («Админский режим»).
 *
 * Логика:
 *   1. Если оба OFF → пропускаем всё.
 *   2. Если включён любой:
 *      - Whitelisted пути (ниже) пропускаются всегда — например /auth/login,
 *        /api/admin/*, /api/maintenance/status, /api/health, статика.
 *      - Для остальных пытаемся декодировать JWT и проверить is_admin → пропускаем.
 *      - Иначе: admin_only_mode → 403 { adminOnly: true }; maintenance → 503 { maintenance: true }.
 *        admin_only_mode приоритетнее (проект закрыт для всех, кроме админов).
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
  // Платёжные вебхуки провайдеров — server-to-server колбэки без токена.
  // Их НИКОГДА нельзя блокировать (иначе оплата не активирует подписку в
  // admin_only/maintenance режимах). Подпись вебхука проверяется в самом роуте.
  /^\/api\/payments\/webhook$/,
  /^\/api\/webhooks(\/|$)/,
  /^\/auth\/login$/,
  // Входы через Telegram (Mini App, одноразовый токен из бота, OIDC).
  // На момент запроса у юзера ещё НЕТ JWT — он его как раз получает, поэтому
  // isAdminFromToken() здесь всегда false и гвард отбивал бы даже админа.
  // Права проверяют сами роуты: при adminOnly они пускают только is_admin.
  /^\/auth\/telegram\/webapp$/,
  /^\/auth\/tg-login$/,
  /^\/auth\/telegram\/(oidc\/(start|info)|callback|availability)$/,
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

  // Ничего не включено — пропускаем всё.
  if (!status.maintenance && !status.adminOnly) return next()

  // Whitelisted пути доступны всегда (нужны чтобы админ мог войти и работать).
  for (const re of ALLOWED) {
    if (re.test(req.path)) return next()
  }

  // Админам всё открыто в обоих режимах.
  if (await isAdminFromToken(req)) return next()

  // Админский режим приоритетнее техработ: проект закрыт для всех не-админов.
  if (status.adminOnly) {
    return res.status(403).json({
      adminOnly: true,
      message: 'Доступ ограничен: проект работает в административном режиме',
    })
  }

  return res.status(503).json({
    maintenance: true,
    message: status.message,
  })
}

module.exports = maintenanceGuard
