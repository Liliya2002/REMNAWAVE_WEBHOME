/**
 * Валидация Telegram Mini App initData (штатная авторизация WebApp).
 *
 * Telegram передаёт в мини-приложение подписанную строку initData:
 *   query_id=...&user=%7B...%7D&auth_date=1712345678&hash=abcdef...
 *
 * Алгоритм проверки (docs.telegram-mini-apps.com / core.telegram.org/bots/webapps):
 *   1. Убираем поле hash, остальные пары сортируем по ключу
 *   2. data_check_string = "key=value" через \n
 *   3. secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 *   4. ожидаемый hash = HMAC_SHA256(key=secret_key, msg=data_check_string)
 *   5. сравниваем с переданным hash (timing-safe)
 *
 * Дополнительно проверяем свежесть auth_date — иначе перехваченная initData
 * оставалась бы валидной вечно.
 */
const crypto = require('crypto')

// Максимальный возраст initData. Telegram обновляет её при каждом открытии
// мини-аппа, поэтому сутки — с запасом (сессия внутри WebView может жить долго).
const MAX_AGE_SEC = parseInt(process.env.TG_WEBAPP_INITDATA_MAX_AGE_SEC || '86400', 10)

/**
 * @param {string} initData — сырая строка из window.Telegram.WebApp.initData
 * @param {string} botToken — токен бота
 * @returns {{ ok: true, user: object, authDate: Date } | { ok: false, error: string }}
 */
function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') return { ok: false, error: 'initData не передана' }
  if (!botToken) return { ok: false, error: 'Токен бота не настроен' }

  let params
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, error: 'initData повреждена' }
  }

  const hash = params.get('hash')
  if (!hash) return { ok: false, error: 'В initData нет hash' }

  // data_check_string: все поля кроме hash, отсортированные по ключу.
  const pairs = []
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue
    pairs.push(`${k}=${v}`)
  }
  pairs.sort()
  const dataCheckString = pairs.join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  // Timing-safe сравнение (обе строки hex одинаковой длины — иначе сразу мимо).
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Подпись initData неверна' }
  }

  // Свежесть auth_date
  const authDateRaw = parseInt(params.get('auth_date') || '0', 10)
  if (!authDateRaw) return { ok: false, error: 'В initData нет auth_date' }
  const ageSec = Math.floor(Date.now() / 1000) - authDateRaw
  if (ageSec > MAX_AGE_SEC) {
    return { ok: false, error: 'Данные авторизации устарели — переоткройте приложение' }
  }

  // user приходит JSON-строкой
  let user
  try {
    user = JSON.parse(params.get('user') || 'null')
  } catch {
    return { ok: false, error: 'Некорректные данные пользователя в initData' }
  }
  if (!user || !user.id) return { ok: false, error: 'В initData нет пользователя' }

  return { ok: true, user, authDate: new Date(authDateRaw * 1000) }
}

module.exports = { verifyInitData, MAX_AGE_SEC }
