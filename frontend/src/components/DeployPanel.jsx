import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Rocket, Terminal, X, Square, Download, RefreshCw,
  CheckCircle, XCircle, Loader, AlertTriangle
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = import.meta.env.VITE_API_URL || ''

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' })
}

function fmtDuration(start, end) {
  if (!start) return ''
  const e = end ? new Date(end) : new Date()
  const ms = e - new Date(start)
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function StatusBadge({ status }) {
  const map = {
    running:  { c: 'bg-blue-500/20 text-blue-300 border-blue-500/40', icon: <Loader className="w-3 h-3 animate-spin" />, label: 'выполняется' },
    success:  { c: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', icon: <CheckCircle className="w-3 h-3" />, label: 'успешно' },
    failed:   { c: 'bg-red-500/20 text-red-300 border-red-500/40', icon: <XCircle className="w-3 h-3" />, label: 'упал' },
    aborted:  { c: 'bg-amber-500/20 text-amber-300 border-amber-500/40', icon: <Square className="w-3 h-3" />, label: 'прерван' },
  }
  const m = map[status] || map.failed
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${m.c}`}>
      {m.icon} {m.label}
    </span>
  )
}

export default function DeployPanel({ updates, currentVersion, onClose }) {
  const [phase, setPhase] = useState('confirm')  // confirm | running | done
  const [targetVersion, setTargetVersion] = useState(updates?.latest || '')
  const [flagNoBackup, setFlagNoBackup] = useState(false)
  const [flagSkipMig, setFlagSkipMig] = useState(false)
  const [run, setRun] = useState(null)
  const [logs, setLogs] = useState([])
  const [connected, setConnected] = useState(false)
  const [reconnects, setReconnects] = useState(0)
  const [error, setError] = useState(null)
  const [aborting, setAborting] = useState(false)

  const eventSrcRef = useRef(null)
  const logBoxRef = useRef(null)
  const lastSeqRef = useRef(-1)

  // Авто-скролл при новых строках
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [logs])

  // Подключение к SSE
  const connectStream = useCallback((runId) => {
    if (eventSrcRef.current) {
      eventSrcRef.current.close()
      eventSrcRef.current = null
    }

    const lastEventId = lastSeqRef.current >= 0 ? `?lastEventId=${lastSeqRef.current}` : ''
    // Передаём токен через query — EventSource не поддерживает custom headers
    const token = localStorage.getItem('token') || ''
    const url = `${API}/api/admin/system/deploy/runs/${runId}/log${lastEventId}${lastEventId ? '&' : '?'}token=${encodeURIComponent(token)}`
    // ВАЖНО: token-в-query — компромисс. Backend этот вариант не принимает, поэтому
    // используем fetch + ReadableStream вместо EventSource (см. ниже).

    // Используем fetch streaming — позволяет передать Authorization header
    const controller = new AbortController()
    eventSrcRef.current = controller

    setConnected(false)
    setError(null)

    ;(async () => {
      try {
        const res = await fetch(`${API}/api/admin/system/deploy/runs/${runId}/log` +
          (lastSeqRef.current >= 0 ? `?lastEventId=${lastSeqRef.current}` : ''), {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'text/event-stream',
          },
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        setConnected(true)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          // Парсим SSE: события разделены \n\n, поля строки 'id: N', 'event: X', 'data: {...}', ': comment'
          let idx
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, idx)
            buf = buf.slice(idx + 2)

            let id = null
            let event = 'message'
            const dataLines = []
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) continue   // comment / heartbeat
              if (line.startsWith('id: ')) id = line.slice(4)
              else if (line.startsWith('event: ')) event = line.slice(7)
              else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
            }
            if (dataLines.length === 0) continue
            const dataStr = dataLines.join('\n')

            if (event === 'end') {
              try {
                const finalData = JSON.parse(dataStr)
                setRun(prev => prev ? { ...prev, status: finalData.status, exitCode: finalData.exitCode, endedAt: new Date().toISOString() } : prev)
              } catch {}
              setPhase('done')
              setConnected(false)
              return
            }

            try {
              const entry = JSON.parse(dataStr)
              if (id != null) lastSeqRef.current = parseInt(id, 10)
              setLogs(prev => [...prev, entry])
            } catch (e) {
              // ignore parse error
            }
          }
        }

        // Стрим закрылся со стороны сервера, но без 'end' — переподключаемся
        if (controller.signal.aborted) return
        setConnected(false)
        setReconnects(r => r + 1)
        setTimeout(() => connectStream(runId), 2000)
      } catch (err) {
        if (controller.signal.aborted) return
        setConnected(false)
        // Backend перезапустился? Перетык через 2 секунды до 30 попыток.
        setReconnects(r => r + 1)
        setTimeout(() => {
          // Проверяем не закончился ли уже деплой через GET /runs/:id
          authFetch(`/api/admin/system/deploy/runs/${runId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data && data.status && data.status !== 'running') {
                setRun(prev => prev ? { ...prev, ...data } : data)
                setPhase('done')
              } else {
                connectStream(runId)
              }
            })
            .catch(() => connectStream(runId))
        }, 2000)
      }
    })()
  }, [])

  // Cleanup при закрытии панели
  useEffect(() => {
    return () => {
      if (eventSrcRef.current) {
        eventSrcRef.current.abort?.()
        eventSrcRef.current.close?.()
        eventSrcRef.current = null
      }
    }
  }, [])

  async function startDeploy() {
    setError(null)
    setLogs([])
    lastSeqRef.current = -1

    const flags = []
    if (flagNoBackup) flags.push('--no-backup')
    if (flagSkipMig) flags.push('--skip-migrations')

    try {
      const res = await authFetch('/api/admin/system/deploy/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: targetVersion, flags }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Ошибка запуска')
        return
      }
      setRun(body)
      setPhase('running')
      connectStream(body.runId)
    } catch (e) {
      setError(e.message || 'Ошибка сети')
    }
  }

  async function abortDeploy() {
    if (!run || aborting) return
    if (!window.confirm('Прервать текущий deploy? Это пошлёт SIGTERM. Возможен частичный апдейт.')) return
    setAborting(true)
    try {
      await authFetch(`/api/admin/system/deploy/runs/${run.runId}/abort`, { method: 'POST' })
    } catch {}
    setAborting(false)
  }

  function downloadLog() {
    if (!run) return
    const token = localStorage.getItem('token') || ''
    const url = `${API}/api/admin/system/deploy/runs/${run.runId}/log.txt`
    fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.text())
      .then(text => {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `deploy-${run.runId}.log`
        a.click()
      })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[95vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Обновление системы</h2>
              {run && (
                <p className="text-xs text-slate-400 font-mono">
                  runId: {run.runId} · {targetVersion}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'running' && run && (
              <button
                onClick={abortDeploy}
                disabled={aborting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 rounded-lg text-sm transition-colors"
              >
                <Square className="w-3.5 h-3.5" /> Прервать
              </button>
            )}
            {(phase === 'done' || phase === 'confirm') && (
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {phase === 'confirm' && (
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <div className="font-semibold mb-1">Что произойдёт</div>
                  <ul className="list-disc list-inside text-amber-300/90 space-y-0.5 text-xs">
                    <li>Бэкап БД (pg_dump → /var/backups/vpn/)</li>
                    <li>git fetch + checkout указанного тега</li>
                    <li>docker compose pull новых образов</li>
                    <li>Применение pending миграций (транзакционно)</li>
                    <li>Rolling restart backend + frontend (15-30 сек даунтайм)</li>
                    <li>Smoke test /api/health</li>
                  </ul>
                  <div className="mt-2 text-amber-400 text-xs">При сбое — авто-откат.</div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 uppercase font-medium mb-1.5">Версия</label>
                <input
                  type="text"
                  value={targetVersion}
                  onChange={e => setTargetVersion(e.target.value)}
                  placeholder="v1.2.0"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                />
                <div className="text-xs text-slate-500 mt-1">
                  Текущая: <span className="font-mono">{currentVersion}</span>
                  {updates?.latest && updates.latest !== currentVersion && (
                    <> · Доступна: <span className="font-mono text-emerald-400">{updates.latest}</span></>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={flagNoBackup} onChange={e => setFlagNoBackup(e.target.checked)} className="rounded" />
                  Пропустить бэкап БД <span className="text-xs text-amber-400">(не рекомендуется)</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={flagSkipMig} onChange={e => setFlagSkipMig(e.target.checked)} className="rounded" />
                  Пропустить миграции БД
                </label>
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg text-sm">{error}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
                  Отмена
                </button>
                <button
                  onClick={startDeploy}
                  disabled={!targetVersion}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:shadow-lg hover:shadow-amber-500/30 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Rocket className="w-4 h-4" /> Запустить deploy
                </button>
              </div>
            </div>
          )}

          {(phase === 'running' || phase === 'done') && (
            <>
              {/* Status bar */}
              <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  {run && <StatusBadge status={run.status || 'running'} />}
                  {connected ? (
                    <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      live
                    </span>
                  ) : reconnects > 0 && phase === 'running' ? (
                    <span className="text-xs text-amber-400 flex items-center gap-1.5">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      переподключение #{reconnects}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {run && fmtDuration(run.startedAt, run.endedAt)} · {logs.length} строк
                </div>
              </div>

              {/* Log viewer */}
              <div
                ref={logBoxRef}
                className="flex-1 overflow-y-auto bg-slate-950 p-3 font-mono text-xs leading-relaxed"
              >
                {logs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-600 gap-2">
                    <Loader className="w-4 h-4 animate-spin" />
                    Ожидание логов…
                  </div>
                ) : (
                  logs.map((entry, i) => {
                    const line = entry.line
                    let cls = 'text-slate-300'
                    if (line.includes('[stderr]')) cls = 'text-red-400'
                    else if (line.includes('━━')) cls = 'text-cyan-300 font-bold'
                    else if (line.startsWith('[runner]')) cls = 'text-violet-400'
                    else if (line.startsWith('✓')) cls = 'text-emerald-400'
                    else if (line.startsWith('✗')) cls = 'text-red-400'
                    else if (line.startsWith('!')) cls = 'text-amber-400'
                    else if (line.startsWith('→')) cls = 'text-blue-400'
                    return (
                      <div key={i} className={cls + ' whitespace-pre-wrap'}>
                        {line}
                      </div>
                    )
                  })
                )}
              </div>

              {/* Footer */}
              <div className="p-3 border-t border-slate-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={downloadLog}
                    disabled={!run}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/50 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-lg text-xs disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" /> Скачать .log
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {phase === 'done' && run?.status === 'success' && (
                    <span className="text-xs text-emerald-400">✓ Готово, exit {run.exitCode}</span>
                  )}
                  {phase === 'done' && (run?.status === 'failed' || run?.status === 'aborted') && (
                    <span className="text-xs text-red-400">{run.status === 'aborted' ? 'Прервано' : `Упал, exit ${run.exitCode}`}</span>
                  )}
                  {phase === 'done' && (
                    <button
                      onClick={onClose}
                      className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm"
                    >
                      Закрыть
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
