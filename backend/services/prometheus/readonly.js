/**
 * PROMETHEUS: слой доступа «только чтение».
 *
 * Здесь живёт единственное обещание, на котором держится весь раздел: этот
 * интеллект НИЧЕГО не меняет. Обещание в промпте ничего не стоит — модель его
 * нарушит при первой возможности или по ошибке, — поэтому запрет сделан
 * механизмами, которые от текста промпта не зависят вовсе.
 *
 * Три независимых рубежа. Чтобы что-то записать в базу, придётся пройти все
 * три, и ни один не полагается на добрую волю модели:
 *
 *   1. Транзакция READ ONLY. Postgres сам отклоняет INSERT/UPDATE/DELETE и
 *      любой DDL внутри такой транзакции — это его собственная проверка, а не
 *      наша. Даже если разбор запроса ниже ошибётся, запись не пройдёт.
 *   2. Разбор запроса. Пропускаем один-единственный SELECT или WITH…SELECT.
 *      Несколько операторов, точка с запятой в середине, любое ключевое слово
 *      записи — отказ до отправки в базу.
 *   3. Маскирование колонок. Токены, ключи и пароли не должны покидать сервер
 *      вообще: раздел разговаривает с моделью через внешний прокси. Секретные
 *      колонки заменяются на «***» ПОСЛЕ выборки, а не запрещаются — иначе
 *      «покажи настройки платёжек» падало бы вместо того, чтобы показать всё
 *      кроме ключа.
 *
 * Отдельно ограничены объём и время: выборка на миллион строк не столько
 * опасна, сколько бессмысленна — она всё равно не поместится в промпт.
 */
const db = require('../../db')
const log = require('../logger').for('Prometheus')

// ─── Что нельзя показывать ──────────────────────────────────────────────────

/**
 * Колонки с секретами. Список явный, а не по регулярке: «max_tokens» и
 * «input_tokens» под шаблон «token» попадают, но секретами не являются, и
 * прятать их — значит мешать разбору расходов на модель.
 */
const SECRET_COLUMNS = new Set([
  'api_key', 'api_token', 'bot_token', 'oauth_token', 'iam_token',
  'password_hash', 'ssh_password', 'service_password',
  'platega_secret', 'oidc_client_secret', 'webhook_secret', 'secret',
  'remnwave_api_token', 'remnwave_secret_key', 'traffic_agent_panel_private_key',
  'private_key', 'token', 'token_hash',
])

/**
 * Персональные данные. Не секреты, но и разбрасываться ими незачем: для
 * анализа бизнес-логики почта конкретного человека не нужна, а уезжает она к
 * внешнему провайдеру модели. Маскируем с сохранением формы, чтобы вопросы
 * вида «сколько у нас почт на gmail» остались отвечаемыми.
 */
const PII_COLUMNS = new Set(['email', 'login', 'telegram_username', 'ip', 'user_agent'])

function maskSecret() { return '***' }

function maskPii(col, value) {
  if (value == null) return value
  const s = String(value)
  if (col === 'email') {
    const at = s.indexOf('@')
    return at > 0 ? `${s.slice(0, 1)}***${s.slice(at)}` : '***'
  }
  if (col === 'ip') return s.replace(/\.\d+$/, '.***').replace(/:[0-9a-f]+$/i, ':***')
  if (col === 'user_agent') return s.slice(0, 40) + (s.length > 40 ? '…' : '')
  return s.slice(0, 2) + '***'
}

/** Пройтись по строкам выборки и скрыть всё, что не должно уехать наружу. */
function maskRows(rows, { maskPii: doPii = true } = {}) {
  const hidden = new Set()
  const out = rows.map(row => {
    const o = {}
    for (const [k, v] of Object.entries(row)) {
      const key = String(k).toLowerCase()
      if (SECRET_COLUMNS.has(key)) { o[k] = v == null ? null : maskSecret(); if (v != null) hidden.add(k) }
      else if (doPii && PII_COLUMNS.has(key)) { o[k] = maskPii(key, v); if (v != null) hidden.add(k) }
      else o[k] = v
    }
    return o
  })
  return { rows: out, hidden: [...hidden] }
}

// ─── Разбор запроса ─────────────────────────────────────────────────────────

