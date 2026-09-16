/**
 * PROMETHEUS: что он умеет.
 *
 * Набор инструментов — это и есть граница возможностей. Модель не может
 * «просто сходить в базу» или «дёрнуть API»: она может только назвать один из
 * перечисленных здесь инструментов и получить ответ. Всё, чего в этом файле
 * нет, для неё не существует.
 *
 * Ни один инструмент не меняет ДАННЫЕ ПРОЕКТА: пользователей, платежи,
 * подписки, настройки, исходники, внешние сервисы. Это не забывчивость и не
 * «добавим позже» — раздел задуман наблюдателем.
 *
 * Исключение ровно одно и оно намеренное: собственная память (memory_write,
 * finding_report). Это его блокнот в таблицах prometheus_*, к проекту он
 * отношения не имеет, а без него «развивается со временем» невозможно — каждый
 * разбор начинался бы с чистого листа. Писать произвольным SQL туда нельзя:
 * только через две функции, каждая знает свою единственную таблицу.
 *
 * Произвольных запросов к внешним адресам тоже нет. Соблазн сделать
 * «http_get(url)» велик, но это дыра: модель по подсказке из данных сходила бы
 * во внутреннюю сеть или к чужому API. Вместо этого — поимённые вызовы к тем
 * интеграциям, что уже есть в проекте, через их же клиенты.
 */
const path = require('path')
const fs = require('fs').promises
const db = require('../../db')
const ro = require('./readonly')
const log = require('../logger').for('Prometheus')

// Корень исходников. В контейнере это /app (туда Dockerfile кладёт backend).
// Фронтенд в образ backend не попадает — значит и прочитать его нельзя;
// говорим об этом прямо, чтобы не выглядело как поломка.
const SRC_ROOT = path.resolve(__dirname, '../..')

/** Файлы, которых не существует для Прометея, даже если он их попросит. */
const FILE_DENY = [
  /(^|\/)\.env/i,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /\.(key|pem|p12|pfx|crt)$/i,
  /(^|\/)uploads(\/|$)/,
]

const FILE_ALLOW_EXT = new Set(['.js', '.sql', '.json', '.md', '.yml', '.yaml', '.sh', '.txt', '.example'])
const MAX_FILE_BYTES = 60000

