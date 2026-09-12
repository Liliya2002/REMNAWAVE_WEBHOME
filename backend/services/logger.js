/**
 * Логи проекта: единый формат, человеческие формулировки, без секретов.
 *
 * Зачем вообще отдельный модуль. Логи уезжают в stdout контейнера и читаются
 * потом через `docker compose logs`. Там нет ни подсветки, ни возможности
 * отфильтровать по уровню — есть только текст. Значит, текст и должен нести
 * всё: когда, насколько важно, откуда и что произошло словами.
 *
 * Формат строки:
 *
 *   12.09 17:04:22  инфо     [Платежи] Platega настроена (источник: админка)
 *   12.09 17:04:31  запрос   POST /api/payments/webhook → 200 · 45 мс · 176.15.22.8
 *   12.09 17:05:02  ОШИБКА   [Рассылки] Не удалось отправить — Bedolaga не отвечает
 *
 * Время местное (LOG_TZ, по умолчанию Europe/Moscow): контейнер живёт в UTC, и
 * читать «14:04», когда на часах 17:04, неудобно ровно в тот момент, когда
 * логи и нужны — при разборе аварии.
 *
 * Уровни капсом только у важного (ВНИМАНИЕ, ОШИБКА): в сплошном потоке взгляд
 * цепляется за них сам, без grep.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

// Подписи фиксированной ширины — тогда сообщения выстраиваются в колонку и
// строка читается по вертикали, а не как сплошная каша.
const LABELS = {
  debug: 'отладка ',
  info:  'инфо    ',
  warn:  'ВНИМАНИЕ',
  error: 'ОШИБКА  ',
  http:  'запрос  ',
}

const COLORS = {
  debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m',
  error: '\x1b[31m', http: '\x1b[35m', reset: '\x1b[0m', dim: '\x1b[2m',
}

// Цвет только в живом терминале. В Docker stdout не TTY, и escape-последова-
// тельности превратились бы в мусор вида «ESC[36m» посреди строки.
const useColor = !!process.stdout.isTTY && process.env.NO_COLOR == null

const minLevel = LEVELS[String(process.env.LOG_LEVEL || '').toLowerCase()]
  || (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug)

const TZ = process.env.LOG_TZ || 'Europe/Moscow'

let fmt
try {
  fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ, day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
} catch {
  // Неизвестная зона не должна ронять процесс на первой же строке лога.
  fmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

function stamp() {
  // «12.09.2026, 17:04:22» → «12.09 17:04:22»: год в логе не нужен, он понятен
  // из контекста, а место в начале строки дорогое. Запятую-разделитель убираем
  // отдельно: в разных версиях ICU она то есть, то нет.
  return fmt.format(new Date())
    .replace(/\.?\d{4}\s*г?\.?/, '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Секреты ────────────────────────────────────────────────────────────────

/**
 * Ключи, значение которых не должно попасть в лог никогда.
 *
 * Это не паранойя: логи читают по SSH, копируют в переписку и присылают в
 * поддержку. Один токен в такой строке — и его видел уже не только владелец.
 */
const SECRET_KEY = /(token|secret|password|passwd|pwd|api[_-]?key|authorization|cookie|session|private|signature|initdata)/i

/** Похоже на ключ/токен: длинная сплошная строка без пробелов. */
const SECRET_VALUE = [
  /\bBearer\s+[\w\-._~+/]+=*/gi,          // заголовок Authorization
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, // JWT
  /\by0__[\w-]{20,}/g,                    // OAuth Яндекса
  /\b[0-9]{8,10}:AA[\w-]{30,}/g,          // токен Telegram-бота
  /\b[a-f0-9]{32,}\b/gi,                  // hex-ключи, хеши
]