/** Ключевые слова, которых в запросе на чтение быть не может ни при каких обстоятельствах. */
const FORBIDDEN = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|comment|reindex|vacuum|refresh|copy|call|do|merge|lock|listen|notify|set|reset|begin|commit|rollback|savepoint|prepare|execute|deallocate|discard|cluster|analyze|explain)\b/i

/**
 * Убрать строки и комментарии, чтобы разбор смотрел на код, а не на текст
 * внутри кавычек: слово «delete» в поисковой строке не должно выглядеть как
 * попытка удаления, а `-- insert` не должен прятать настоящую команду.
 *
 * Один проход слева направо, а не цепочка replace. Цепочка выглядит проще, но
 * ломается на пересечениях: если сначала вырезать комментарии, то `--` ВНУТРИ
 * строки срежет её хвост вместе с закрывающей кавычкой, строка окажется
 * незакрытой, и дальше разбор поедет. Ошибка безопасная — запрос отклоняется, —
 * но отклоняется и честный `WHERE note = 'скидка -- не акция'`. Кто первым
 * встретился, тот и определяет, как читать дальше.
 */
function stripLiterals(sql) {
  const s = String(sql)
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    const next = s[i + 1]

    if (c === '-' && next === '-') {                   // комментарий до конца строки
      while (i < s.length && s[i] !== '\n') i++
      out += ' '
      continue
    }
    if (c === '/' && next === '*') {                   // блочный комментарий
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    if (c === "'") {                                   // строка, '' внутри — экранированная кавычка
      i++
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") { i += 2; continue }
        if (s[i] === "'") { i++; break }
        i++
      }
      out += "''"
      continue
    }
    if (c === '"') {                                   // имя в кавычках
      i++
      while (i < s.length) {
        if (s[i] === '"' && s[i + 1] === '"') { i += 2; continue }
        if (s[i] === '"') { i++; break }
        i++
      }
      out += '""'
      continue
    }
    if (c === '$' && next === '$') {                   // долларовые кавычки
      i += 2
      while (i < s.length && !(s[i] === '$' && s[i + 1] === '$')) i++
      i += 2
      out += "''"
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Можно ли выполнять этот запрос.
 * @returns {{ok: true, sql: string} | {ok: false, error: string}}
 */
function validateSelect(raw) {
  const sql = String(raw || '').trim().replace(/;\s*$/, '')
  if (!sql) return { ok: false, error: 'Пустой запрос' }
  if (sql.length > 4000) return { ok: false, error: 'Запрос длиннее 4000 символов' }

  const bare = stripLiterals(sql)

  // Точка с запятой в середине — это уже несколько операторов.
  if (bare.includes(';')) {
    return { ok: false, error: 'Несколько операторов в одном запросе запрещены' }
  }
  if (!/^\s*(select|with)\b/i.test(bare)) {
    return { ok: false, error: 'Разрешены только SELECT и WITH…SELECT' }
  }
  const bad = bare.match(FORBIDDEN)
  if (bad) {
    return { ok: false, error: `Запрещённое слово «${bad[0]}» — доступ только на чтение` }
  }
  // WITH … AS ( INSERT … RETURNING ) — запись, замаскированная под чтение.
  // Ловится и FORBIDDEN выше, но проверка дешёвая, а цена промаха высокая.
  if (/\bwith\b[\s\S]*\b(insert|update|delete)\b/i.test(bare)) {
    return { ok: false, error: 'CTE с записью запрещены' }
  }
  return { ok: true, sql }
}

// ─── Выполнение ─────────────────────────────────────────────────────────────

const MAX_ROWS = 200
const TIMEOUT_MS = 10000

/**
 * Выполнить запрос на чтение.
 *
 * Транзакция открывается как READ ONLY и всегда откатывается. Откат, а не
 * коммит: коммитить нечего, а ROLLBACK гарантирует, что даже случайно
 * созданное временное состояние не переживёт запрос.
 */
async function runSelect(raw, { limit = MAX_ROWS, maskPii = true, explain = true } = {}) {
  const check = validateSelect(raw)
  if (!check.ok) return { ok: false, error: check.error }

  const client = await db.pool.connect()
  try {
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${Number(TIMEOUT_MS)}`)

    const cap = Math.min(Number(limit) || MAX_ROWS, MAX_ROWS)
    // Оборачиваем в подзапрос, а не дописываем LIMIT: у запроса может быть свой
    // LIMIT, ORDER BY или UNION, и дописанный в хвост сломал бы смысл.
    const res = await client.query(`SELECT * FROM (${check.sql}) AS prometheus_q LIMIT ${cap + 1}`)

    const truncated = res.rows.length > cap
    const rows = truncated ? res.rows.slice(0, cap) : res.rows
    const masked = maskRows(rows, { maskPii })

    return {
      ok: true,
      rows: masked.rows,
      row_count: masked.rows.length,
      truncated,
      hidden_columns: masked.hidden,
      fields: res.fields.map(f => f.name),
    }
  } catch (e) {
    return explain ? await explainSqlError(e, check.sql) : { ok: false, error: e.message }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

/**
 * Ошибка запроса — вместе с тем, как должно быть.
 *
 * Голое «column s.status does not exist» отправляет модель гадать дальше, и она
 * перебирает названия по одному, тратя шаги и деньги. Если названия не угаданы,
 * возвращаем настоящий состав упомянутых таблиц: следующая попытка будет
 * осмысленной, а не второй догадкой.
 */
async function explainSqlError(e, sql) {
  const out = { ok: false, error: e.message }
  if (e.hint) out.hint = e.hint          // Postgres часто сам подсказывает похожее имя
  if (e.code !== '42703' && e.code !== '42P01') return out   // не про колонки и таблицы

  // Имена после FROM и JOIN. Разбор грубый, но нам нужен лишь список кандидатов.
  const names = [...new Set(
    [...String(sql).matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase())
  )].slice(0, 6)
  if (!names.length) return out

  const r = await runSelect(
    `SELECT table_name AS "таблица", string_agg(column_name, ', ' ORDER BY ordinal_position) AS "колонки"
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${names.map(n => `'${n}'`).join(',')})
      GROUP BY table_name`,
    { limit: 20, maskPii: false, explain: false }   // explain: false — чтобы не зациклиться
  )
  if (r.ok && r.rows.length) {
    out.таблицы_на_самом_деле = r.rows
    out.подсказка = 'Возьми названия колонок отсюда, а не по памяти: в этом проекте они свои.'
  } else if (r.ok) {
    out.подсказка = `Таких таблиц в базе нет: ${names.join(', ')}. Посмотри список через db_schema без аргументов.`
  }
  return out
}

/**
 * Проверка рубежей при старте.
 *
 * Запускается один раз и пишет в лог, работает ли запрет на запись. Без этого
 * поломка защиты (скажем, кто-то заменил READ ONLY на обычный BEGIN) осталась
 * бы незамеченной до первого происшествия.
 */
async function selfCheck() {
  const probes = [
    ['DELETE FROM users', 'разбор запроса'],
    ['SELECT 1; DROP TABLE users', 'несколько операторов'],
    ['WITH x AS (DELETE FROM users RETURNING id) SELECT * FROM x', 'запись внутри CTE'],
  ]
  const failed = []
  for (const [sql, what] of probes) {
    const r = await runSelect(sql)
    if (r.ok) failed.push(what)
  }

  // Отдельно — рубеж самой базы: выражение проходит разбор, но Postgres обязан
  // отклонить запись внутри READ ONLY транзакции.
  const client = await db.pool.connect()
  let dbGuard = false
  try {
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query("CREATE TEMP TABLE prometheus_guard_probe (x int)")
  } catch {
    dbGuard = true
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
  if (!dbGuard) failed.push('READ ONLY транзакция')

  if (failed.length) {
    log.error(`ЗАЩИТА ОТ ЗАПИСИ НЕ РАБОТАЕТ: ${failed.join(', ')}. Раздел отключён.`)
    return { ok: false, failed }
  }
  log.info('Защита «только чтение» проверена: запись отклоняется на всех рубежах')
  return { ok: true }
}

module.exports = {
  runSelect, validateSelect, maskRows, selfCheck,
  SECRET_COLUMNS, PII_COLUMNS, MAX_ROWS,
}
