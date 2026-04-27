#!/usr/bin/env node
/**
 * Migration runner для PostgreSQL.
 *
 * Структура папки backend/migrations/:
 *   NNNN_name.up.sql    — применение миграции (обязателен)
 *   NNNN_name.down.sql  — откат (опционален, без него `down` для этой миграции упадёт)
 *
 * Команды:
 *   node scripts/migrate.js status           — какие миграции есть и какие применены
 *   node scripts/migrate.js up [count]       — применить все pending (или count следующих)
 *   node scripts/migrate.js down [count=1]   — откатить последние count (по умолчанию 1)
 *   node scripts/migrate.js create <name>    — создать пустые up/down файлы со следующим номером
 *   node scripts/migrate.js bootstrap        — пометить ВСЕ существующие миграции как применённые
 *                                              (для миграции существующего прода на новую систему)
 *   node scripts/migrate.js verify           — проверить чексуммы применённых миграций
 *
 * Безопасность:
 *   - Каждая миграция исполняется в одной транзакции (BEGIN/COMMIT). Падение → ROLLBACK.
 *   - Для уже применённой миграции сверяется SHA-256 файла. Если отличается — abort.
 *   - Используется advisory lock — не запустится в двух местах одновременно.
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Pool } = require('pg')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const ADVISORY_LOCK_KEY = 4242732871 // произвольное 32-битное число

// ─── Утилиты ──────────────────────────────────────────────────────────────────

const COLORS = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

function log(msg) { process.stdout.write(msg + '\n') }
function err(msg) { process.stderr.write(COLORS.red(msg) + '\n') }

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.up.sql'))
    .sort() // лексикографический порядок = числовой при правильном префиксе
    .map(f => {
      const name = f.replace(/\.up\.sql$/, '')
      const upPath = path.join(MIGRATIONS_DIR, f)
      const downPath = path.join(MIGRATIONS_DIR, name + '.down.sql')
      const upSql = fs.readFileSync(upPath, 'utf8')
      const downSql = fs.existsSync(downPath) ? fs.readFileSync(downPath, 'utf8') : null
      return {
        name,
        upPath,
        downPath: fs.existsSync(downPath) ? downPath : null,
        upSql,
        downSql,
        checksum: sha256(upSql),
      }
    })
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER
    )
  `)
}

async function getApplied(client) {
  const { rows } = await client.query(
    `SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name ASC`
  )
  const map = new Map()
  for (const r of rows) map.set(r.name, r)
  return map
}

async function withLock(pool, fn) {
  const client = await pool.connect()
  try {
    const got = await client.query(
      'SELECT pg_try_advisory_lock($1) AS got',
      [ADVISORY_LOCK_KEY]
    )
    if (!got.rows[0].got) {
      throw new Error('Другая миграция уже выполняется (advisory lock занят). Подождите или проверьте процессы.')
    }
    try {
      return await fn(client)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

// ─── Команды ───────────────────────────────────────────────────────────────────

async function cmdStatus(pool) {
  await withLock(pool, async (client) => {
    await ensureMigrationsTable(client)
    const applied = await getApplied(client)
    const files = listMigrationFiles()

    log(COLORS.bold(`\nMigrations: ${MIGRATIONS_DIR}\n`))

    if (files.length === 0) {
      log(COLORS.dim('  (нет файлов миграций)'))
      return
    }

    let pendingCount = 0
    let mismatchCount = 0

    for (const m of files) {
      const a = applied.get(m.name)
      if (!a) {
        log(`  ${COLORS.yellow('PENDING')}  ${m.name}${m.downSql ? '' : COLORS.dim(' (без down)')}`)
        pendingCount++
      } else if (a.checksum !== m.checksum) {
        log(`  ${COLORS.red('MODIFIED')} ${m.name} ${COLORS.dim(`— файл изменился после применения`)}`)
        mismatchCount++
      } else {
        const at = new Date(a.applied_at).toISOString().replace('T', ' ').slice(0, 19)
        log(`  ${COLORS.green('applied')}  ${m.name} ${COLORS.dim(at)}`)
      }
    }

    // Применённые, для которых нет файла
    for (const [name] of applied) {
      if (!files.find(f => f.name === name)) {
        log(`  ${COLORS.red('GHOST')}    ${name} ${COLORS.dim('— применена, но файла нет в migrations/')}`)
      }
    }

    log('')
    log(COLORS.dim(`Всего файлов: ${files.length}, применено: ${applied.size}, в очереди: ${pendingCount}${mismatchCount ? `, чексум-конфликтов: ${mismatchCount}` : ''}`))
  })
}

async function cmdUp(pool, count = Infinity) {
  await withLock(pool, async (client) => {
    await ensureMigrationsTable(client)
    const applied = await getApplied(client)
    const files = listMigrationFiles()

    // Сначала проверяем, не изменились ли уже применённые
    for (const m of files) {
      const a = applied.get(m.name)
      if (a && a.checksum !== m.checksum) {
        throw new Error(
          `Миграция ${m.name} уже применена, но содержимое файла изменилось.\n` +
          `Применённая чексумма: ${a.checksum}\n` +
          `Файла: ${m.checksum}\n` +
          `Не редактируйте применённые миграции — создайте новую миграцию для исправления.`
        )
      }
    }

    const pending = files.filter(m => !applied.has(m.name))
    if (pending.length === 0) {
      log(COLORS.green('✓ Нет миграций в очереди'))
      return
    }

    const toApply = pending.slice(0, Number.isFinite(count) ? count : pending.length)
    log(COLORS.bold(`\nПрименяю ${toApply.length} миграций:\n`))

    for (const m of toApply) {
      const start = Date.now()
      log(`  ${COLORS.cyan('→')} ${m.name}`)
      try {
        await client.query('BEGIN')
        await client.query(m.upSql)
        const duration = Date.now() - start
        await client.query(
          `INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)`,
          [m.name, m.checksum, duration]
        )
        await client.query('COMMIT')
        log(`  ${COLORS.green('✓')} ${m.name} ${COLORS.dim(`(${duration} ms)`)}`)
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`Миграция ${m.name} упала: ${e.message}`)
      }
    }

    log(COLORS.green(`\n✓ Применено: ${toApply.length}`))
  })
}

async function cmdDown(pool, count = 1) {
  await withLock(pool, async (client) => {
    await ensureMigrationsTable(client)
    const applied = await getApplied(client)
    const files = listMigrationFiles()

    // Берём последние применённые в обратном порядке
    const appliedNames = [...applied.keys()].sort().reverse()
    const toRollback = appliedNames.slice(0, count)

    if (toRollback.length === 0) {
      log(COLORS.dim('Нет применённых миграций для отката'))
      return
    }

    log(COLORS.bold(`\nОткатываю ${toRollback.length} миграций:\n`))

    for (const name of toRollback) {
      const m = files.find(f => f.name === name)
      if (!m) {
        throw new Error(`Не найден файл миграции ${name} (применена, но удалена из migrations/). Восстановите файл или удалите запись из schema_migrations вручную.`)
      }
      if (!m.downSql) {
        throw new Error(`Миграция ${name} не имеет .down.sql — откат невозможен. Создайте down-файл или удалите запись из schema_migrations вручную после ручного отката.`)
      }

      const start = Date.now()
      log(`  ${COLORS.yellow('←')} ${name}`)
      try {
        await client.query('BEGIN')
        await client.query(m.downSql)
        await client.query(`DELETE FROM schema_migrations WHERE name = $1`, [name])
        await client.query('COMMIT')
        log(`  ${COLORS.green('✓')} ${name} откачена ${COLORS.dim(`(${Date.now() - start} ms)`)}`)
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`Откат ${name} упал: ${e.message}`)
      }
    }

    log(COLORS.green(`\n✓ Откачено: ${toRollback.length}`))
  })
}

async function cmdBootstrap(pool) {
  await withLock(pool, async (client) => {
    await ensureMigrationsTable(client)
    const files = listMigrationFiles()
    const applied = await getApplied(client)

    if (applied.size > 0) {
      log(COLORS.yellow(`Уже есть ${applied.size} применённых миграций — bootstrap пропущен.`))
      log(COLORS.dim('Если нужно «начать сначала» — TRUNCATE schema_migrations и запустите снова.'))
      return
    }

    if (files.length === 0) {
      log(COLORS.dim('Нет файлов миграций для bootstrap.'))
      return
    }

    log(COLORS.bold(`\nBootstrap: помечаю ${files.length} миграций как уже применённые ${COLORS.dim('(SQL не выполняется!)')}\n`))

    for (const m of files) {
      await client.query(
        `INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, 0)
         ON CONFLICT (name) DO NOTHING`,
        [m.name, m.checksum]
      )
      log(`  ${COLORS.green('✓')} ${m.name} ${COLORS.dim('— marked applied')}`)
    }

    log(COLORS.green(`\n✓ Bootstrap завершён. С этого момента новые миграции в migrations/ будут применяться обычным up.`))
  })
}

async function cmdVerify(pool) {
  await withLock(pool, async (client) => {
    await ensureMigrationsTable(client)
    const applied = await getApplied(client)
    const files = listMigrationFiles()
    let bad = 0
    for (const m of files) {
      const a = applied.get(m.name)
      if (!a) continue
      if (a.checksum !== m.checksum) {
        err(`MODIFIED: ${m.name}`)
        err(`  applied: ${a.checksum}`)
        err(`  file:    ${m.checksum}`)
        bad++
      }
    }
    if (bad > 0) {
      throw new Error(`Чексуммы расходятся для ${bad} миграций.`)
    }
    log(COLORS.green(`✓ Все ${applied.size} применённых миграций совпадают с файлами.`))
  })
}

function cmdCreate(name) {
  if (!name) throw new Error('Использование: migrate.js create <name>')
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error('Имя миграции: только [a-z0-9_], например: add_user_phone')
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) fs.mkdirSync(MIGRATIONS_DIR, { recursive: true })

  const existing = listMigrationFiles()
  let nextNum = 1
  if (existing.length > 0) {
    const last = existing[existing.length - 1].name
    const m = last.match(/^(\d+)_/)
    if (m) nextNum = parseInt(m[1], 10) + 1
  }
  const prefix = String(nextNum).padStart(4, '0')
  const baseName = `${prefix}_${name}`
  const upPath = path.join(MIGRATIONS_DIR, `${baseName}.up.sql`)
  const downPath = path.join(MIGRATIONS_DIR, `${baseName}.down.sql`)

  fs.writeFileSync(upPath, `-- Migration: ${baseName}\n-- Up\n\n`, 'utf8')
  fs.writeFileSync(downPath, `-- Migration: ${baseName}\n-- Down (откат изменений из .up.sql)\n\n`, 'utf8')

  log(COLORS.green('Created:'))
  log('  ' + upPath)
  log('  ' + downPath)
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2] || 'status'
  const arg = process.argv[3]

  // create не требует подключения к БД
  if (cmd === 'create') {
    cmdCreate(arg)
    return
  }

  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT, 10) || 5432,
    user: process.env.PGUSER || 'vpn_user',
    password: process.env.PGPASSWORD || 'vpn_pass',
    database: process.env.PGDATABASE || 'vpn_db',
  })

  try {
    switch (cmd) {
      case 'status':    await cmdStatus(pool); break
      case 'up':        await cmdUp(pool, arg ? parseInt(arg, 10) : Infinity); break
      case 'down':      await cmdDown(pool, arg ? parseInt(arg, 10) : 1); break
      case 'bootstrap': await cmdBootstrap(pool); break
      case 'verify':    await cmdVerify(pool); break
      default:
        err(`Неизвестная команда: ${cmd}`)
        log('Использование: migrate.js [status|up|down|create|bootstrap|verify] [arg]')
        process.exitCode = 2
    }
  } catch (e) {
    err(`\n${e.message}`)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main()
