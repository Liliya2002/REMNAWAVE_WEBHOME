/**
 * Строка лога на каждый запрос к API.
 *
 * До этого HTTP-запросы не логировались вообще: в логах было только то, что
 * кто-то явно написал через console. Разобрать «кто, когда и чем дёрнул» было
 * не по чему — а именно это нужно, когда клиент говорит «я оплатил, а денег
 * нет» или когда в панель кто-то ломится.
 *
 * Формат:
 *
 *   12.09 17:04:31  запрос   POST /api/payments/webhook → 200 · 45 мс · 176.15.22.8 · вебхук оплаты
 *   12.09 17:04:33  ВНИМАНИЕ POST /auth/login → 401 · 12 мс · 176.15.22.8 · вход в аккаунт · неверные данные входа
 *   12.09 17:09:10  ОШИБКА   GET /api/admin/bedolaga/accounts/1/users → 502 · 9.8 с · админ #1 · внешний сервис не ответил
 *
 * Тело запроса не пишется никогда. В нём пароли, ключи платёжек и токены
 * провайдеров; один такой лог, отправленный в поддержку, — это утечка.
 */
const logger = require('../services/logger')

/**
 * Пути, которые в спокойном состоянии молчат.
 *
 * Это опросы, а не действия: фронт дёргает их на каждой навигации и по таймеру,
 * и в логе они дают больше строк, чем всё остальное вместе взятое. Смысла в
 * записи «статус обслуживания: выключено» ровно ноль — пока она не 4xx/5xx или
 * не медленная, а такие пишутся всегда.
 */
const QUIET = [
  /^\/api\/health/,
  /^\/api\/maintenance\/status/,
  /^\/api\/admin\/public\/config/,
  /^\/uploads\//,
  /^\/favicon/,
  /^\/assets\//,
]

/** Запросы, которые стоит узнавать в лицо. Остальные и так читаются по пути. */
const NAMES = [
  [/^\/api\/payments\/webhook/,        'вебхук оплаты'],
  [/^\/api\/payments/,                 'оплата'],
  [/^\/api\/promo/,                    'промокод'],
  [/^\/auth\/login/,                   'вход в аккаунт'],
  [/^\/auth\/register/,                'регистрация'],
  [/^\/auth\/(telegram|tg-login)/,     'вход через Telegram'],
  [/^\/auth\/(forgot|reset)/,          'восстановление пароля'],
  [/^\/api\/tg\/webhook/,              'обновление от Telegram'],
  [/^\/api\/webhooks/,                 'вебхук RemnaWave'],
  [/^\/api\/admin\/bedolaga\/.*broadcast/, 'рассылки'],
  [/^\/api\/admin\/system\/deploy/,    'обновление проекта'],
  [/^\/api\/admin\/payment-settings/,  'настройки платёжек'],
  [/^\/api\/admin/,                    'админка'],
  [/^\/api\/subscriptions/,            'подписки'],
]

/** Что означает код ответа — словами, а не числом. */
function phrase(status) {
  if (status < 400) return null                       // всё хорошо, пояснять нечего
  if (status === 400) return 'запрос не прошёл проверку'
  if (status === 401) return 'не авторизован'
  if (status === 403) return 'доступ запрещён'
  if (status === 404) return 'адрес не найден'
  if (status === 409) return 'конфликт с текущим состоянием'
  if (status === 413) return 'тело запроса слишком большое'
  if (status === 429) return 'сработал лимит запросов'
  if (status === 502 || status === 504) return 'внешний сервис не ответил'
  if (status === 503) return 'сервис временно недоступен'
  if (status >= 500) return 'ошибка на нашей стороне'
  return 'запрос отклонён'
}

function nameOf(path) {
  for (const [re, name] of NAMES) if (re.test(path)) return name
  return null
}

function ms(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} с` : `${n} мс`
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  const raw = fwd ? String(fwd).split(',')[0].trim() : (req.ip || req.socket?.remoteAddress || '')
  // ::ffff:127.0.0.1 — это IPv4-адрес в обёртке IPv6. В логе от обёртки только шум.
  return raw.replace(/^::ffff:/, '') || '—'
}

/**
 * @param {object} [opts]
 * @param {number} [opts.slowMs=2000] с какой задержки запрос считать медленным
 */
module.exports = function requestLog({ slowMs = 2000 } = {}) {
  return function (req, res, next) {
    // Путь снимаем СРАЗУ и из originalUrl. К моменту события finish Express уже
    // переписал req.url и req.path на остаток относительно сработавшего
    // роутера: «/auth/login» превращается в «/login», а «/api/plans» — в «/».
    // originalUrl не меняется за время запроса.
    const qs = req.originalUrl.indexOf('?')
    const path = qs === -1 ? req.originalUrl : req.originalUrl.slice(0, qs)
    // Параметры не пишем: там одноразовые токены входа и подписи вебхуков.
    // Отмечаем лишь сам факт, что они были.
    const q = qs === -1 ? '' : ' (+параметры)'

    const quiet = QUIET.some(re => re.test(path))
    const started = process.hrtime.bigint()

    res.on('finish', () => {
      const took = Number((process.hrtime.bigint() - started) / 1000000n)
      const status = res.statusCode
      const slow = took >= slowMs

      // Молчаливые пути показываем, только если что-то пошло не так: упавший
      // health-check — как раз то, что важно увидеть.
      if (quiet && status < 400 && !slow) return

      const bits = []
      bits.push(`${req.method} ${path}${q} → ${status}`)
      bits.push(ms(took))

      if (req.userId) bits.push(`пользователь #${req.userId}`)
      else bits.push(clientIp(req))

      const name = nameOf(path)
      if (name) bits.push(name)

      const why = phrase(status)
      if (why) bits.push(why)
      if (slow) bits.push('МЕДЛЕННО')

      const line = bits.join(' · ')
      if (status >= 500) logger.error(line)
      else if (status >= 400 || slow) logger.warn(line)
      else logger.http(line)
    })

    next()
  }
}