function maskString(s) {
  let out = String(s)
  for (const re of SECRET_VALUE) out = out.replace(re, m => hide(m))
  // Пары «ключ=значение» и «ключ: значение» в свободном тексте и query-строках
  out = out.replace(/([?&;]|\b)([\w.-]*(?:token|secret|password|passwd|key|signature|initdata)[\w.-]*)\s*[=:]\s*([^\s&;,"']+)/gi,
    (m, pre, key, val) => `${pre}${key}=${hide(val)}`)
  return out
}

function hide(v) {
  const s = String(v)
  if (s.length <= 8) return '***'
  return s.slice(0, 4) + '…***(' + s.length + ')'
}

/** Рекурсивно чистит объект перед выводом. Глубина ограничена — логи не дамп. */
function sanitize(value, depth = 0) {
  if (value == null) return value
  if (typeof value === 'string') return maskString(value)
  if (typeof value !== 'object') return value
  if (depth > 4) return '…'
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1))

  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) { out[k] = typeof v === 'string' || typeof v === 'number' ? hide(v) : '***' }
    else out[k] = sanitize(v, depth + 1)
  }
  return out
}

// ─── Человеческие формулировки ──────────────────────────────────────────────

/** Коды PostgreSQL, которые реально встречаются, — словами. */
const PG = {
  '23505': 'запись с таким значением уже есть',
  '23503': 'ссылка на запись, которой нет',
  '23502': 'обязательное поле осталось пустым',
  '22P02': 'значение не подходит по типу (например, текст вместо числа)',
  '42703': 'в таблице нет такой колонки — скорее всего не применена миграция',
  '42P01': 'нет такой таблицы — скорее всего не применена миграция',
  '42804': 'типы в запросе не сходятся',
  '28P01': 'база отклонила пароль',
  '3D000': 'базы с таким именем нет',
  '53300': 'у базы кончились свободные соединения',
  '57P03': 'база ещё запускается и не принимает запросы',
  '40P01': 'взаимная блокировка запросов, транзакция отменена',
  '55P03': 'строка занята другой транзакцией',
}

/** Сетевые ошибки Node — словами. */
const NET = {
  ECONNREFUSED: 'соединение отклонено — служба не запущена или закрыт порт',
  ECONNRESET: 'соединение оборвала другая сторона',
  ETIMEDOUT: 'сторона не ответила вовремя',
  ENOTFOUND: 'не удалось найти такой адрес (ошибка в имени хоста или нет DNS)',
  EAI_AGAIN: 'DNS временно недоступен',
  EHOSTUNREACH: 'до хоста нет маршрута',
  ENETUNREACH: 'сеть недоступна',
  EPIPE: 'соединение закрылось на середине передачи',
  ECONNABORTED: 'запрос прерван',
  EACCES: 'нет прав на это действие или порт занят',
  EADDRINUSE: 'порт уже занят другим процессом',
  ENOSPC: 'на диске кончилось место',
  EMFILE: 'кончились свободные файловые дескрипторы',
}

/**
 * Ошибка → фраза, которую поймёт владелец проекта, а не только разработчик.
 *
 * «error: relation "broadcast_settings" does not exist» ни о чём не говорит,
 * а «нет такой таблицы — скорее всего не применена миграция» говорит сразу,
 * что делать. Технический текст при этом не выбрасываем: он нужен, когда
 * фразы недостаточно, — просто уходит в хвост строки.
 */
function human(err) {
  if (!err) return 'неизвестная ошибка'
  if (typeof err === 'string') return maskString(err)

  const raw = maskString(err.message || String(err))
  const parts = []

  if (err.code && PG[err.code]) parts.push(PG[err.code])
  else if (err.code && NET[err.code]) parts.push(NET[err.code])
  else if (err.status === 401 || err.statusCode === 401) parts.push('ключ доступа отклонён')
  else if (err.status === 403 || err.statusCode === 403) parts.push('доступ запрещён')
  else if (err.status === 404 || err.statusCode === 404) parts.push('адрес не найден')
  else if (err.status === 429 || err.statusCode === 429) parts.push('слишком много запросов, нас притормозили')
  else if (err.status >= 500 || err.statusCode >= 500) parts.push('на стороне сервиса ошибка')
  else if (err instanceof SyntaxError && /JSON/i.test(raw)) parts.push('в ответе не JSON')

  if (!parts.length) return raw
  // Техническую формулировку оставляем — по ней ищут в поиске и в issues.
  return `${parts[0]} (${raw})`
}

