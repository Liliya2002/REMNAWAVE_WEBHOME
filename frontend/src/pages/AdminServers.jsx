import React, { useEffect, useState, useMemo } from 'react'
import RwUsersPanel from '../components/RwUsersPanel'

const API_URL = import.meta.env.VITE_API_URL || ''

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatUptime(ms) {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}д ${h}ч`
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

function formatPanelUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d}д ${h}ч`
  return `${h}ч`
}

const countryFlags = {
  RU: '🇷🇺', DE: '🇩🇪', US: '🇺🇸', NL: '🇳🇱', FI: '🇫🇮', SG: '🇸🇬',
  GB: '🇬🇧', FR: '🇫🇷', JP: '🇯🇵', CA: '🇨🇦', AU: '🇦🇺', KR: '🇰🇷',
  SE: '🇸🇪', CH: '🇨🇭', PL: '🇵🇱', TR: '🇹🇷', AE: '🇦🇪', IN: '🇮🇳',
  BR: '🇧🇷', HK: '🇭🇰', TW: '🇹🇼', UA: '🇺🇦', KZ: '🇰🇿', CZ: '🇨🇿',
  GE: '🇬🇪',
}

const SORT_OPTIONS = [
  { value: 'name', label: 'По имени' },
  { value: 'users', label: 'По юзерам ↓' },
  { value: 'traffic', label: 'По трафику ↓' },
  { value: 'uptime', label: 'По uptime ↓' },
]

const STATUS_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'online', label: '🟢 Онлайн' },
  { value: 'offline', label: '🔴 Оффлайн' },
  { value: 'disabled', label: '⏸️ Отключены' },
]

