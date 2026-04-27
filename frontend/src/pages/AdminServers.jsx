import React, { useEffect, useMemo, useState } from 'react'
import {
  // page
  Globe, RefreshCw, Search, X, ChevronDown,
  // tabs
  Server, Layers, Users as UsersIcon,
  // stats
  Cpu, MemoryStick, Clock, Activity, UserCheck, Wifi,
  // status / actions
  CheckCircle, XCircle, PauseCircle, PlayCircle, Pause,
  RotateCcw, Pencil, Check, Plug, AlertTriangle, Link2,
  HardDrive, Gauge, ArrowDownUp, MapPin,
} from 'lucide-react'
import RwUsersPanel from '../components/RwUsersPanel'

const API_URL = import.meta.env.VITE_API_URL || ''

// ─── Утилиты форматирования ─────────────────────────────────────────────────
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

const COUNTRY_FLAGS = {
  RU: '🇷🇺', DE: '🇩🇪', US: '🇺🇸', NL: '🇳🇱', FI: '🇫🇮', SG: '🇸🇬',
  GB: '🇬🇧', FR: '🇫🇷', JP: '🇯🇵', CA: '🇨🇦', AU: '🇦🇺', KR: '🇰🇷',
  SE: '🇸🇪', CH: '🇨🇭', PL: '🇵🇱', TR: '🇹🇷', AE: '🇦🇪', IN: '🇮🇳',
  BR: '🇧🇷', HK: '🇭🇰', TW: '🇹🇼', UA: '🇺🇦', KZ: '🇰🇿', CZ: '🇨🇿', GE: '🇬🇪',
}

const SORT_OPTIONS = [
  { value: 'name',    label: 'По имени' },
  { value: 'users',   label: 'По юзерам ↓' },
  { value: 'traffic', label: 'По трафику ↓' },
  { value: 'uptime',  label: 'По uptime ↓' },
]

const STATUS_FILTERS = [
  { value: 'all',      label: 'Все' },
  { value: 'online',   label: 'Онлайн',     dot: 'bg-emerald-400' },
  { value: 'offline',  label: 'Оффлайн',    dot: 'bg-red-400' },
  { value: 'disabled', label: 'Отключены',  dot: 'bg-amber-400' },
]