// ─── Вывод ──────────────────────────────────────────────────────────────────

function render(level, tag, message, extra) {
  const label = LABELS[level] || LABELS.info
  const head = useColor
    ? `${COLORS.dim}${stamp()}${COLORS.reset}  ${COLORS[level] || ''}${label}${COLORS.reset}`
    : `${stamp()}  ${label}`

  const body = tag ? `[${tag}] ${message}` : message
  let line = `${head}  ${body}`

  if (extra !== undefined) {
    const s = sanitize(extra)
    let text
    try { text = typeof s === 'string' ? s : JSON.stringify(s) } catch { text = '[не удалось сериализовать]' }
    if (text && text !== '{}') line += useColor ? `  ${COLORS.dim}${text}${COLORS.reset}` : `  ${text}`
  }
  return line
}

function emit(level, tag, message, extra) {
  if ((LEVELS[level] || LEVELS.info) < minLevel) return
  const line = render(level, tag, message, extra)
  // warn и error — в stderr: Docker помечает поток, и в `docker logs` их можно
  // отделить от обычных сообщений (`2>/dev/null` оставит только их).
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

/**
 * Логгер с постоянной меткой раздела.
 * @example const log = require('./logger').for('Платежи')
 */
function forTag(tag) {
  return {
    debug: (msg, extra) => emit('debug', tag, msg, extra),
    info: (msg, extra) => emit('info', tag, msg, extra),
    warn: (msg, extra) => emit('warn', tag, msg, extra),
    /** Принимает и текст, и объект Error — во втором случае переводит на русский. */
    error: (msg, errOrExtra) => {
      if (errOrExtra instanceof Error) emit('error', tag, `${msg} — ${human(errOrExtra)}`)
      else emit('error', tag, msg, errOrExtra)
    },
    http: (msg, extra) => emit('http', tag, msg, extra),
  }
}

// ─── Перехват console.* ─────────────────────────────────────────────────────

/**
 * Подмешать метку времени и уровень ко всем существующим console.*.
 *
 * В коде проекта около 470 вызовов console.log/warn/error, и почти все уже
 * несут метку раздела в квадратных скобках — не хватало только времени и
 * уровня. Переписывать 470 мест ради этого значило бы 470 шансов что-нибудь
 * задеть; обёртка даёт тот же результат одной строкой в index.js и не меняет
 * поведение: аргументы те же, порядок тот же, поток тот же.
 *
 * Ставится один раз при старте. Повторный вызов ничего не делает.
 */
let installed = false
function install() {
  if (installed) return
  installed = true

  const native = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  }

  const wrap = (level, out) => (...args) => {
    if ((LEVELS[level] || LEVELS.info) < minLevel) return
    // Метку раздела вида «[Платежи]» вызывающий код уже пишет сам первым
    // аргументом — отдельным полем её не выносим, чтобы не разбирать строку.
    const text = args.map(a => {
      if (typeof a === 'string') return maskString(a)
      if (a instanceof Error) return human(a)
      try { return JSON.stringify(sanitize(a)) } catch { return String(a) }
    }).join(' ')
    out(render(level, null, text))
  }

  console.log = wrap('info', native.log)
  console.info = wrap('info', native.info)
  console.warn = wrap('warn', native.warn)
  console.error = wrap('error', native.error)
  console.debug = wrap('debug', native.debug)

  return native
}

module.exports = {
  for: forTag, install, human, sanitize, maskString,
  debug: (m, e) => emit('debug', null, m, e),
  info: (m, e) => emit('info', null, m, e),
  warn: (m, e) => emit('warn', null, m, e),
  error: (m, e) => emit('error', null, m, e),
  http: (m, e) => emit('http', null, m, e),
  LEVELS, minLevel, TZ,
}