/** Путь внутри корня и не в запрещённом списке? */
function resolveSafe(rel) {
  const clean = String(rel || '').replace(/^[/\\]+/, '')
  const abs = path.resolve(SRC_ROOT, clean)
  if (abs !== SRC_ROOT && !abs.startsWith(SRC_ROOT + path.sep)) {
    return { ok: false, error: 'Путь за пределами проекта' }
  }
  const norm = abs.slice(SRC_ROOT.length).replace(/\\/g, '/')
  for (const re of FILE_DENY) {
    if (re.test(norm)) return { ok: false, error: 'Этот файл закрыт для чтения' }
  }
  return { ok: true, abs, rel: norm.replace(/^\//, '') }
}

// ─── Инструменты ────────────────────────────────────────────────────────────

const TOOLS = {
  /** Структура базы: какие таблицы есть и из чего состоят. */
  db_schema: {
    description: 'Структура базы: таблицы и колонки с типами. Без данных. ' +
      'Вызывайте ПЕРВОЙ, до любого db_query: названия колонок в этом проекте свои, ' +
      'и угаданные по памяти почти всегда неверны.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Имя таблицы — полное описание с типами. Пусто — карта всей базы: таблицы, число строк и состав колонок.' },
      },
    },
    async run({ table }) {
      if (!table) {
        // Сразу с колонками, а не только имена таблиц. Список без состава
        // экономит несколько сотен токенов и стоит потом нескольких неверных
        // запросов подряд: модель начинает угадывать названия по памяти.
        const r = await ro.runSelect(
          `SELECT c.relname AS "таблица",
                  c.reltuples::bigint AS "примерно_строк",
                  (SELECT string_agg(a.attname, ', ' ORDER BY a.attnum)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS "колонки"
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            ORDER BY c.relname`, { limit: 200 })
        return r
      }
      return ro.runSelect(
        `SELECT column_name AS "колонка", data_type AS "тип", is_nullable AS "может_быть_пустым",
                column_default AS "по_умолчанию"
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${quote(table)}
          ORDER BY ordinal_position`, { limit: 200 })
    },
  },

  /** Чтение данных. Единственный путь к базе — и он только на чтение. */
  db_query: {
    description: 'Выполнить SELECT к базе проекта. Только чтение: любые INSERT/UPDATE/DELETE/DDL ' +
      'отклоняются. Выдача ограничена 200 строками. Секреты (токены, ключи, пароли) и ' +
      'персональные данные приходят замаскированными.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Один запрос SELECT или WITH…SELECT, без точки с запятой в конце.' },
        limit: { type: 'number', description: 'Сколько строк вернуть, максимум 200.' },
      },
      required: ['sql'],
    },
    run: ({ sql, limit }) => ro.runSelect(sql, { limit }),
  },

  /** Где что лежит в исходниках. */
  list_files: {
    description: 'Список файлов проекта (серверная часть). Фронтенд в образ backend не попадает, ' +
      'его исходники прочитать нельзя.',
    input_schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Папка относительно корня, например services или routes. Пусто — корень.' },
      },
    },
    async run({ dir }) {
      const safe = resolveSafe(dir || '.')
      if (!safe.ok) return { ok: false, error: safe.error }
      try {
        const items = await fs.readdir(safe.abs, { withFileTypes: true })
        const out = []
        for (const it of items) {
          const child = resolveSafe(path.join(safe.rel, it.name))
          if (!child.ok) continue
          if (it.isDirectory()) out.push({ path: child.rel, type: 'папка' })
          else {
            const st = await fs.stat(child.abs).catch(() => null)
            out.push({ path: child.rel, type: 'файл', bytes: st ? st.size : null })
          }
        }
        return { ok: true, dir: safe.rel || '.', items: out }
      } catch (e) {
        return { ok: false, error: e.message }
      }
    },
  },

  read_file: {
    description: 'Прочитать файл исходников. Доступны .js, .sql, .json, .md, .yml, .sh. ' +
      'Файлы с секретами (.env, ключи) закрыты.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь относительно корня серверной части, например services/payment.js' },
      },
      required: ['path'],
    },
    async run({ path: rel }) {
      const safe = resolveSafe(rel)
      if (!safe.ok) return { ok: false, error: safe.error }
      const ext = path.extname(safe.abs).toLowerCase()
      if (!FILE_ALLOW_EXT.has(ext)) return { ok: false, error: `Файлы ${ext || 'без расширения'} читать нельзя` }
      try {
        const st = await fs.stat(safe.abs)
        if (!st.isFile()) return { ok: false, error: 'Это не файл' }
        const buf = await fs.readFile(safe.abs, 'utf8')
        const truncated = buf.length > MAX_FILE_BYTES
        return {
          ok: true, path: safe.rel, bytes: st.size, truncated,
          content: truncated ? buf.slice(0, MAX_FILE_BYTES) + '\n…(обрезано)' : buf,
        }
      } catch (e) {
        return { ok: false, error: e.message }
      }
    },
  },

  /** Сводка о проекте — чтобы не собирать её десятком запросов каждый раз. */
  project_facts: {
    description: 'Краткая сводка о проекте: версия, применённые миграции, подключённые интеграции, ' +
      'состояние ИИ-подсистем. Дешевле, чем собирать это запросами.',
    input_schema: { type: 'object', properties: {} },
    async run() {
      const out = {}
      try { out.версия = require('../version').getVersion?.() || null } catch { out.версия = null }

      const q = async (label, sql) => {
        const r = await ro.runSelect(sql, { limit: 50 })
        out[label] = r.ok ? r.rows : { ошибка: r.error }
      }
      await q('миграций_применено', "SELECT COUNT(*)::int AS n, MAX(name) AS последняя FROM schema_migrations")
      await q('пользователи', `SELECT COUNT(*)::int AS всего,
                                      COUNT(*) FILTER (WHERE is_admin)::int AS админов,
                                      COUNT(*) FILTER (WHERE telegram_id IS NOT NULL)::int AS с_телеграмом
                                 FROM users`)
      await q('подписки', `SELECT COUNT(*)::int AS всего,
                                  COUNT(*) FILTER (WHERE is_active)::int AS активных,
                                  COUNT(*) FILTER (WHERE provisioning_status <> 'ok')::int AS без_доступа
                             FROM subscriptions`)
      await q('платежи_30дней', `SELECT COUNT(*)::int AS всего,
                                        COUNT(*) FILTER (WHERE status='completed')::int AS успешных,
                                        COALESCE(SUM(amount) FILTER (WHERE status='completed'),0)::numeric AS сумма
                                   FROM payments WHERE created_at > NOW() - interval '30 days'`)
      await q('тарифы', 'SELECT id, name, traffic_gb, is_active, array_length(squad_uuids,1) AS серверных_групп FROM plans ORDER BY id')
      await q('интеграции', `SELECT 'bedolaga' AS сервис, COUNT(*)::int AS аккаунтов FROM bedolaga_accounts
                             UNION ALL SELECT 'yandex_cloud', COUNT(*)::int FROM yc_accounts
                             UNION ALL SELECT 'selectel', COUNT(*)::int FROM selectel_accounts
                             UNION ALL SELECT 'ruvds', COUNT(*)::int FROM ruvds_accounts
                             UNION ALL SELECT 'vps', COUNT(*)::int FROM vps_servers`)
      await q('ии_рассылки', 'SELECT ai_mode, ai_dry_run, ai_interval_hours, ai_min_confidence FROM broadcast_settings WHERE id=1')
      await q('ии_база_знаний', "SELECT COUNT(*)::int AS всего, COUNT(*) FILTER (WHERE is_active)::int AS активных FROM ai_knowledge")
      return { ok: true, ...out }
    },
  },

  /** Панель RemnaWave — только чтение. */
  remnawave_read: {
    description: 'Данные панели RemnaWave: статистика, ноды, серверные группы. Только чтение.',
    input_schema: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'Что запросить: stats, nodes, squads' },
      },
      required: ['what'],
    },
    async run({ what }) {
      const rw = require('../remnwave')
      try {
        if (what === 'stats') return { ok: true, data: await rw.getSystemStats() }
        if (what === 'nodes') return { ok: true, data: await rw.getNodes() }
        if (what === 'squads') return { ok: true, data: await rw.getInternalSquads() }
        return { ok: false, error: 'Доступно: stats, nodes, squads' }
      } catch (e) { return { ok: false, error: e.message } }
    },
  },

  /** Бот продаж Bedolaga — только чтение. */
  bedolaga_read: {
    description: 'Данные стороннего бота Bedolaga: сводка, сегменты, история рассылок, тикеты. Только чтение.',
    input_schema: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'Что запросить: overview, segments, broadcasts, tickets' },
      },
      required: ['what'],
    },
    async run({ what }) {
      const bd = require('../bedolaga')
      const acc = (await db.query('SELECT * FROM bedolaga_accounts WHERE is_active = true ORDER BY id LIMIT 1')).rows[0]
      if (!acc) return { ok: false, error: 'Нет активного аккаунта Bedolaga' }
      try {
        if (what === 'segments') return await bd.getSegmentSizes(acc)
        if (what === 'broadcasts') {
          const r = await bd.getBroadcastHistory(acc)
          return r.ok ? { ok: true, всего: r.items.length, последние: r.items.slice(0, 15) } : r
        }
        if (what === 'tickets') {
          const r = await bd.listTickets(acc, { limit: 30, offset: 0 })
          const items = r.data?.items || r.data || []
          return { ok: true, всего: items.length, тикеты: items.map(t => ({ id: t.id, тема: t.title, статус: t.status })) }
        }
        if (what === 'overview') return await bd.call(acc, '/overview')
        return { ok: false, error: 'Доступно: overview, segments, broadcasts, tickets' }
      } catch (e) { return { ok: false, error: e.message } }
    },
  },

  // ── Собственная память ──

  memory_write: {
    description: 'Запомнить что-то на будущее: установленный факт, как здесь устроено, ' +
      'решение владельца или вывод из собственной ошибки. Пишет ТОЛЬКО в свою память, ' +
      'данные проекта не затрагивает. Запись по той же теме заменяет прежнюю.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'fact — установленный факт; context — как здесь устроено; decision — решение владельца; lesson — вывод из своей ошибки' },
        topic: { type: 'string', description: 'Короткая тема, по ней запись потом находится и обновляется. Например «сегмент expired» или «выдача доступа».' },
        content: { type: 'string', description: 'Само наблюдение, одно-два предложения.' },
        confidence: { type: 'number', description: 'Уверенность от 0 до 1. Посчитано по выборке — высокая, предположение — низкая.' },
        evidence: { type: 'string', description: 'Чем подтверждено: запрос, файл, вызов. Без этого проверить будет нечем.' },
      },
      required: ['topic', 'content'],
    },
    run: (i) => require('./memory').remember(i),
  },

  memory_search: {
    description: 'Поискать в собственной памяти по теме. Основное и так подкладывается ' +
      'в начало разбора — сюда идти, если нужно что-то конкретное из прошлых разборов.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Что искать' } },
      required: ['query'],
    },
    async run({ query }) {
      const rows = await require('./memory').search(query, { limit: 15 })
      return { ok: true, найдено: rows.length, записи: rows }
    },
  },

  finding_report: {
    description: 'Зафиксировать найденную проблему проекта, чтобы она не потерялась и ' +
      'чтобы у неё появилась судьба: владелец её примет, отклонит или починит. ' +
      'Повтор той же проблемы не создаёт дубль и не воскрешает уже отклонённую.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Суть одной строкой' },
        detail: { type: 'string', description: 'Развёрнуто: в чём проблема, чем подтверждается, чем грозит' },
        severity: { type: 'string', description: 'low, medium или high' },
        area: { type: 'string', description: 'Область: платежи, подписки, рассылки, тикеты, инфраструктура…' },
        evidence: { type: 'string', description: 'Запрос или файл, на котором это видно' },
      },
      required: ['title'],
    },
    run: (i) => require('./memory').reportFinding(i),
  },
}

/** Экранирование строки для подстановки в SQL — только для имён из схемы. */
function quote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

/** Описание инструментов в виде, который понимает Anthropic API. */
function toolDefinitions() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}

/**
 * Выполнить инструмент по имени.
 *
 * Неизвестное имя — не ошибка выполнения, а ответ модели: пусть увидит, что
 * такого инструмента нет, и попробует другой, вместо того чтобы прогон падал.
 */
async function runTool(name, input) {
  const tool = TOOLS[name]
  if (!tool) return { ok: false, error: `Инструмента «${name}» не существует. Доступны: ${Object.keys(TOOLS).join(', ')}` }
  const started = Date.now()
  try {
    const r = await tool.run(input || {})
    log.debug(`инструмент ${name} — ${Date.now() - started} мс`)
    return r
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

module.exports = { TOOLS, toolDefinitions, runTool, resolveSafe, SRC_ROOT }
