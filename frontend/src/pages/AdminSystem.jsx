import React, { useEffect, useState, useCallback } from 'react'
import {
  Server, GitBranch, Calendar, Cpu, Database, Activity,
  Layers, CheckCircle, AlertTriangle, XCircle, RefreshCw,
  ExternalLink, Clock, HardDrive, Zap, Sparkles, ArrowUpCircle, Package, Rocket,
} from 'lucide-react'
import { authFetch } from '../services/api'
import DeployPanel from '../components/DeployPanel'

function fmtBytes(bytes) {
  if (!bytes) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = bytes
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}

function fmtUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts = []
  if (d) parts.push(`${d}д`)
  if (h) parts.push(`${h}ч`)
  if (m) parts.push(`${m}м`)
  if (!d && !h) parts.push(`${s}с`)
  return parts.join(' ')
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function StatusPill({ status, children }) {
  const map = {
    ok:       'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    pending:  'bg-amber-500/15  text-amber-300  border-amber-500/40',
    error:    'bg-red-500/15    text-red-300    border-red-500/40',
    info:     'bg-blue-500/15   text-blue-300   border-blue-500/40',
    neutral:  'bg-slate-500/15  text-slate-300  border-slate-500/40',
  }
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${map[status] || map.neutral}`}>
      {children}
    </span>
  )
}

function Card({ icon: Icon, iconColor, title, children, className = '' }) {
  return (
    <div className={`bg-gradient-to-br from-slate-900/60 to-slate-950/50 border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-lg ${iconColor || 'bg-blue-500/20 text-blue-400'} flex items-center justify-center`}>
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-base font-bold text-white">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function KV({ k, v, mono = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-slate-800/40 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{k}</span>
      <span className={`text-sm text-slate-200 truncate ${mono ? 'font-mono' : ''}`}>{v}</span>
    </div>
  )
}

export default function AdminSystem() {
  const [info, setInfo] = useState(null)
  const [migrations, setMigrations] = useState(null)
  const [health, setHealth] = useState(null)
  const [updates, setUpdates] = useState(null)
  const [deployStatus, setDeployStatus] = useState(null)
  const [showDeployPanel, setShowDeployPanel] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updatesLoading, setUpdatesLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [i, m, h, d] = await Promise.all([
        authFetch('/api/admin/system/info').then(r => r.ok ? r.json() : null),
        authFetch('/api/admin/system/migrations').then(r => r.ok ? r.json() : null),
        authFetch('/api/admin/system/health').then(r => r.ok ? r.json() : null),
        authFetch('/api/admin/system/deploy/status').then(r => r.ok ? r.json() : null),
      ])
      setInfo(i); setMigrations(m); setHealth(h); setDeployStatus(d)
    } catch (e) {
      setError(e.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUpdates = useCallback(async (fresh = false) => {
    setUpdatesLoading(true)
    try {
      const res = await authFetch(`/api/admin/system/updates${fresh ? '?fresh=1' : ''}`)
      if (res.ok) setUpdates(await res.json())
    } catch (e) {
      // silent
    } finally {
      setUpdatesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    fetchUpdates(false)
  }, [fetchAll, fetchUpdates])

  if (loading && !info) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {showDeployPanel && (
        <DeployPanel
          updates={updates}
          currentVersion={info?.version}
          onClose={() => { setShowDeployPanel(false); fetchAll() }}
        />
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Server className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Система</h1>
            <p className="text-sm text-slate-400">Версия, миграции, проверка обновлений</p>
          </div>
        </div>
        <button
          onClick={() => { fetchAll(); fetchUpdates(true) }}
          disabled={loading || updatesLoading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${(loading || updatesLoading) ? 'animate-spin' : ''}`} />
          <span className="text-sm">Обновить</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-400 rounded-lg text-sm">{error}</div>
      )}

      {/* Update banner */}
      {updates?.configured && updates.behindCount > 0 && (
        <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-500/40 rounded-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
                <ArrowUpCircle className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-amber-200 text-sm sm:text-base">
                  Доступно обновление: <span className="font-mono">{updates.latest}</span>
                </div>
                <div className="text-xs sm:text-sm text-amber-300/80 mt-0.5">
                  Вы отстаёте на {updates.behindCount} {updates.behindCount === 1 ? 'версию' : updates.behindCount < 5 ? 'версии' : 'версий'} от последней.
                  Текущая: <span className="font-mono">{updates.current}</span>
                </div>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {updates.behindVersions[0]?.url && (
                <a
                  href={updates.behindVersions[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-amber-500/10 border border-amber-500/40 text-amber-200 rounded-lg hover:bg-amber-500/20 transition-all flex items-center gap-1.5 text-sm font-medium"
                >
                  <ExternalLink className="w-4 h-4" /> GitHub
                </a>
              )}
              {deployStatus?.configured && deployStatus.ok && (
                <button
                  onClick={() => setShowDeployPanel(true)}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:shadow-lg hover:shadow-amber-500/30 text-white font-medium rounded-lg flex items-center gap-2 text-sm transition-all"
                >
                  <Rocket className="w-4 h-4" /> Обновить сейчас
                </button>
              )}
            </div>
          </div>
          {deployStatus && !deployStatus.configured && (
            <div className="mt-3 text-xs text-amber-400/80">
              Кнопка «Обновить» недоступна: deploy-runner не настроен в этом окружении. См. DEPLOY.md.
            </div>
          )}
          {deployStatus?.configured && !deployStatus.ok && (
            <div className="mt-3 text-xs text-red-400">
              deploy-runner недоступен: {deployStatus.error || 'unknown'}
            </div>
          )}
        </div>
      )}

      {updates?.configured && updates.isLatest && updates.latest && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-2xl flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="text-sm text-emerald-200">
            Установлена последняя стабильная версия <span className="font-mono font-semibold">{updates.current}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Version */}
        <Card icon={Cpu} iconColor="bg-violet-500/20 text-violet-400" title="Версия и сборка">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white font-mono">{info?.version || '—'}</span>
            {info?.shaShort && (
              <span className="text-xs text-slate-500 font-mono">@ {info.shaShort}</span>
            )}
          </div>
          <KV k="Build SHA" v={info?.sha || '—'} mono />
          <KV k="Build date" v={fmtDate(info?.buildDate)} />
          <KV k="Started at" v={fmtDate(info?.startedAt)} />
          <KV k="Uptime" v={fmtUptime(info?.uptimeSeconds)} />
          <KV k="Node" v={info?.nodeVersion || '—'} mono />
          <KV k="Platform" v={info?.platform || '—'} mono />
          <KV k="Env" v={info?.env || '—'} />
        </Card>

        {/* Health */}
        <Card icon={Activity} iconColor="bg-emerald-500/20 text-emerald-400" title="Здоровье системы">
          {health ? (
            <div className="space-y-2.5">
              {/* DB */}
              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-700/40">
                <div className="flex items-center gap-2.5">
                  <Database className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-200">База данных</span>
                </div>
                {health.checks.db?.ok ? (
                  <StatusPill status="ok">{health.checks.db.latencyMs} ms</StatusPill>
                ) : (
                  <StatusPill status="error">DOWN</StatusPill>
                )}
              </div>

              {/* DB stats */}
              {health.checks.dbStats?.sizeBytes != null && (
                <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-700/40">
                  <div className="flex items-center gap-2.5">
                    <HardDrive className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-200">Размер БД</span>
                  </div>
                  <span className="text-sm text-slate-300 font-mono">
                    {fmtBytes(health.checks.dbStats.sizeBytes)} · {health.checks.dbStats.tables} таблиц
                  </span>
                </div>
              )}

              {/* Remnawave */}
              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-700/40">
                <div className="flex items-center gap-2.5">
                  <Zap className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-200">Remnawave Panel</span>
                </div>
                {health.checks.remnawave?.configured === false ? (
                  <StatusPill status="neutral">не настроен</StatusPill>
                ) : health.checks.remnawave?.ok ? (
                  <StatusPill status="ok">{health.checks.remnawave.latencyMs} ms</StatusPill>
                ) : (
                  <StatusPill status="error">DOWN</StatusPill>
                )}
              </div>

              {/* Memory */}
              {health.checks.memory && (
                <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-700/40">
                  <div className="flex items-center gap-2.5">
                    <Cpu className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-200">Память (RSS)</span>
                  </div>
                  <span className="text-sm text-slate-300 font-mono">
                    {health.checks.memory.rssMB} MB
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Загрузка…</div>
          )}
        </Card>
      </div>

      {/* Migrations */}
      <Card icon={Layers} iconColor="bg-blue-500/20 text-blue-400" title="Миграции БД">
        {migrations ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 bg-slate-800/40 border border-slate-700/40 rounded-lg">
                <div className="text-[11px] text-slate-500 uppercase font-medium">Всего</div>
                <div className="text-2xl font-bold text-slate-100">{migrations.total}</div>
              </div>
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <div className="text-[11px] text-emerald-400 uppercase font-medium">Применено</div>
                <div className="text-2xl font-bold text-emerald-300">{migrations.appliedCount}</div>
              </div>
              <div className={`p-3 rounded-lg border ${
                migrations.pendingCount > 0
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-slate-800/40 border-slate-700/40'
              }`}>
                <div className={`text-[11px] uppercase font-medium ${migrations.pendingCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>В очереди</div>
                <div className={`text-2xl font-bold ${migrations.pendingCount > 0 ? 'text-amber-300' : 'text-slate-300'}`}>{migrations.pendingCount}</div>
              </div>
              <div className={`p-3 rounded-lg border ${
                (migrations.modifiedCount + migrations.ghostCount) > 0
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-slate-800/40 border-slate-700/40'
              }`}>
                <div className={`text-[11px] uppercase font-medium ${(migrations.modifiedCount + migrations.ghostCount) > 0 ? 'text-red-400' : 'text-slate-500'}`}>Конфликтов</div>
                <div className={`text-2xl font-bold ${(migrations.modifiedCount + migrations.ghostCount) > 0 ? 'text-red-300' : 'text-slate-300'}`}>
                  {migrations.modifiedCount + migrations.ghostCount}
                </div>
              </div>
            </div>

            {migrations.pendingCount > 0 && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200">
                  <div className="font-semibold">Есть {migrations.pendingCount} непринятых миграций.</div>
                  <div className="text-amber-300/80 mt-0.5">
                    Запустите на сервере: <code className="px-1.5 py-0.5 bg-slate-900/60 rounded font-mono">npm run migrate:up</code>
                  </div>
                </div>
              </div>
            )}

            {(migrations.modifiedCount + migrations.ghostCount) > 0 && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/40 rounded-lg flex items-start gap-2.5">
                <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs text-red-200">
                  <div className="font-semibold">Конфликты в миграциях.</div>
                  <div className="text-red-300/80 mt-0.5">
                    {migrations.modifiedCount > 0 && <>{migrations.modifiedCount} изменены после применения. </>}
                    {migrations.ghostCount > 0 && <>{migrations.ghostCount} применены, но файлов нет. </>}
                    Запустите <code className="px-1.5 py-0.5 bg-slate-900/60 rounded font-mono">npm run migrate:verify</code> для деталей.
                  </div>
                </div>
              </div>
            )}

            <div className="max-h-[400px] overflow-y-auto -mx-1 px-1 scrollbar-hide">
              <div className="divide-y divide-slate-800/50 border border-slate-800/50 rounded-lg overflow-hidden">
                {migrations.items.map(m => (
                  <div key={m.name} className="flex items-center gap-3 px-3 py-2.5 bg-slate-900/30">
                    <div className="shrink-0">
                      {m.status === 'applied' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                      {m.status === 'pending' && <Clock className="w-4 h-4 text-amber-400" />}
                      {m.status === 'modified' && <AlertTriangle className="w-4 h-4 text-red-400" />}
                      {m.status === 'ghost' && <XCircle className="w-4 h-4 text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm text-slate-200 truncate">{m.name}</div>
                      {m.appliedAt && (
                        <div className="text-[11px] text-slate-500">
                          {fmtDate(m.appliedAt)}{m.durationMs != null ? ` · ${m.durationMs} ms` : ''}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {!m.hasDown && m.status === 'applied' && (
                        <span className="text-[10px] text-slate-600">no-down</span>
                      )}
                      <StatusPill status={
                        m.status === 'applied' ? 'ok' :
                        m.status === 'pending' ? 'pending' :
                        'error'
                      }>
                        {m.status}
                      </StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-500">Загрузка…</div>
        )}
      </Card>

      {/* Updates / Releases */}
      <Card icon={Package} iconColor="bg-slate-500/20 text-slate-300" title="Обновления">
        {updates?.configured === false ? (
          <div className="p-4 bg-slate-800/30 border border-slate-700/40 rounded-lg text-sm text-slate-400">
            <p className="mb-2">{updates.message}</p>
            <p className="text-xs text-slate-500">
              Добавьте в <code className="font-mono px-1 py-0.5 bg-slate-900/60 rounded">.env</code>:
              <br />
              <code className="font-mono">GITHUB_REPO=owner/vpnwebhome</code>
            </p>
          </div>
        ) : updates?.error ? (
          <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg text-sm">
            {updates.error}
          </div>
        ) : updates?.recentReleases ? (
          <>
            <div className="mb-4 p-4 bg-slate-800/40 border border-slate-700/40 rounded-lg flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500 uppercase font-medium">Текущая</div>
                <div className="text-xl font-bold font-mono text-slate-100">{updates.current}</div>
              </div>
              <Sparkles className="w-5 h-5 text-slate-600" />
              <div className="text-right">
                <div className="text-xs text-slate-500 uppercase font-medium">Последняя</div>
                <div className={`text-xl font-bold font-mono ${
                  updates.isLatest ? 'text-emerald-300' : 'text-amber-300'
                }`}>{updates.latest || '—'}</div>
              </div>
            </div>

            <div className="space-y-2">
              {updates.recentReleases.length === 0 && (
                <div className="text-sm text-slate-500 text-center py-4">Релизов ещё нет</div>
              )}
              {updates.recentReleases.map(rel => (
                <a
                  key={rel.version}
                  href={rel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-all ${
                    rel.isCurrent
                      ? 'bg-blue-500/10 border-blue-500/40 hover:bg-blue-500/15'
                      : 'bg-slate-800/30 border-slate-700/40 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <GitBranch className={`w-4 h-4 shrink-0 ${rel.isCurrent ? 'text-blue-400' : 'text-slate-500'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-sm font-semibold ${rel.isCurrent ? 'text-blue-300' : 'text-slate-200'}`}>
                          {rel.version}
                        </span>
                        {rel.isCurrent && <StatusPill status="info">текущая</StatusPill>}
                      </div>
                      {rel.name && rel.name !== rel.version && (
                        <div className="text-xs text-slate-500 truncate">{rel.name}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
                    {fmtDate(rel.publishedAt)}
                    <ExternalLink className="w-3 h-3" />
                  </div>
                </a>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
          </div>
        )}

        {updates?.checkedAt && (
          <div className="mt-3 text-[11px] text-slate-600 text-right">
            Проверено: {fmtDate(updates.checkedAt)}{updates.fromCache ? ' (кеш)' : ''}
          </div>
        )}
      </Card>
    </div>
  )
}
