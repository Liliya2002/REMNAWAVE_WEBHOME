import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  // top stats
  Clock, Cpu, Users as UsersIcon, Layers, MailWarning,
  // ui
  Search,
} from 'lucide-react'
import { authFetch } from '../services/api'
import { GROUPS } from '../config/adminNav'
import { useAdminUi } from '../contexts/AdminUiContext'
import AdminDashboard from '../components/admin/AdminDashboard'

// ─── Утилиты ─────────────────────────────────────────────────────────────────
function fmtUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d}д`)
  if (h) parts.push(`${h}ч`)
  parts.push(`${m}м`)
  return parts.join(' ')
}

// ─── Компоненты ──────────────────────────────────────────────────────────────
function StatPill({ icon: Icon, label, value, sub, accent }) {
  const colors = {
    blue:    'from-blue-500/15  to-cyan-500/10   border-blue-500/25  text-blue-300',
    emerald: 'from-emerald-500/15 to-green-500/10 border-emerald-500/25 text-emerald-300',
    violet:  'from-violet-500/15 to-fuchsia-500/10 border-violet-500/25 text-violet-300',
    amber:   'from-amber-500/15 to-orange-500/10 border-amber-500/25 text-amber-300',
  }
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-gradient-to-br ${colors[accent] || colors.blue}`}>
      <div className="w-9 h-9 rounded-lg bg-slate-900/60 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-base sm:text-lg font-bold text-white leading-tight font-mono truncate">{value}</div>
        <div className="text-[11px] text-slate-400 truncate">{label}{sub ? <span className="text-slate-500"> · {sub}</span> : null}</div>
      </div>
    </div>
  )
}

function GroupCard({ group, query }) {
  const items = query
    ? group.items.filter(i => i.label.toLowerCase().includes(query.toLowerCase()))
    : group.items

  // Если фильтр и в этой группе ничего не подошло — скрываем целую карточку
  if (query && items.length === 0) return null

  return (
    <div className="bg-gradient-to-br from-slate-900/60 to-slate-950/60 border border-slate-800/70 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/60 bg-slate-900/40">
        <span className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${group.color} shrink-0`} />
        <h3 className="text-base font-semibold text-slate-100">{group.title}</h3>
      </div>

      {/* Items */}
      <div className="py-2">
        {items.map(({ to, Icon, label }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/40 transition-colors group"
          >
            <Icon className="w-4 h-4 text-slate-500 group-hover:text-slate-200 transition-colors shrink-0" />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
// В новом виде (v2) главный экран — дашборд с виджетами (навигация уже в сайдбаре).
// В классическом виде — сетка разделов, которая и служит навигацией.
export default function AdminOverview() {
  const { version } = useAdminUi()
  return version === 'v2' ? <AdminDashboard /> : <ClassicOverview />
}

function ClassicOverview() {
  const [stats, setStats] = useState(null)
  const [systemInfo, setSystemInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [s, i] = await Promise.all([
          authFetch('/api/admin/stats').then(r => r.ok ? r.json() : null).catch(() => null),
          authFetch('/api/admin/system/info').then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        if (!cancelled) { setStats(s); setSystemInfo(i) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Ctrl+K / Cmd+K — фокус на поиск
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const totalShownItems = useMemo(() => {
    if (!query) return GROUPS.reduce((s, g) => s + g.items.length, 0)
    const q = query.toLowerCase()
    return GROUPS.reduce((s, g) =>
      s + g.items.filter(i => i.label.toLowerCase().includes(q)).length, 0)
  }, [query])

  return (
    <div className="space-y-6">
      {/* ─── Top stats row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatPill
          icon={Clock}
          accent="blue"
          label="Аптайм backend"
          value={loading ? '…' : fmtUptime(systemInfo?.uptimeSeconds)}
        />
        <StatPill
          icon={Cpu}
          accent="violet"
          label="Версия"
          sub={systemInfo?.shaShort || ''}
          value={loading ? '…' : (systemInfo?.version ? `v${systemInfo.version}` : '—')}
        />
        <StatPill
          icon={UsersIcon}
          accent="emerald"
          label="Пользователей"
          value={loading ? '…' : (stats?.totalUsers ?? '—')}
        />
        <StatPill
          icon={Layers}
          accent="amber"
          label="Активные подписки"
          value={loading ? '…' : (stats?.activeSubscriptions ?? '—')}
        />
        <StatPill
          icon={MailWarning}
          accent={stats?.unconfirmedEmails > 0 ? 'amber' : 'emerald'}
          label="Без подтверждения email"
          value={loading ? '…' : (stats?.unconfirmedEmails ?? 0)}
        />
      </div>

      {/* ─── Header + search ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Панель администратора</h1>
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Онлайн
          </span>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input autoComplete="off"
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по разделам…"
            className="w-full pl-9 pr-16 py-2 bg-slate-900/60 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-slate-900/80 transition-all"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700 rounded">
            Ctrl K
          </kbd>
        </div>
      </div>

      {/* ─── Groups grid ────────────────────────────────────────────────── */}
      {totalShownItems === 0 ? (
        <div className="text-center py-12 text-slate-500">
          Ничего не найдено по запросу «{query}»
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {GROUPS.map(g => (
            <GroupCard key={g.id} group={g} query={query} />
          ))}
        </div>
      )}
    </div>
  )
}
