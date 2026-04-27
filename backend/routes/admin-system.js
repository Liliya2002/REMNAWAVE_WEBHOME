/**
 * Admin system endpoints — версия, миграции, проверка обновлений с GitHub.
 *
 *   GET  /api/admin/system/info          — текущая версия + сборка + uptime
 *   GET  /api/admin/system/migrations    — applied vs pending миграции
 *   GET  /api/admin/system/health        — DB / Remnawave / диск
 *   GET  /api/admin/system/updates       — список релизов с GitHub + behind_count
 *
 * GITHUB_REPO в .env: "owner/repo" (например "artur/vpnwebhome").
 * Без него /updates вернёт configured=false.
 */
const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')
const version = require('../services/version')

router.use(verifyToken, verifyAdmin)

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const REMNWAVE_API_URL = process.env.REMNWAVE_API_URL || ''
const GITHUB_REPO = (process.env.GITHUB_REPO || '').trim() // "owner/repo"
const DEPLOY_RUNNER_URL = (process.env.DEPLOY_RUNNER_URL || '').replace(/\/$/, '')
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || ''
const audit = require('../services/auditLog')

// ─── Кеш для проверки обновлений (60 сек) ──────────────────────────────────────
let updatesCache = null
let updatesCacheTime = 0
const UPDATES_TTL_MS = 60 * 1000

// ─── /info ─────────────────────────────────────────────────────────────────────
router.get('/info', async (req, res) => {
  try {
    const info = version.getInfo()
    res.json({
      version: info.version,
      sha: info.sha,
      shaShort: info.shaShort,
      buildDate: info.buildDate,
      startedAt: info.startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: info.nodeVersion,
      platform: info.platform,
      env: process.env.NODE_ENV || 'development',
      githubRepoConfigured: !!GITHUB_REPO,
      githubRepo: GITHUB_REPO || null,
    })
  } catch (err) {
    console.error('[AdminSystem] info error:', err.message)
    res.status(500).json({ error: 'Ошибка получения информации' })
  }
})

// ─── /migrations ───────────────────────────────────────────────────────────────
router.get('/migrations', async (req, res) => {
  try {
    // Список файлов
    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.up.sql'))
        .sort()
      : []

    const fileEntries = files.map(f => {
      const name = f.replace(/\.up\.sql$/, '')
      const upPath = path.join(MIGRATIONS_DIR, f)
      const downPath = path.join(MIGRATIONS_DIR, name + '.down.sql')
      const upSql = fs.readFileSync(upPath, 'utf8')
      return {
        name,
        hasDown: fs.existsSync(downPath),
        checksum: crypto.createHash('sha256').update(upSql).digest('hex'),
        sizeBytes: Buffer.byteLength(upSql, 'utf8'),
      }
    })

    // Применённые из БД
    let applied = []
    let tableExists = true
    try {
      const r = await db.query(
        `SELECT name, checksum, applied_at, duration_ms FROM schema_migrations ORDER BY name ASC`
      )
      applied = r.rows
    } catch (e) {
      tableExists = false
    }

    const appliedMap = new Map(applied.map(a => [a.name, a]))

    const items = fileEntries.map(f => {
      const a = appliedMap.get(f.name)
      let status = 'pending'
      if (a) {
        status = a.checksum === f.checksum ? 'applied' : 'modified'
      }
      return {
        name: f.name,
        status,
        hasDown: f.hasDown,
        sizeBytes: f.sizeBytes,
        appliedAt: a?.applied_at || null,
        durationMs: a?.duration_ms ?? null,
      }
    })

    // Применённые, для которых нет файла (ghost)
    for (const a of applied) {
      if (!fileEntries.find(f => f.name === a.name)) {
        items.push({
          name: a.name,
          status: 'ghost',
          hasDown: false,
          sizeBytes: 0,
          appliedAt: a.applied_at,
          durationMs: a.duration_ms,
        })
      }
    }

    const pendingCount = items.filter(i => i.status === 'pending').length
    const modifiedCount = items.filter(i => i.status === 'modified').length
    const ghostCount = items.filter(i => i.status === 'ghost').length

    res.json({
      tableExists,
      total: items.length,
      appliedCount: applied.length,
      pendingCount,
      modifiedCount,
      ghostCount,
      items,
    })
  } catch (err) {
    console.error('[AdminSystem] migrations error:', err.message)
    res.status(500).json({ error: 'Ошибка получения списка миграций' })
  }
})

