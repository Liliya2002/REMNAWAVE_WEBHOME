/**
 * deploy-runner — отдельный сервис, который запускает deploy.sh на хосте через docker.sock.
 *
 * Не использует express и других зависимостей: чистый node:http + child_process.
 *
 * Endpoints (внутренняя сеть docker, не выставляется наружу):
 *   POST /runs            — запустить deploy. Body: { version: "v1.2.0", flags?: ["--no-backup"] }
 *                           Возвращает: { runId, version, startedAt }
 *   GET  /runs            — список последних 20 запусков
 *   GET  /runs/:id        — статус конкретного запуска: { status, exitCode, startedAt, endedAt, logSize }
 *   GET  /runs/:id/log    — SSE-стрим логов. С header Last-Event-ID может продолжить с офсета.
 *   GET  /runs/:id/log.txt — plain text дамп всего лога (для скачивания)
 *   POST /runs/:id/abort  — пытается прервать запущенный deploy (SIGTERM)
 *   GET  /healthz         — health
 *
 * Auth: header X-Deploy-Token = DEPLOY_TOKEN (обязателен на всех путях кроме /healthz).
 */

const http = require('http')
const { spawn } = require('child_process')
const crypto = require('crypto')
const path = require('path')

const PORT = parseInt(process.env.RUNNER_PORT || '4100', 10)
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || ''
const PROJECT_DIR = process.env.PROJECT_DIR || '/project'
const MAX_KEEP_RUNS = 20
const MAX_LOG_LINES = 5000

if (!DEPLOY_TOKEN || DEPLOY_TOKEN.length < 16) {
  console.error('[runner] DEPLOY_TOKEN not set or too short (need >= 16 chars). Exiting.')
  process.exit(1)
}

// ─── State ───────────────────────────────────────────────────────────────────
/** @type {Map<string, Run>} */
const runs = new Map()
/** @type {Run|null} */
let activeRun = null

class Run {
  constructor(version, flags) {
    this.id = crypto.randomBytes(8).toString('hex')
    this.version = version
    this.flags = flags || []
    this.startedAt = new Date().toISOString()
    this.endedAt = null
    this.exitCode = null
    this.status = 'running' // running | success | failed | aborted
    /** @type {{seq: number, ts: string, line: string}[]} */
    this.lines = []
    this.subscribers = new Set()  // Set<res>
    /** @type {import('child_process').ChildProcess|null} */
    this.proc = null
  }

  pushLine(line) {
    const entry = {
      seq: this.lines.length,
      ts: new Date().toISOString(),
      line,
    }
    this.lines.push(entry)
    if (this.lines.length > MAX_LOG_LINES) {
      this.lines.shift()
    }
    // SSE рассылка
    const sseData = `id: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`
    for (const res of this.subscribers) {
      try { res.write(sseData) } catch {}
    }
  }

  finish(exitCode, signal) {
    this.endedAt = new Date().toISOString()
    this.exitCode = exitCode
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      this.status = 'aborted'
    } else {
      this.status = exitCode === 0 ? 'success' : 'failed'
    }
    this.proc = null

    // Завершаем все SSE-стримы финальным событием
    const final = `event: end\ndata: ${JSON.stringify({ status: this.status, exitCode })}\n\n`
    for (const res of this.subscribers) {
      try { res.write(final); res.end() } catch {}
    }
    this.subscribers.clear()
  }

  toSummary() {
    return {
      runId: this.id,
      version: this.version,
      flags: this.flags,
      status: this.status,
      exitCode: this.exitCode,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      logSize: this.lines.length,
    }
  }
}

function pruneOldRuns() {
  if (runs.size <= MAX_KEEP_RUNS) return
  // Удаляем самые старые завершённые
  const arr = Array.from(runs.values()).filter(r => r.status !== 'running')
  arr.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const toDelete = arr.slice(0, runs.size - MAX_KEEP_RUNS)
  for (const r of toDelete) runs.delete(r.id)
}