export default function AdminServers() {
  const [servers, setServers] = useState([])
  const [squads, setSquads] = useState([])
  const [totalOnline, setTotalOnline] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedServer, setExpandedServer] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [systemStats, setSystemStats] = useState(null)
  const [serverUsers, setServerUsers] = useState({})
  const [loadingUsers, setLoadingUsers] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [editingName, setEditingName] = useState(null)
  const [newName, setNewName] = useState('')
  const [actionLoading, setActionLoading] = useState({})
  const [showNodes, setShowNodes] = useState(false)
  const [showServers, setShowServers] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const [localSquads, setLocalSquads] = useState([])
  const [localSquadsLoading, setLocalSquadsLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [editingSquadId, setEditingSquadId] = useState(null)
  const [editSquadName, setEditSquadName] = useState('')

  const token = localStorage.getItem('token')
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  async function fetchServers() {
    try {
      const res = await fetch(`${API_URL}/api/admin/servers`, { headers: authHeaders })
      if (!res.ok) throw new Error('Ошибка загрузки')
      const data = await res.json()
      setServers(data.servers || [])
      setSquads(data.squads || [])
      setTotalOnline(data.totalOnline || 0)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchSystemStats() {
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/system-stats`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setSystemStats(data.stats)
      }
    } catch {}
  }

  async function fetchServerUsers(uuid) {
    if (serverUsers[uuid]) {
      setServerUsers(prev => { const n = { ...prev }; delete n[uuid]; return n })
      return
    }
    setLoadingUsers(prev => ({ ...prev, [uuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${uuid}/users`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setServerUsers(prev => ({ ...prev, [uuid]: data.users || [] }))
      }
    } catch {} finally {
      setLoadingUsers(prev => ({ ...prev, [uuid]: false }))
    }
  }

  async function updateServerName(uuid) {
    if (!newName.trim()) return
    setActionLoading(prev => ({ ...prev, ['name_' + uuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${uuid}`, {
        method: 'PATCH', headers: authHeaders, body: JSON.stringify({ name: newName.trim() })
      })
      if (res.ok) {
        setServers(prev => prev.map(s => s.uuid === uuid ? { ...s, name: newName.trim() } : s))
        setEditingName(null)
        setNewName('')
      }
    } catch {} finally {
      setActionLoading(prev => ({ ...prev, ['name_' + uuid]: false }))
    }
  }

  async function toggleNode(uuid, currentDisabled) {
    const action = currentDisabled ? 'enable' : 'disable'
    setActionLoading(prev => ({ ...prev, ['node_' + uuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${uuid}/${action}`, {
        method: 'POST', headers: authHeaders
      })
      if (res.ok) {
        setServers(prev => prev.map(s => s.uuid === uuid ? { ...s, isDisabled: !currentDisabled } : s))
      }
    } catch {} finally {
      setActionLoading(prev => ({ ...prev, ['node_' + uuid]: false }))
    }
  }

  async function restartNode(uuid) {
    setActionLoading(prev => ({ ...prev, ['restart_' + uuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${uuid}/restart`, {
        method: 'POST', headers: authHeaders
      })
      if (res.ok) {
        fetchServers()
      }
    } catch {} finally {
      setActionLoading(prev => ({ ...prev, ['restart_' + uuid]: false }))
    }
  }

  async function toggleHost(hostUuid, currentDisabled) {
    setActionLoading(prev => ({ ...prev, ['host_' + hostUuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/hosts/${hostUuid}`, {
        method: 'PATCH', headers: authHeaders, body: JSON.stringify({ isDisabled: !currentDisabled })
      })
      if (res.ok) {
        setServers(prev => prev.map(s => ({
          ...s,
          hosts: s.hosts.map(h => h.uuid === hostUuid ? { ...h, isDisabled: !currentDisabled } : h)
        })))
      }
    } catch {} finally {
      setActionLoading(prev => ({ ...prev, ['host_' + hostUuid]: false }))
    }
  }

  async function fetchLocalSquads() {
    setLocalSquadsLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/squads`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setLocalSquads(data.squads || [])
      }
    } catch (err) {
      console.error('Error fetching local squads:', err)
    } finally {
      setLocalSquadsLoading(false)
    }
  }

  async function syncSquads() {
    setSyncLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/squads/sync`, {
        method: 'POST', headers: authHeaders
      })
      if (res.ok) {
        const data = await res.json()
        setLocalSquads(data.squads || [])
        fetchLocalSquads()
      }
    } catch (err) {
      console.error('Error syncing squads:', err)
    } finally {
      setSyncLoading(false)
    }
  }

  async function updateSquadName(squadId) {
    if (!editSquadName.trim()) return
    setActionLoading(prev => ({ ...prev, ['squad_' + squadId]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/squads/${squadId}`, {
        method: 'PATCH', headers: authHeaders,
        body: JSON.stringify({ display_name: editSquadName.trim() })
      })
      if (res.ok) {
        setLocalSquads(prev => prev.map(s => s.id === squadId ? { ...s, display_name: editSquadName.trim() } : s))
        setEditingSquadId(null)
        setEditSquadName('')
      }
    } catch {} finally {
      setActionLoading(prev => ({ ...prev, ['squad_' + squadId]: false }))
    }
  }

  useEffect(() => {
    fetchServers()
    fetchSystemStats()
    fetchLocalSquads()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => { fetchServers(); fetchSystemStats() }, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  const filteredServers = useMemo(() => {
    let list = [...servers]
    if (statusFilter === 'online') list = list.filter(s => s.isConnected && !s.isDisabled)
    else if (statusFilter === 'offline') list = list.filter(s => !s.isConnected && !s.isDisabled)
    else if (statusFilter === 'disabled') list = list.filter(s => s.isDisabled)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        (s.countryCode || '').toLowerCase().includes(q)
      )
    }

    list.sort((a, b) => {
      if (sortBy === 'users') return (b.usersOnline || 0) - (a.usersOnline || 0)
      if (sortBy === 'traffic') return (b.trafficUsedBytes || 0) - (a.trafficUsedBytes || 0)
      if (sortBy === 'uptime') return (b.xrayUptime || 0) - (a.xrayUptime || 0)
      return a.name.localeCompare(b.name)
    })
    return list
  }, [servers, statusFilter, search, sortBy])

  const connectedCount = servers.filter(s => s.isConnected && !s.isDisabled).length
  const disabledCount = servers.filter(s => s.isDisabled).length
  const disconnectedCount = servers.filter(s => !s.isConnected && !s.isDisabled).length
  const totalTrafficUsed = servers.reduce((sum, s) => sum + (s.trafficUsedBytes || 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Загрузка серверов...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <h3 className="text-xl sm:text-2xl font-bold text-white">🖥️ RemnaWave</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowServers(!showServers)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all border ${
              showServers ? 'bg-purple-500/15 border-purple-500/40 text-purple-400' : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-purple-500/40'
            }`}>
            {showServers ? '🗺️ Скрыть серверы' : '🗺️ Управление серверами'}
          </button>
          <button onClick={() => setShowNodes(!showNodes)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all border ${
              showNodes ? 'bg-blue-500/15 border-blue-500/40 text-blue-400' : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-blue-500/40'
            }`}>
            {showNodes ? '🖥️ Скрыть ноды' : '🖥️ Управление нодами'}
          </button>
          <button onClick={() => setShowUsers(!showUsers)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all border ${
              showUsers ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-cyan-500/40'
            }`}>
            {showUsers ? '👥 Скрыть пользователей' : '👥 Управление пользователями'}
          </button>
        </div>
      </div>

      {/* Users panel — toggled by button */}
      {showUsers && (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 p-4">
          <RwUsersPanel />
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {/* System Stats Panel */}
      {systemStats && (
        <div className="relative overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-slate-950/95 via-slate-900/90 to-slate-950/95 p-3 sm:p-4">
          <div className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-indigo-500/10 blur-3xl" />

          <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-400/80">RemnaWave Monitor</div>
              <h4 className="mt-0.5 text-base sm:text-lg font-extrabold text-white">Системная телеметрия панели</h4>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live Stats
            </div>
          </div>

          <div className="relative mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricTile label="CPU ядер" value={systemStats.cpu?.cores || '—'} accent="cyan" />
            <MetricTile
              label="RAM занято"
              value={`${formatBytes(systemStats.memory?.used || 0)} / ${formatBytes(systemStats.memory?.total || 0)}`}
              accent="blue"
            />
            <MetricTile label="RAM свободно" value={formatBytes(systemStats.memory?.available || 0)} accent="green" />
            <MetricTile label="Uptime панели" value={formatPanelUptime(systemStats.uptime)} accent="slate" />
            <MetricTile label="Всего юзеров" value={systemStats.users?.totalUsers || 0} accent="purple" />
            <MetricTile label="Онлайн сейчас" value={systemStats.onlineStats?.onlineNow || 0} accent="green" />
          </div>

          {systemStats.users?.statusCounts && (
            <div className="relative mt-2.5 grid grid-cols-3 gap-2 xl:grid-cols-6">
              <StatusPill label="Active" value={systemStats.users.statusCounts.ACTIVE || 0} tone="green" />
              <StatusPill label="Disabled" value={systemStats.users.statusCounts.DISABLED || 0} tone="red" />
              <StatusPill label="Limited" value={systemStats.users.statusCounts.LIMITED || 0} tone="yellow" />
              <StatusPill label="Expired" value={systemStats.users.statusCounts.EXPIRED || 0} tone="slate" />
              <StatusPill label="За 24ч" value={systemStats.onlineStats?.lastDay ?? 0} tone="blue" />
              <StatusPill label="За неделю" value={systemStats.onlineStats?.lastWeek ?? 0} tone="purple" />
            </div>
          )}
        </div>
      )}
      {/* Servers (Squads) management — toggled by button */}
      {showServers && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">🗺️ Управление серверами</h3>
            <button
              onClick={syncSquads}
              disabled={syncLoading}
              className="px-4 py-2 bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            >
              {syncLoading ? '⏳ Синхронизация...' : '🔄 Синхронизировать с RemnaWave'}
            </button>
          </div>

          {localSquadsLoading ? (
            <div className="flex items-center gap-2 text-slate-400 py-8 justify-center">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Загрузка серверов...
            </div>
          ) : localSquads.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500 mb-4">Серверы не найдены в базе данных</p>
              <button onClick={syncSquads} disabled={syncLoading}
                className="px-6 py-3 bg-purple-500/20 border border-purple-500/40 text-purple-400 hover:bg-purple-500/30 rounded-lg font-bold transition-all disabled:opacity-50">
                🔄 Загрузить из RemnaWave
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {localSquads.map(squad => (
                <div key={squad.id} className="p-5 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-xl hover:border-purple-500/30 transition-all">
                  {/* Header: name + edit */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    {editingSquadId === squad.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          value={editSquadName}
                          onChange={e => setEditSquadName(e.target.value)}
                          className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
                          placeholder="Название сервера"
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && updateSquadName(squad.id)}
                        />
                        <button onClick={() => updateSquadName(squad.id)} disabled={actionLoading['squad_' + squad.id]}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-xs font-bold text-white disabled:opacity-50">
                          {actionLoading['squad_' + squad.id] ? '...' : '✓'}
                        </button>
                        <button onClick={() => { setEditingSquadId(null); setEditSquadName('') }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-bold text-slate-300">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-white text-lg truncate">{squad.display_name}</h4>
                          {squad.display_name !== squad.tag && (
                            <p className="text-xs text-slate-500 mt-0.5">RemnaWave: {squad.tag}</p>
                          )}
                        </div>
                        <button
                          onClick={() => { setEditingSquadId(squad.id); setEditSquadName(squad.display_name) }}
                          className="shrink-0 px-2.5 py-1.5 bg-slate-800/50 border border-slate-700/50 hover:border-purple-500/50 rounded text-xs text-slate-400 hover:text-white transition-all"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex flex-wrap gap-4 text-sm text-slate-400 mb-3">
                    <span>🔗 {squad.inbounds_count} inbounds</span>
                    <span>🖥️ {squad.nodes_count} нод</span>
                  </div>

                  {/* Linked plans */}
                  {squad.linked_plans && squad.linked_plans.length > 0 ? (
                    <div className="mt-3 pt-3 border-t border-slate-700/30">
                      <p className="text-xs text-slate-500 font-semibold mb-2">📋 Привязан к тарифам:</p>
                      <div className="flex flex-wrap gap-2">
                        {squad.linked_plans.map(plan => (
                          <span key={plan.id} className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                            plan.is_active
                              ? 'bg-green-500/10 border-green-500/30 text-green-400'
                              : 'bg-slate-800/50 border-slate-700/30 text-slate-500'
                          }`}>
                            {plan.name} {!plan.is_active && '(неактивен)'}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-slate-700/30">
                      <p className="text-xs text-orange-400">⚠️ Не привязан ни к одному тарифу</p>
                    </div>
                  )}

                  {/* UUID */}
                  <div className="mt-3 text-xs text-slate-600 font-mono truncate">{squad.uuid}</div>

                  {/* Sync time */}
                  {squad.synced_at && (
                    <div className="text-xs text-slate-600 mt-1">
                      🔄 Синхронизировано: {new Date(squad.synced_at).toLocaleString('ru-RU')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Nodes management — toggled by button */}
      {showNodes && (<>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded" />
          Авто (30с)
        </label>
        <button onClick={() => { fetchServers(); fetchSystemStats() }}
          className="px-4 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg hover:border-blue-500/50 transition-all text-sm text-slate-300 font-semibold">
          🔄 Обновить
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Всего серверов" value={servers.length} />
        <SummaryCard label="🟢 Онлайн" value={connectedCount} color="green" />
        <SummaryCard label="🔴 Оффлайн" value={disconnectedCount} color="red" />
        <SummaryCard label="⏸️ Отключены" value={disabledCount} color="orange" />
        <SummaryCard label="👥 Онлайн юзеры" value={totalOnline} color="blue" />
      </div>

      {/* Total traffic */}
      <div className="p-4 bg-gradient-to-r from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-xl flex flex-wrap items-center gap-6">
        <div>
          <span className="text-xs text-slate-500 font-semibold">📊 Общий трафик: </span>
          <span className="text-lg font-bold text-cyan-400">{formatBytes(totalTrafficUsed)}</span>
        </div>
        {squads.length > 0 && (
          <div>
            <span className="text-xs text-slate-500 font-semibold">🗺️ Групп: </span>
            <span className="text-lg font-bold text-purple-400">{squads.length}</span>
          </div>
        )}
      </div>

      {/* Search, Filter, Sort */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input type="text" placeholder="🔍 Поиск по имени, адресу..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">✕</button>
          )}
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${
                statusFilter === f.value
                  ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                  : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500/50">
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {(search || statusFilter !== 'all') && (
        <div className="text-xs text-slate-500">
          Найдено: <span className="text-white font-bold">{filteredServers.length}</span> из {servers.length}
        </div>
      )}

      {/* Server List */}
      <div className="space-y-3">
        {filteredServers.map(server => {
          const isExpanded = expandedServer === server.uuid
          const statusColor = server.isDisabled
            ? 'border-orange-500/30 from-orange-900/10'
            : server.isConnected
              ? 'border-green-500/30 from-green-900/10'
              : 'border-red-500/30 from-red-900/10'
          const statusIcon = server.isDisabled ? '⏸️' : server.isConnected ? '🟢' : '🔴'
          const statusText = server.isDisabled ? 'Отключён' : server.isConnected ? 'Онлайн' : 'Оффлайн'
          const flag = countryFlags[server.countryCode?.toUpperCase()] || '🌍'
          const users = serverUsers[server.uuid]
          const isLoadingUsers = loadingUsers[server.uuid]

          return (
            <div key={server.uuid} className={`border bg-gradient-to-br ${statusColor} to-slate-900/50 rounded-xl overflow-hidden transition-all`}>
              <div className="p-4 sm:p-5 cursor-pointer hover:bg-slate-800/20 transition-colors"
                onClick={() => setExpandedServer(isExpanded ? null : server.uuid)}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-2xl">{flag}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-lg font-bold text-white truncate">{server.name}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          server.isDisabled ? 'bg-orange-500/20 text-orange-400'
                          : server.isConnected ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                        }`}>
                          {statusIcon} {statusText}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{server.address || '—'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 sm:gap-6 text-sm shrink-0">
                    <QuickStat label="Юзеры" value={server.usersOnline} color="text-blue-400" />
                    <QuickStat label="Трафик" value={formatBytes(server.trafficUsedBytes)} color="text-cyan-400" />
                    <QuickStat label="Uptime" value={formatUptime(server.xrayUptime)} color="text-slate-300" />
                    <span className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-slate-700/50 p-4 sm:p-5 bg-slate-900/30 space-y-4">
                  {/* Server name edit + actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {editingName === server.uuid ? (
                      <>
                        <input value={newName} onChange={e => setNewName(e.target.value)}
                          className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                          placeholder="Новое имя" autoFocus onKeyDown={e => e.key === 'Enter' && updateServerName(server.uuid)} />
                        <button onClick={() => updateServerName(server.uuid)} disabled={actionLoading['name_' + server.uuid]}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-bold text-white disabled:opacity-50">
                          {actionLoading['name_' + server.uuid] ? '...' : '✓'}
                        </button>
                        <button onClick={() => { setEditingName(null); setNewName('') }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-bold text-slate-300">✕</button>
                      </>
                    ) : (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setEditingName(server.uuid); setNewName(server.name) }}
                          className="px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 hover:border-blue-500/50 rounded text-xs text-slate-400 hover:text-white transition-all">
                          ✏️ Переименовать
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleNode(server.uuid, server.isDisabled) }}
                          disabled={actionLoading['node_' + server.uuid]}
                          className={`px-3 py-1.5 rounded text-xs font-bold transition-all border ${
                            server.isDisabled
                              ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                              : 'bg-orange-500/10 border-orange-500/30 text-orange-400 hover:bg-orange-500/20'
                          } disabled:opacity-50`}>
                          {actionLoading['node_' + server.uuid] ? '...'
                            : server.isDisabled ? '▶ Включить ноду' : '⏸ Отключить ноду'}
                        </button>
                        {server.isConnected && !server.isDisabled && (
                          <button
                            onClick={(e) => { e.stopPropagation(); restartNode(server.uuid) }}
                            disabled={actionLoading['restart_' + server.uuid]}
                            className="px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 rounded text-xs font-bold transition-all disabled:opacity-50">
                            {actionLoading['restart_' + server.uuid] ? '...' : '🔄 Рестарт Xray'}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Hardware */}
                  <div>
                    <h5 className="text-sm font-bold text-slate-400 mb-2">⚙️ Оборудование</h5>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <InfoCard label="CPU" value={server.cpuModel || '—'} />
                      <InfoCard label="CPU ядер" value={server.cpuCount || '—'} />
                      <InfoCard label="RAM" value={server.totalRam || '—'} />
                      <InfoCard label="Xray" value={server.xrayVersion || '—'} />
                    </div>
                  </div>

                  {/* Traffic details */}
                  <div>
                    <h5 className="text-sm font-bold text-slate-400 mb-2">📊 Трафик</h5>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <InfoCard label="Использовано" value={formatBytes(server.trafficUsedBytes)} />
                      <InfoCard label="Лимит" value={server.trafficLimitBytes ? formatBytes(server.trafficLimitBytes) : '∞'} />
                      <InfoCard label="Множитель" value={`×${server.consumptionMultiplier}`} />
                      <InfoCard label="День сброса" value={server.trafficResetDay || '—'} />
                    </div>
                    {server.trafficLimitBytes > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>{formatBytes(server.trafficUsedBytes)}</span>
                          <span>{formatBytes(server.trafficLimitBytes)}</span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${
                            server.trafficUsedBytes / server.trafficLimitBytes > 0.9 ? 'bg-red-500'
                              : server.trafficUsedBytes / server.trafficLimitBytes > 0.7 ? 'bg-yellow-500' : 'bg-cyan-500'
                          }`} style={{ width: `${Math.min(100, (server.trafficUsedBytes / server.trafficLimitBytes) * 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Hosts / Inbounds */}
                  {server.hosts?.length > 0 && (
                    <div>
                      <h5 className="text-sm font-bold text-slate-400 mb-2">🔗 Хосты ({server.hosts.length})</h5>
                      <div className="space-y-2">
                        {server.hosts.map(host => (
                          <div key={host.uuid} className={`p-3 rounded-lg border text-sm flex items-center justify-between gap-2 ${
                            host.isDisabled ? 'bg-slate-900/50 border-slate-700/30 opacity-60' : 'bg-slate-800/30 border-slate-700/50'
                          }`}>
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="font-mono text-slate-300 truncate">{host.remark || host.address || 'N/A'}</span>
                              {host.protocol && (
                                <span className="px-2 py-0.5 bg-blue-500/20 border border-blue-500/50 rounded text-xs text-blue-300 font-bold">{host.protocol}</span>
                              )}
                              <span className="text-slate-500">:{host.port}</span>
                              {host.isDisabled && <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs">выкл</span>}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleHost(host.uuid, host.isDisabled) }}
                              disabled={actionLoading['host_' + host.uuid]}
                              className={`shrink-0 px-3 py-1 rounded text-xs font-bold transition-all border ${
                                host.isDisabled
                                  ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                                  : 'bg-orange-500/10 border-orange-500/30 text-orange-400 hover:bg-orange-500/20'
                              } disabled:opacity-50`}>
                              {actionLoading['host_' + host.uuid] ? '...'
                                : host.isDisabled ? '▶ Включить' : '⏸ Выключить'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Users on server */}
                  <div>
                    <button onClick={(e) => { e.stopPropagation(); fetchServerUsers(server.uuid) }}
                      disabled={isLoadingUsers}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 hover:border-blue-500/50 rounded text-xs text-slate-400 hover:text-white transition-all disabled:opacity-50">
                      {isLoadingUsers ? (
                        <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Загрузка...</>
                      ) : users ? '👥 Скрыть пользователей' : '👥 Показать пользователей'}
                    </button>
                    {users && (
                      <div className="mt-2 max-h-60 overflow-y-auto">
                        {users.length === 0 ? (
                          <div className="text-xs text-slate-600 p-2">Нет подключённых пользователей</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-800">
                                <th className="text-left py-1.5 px-2">Имя</th>
                                <th className="text-left py-1.5 px-2">Статус</th>
                                <th className="text-right py-1.5 px-2">Трафик</th>
                              </tr>
                            </thead>
                            <tbody>
                              {users.slice(0, 50).map((u, i) => (
                                <tr key={u.uuid || i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                                  <td className="py-1.5 px-2 text-slate-300 font-mono truncate max-w-[200px]">{u.username || u.shortUuid || '—'}</td>
                                  <td className="py-1.5 px-2">
                                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                                      u.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400'
                                        : u.status === 'DISABLED' ? 'bg-red-500/20 text-red-400'
                                        : 'bg-slate-700 text-slate-400'
                                    }`}>{u.status || '—'}</span>
                                  </td>
                                  <td className="py-1.5 px-2 text-right text-slate-400">{formatBytes(u.usedTrafficBytes || u.trafficUsedBytes || 0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {users.length > 50 && (
                          <div className="text-xs text-slate-600 p-2 text-center">... и ещё {users.length - 50}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="text-xs text-slate-600 flex flex-wrap gap-4 pt-2 border-t border-slate-800/50">
                    {server.lastStatusMessage && <span>💬 {server.lastStatusMessage}</span>}
                    {server.updatedAt && <span>🕐 Обновлено: {new Date(server.updatedAt).toLocaleString('ru-RU')}</span>}
                    <span className="font-mono text-slate-700">{server.uuid}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filteredServers.length === 0 && !error && (
        <div className="text-center py-16 text-slate-500">
          {search || statusFilter !== 'all' ? 'Нет серверов по фильтрам' : 'Серверы не найдены'}
        </div>
      )}

      </>)}{/* end showNodes */}
    </div>
  )
}

function InfoCard({ label, value }) {
  return (
    <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/30">
      <div className="text-xs text-slate-500 font-semibold mb-1">{label}</div>
      <div className="font-mono font-bold text-slate-300 text-sm truncate">{value}</div>
    </div>
  )
}

function MiniStat({ label, value, color = 'text-white' }) {
  return (
    <div className="text-center">
      <div className="text-xs text-slate-500 font-semibold">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  )
}

function MetricTile({ label, value, accent = 'slate' }) {
  const accentMap = {
    cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    purple: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    slate: 'border-slate-600/50 bg-slate-800/50 text-slate-100',
  }

  return (
    <div className={`rounded-lg border p-2.5 ${accentMap[accent] || accentMap.slate}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80 leading-tight">{label}</div>
      <div className="mt-0.5 text-sm sm:text-base font-black tracking-tight leading-tight">{value}</div>
    </div>
  )
}

function StatusPill({ label, value, tone = 'slate' }) {
  const toneMap = {
    green: 'border-green-500/30 bg-green-500/10 text-green-300',
    red: 'border-red-500/30 bg-red-500/10 text-red-300',
    yellow: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    purple: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    slate: 'border-slate-600/50 bg-slate-800/50 text-slate-300',
  }

  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${toneMap[tone] || toneMap.slate}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80 leading-tight">{label}</div>
      <div className="text-xs sm:text-sm font-bold mt-0.5 leading-tight">{value}</div>
    </div>
  )
}

function SummaryCard({ label, value, color }) {
  const colorMap = {
    green: { bg: 'from-green-900/20 border-green-700/30', text: 'text-green-400' },
    red: { bg: 'from-red-900/20 border-red-700/30', text: 'text-red-400' },
    orange: { bg: 'from-orange-900/20 border-orange-700/30', text: 'text-orange-400' },
    blue: { bg: 'from-blue-900/20 border-blue-700/30', text: 'text-blue-400' },
  }
  const c = colorMap[color] || { bg: 'from-slate-800/40 border-slate-700/50', text: 'text-white' }
  return (
    <div className={`p-4 bg-gradient-to-br ${c.bg} to-slate-900/50 border rounded-xl`}>
      <div className={`text-xs ${c.text} font-semibold mb-1`}>{label}</div>
      <div className={`text-2xl font-bold ${c.text}`}>{value}</div>
    </div>
  )
}

function QuickStat({ label, value, color }) {
  return (
    <div className="text-center">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-bold ${color}`}>{value}</div>
    </div>
  )
}