// ─── /health (расширенный, под админа) ─────────────────────────────────────────
router.get('/health', async (req, res) => {
  const checks = {}

  // DB
  try {
    const t0 = Date.now()
    await db.query('SELECT 1')
    checks.db = { ok: true, latencyMs: Date.now() - t0 }
  } catch (e) {
    checks.db = { ok: false, error: e.message }
  }

  // DB size + table count
  try {
    const r = await db.query(`
      SELECT pg_database_size(current_database()) AS bytes,
             (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables
    `)
    checks.dbStats = {
      sizeBytes: Number(r.rows[0].bytes),
      tables: Number(r.rows[0].tables),
    }
  } catch (e) {
    checks.dbStats = { error: e.message }
  }

  // Remnawave
  if (REMNWAVE_API_URL) {
    try {
      const t0 = Date.now()
      const r = await fetch(REMNWAVE_API_URL + '/api/system/info', {
        method: 'GET',
        headers: { 'X-Api-Key': process.env.REMNWAVE_API_TOKEN || '' },
        signal: AbortSignal.timeout(5000),
      })
      checks.remnawave = {
        ok: r.ok,
        status: r.status,
        latencyMs: Date.now() - t0,
        url: REMNWAVE_API_URL,
      }
    } catch (e) {
      checks.remnawave = { ok: false, error: e.message, url: REMNWAVE_API_URL }
    }
  } else {
    checks.remnawave = { configured: false }
  }

  // Memory
  const mem = process.memoryUsage()
  checks.memory = {
    rssMB: Math.round(mem.rss / 1024 / 1024),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
  }

  const ok = checks.db.ok !== false
  res.status(ok ? 200 : 503).json({ ok, checks })
})

// ─── /updates ──────────────────────────────────────────────────────────────────
function semverParse(v) {
  if (!v) return null
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] || null }
}

function semverCompare(a, b) {
  const pa = semverParse(a), pb = semverParse(b)
  if (!pa || !pb) return 0
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  // prerelease считается старше release
  if (pa.prerelease && !pb.prerelease) return -1
  if (!pa.prerelease && pb.prerelease) return 1
  return 0
}

router.get('/updates', async (req, res) => {
  try {
    if (!GITHUB_REPO) {
      return res.json({
        configured: false,
        message: 'GITHUB_REPO не задан в .env. Пример: GITHUB_REPO=username/vpnwebhome'
      })
    }

    // Кеш на 60 секунд (rate-limit GitHub API: 60 запросов/час без авторизации)
    const now = Date.now()
    if (req.query.fresh !== '1' && updatesCache && (now - updatesCacheTime) < UPDATES_TTL_MS) {
      return res.json({ ...updatesCache, fromCache: true })
    }

    const info = version.getInfo()
    const currentVersion = info.version

    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `vpnwebhome/${currentVersion}`,
    }
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return res.status(502).json({
        configured: true,
        error: `GitHub API ответил ${r.status}: ${text.slice(0, 200)}`,
      })
    }

    const releases = (await r.json()) || []

    // Берём только не-draft и не-prerelease (по умолчанию)
    const stable = releases.filter(rel => !rel.draft && !rel.prerelease)

    // Сортируем по версии (новейшая первая)
    stable.sort((a, b) => semverCompare(b.tag_name, a.tag_name))

    const latest = stable[0] || null
    const latestVersion = latest?.tag_name || null

    // На сколько релизов мы отстаём (только те что новее текущей)
    const behind = stable.filter(rel => semverCompare(rel.tag_name, currentVersion) > 0)

    const result = {
      configured: true,
      current: currentVersion,
      latest: latestVersion,
      isLatest: latestVersion ? semverCompare(latestVersion, currentVersion) <= 0 : true,
      behindCount: behind.length,
      behindVersions: behind.map(rel => ({
        version: rel.tag_name,
        name: rel.name,
        publishedAt: rel.published_at,
        url: rel.html_url,
        body: (rel.body || '').slice(0, 2000),
      })),
      recentReleases: stable.slice(0, 5).map(rel => ({
        version: rel.tag_name,
        name: rel.name,
        publishedAt: rel.published_at,
        url: rel.html_url,
        isCurrent: semverCompare(rel.tag_name, currentVersion) === 0,
      })),
      checkedAt: new Date().toISOString(),
    }

    updatesCache = result
    updatesCacheTime = now

    res.json(result)
  } catch (err) {
    console.error('[AdminSystem] updates error:', err.message)
    res.status(500).json({ configured: !!GITHUB_REPO, error: err.message })
  }
})

// ─── Deploy proxy → deploy-runner ──────────────────────────────────────────────
//
// Backend стоит middleman-ом между фронтом и deploy-runner. Назначение:
//   - проверка прав (verifyAdmin уже наверху)
//   - проксирование (изоляция runner-а от внешнего мира)
//   - audit log
//
// Endpoints:
//   GET  /deploy/status             — настроен ли runner (для UI)
//   POST /deploy/run                — старт деплоя (body: { version, flags? })
//   GET  /deploy/runs               — список последних запусков
//   GET  /deploy/runs/:id           — статус
//   GET  /deploy/runs/:id/log       — SSE стрим (с поддержкой Last-Event-ID)
//   GET  /deploy/runs/:id/log.txt   — plain text дамп
//   POST /deploy/runs/:id/abort     — SIGTERM текущему процессу

