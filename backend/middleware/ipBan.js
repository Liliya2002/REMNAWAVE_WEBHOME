/**
 * Middleware: блокирует входящий запрос если IP в banned_ips.
 *
 * Используется на /auth/register. Уже зарегистрированных юзеров не отрезаем
 * (login пропускает, чтобы не выкидывать настоящих юзеров за CGNAT-соседа).
 */
const ipBan = require('../services/ipBan')

async function checkBannedIp(req, res, next) {
  try {
    const ip = req.ip
    if (!ip) return next()
    const ban = await ipBan.isIpBanned(ip)
    if (ban) {
      return res.status(403).json({
        error: 'Регистрация с этого IP-адреса временно ограничена',
        code: 'IP_BANNED',
        // Подсказка но без деталей чтобы не светить причину
        until: ban.expires_at,
      })
    }
    next()
  } catch (err) {
    console.error('[checkBannedIp] error:', err.message)
    // При ошибке — пропускаем, не блокируем регистрацию из-за нашего бага
    next()
  }
}

module.exports = { checkBannedIp }