// ─── Запуск deploy.sh ─────────────────────────────────────────────────────────
function startDeploy(version, flags) {
  if (activeRun && activeRun.status === 'running') {
    throw new Error('Уже запущен другой deploy: ' + activeRun.id)
  }

  // Строгая валидация версии — впереди bash: только [a-zA-Z0-9._-]
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(version)) {
    throw new Error('Некорректный формат версии')
  }
  // Флаги — белый список
  const allowedFlags = new Set(['--yes', '--no-backup', '--skip-migrations'])
  for (const f of flags || []) {
    if (!allowedFlags.has(f)) throw new Error('Недопустимый флаг: ' + f)
  }

  const run = new Run(version, flags)
  runs.set(run.id, run)
  activeRun = run

  // --yes автоматически — иначе deploy.sh повиснет на чтении подтверждения
  const args = [path.join(PROJECT_DIR, 'deploy', 'deploy.sh'), version, '--yes', ...(flags || [])]

  run.pushLine(`[runner] Spawning: bash ${args.join(' ')}`)
  run.pushLine(`[runner] cwd: ${PROJECT_DIR}`)
  run.pushLine(`[runner] runId: ${run.id}`)
  run.pushLine('')

  const proc = spawn('bash', args, {
    cwd: PROJECT_DIR,
    env: { ...process.env, FORCE_COLOR: '0' }, // отключаем цвета — иначе ANSI escapes в логе
  })
  run.proc = proc

  // Stdout/stderr → построчно в лог
  let stdoutBuf = ''
  let stderrBuf = ''

  proc.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString()
    let nl
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl)
      run.pushLine(line)
      stdoutBuf = stdoutBuf.slice(nl + 1)
    }
  })

  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString()
    let nl
    while ((nl = stderrBuf.indexOf('\n')) !== -1) {
      const line = stderrBuf.slice(0, nl)
      run.pushLine('[stderr] ' + line)
      stderrBuf = stderrBuf.slice(nl + 1)
    }
  })

  proc.on('error', err => {
    run.pushLine(`[runner] spawn error: ${err.message}`)
    run.finish(127, null)
    if (activeRun === run) activeRun = null
  })

  proc.on('exit', (code, signal) => {
    if (stdoutBuf) run.pushLine(stdoutBuf)
    if (stderrBuf) run.pushLine('[stderr] ' + stderrBuf)
    run.pushLine('')
    run.pushLine(`[runner] Process exited code=${code} signal=${signal || 'none'}`)
    run.finish(code, signal)
    if (activeRun === run) activeRun = null
    pruneOldRuns()
  })

  return run
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > max) {
        req.destroy()
        reject(new Error('body too large'))
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJSON(res, status, body) {
  const str = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(str),
  })
  res.end(str)
}

function authOk(req) {
  return req.headers['x-deploy-token'] === DEPLOY_TOKEN
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'runner'}`)

  try {
    // Public health
    if (url.pathname === '/healthz') {
      return sendJSON(res, 200, { ok: true })
    }

    // Auth
    if (!authOk(req)) {
      return sendJSON(res, 401, { error: 'invalid deploy token' })
    }

    // POST /runs
    if (url.pathname === '/runs' && req.method === 'POST') {
      const raw = await readBody(req)
      let body
      try { body = JSON.parse(raw || '{}') } catch { return sendJSON(res, 400, { error: 'invalid JSON' }) }
      try {
        const run = startDeploy(body.version, body.flags)
        return sendJSON(res, 201, run.toSummary())
      } catch (e) {
        return sendJSON(res, 400, { error: e.message })
      }
    }

    // GET /runs
    if (url.pathname === '/runs' && req.method === 'GET') {
      const list = Array.from(runs.values())
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(r => r.toSummary())
      return sendJSON(res, 200, { runs: list, active: activeRun?.id || null })
    }

    // /runs/:id, /runs/:id/log, /runs/:id/log.txt, /runs/:id/abort
    const m = url.pathname.match(/^\/runs\/([a-f0-9]+)(\/.*)?$/)
    if (m) {
      const id = m[1]
      const sub = m[2] || ''
      const run = runs.get(id)
      if (!run) return sendJSON(res, 404, { error: 'run not found' })

      // GET /runs/:id
      if (!sub && req.method === 'GET') {
        return sendJSON(res, 200, run.toSummary())
      }

      // POST /runs/:id/abort
      if (sub === '/abort' && req.method === 'POST') {
        if (run.status !== 'running' || !run.proc) {
          return sendJSON(res, 400, { error: 'run not running' })
        }
        run.proc.kill('SIGTERM')
        return sendJSON(res, 200, { ok: true, message: 'SIGTERM sent' })
      }

      // GET /runs/:id/log.txt — plain dump
      if (sub === '/log.txt' && req.method === 'GET') {
        const text = run.lines.map(l => l.line).join('\n') + '\n'
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end(text)
      }

      // GET /runs/:id/log — SSE
      if (sub === '/log' && req.method === 'GET') {
        const lastEventId = parseInt(req.headers['last-event-id'] || url.searchParams.get('lastEventId') || '-1', 10)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',  // отключить буферизацию nginx
        })

        // Сначала отдаём накопленные логи начиная с lastEventId+1
        for (const entry of run.lines) {
          if (entry.seq > lastEventId) {
            res.write(`id: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`)
          }
        }

        // Если уже завершён — сразу шлём end и закрываем
        if (run.status !== 'running') {
          res.write(`event: end\ndata: ${JSON.stringify({ status: run.status, exitCode: run.exitCode })}\n\n`)
          res.end()
          return
        }

        // Подписываем на дальнейшие
        run.subscribers.add(res)
        // Heartbeat каждые 15 сек чтобы прокси не закрывал idle connection
        const hb = setInterval(() => {
          try { res.write(': heartbeat\n\n') } catch {}
        }, 15000)
        req.on('close', () => {
          clearInterval(hb)
          run.subscribers.delete(res)
        })
        return
      }
    }

    sendJSON(res, 404, { error: 'not found' })
  } catch (e) {
    console.error('[runner] handler error:', e.message)
    if (!res.headersSent) sendJSON(res, 500, { error: e.message })
    else res.end()
  }
})

server.listen(PORT, () => {
  console.log(`[runner] Listening on ${PORT}, project at ${PROJECT_DIR}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[runner] SIGTERM received, shutting down')
  if (activeRun?.proc) activeRun.proc.kill('SIGTERM')
  server.close(() => process.exit(0))
})