function runnerConfigured() {
  return !!(DEPLOY_RUNNER_URL && DEPLOY_TOKEN)
}

async function runnerFetch(path, options = {}) {
  if (!runnerConfigured()) {
    const err = new Error('deploy-runner not configured (set DEPLOY_RUNNER_URL and DEPLOY_TOKEN)')
    err.code = 'NO_RUNNER'
    throw err
  }
  const url = DEPLOY_RUNNER_URL + path
  return fetch(url, {
    ...options,
    headers: {
      'X-Deploy-Token': DEPLOY_TOKEN,
      ...(options.headers || {}),
    },
  })
}

router.get('/deploy/status', async (req, res) => {
  if (!runnerConfigured()) {
    return res.json({ configured: false, message: 'deploy-runner не настроен в окружении (DEPLOY_RUNNER_URL/DEPLOY_TOKEN)' })
  }
  try {
    const r = await runnerFetch('/healthz')
    const ok = r.ok
    res.json({ configured: true, ok, runnerUrl: DEPLOY_RUNNER_URL })
  } catch (e) {
    res.json({ configured: true, ok: false, error: e.message })
  }
})

router.post('/deploy/run', async (req, res) => {
  try {
    if (!runnerConfigured()) return res.status(503).json({ error: 'deploy-runner not configured' })
    const { version, flags } = req.body || {}
    if (!version) return res.status(400).json({ error: 'version is required' })

    const r = await runnerFetch('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, flags }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      return res.status(r.status).json(body)
    }

    audit.write(req, 'system.deploy.start', { type: 'deploy', id: body.runId }, {
      version, flags: flags || []
    }).catch(() => {})

    res.status(201).json(body)
  } catch (err) {
    console.error('[AdminSystem] deploy/run error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/deploy/runs', async (req, res) => {
  try {
    if (!runnerConfigured()) return res.status(503).json({ error: 'deploy-runner not configured' })
    const r = await runnerFetch('/runs')
    const body = await r.json().catch(() => ({}))
    res.status(r.status).json(body)
  } catch (err) {
    console.error('[AdminSystem] deploy/runs error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/deploy/runs/:id', async (req, res) => {
  try {
    if (!runnerConfigured()) return res.status(503).json({ error: 'deploy-runner not configured' })
    const id = encodeURIComponent(req.params.id)
    const r = await runnerFetch(`/runs/${id}`)
    const body = await r.json().catch(() => ({}))
    res.status(r.status).json(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/deploy/runs/:id/log.txt', async (req, res) => {
  try {
    if (!runnerConfigured()) return res.status(503).send('deploy-runner not configured')
    const id = encodeURIComponent(req.params.id)
    const r = await runnerFetch(`/runs/${id}/log.txt`)
    const text = await r.text()
    res.status(r.status).type('text/plain; charset=utf-8').send(text)
  } catch (err) {
    res.status(500).send(err.message)
  }
})

router.get('/deploy/runs/:id/log', async (req, res) => {
  if (!runnerConfigured()) {
    return res.status(503).json({ error: 'deploy-runner not configured' })
  }
  const id = encodeURIComponent(req.params.id)
  const lastEventId = req.headers['last-event-id'] || req.query.lastEventId

  try {
    const r = await runnerFetch(`/runs/${id}/log` + (lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : ''), {
      method: 'GET',
      headers: lastEventId ? { 'Last-Event-ID': String(lastEventId) } : {},
    })

    if (!r.ok) {
      const errBody = await r.text().catch(() => '')
      return res.status(r.status).json({ error: errBody || 'runner error' })
    }

    // Стрим SSE как есть
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const reader = r.body.getReader()
    const decoder = new TextDecoder()

    req.on('close', () => {
      try { reader.cancel() } catch {}
    })

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
    }
    res.end()
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message })
    } else {
      res.end()
    }
  }
})

router.post('/deploy/runs/:id/abort', async (req, res) => {
  try {
    if (!runnerConfigured()) return res.status(503).json({ error: 'deploy-runner not configured' })
    const id = encodeURIComponent(req.params.id)
    const r = await runnerFetch(`/runs/${id}/abort`, { method: 'POST' })
    const body = await r.json().catch(() => ({}))

    audit.write(req, 'system.deploy.abort', { type: 'deploy', id: req.params.id }, {}).catch(() => {})

    res.status(r.status).json(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