// ─── Универсальные компоненты ───────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    online:   { c: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', label: 'Онлайн' },
    offline:  { c: 'bg-red-500/15 text-red-300 border-red-500/40', dot: 'bg-red-400', label: 'Оффлайн' },
    disabled: { c: 'bg-amber-500/15 text-amber-300 border-amber-500/40', dot: 'bg-amber-400', label: 'Отключён' },
  }
  const m = map[status] || map.offline
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${m.c}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${status === 'online' ? 'animate-pulse' : ''}`} />
      {m.label}
    </span>
  )
}

function MetricTile({ icon: Icon, label, value, accent = 'slate' }) {
  const accents = {
    cyan:    'border-cyan-500/30 from-cyan-500/10 to-cyan-500/5 text-cyan-300',
    blue:    'border-blue-500/30 from-blue-500/10 to-blue-500/5 text-blue-300',
    emerald: 'border-emerald-500/30 from-emerald-500/10 to-emerald-500/5 text-emerald-300',
    violet:  'border-violet-500/30 from-violet-500/10 to-violet-500/5 text-violet-300',
    amber:   'border-amber-500/30 from-amber-500/10 to-amber-500/5 text-amber-300',
    slate:   'border-slate-700 from-slate-800/40 to-slate-800/20 text-slate-200',
  }
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-gradient-to-br ${accents[accent]}`}>
      <div className="w-8 h-8 rounded-lg bg-slate-900/60 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase font-medium tracking-wide opacity-70 truncate">{label}</div>
        <div className="text-sm sm:text-base font-bold text-white font-mono leading-tight truncate">{value}</div>
      </div>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, accent = 'slate' }) {
  const map = {
    emerald: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    red:     'text-red-300 border-red-500/30 bg-red-500/10',
    amber:   'text-amber-300 border-amber-500/30 bg-amber-500/10',
    blue:    'text-blue-300 border-blue-500/30 bg-blue-500/10',
    slate:   'text-slate-200 border-slate-700 bg-slate-800/30',
  }
  return (
    <div className={`p-3 rounded-xl border ${map[accent]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 opacity-80" />
        <span className="text-[11px] uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono">{value}</div>
    </div>
  )
}

function InfoCard({ label, value }) {
  return (
    <div className="px-3 py-2 bg-slate-900/50 rounded-lg border border-slate-700/40">
      <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{label}</div>
      <div className="text-sm font-mono font-semibold text-slate-200 truncate">{value}</div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AdminServers() {
  // Data
  const [servers, setServers] = useState([])
  const [squads, setSquads] = useState([])
  const [localSquads, setLocalSquads] = useState([])
  const [systemStats, setSystemStats] = useState(null)
  const [totalOnline, setTotalOnline] = useState(0)
  const [serverUsers, setServerUsers] = useState({})

  // UI
  const [loading, setLoading] = useState(true)
  const [localSquadsLoading, setLocalSquadsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('nodes') // nodes | squads | users
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Action loading flags
  const [actionLoading, setActionLoading] = useState({})
  const [loadingUsers, setLoadingUsers] = useState({})
  const [syncLoading, setSyncLoading] = useState(false)

  // Filters / interaction
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [expandedServer, setExpandedServer] = useState(null)
  const [editingName, setEditingName] = useState(null)
  const [newName, setNewName] = useState('')
  const [editingSquadId, setEditingSquadId] = useState(null)
  const [editSquadName, setEditSquadName] = useState('')

  const token = localStorage.getItem('token')
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // ─── Fetchers ────────────────────────────────────────────────────────────
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
      const res = await fetch(`${API_URL}/api/admin/squads/sync`, { method: 'POST', headers: authHeaders })
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

  // ─── Mutations ───────────────────────────────────────────────────────────
  async function updateServerName(uuid) {
    if (!newName.trim()) return
    setActionLoading(p => ({ ...p, ['name_' + uuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${uuid}`, {
        method: 'PATCH', headers: authHeaders, body: JSON.stringify({ name: newName.trim() })
      })
      if (res.ok) {
        setServers(p => p.map(s => s.uuid === uuid ? { ...s, name: newName.trim() } : s))
        setEditingName(null); setNewName('')
      }
    } catch {} finally {
      setActionLoading(p => ({ ...p, ['name_' + uuid]: false }))
    }
  }

  async function toggleNode(uuid, currentDisabled) {
    const action = currentDisabled ? 'enable' : 'disable'
    setActionLoading(p => ({ ...p, ['node_' + uuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${uuid}/${action}`, { method: 'POST', headers: authHeaders })
      if (res.ok) {
        setServers(p => p.map(s => s.uuid === uuid ? { ...s, isDisabled: !currentDisabled } : s))
      }
    } catch {} finally {
      setActionLoading(p => ({ ...p, ['node_' + uuid]: false }))
    }
  }

  async function restartNode(uuid) {
    setActionLoading(p => ({ ...p, ['restart_' + uuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${uuid}/restart`, { method: 'POST', headers: authHeaders })
      if (res.ok) fetchServers()
    } catch {} finally {
      setActionLoading(p => ({ ...p, ['restart_' + uuid]: false }))
    }
  }

  async function toggleHost(hostUuid, currentDisabled) {
    setActionLoading(p => ({ ...p, ['host_' + hostUuid]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/hosts/${hostUuid}`, {
        method: 'PATCH', headers: authHeaders, body: JSON.stringify({ isDisabled: !currentDisabled })
      })
      if (res.ok) {
        setServers(p => p.map(s => ({
          ...s,
          hosts: s.hosts.map(h => h.uuid === hostUuid ? { ...h, isDisabled: !currentDisabled } : h),
        })))
      }
    } catch {} finally {
      setActionLoading(p => ({ ...p, ['host_' + hostUuid]: false }))
    }
  }

  async function updateSquadName(squadId) {
    if (!editSquadName.trim()) return
    setActionLoading(p => ({ ...p, ['squad_' + squadId]: true }))
    try {
      const res = await fetch(`${API_URL}/api/admin/squads/${squadId}`, {
        method: 'PATCH', headers: authHeaders, body: JSON.stringify({ display_name: editSquadName.trim() })
      })
      if (res.ok) {
        setLocalSquads(p => p.map(s => s.id === squadId ? { ...s, display_name: editSquadName.trim() } : s))
        setEditingSquadId(null); setEditSquadName('')
      }
    } catch {} finally {
      setActionLoading(p => ({ ...p, ['squad_' + squadId]: false }))
    }
  }

  // ─── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchServers(); fetchSystemStats(); fetchLocalSquads()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => { fetchServers(); fetchSystemStats() }, 30000)
    return () => clearInterval(id)
  }, [autoRefresh])

  // ─── Derived ─────────────────────────────────────────────────────────────
  const filteredServers = useMemo(() => {
    let list = [...servers]
    if (statusFilter === 'online')   list = list.filter(s => s.isConnected && !s.isDisabled)
    else if (statusFilter === 'offline')  list = list.filter(s => !s.isConnected && !s.isDisabled)
    else if (statusFilter === 'disabled') list = list.filter(s => s.isDisabled)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        (s.countryCode || '').toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      if (sortBy === 'users')   return (b.usersOnline || 0) - (a.usersOnline || 0)
      if (sortBy === 'traffic') return (b.trafficUsedBytes || 0) - (a.trafficUsedBytes || 0)
      if (sortBy === 'uptime')  return (b.xrayUptime || 0) - (a.xrayUptime || 0)
      return a.name.localeCompare(b.name)
    })
    return list
  }, [servers, statusFilter, search, sortBy])

  const connectedCount    = servers.filter(s => s.isConnected && !s.isDisabled).length
  const disabledCount     = servers.filter(s => s.isDisabled).length
  const disconnectedCount = servers.filter(s => !s.isConnected && !s.isDisabled).length
  const totalTrafficUsed  = servers.reduce((sum, s) => sum + (s.trafficUsedBytes || 0), 0)

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Globe className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">RemnaWave</h1>
            <p className="text-xs text-slate-400">Управление нодами, серверами и пользователями</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer px-3 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="rounded" />
            Авто 30с
          </label>
          <button onClick={() => { fetchServers(); fetchSystemStats() }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-lg text-sm text-slate-300 transition-all">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Telemetry */}
      {systemStats && (
        <div className="relative overflow-hidden rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4">
          <div className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-violet-500/10 blur-3xl" />

          <div className="relative flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h4 className="text-sm sm:text-base font-bold text-slate-100">Системная телеметрия панели</h4>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>

          <div className="relative grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricTile icon={Cpu}        accent="cyan"    label="CPU ядер"      value={systemStats.cpu?.cores || '—'} />
            <MetricTile icon={MemoryStick} accent="blue"    label="RAM занято"
              value={`${formatBytes(systemStats.memory?.used || 0)} / ${formatBytes(systemStats.memory?.total || 0)}`} />
            <MetricTile icon={HardDrive}  accent="emerald" label="RAM свободно"  value={formatBytes(systemStats.memory?.available || 0)} />
            <MetricTile icon={Clock}      accent="slate"   label="Uptime панели" value={formatPanelUptime(systemStats.uptime)} />
            <MetricTile icon={UsersIcon}  accent="violet"  label="Всего юзеров"  value={systemStats.users?.totalUsers || 0} />
            <MetricTile icon={UserCheck}  accent="emerald" label="Онлайн сейчас" value={systemStats.onlineStats?.onlineNow || 0} />
          </div>

          {systemStats.users?.statusCounts && (
            <div className="relative mt-3 grid grid-cols-3 gap-2 xl:grid-cols-6">
              <SummaryCard icon={CheckCircle} label="Active"    accent="emerald" value={systemStats.users.statusCounts.ACTIVE || 0} />
              <SummaryCard icon={XCircle}     label="Disabled"  accent="red"     value={systemStats.users.statusCounts.DISABLED || 0} />
              <SummaryCard icon={Pause}       label="Limited"   accent="amber"   value={systemStats.users.statusCounts.LIMITED || 0} />
              <SummaryCard icon={Clock}       label="Expired"   accent="slate"   value={systemStats.users.statusCounts.EXPIRED || 0} />
              <SummaryCard icon={Wifi}        label="За 24ч"    accent="blue"    value={systemStats.onlineStats?.lastDay ?? 0} />
              <SummaryCard icon={Wifi}        label="За неделю" accent="blue"    value={systemStats.onlineStats?.lastWeek ?? 0} />
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-900/50 border border-slate-800/60 rounded-xl w-full sm:w-fit">
        {[
          { id: 'nodes',  label: 'Ноды',          Icon: Server,    count: servers.length },
          { id: 'squads', label: 'Серверы',       Icon: Layers,    count: localSquads.length },
          { id: 'users',  label: 'Пользователи',  Icon: UsersIcon },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 sm:flex-none justify-center ${
              activeTab === t.id
                ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <t.Icon className="w-4 h-4" />
            <span>{t.label}</span>
            {t.count != null && (
              <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                activeTab === t.id ? 'bg-white/20' : 'bg-slate-800/80'
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* TAB: NODES ─────────────────────────────────────────────────────── */}
      {activeTab === 'nodes' && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard icon={Server}       accent="slate"   label="Всего"      value={servers.length} />
            <SummaryCard icon={CheckCircle}  accent="emerald" label="Онлайн"     value={connectedCount} />
            <SummaryCard icon={XCircle}      accent="red"     label="Оффлайн"    value={disconnectedCount} />
            <SummaryCard icon={PauseCircle}  accent="amber"   label="Отключены"  value={disabledCount} />
            <SummaryCard icon={UsersIcon}    accent="blue"    label="Юзеры"      value={totalOnline} />
          </div>

          {/* Total traffic + groups */}
          <div className="px-4 py-3 bg-slate-900/40 border border-slate-800/60 rounded-xl flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <ArrowDownUp className="w-4 h-4 text-cyan-400" />
              <span className="text-slate-400">Общий трафик:</span>
              <span className="font-mono font-bold text-cyan-300">{formatBytes(totalTrafficUsed)}</span>
            </div>
            {squads.length > 0 && (
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-violet-400" />
                <span className="text-slate-400">Серверных групп:</span>
                <span className="font-mono font-bold text-violet-300">{squads.length}</span>
              </div>
            )}
          </div>

          {/* Filter bar */}
          <div className="flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Поиск по имени, адресу, стране…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-9 py-2 bg-slate-900/60 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1 lg:mx-0 lg:px-0">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                    statusFilter === f.value
                      ? 'bg-violet-500/20 border-violet-500/50 text-violet-200'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
                  {f.label}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:border-violet-500/50"
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {(search || statusFilter !== 'all') && (
            <div className="text-xs text-slate-500">
              Найдено: <span className="font-mono font-semibold text-slate-300">{filteredServers.length}</span> из {servers.length}
            </div>
          )}

          {/* Loading / Empty / List */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-slate-600 border-t-violet-400 rounded-full animate-spin" />
            </div>
          ) : filteredServers.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              {search || statusFilter !== 'all' ? 'Нет нод по фильтрам' : 'Ноды не найдены'}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredServers.map(server => (
                <NodeCard
                  key={server.uuid}
                  server={server}
                  expanded={expandedServer === server.uuid}
                  onToggle={() => setExpandedServer(expandedServer === server.uuid ? null : server.uuid)}
                  editingName={editingName === server.uuid ? newName : null}
                  onStartEditName={() => { setEditingName(server.uuid); setNewName(server.name) }}
                  onChangeName={setNewName}
                  onCancelEditName={() => { setEditingName(null); setNewName('') }}
                  onSaveName={() => updateServerName(server.uuid)}
                  onToggleNode={() => toggleNode(server.uuid, server.isDisabled)}
                  onRestartNode={() => restartNode(server.uuid)}
                  onToggleHost={(hostUuid, disabled) => toggleHost(hostUuid, disabled)}
                  onToggleUsers={() => fetchServerUsers(server.uuid)}
                  users={serverUsers[server.uuid]}
                  isLoadingUsers={loadingUsers[server.uuid]}
                  actionLoading={actionLoading}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: SQUADS ─────────────────────────────────────────────────────── */}
      {activeTab === 'squads' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-400">
              Серверные группы (squads) синхронизируются из RemnaWave и привязываются к тарифам.
            </div>
            <button
              onClick={syncSquads}
              disabled={syncLoading}
              className="flex items-center gap-1.5 px-3 py-2 bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncLoading ? 'animate-spin' : ''}`} />
              {syncLoading ? 'Синхронизация…' : 'Синхронизировать'}
            </button>
          </div>

          {localSquadsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-slate-600 border-t-violet-400 rounded-full animate-spin" />
            </div>
          ) : localSquads.length === 0 ? (
            <div className="text-center py-12">
              <Layers className="w-12 h-12 mx-auto text-slate-600 mb-3" />
              <p className="text-slate-500 mb-4">Серверные группы не найдены в БД</p>
              <button onClick={syncSquads} disabled={syncLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-500/20 border border-violet-500/40 text-violet-200 hover:bg-violet-500/30 rounded-lg font-medium disabled:opacity-50">
                <RefreshCw className="w-4 h-4" />
                Загрузить из RemnaWave
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {localSquads.map(squad => (
                <SquadCard
                  key={squad.id}
                  squad={squad}
                  isEditing={editingSquadId === squad.id}
                  editValue={editSquadName}
                  onStartEdit={() => { setEditingSquadId(squad.id); setEditSquadName(squad.display_name) }}
                  onChangeEdit={setEditSquadName}
                  onCancelEdit={() => { setEditingSquadId(null); setEditSquadName('') }}
                  onSave={() => updateSquadName(squad.id)}
                  saving={!!actionLoading['squad_' + squad.id]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: USERS ─────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/30 p-4">
          <RwUsersPanel />
        </div>
      )}
    </div>
  )
}

// ─── NodeCard ────────────────────────────────────────────────────────────────
function NodeCard({
  server, expanded, onToggle,
  editingName, onStartEditName, onChangeName, onCancelEditName, onSaveName,
  onToggleNode, onRestartNode, onToggleHost,
  onToggleUsers, users, isLoadingUsers,
  actionLoading,
}) {
  const status = server.isDisabled ? 'disabled' : server.isConnected ? 'online' : 'offline'
  const flag = COUNTRY_FLAGS[server.countryCode?.toUpperCase()] || '🌍'
  const accentBorder = status === 'online' ? 'border-emerald-500/30'
    : status === 'disabled' ? 'border-amber-500/30' : 'border-red-500/30'

  return (
    <div className={`bg-slate-900/40 border ${accentBorder} rounded-2xl overflow-hidden transition-all hover:border-slate-600/60`}>
      {/* Collapsed row */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-slate-800/20 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-2xl shrink-0">{flag}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-base font-bold text-white truncate">{server.name}</h4>
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
              <MapPin className="w-3 h-3" />
              <span className="font-mono truncate">{server.address || '—'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-5 text-xs sm:text-sm shrink-0">
          <div className="text-center">
            <div className="text-[10px] text-slate-500 uppercase">Юзеры</div>
            <div className="font-mono font-bold text-blue-300">{server.usersOnline ?? 0}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-slate-500 uppercase">Трафик</div>
            <div className="font-mono font-bold text-cyan-300">{formatBytes(server.trafficUsedBytes)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-slate-500 uppercase">Uptime</div>
            <div className="font-mono font-bold text-slate-300">{formatUptime(server.xrayUptime)}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-slate-800/60 p-4 bg-slate-950/30 space-y-4">
          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2">
            {editingName !== null ? (
              <>
                <input
                  value={editingName}
                  onChange={e => onChangeName(e.target.value)}
                  className="flex-1 min-w-[200px] px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500"
                  placeholder="Новое имя ноды"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && onSaveName()}
                />
                <button onClick={onSaveName} disabled={actionLoading['name_' + server.uuid]}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-bold text-white inline-flex items-center gap-1 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> Сохранить
                </button>
                <button onClick={onCancelEditName}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold text-slate-300 inline-flex items-center gap-1">
                  <X className="w-3.5 h-3.5" /> Отмена
                </button>
              </>
            ) : (
              <>
                <button onClick={onStartEditName}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 hover:border-slate-600 rounded-lg text-xs text-slate-300 hover:text-white transition-all">
                  <Pencil className="w-3.5 h-3.5" /> Переименовать
                </button>
                <button
                  onClick={onToggleNode}
                  disabled={actionLoading['node_' + server.uuid]}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                    server.isDisabled
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                      : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                  }`}
                >
                  {server.isDisabled ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                  {server.isDisabled ? 'Включить ноду' : 'Отключить ноду'}
                </button>
                {server.isConnected && !server.isDisabled && (
                  <button onClick={onRestartNode} disabled={actionLoading['restart_' + server.uuid]}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/15 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/25 rounded-lg text-xs font-medium transition-all disabled:opacity-50">
                    <RotateCcw className="w-3.5 h-3.5" /> Рестарт Xray
                  </button>
                )}
              </>
            )}
          </div>

          {/* Hardware */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-300">Оборудование</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <InfoCard label="CPU"       value={server.cpuModel || '—'} />
              <InfoCard label="CPU ядер"  value={server.cpuCount || '—'} />
              <InfoCard label="RAM"       value={server.totalRam || '—'} />
              <InfoCard label="Xray"      value={server.xrayVersion || '—'} />
            </div>
          </div>

          {/* Traffic */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-300">Трафик</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <InfoCard label="Использовано" value={formatBytes(server.trafficUsedBytes)} />
              <InfoCard label="Лимит"        value={server.trafficLimitBytes ? formatBytes(server.trafficLimitBytes) : '∞'} />
              <InfoCard label="Множитель"    value={`×${server.consumptionMultiplier ?? 1}`} />
              <InfoCard label="Сброс"        value={server.trafficResetDay || '—'} />
            </div>
            {server.trafficLimitBytes > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] text-slate-500 mb-1 font-mono">
                  <span>{formatBytes(server.trafficUsedBytes)}</span>
                  <span>{formatBytes(server.trafficLimitBytes)}</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${
                    server.trafficUsedBytes / server.trafficLimitBytes > 0.9 ? 'bg-red-500'
                      : server.trafficUsedBytes / server.trafficLimitBytes > 0.7 ? 'bg-amber-500' : 'bg-cyan-500'
                  }`} style={{ width: `${Math.min(100, (server.trafficUsedBytes / server.trafficLimitBytes) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Hosts */}
          {server.hosts?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Plug className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-300">Хосты ({server.hosts.length})</span>
              </div>
              <div className="space-y-1.5">
                {server.hosts.map(host => (
                  <div key={host.uuid} className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border text-sm ${
                    host.isDisabled ? 'bg-slate-900/40 border-slate-800 opacity-60' : 'bg-slate-800/30 border-slate-700/50'
                  }`}>
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-mono text-slate-200 truncate">{host.remark || host.address || 'N/A'}</span>
                      {host.protocol && (
                        <span className="px-2 py-0.5 bg-blue-500/15 border border-blue-500/40 rounded text-[11px] text-blue-300 font-bold">
                          {host.protocol}
                        </span>
                      )}
                      <span className="text-slate-500 font-mono text-xs">:{host.port}</span>
                      {host.isDisabled && (
                        <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-300 rounded text-[10px] font-medium">выкл</span>
                      )}
                    </div>
                    <button
                      onClick={() => onToggleHost(host.uuid, host.isDisabled)}
                      disabled={actionLoading['host_' + host.uuid]}
                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-all disabled:opacity-50 ${
                        host.isDisabled
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                          : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                      }`}
                    >
                      {host.isDisabled ? <><PlayCircle className="w-3 h-3" /> Включить</> : <><PauseCircle className="w-3 h-3" /> Выключить</>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Users */}
          <div>
            <button onClick={onToggleUsers} disabled={isLoadingUsers}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 hover:border-slate-600 rounded-lg text-xs text-slate-300 hover:text-white transition-all disabled:opacity-50">
              {isLoadingUsers ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Загрузка…</>
              ) : (
                <><UsersIcon className="w-3.5 h-3.5" /> {users ? 'Скрыть пользователей' : 'Показать пользователей'}</>
              )}
            </button>
            {users && (
              <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-800/60">
                {users.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500">Нет подключённых пользователей</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-slate-900/60 sticky top-0">
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="text-left py-1.5 px-3 font-medium">Имя</th>
                        <th className="text-left py-1.5 px-3 font-medium">Статус</th>
                        <th className="text-right py-1.5 px-3 font-medium">Трафик</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.slice(0, 50).map((u, i) => (
                        <tr key={u.uuid || i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-1.5 px-3 text-slate-200 font-mono truncate max-w-[200px]">{u.username || u.shortUuid || '—'}</td>
                          <td className="py-1.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              u.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-300'
                                : u.status === 'DISABLED' ? 'bg-red-500/15 text-red-300'
                                : 'bg-slate-700 text-slate-400'
                            }`}>{u.status || '—'}</span>
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono text-slate-400">
                            {formatBytes(u.usedTrafficBytes || u.trafficUsedBytes || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {users.length > 50 && (
                  <div className="text-xs text-slate-500 p-2 text-center bg-slate-900/40">… и ещё {users.length - 50}</div>
                )}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-slate-800/60">
            {server.lastStatusMessage && <span>{server.lastStatusMessage}</span>}
            {server.updatedAt && <span>Обновлено: {new Date(server.updatedAt).toLocaleString('ru-RU')}</span>}
            <span className="font-mono text-slate-700 truncate">{server.uuid}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SquadCard ───────────────────────────────────────────────────────────────
function SquadCard({ squad, isEditing, editValue, onStartEdit, onChangeEdit, onCancelEdit, onSave, saving }) {
  return (
    <div className="p-4 bg-slate-900/40 border border-slate-800/60 rounded-2xl hover:border-slate-600/60 transition-all">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              value={editValue}
              onChange={e => onChangeEdit(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500"
              placeholder="Название группы"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && onSave()}
            />
            <button onClick={onSave} disabled={saving}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-bold text-white disabled:opacity-50">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={onCancelEdit}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-violet-400 shrink-0" />
                <h4 className="font-bold text-white truncate">{squad.display_name}</h4>
              </div>
              {squad.display_name !== squad.tag && (
                <div className="text-[11px] text-slate-500 mt-0.5 ml-6 font-mono truncate">RW: {squad.tag}</div>
              )}
            </div>
            <button onClick={onStartEdit}
              className="shrink-0 p-1.5 bg-slate-800/50 border border-slate-700/50 hover:border-slate-600 rounded-lg text-slate-400 hover:text-white transition-all">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-400 mb-3">
        <span className="inline-flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5" /> {squad.inbounds_count} inbounds
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5" /> {squad.nodes_count} нод
        </span>
      </div>

      {/* Linked plans */}
      {squad.linked_plans && squad.linked_plans.length > 0 ? (
        <div className="pt-3 border-t border-slate-800/60">
          <div className="text-[11px] text-slate-500 font-medium uppercase mb-2">Тарифы</div>
          <div className="flex flex-wrap gap-1.5">
            {squad.linked_plans.map(plan => (
              <span key={plan.id} className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                plan.is_active
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800/50 border-slate-700 text-slate-500'
              }`}>
                {plan.name}{!plan.is_active && ' (неактивен)'}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="pt-3 border-t border-slate-800/60">
          <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" /> Не привязан ни к одному тарифу
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="mt-3 text-[10px] text-slate-600 font-mono truncate">{squad.uuid}</div>
      {squad.synced_at && (
        <div className="text-[10px] text-slate-600 mt-0.5">
          Синхр: {new Date(squad.synced_at).toLocaleString('ru-RU')}
        </div>
      )}
    </div>
  )
}
