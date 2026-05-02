import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Check, Edit3, Filter, Layers, LayoutGrid, Pause, Play, Plus,
  Search, Server, Sparkles, Ticket, Trash2, ArrowUpDown, GripVertical,
  TrendingUp, Database, DollarSign, RefreshCw,
} from 'lucide-react'
import PlanForm from '../components/PlanForm'

const TIER_PRESETS = {
  0: { label: 'Trial',     color: '#94a3b8' },
  1: { label: 'Basic',     color: '#06b6d4' },
  2: { label: 'Pro',       color: '#3b82f6' },
  3: { label: 'Premium',   color: '#8b5cf6' },
  4: { label: 'Ultimate',  color: '#f59e0b' },
}

function tierMeta(plan) {
  const preset = TIER_PRESETS[plan.tier] || { label: `Tier ${plan.tier}`, color: '#64748b' }
  return {
    label: plan.tier_label || preset.label,
    color: plan.color || preset.color,
  }
}

function fmtPrice(v) {
  if (v == null || v === '') return '—'
  return `${Number(v).toFixed(0)} ₽`
}

export default function AdminPlans() {
  const [plans, setPlans] = useState([])
  const [squads, setSquads] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingPlan, setEditingPlan] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [draggedId, setDraggedId] = useState(null)

  useEffect(() => {
    fetchPlans()
    fetchSquads()
  }, [])

  async function fetchPlans() {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) setPlans(data.plans || [])
    } finally { setLoading(false) }
  }

  async function fetchSquads() {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/subscriptions/squads`)
      if (res.ok) {
        const data = await res.json()
        setSquads(data.squads || [])
      }
    } catch {}
  }

  async function togglePlanActive(plan) {
    const token = localStorage.getItem('token')
    await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans/${plan.id}/toggle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    fetchPlans()
  }

  async function deletePlan(plan) {
    if (!confirm(`Удалить тариф «${plan.name}»?`)) return
    const token = localStorage.getItem('token')
    await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans/${plan.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    fetchPlans()
  }

  // Drag-and-drop reorder
  function handleDragStart(id) { setDraggedId(id) }
  async function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return }
    const draggedPlan = plans.find(p => p.id === draggedId)
    const targetPlan  = plans.find(p => p.id === targetId)
    if (!draggedPlan || !targetPlan) return

    // Перемещаем dragged в группу target.tier и присваиваем sort_order между соседями
    const targetTier = targetPlan.tier
    const sameTier = plans
      .filter(p => p.tier === targetTier && p.id !== draggedId)
      .sort((a, b) => a.sort_order - b.sort_order)
    const targetIdx = sameTier.findIndex(p => p.id === targetId)
    const newSortOrder = targetIdx >= 0 ? targetPlan.sort_order : (sameTier.length * 10)

    const items = [
      { id: draggedId, tier: targetTier, sort_order: newSortOrder },
      ...sameTier.slice(targetIdx).map((p, i) => ({ id: p.id, sort_order: newSortOrder + (i + 1) * 10 })),
    ]
    const token = localStorage.getItem('token')
    await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items }),
    })
    setDraggedId(null)
    fetchPlans()
  }

  const stats = useMemo(() => {
    const active = plans.filter(p => p.is_active).length
    const trial  = plans.filter(p => p.is_trial).length
    const tiersUsed = new Set(plans.map(p => p.tier)).size
    const avgMonthly = (() => {
      const values = plans.map(p => Number(p.price_monthly)).filter(v => Number.isFinite(v) && v > 0)
      if (!values.length) return 0
      return values.reduce((a, b) => a + b, 0) / values.length
    })()
    const maxTraffic = Math.max(...plans.map(p => Number(p.traffic_gb) || 0), 0)
    return { total: plans.length, active, trial, tiersUsed, avgMonthly, maxTraffic, paused: plans.length - active }
  }, [plans])

  const filteredPlans = useMemo(() => {
    let next = [...plans]
    const q = searchTerm.trim().toLowerCase()
    if (q) {
      next = next.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.tier_label || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter === 'active')  next = next.filter(p => p.is_active && !p.is_trial)
    if (statusFilter === 'paused')  next = next.filter(p => !p.is_active)
    if (statusFilter === 'trial')   next = next.filter(p => p.is_trial)
    return next
  }, [plans, searchTerm, statusFilter])

  // Группировка по tier
  const grouped = useMemo(() => {
    const map = new Map()
    for (const p of filteredPlans) {
      const t = p.tier ?? 0
      if (!map.has(t)) map.set(t, [])
      map.get(t).push(p)
    }
    // Сортируем внутри группы
    for (const [t, arr] of map) {
      arr.sort((a, b) => (a.sort_order - b.sort_order) || ((a.price_monthly || 0) - (b.price_monthly || 0)))
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [filteredPlans])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/25">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Тарифы</h1>
            <p className="text-xs text-slate-400">Управление планами подписки и уровнями</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchPlans} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
          <button onClick={() => setShowAddForm(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-lg hover:shadow-cyan-500/30">
            <Plus className="w-4 h-4" />
            Новый тариф
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Layers}      label="Всего тарифов" value={stats.total}    accent="cyan" />
        <StatCard icon={Play}        label="Активных"      value={stats.active}   accent="emerald" />
        <StatCard icon={Ticket}      label="Trial"         value={stats.trial}    accent="amber" />
        <StatCard icon={TrendingUp}  label="Уровней"       value={stats.tiersUsed} accent="violet" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Поиск по названию, описанию, tier-label…"
            className="w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <div className="flex gap-1 p-1 bg-slate-900/50 border border-slate-800/60 rounded-lg">
          {[
            { id: 'all',    label: 'Все' },
            { id: 'active', label: 'Активные' },
            { id: 'paused', label: 'Приостановленные' },
            { id: 'trial',  label: 'Trial' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                statusFilter === f.id
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Plans grouped by tier */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" />
          Загружаю тарифы…
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Layers className="w-16 h-16 mx-auto mb-3 text-slate-700" />
          <div className="font-medium">Тарифы не найдены</div>
          <div className="text-xs mt-1">Создайте первый тариф или измените фильтры</div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([tier, planList]) => {
            const preset = TIER_PRESETS[tier] || { label: `Tier ${tier}`, color: '#64748b' }
            return (
              <div key={tier}>
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs"
                    style={{ background: `linear-gradient(135deg, ${preset.color}, ${preset.color}aa)` }}
                  >
                    {tier}
                  </div>
                  <h3 className="text-base font-semibold text-slate-200">{preset.label}</h3>
                  <span className="text-xs text-slate-500">{planList.length} тариф{planList.length === 1 ? '' : (planList.length < 5 ? 'а' : 'ов')}</span>
                  <div className="flex-1 h-px bg-slate-800/60" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {planList.map(p => (
                    <PlanCard
                      key={p.id}
                      plan={p}
                      onEdit={() => setEditingPlan(p)}
                      onToggle={() => togglePlanActive(p)}
                      onDelete={() => deletePlan(p)}
                      onDragStart={() => handleDragStart(p.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(p.id)}
                      isDragging={draggedId === p.id}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {(showAddForm || editingPlan) && (
        <PlanForm
          plan={editingPlan}
          squads={squads}
          onClose={() => { setShowAddForm(false); setEditingPlan(null) }}
          onSave={() => { setShowAddForm(false); setEditingPlan(null); fetchPlans() }}
        />
      )}
    </div>
  )
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, accent = 'cyan' }) {
  const map = {
    cyan:    'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    amber:   'border-amber-500/30 bg-amber-500/10 text-amber-300',
    violet:  'border-violet-500/30 bg-violet-500/10 text-violet-300',
  }
  return (
    <div className={`p-4 rounded-xl border ${map[accent]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 opacity-80" />
        <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
      </div>
      <div className="text-2xl font-bold font-mono">{value}</div>
    </div>
  )
}

function PlanCard({ plan, onEdit, onToggle, onDelete, onDragStart, onDragOver, onDrop, isDragging }) {
  const meta = tierMeta(plan)
  const squadCount = Array.isArray(plan.squad_uuids) ? plan.squad_uuids.length : 0
  const inactive = !plan.is_active

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative rounded-2xl border-2 overflow-hidden transition-all cursor-move ${
        inactive ? 'opacity-60 grayscale-[40%]' : ''
      } ${isDragging ? 'opacity-30 scale-95' : ''}`}
      style={{
        borderColor: inactive ? 'rgb(51 65 85 / 0.5)' : `${meta.color}55`,
        background: inactive
          ? 'linear-gradient(135deg, rgba(15,23,42,0.7), rgba(2,6,23,0.85))'
          : `linear-gradient(135deg, ${meta.color}0a, rgba(2,6,23,0.85))`,
      }}
    >
      {/* Top accent strip */}
      <div className="h-1" style={{ background: meta.color }} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <GripVertical className="w-3 h-3 text-slate-600 shrink-0" />
              <span
                className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-white"
                style={{ background: meta.color }}
              >
                {meta.label}
              </span>
              {plan.is_trial && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/30 text-amber-200">trial</span>
              )}
              {!plan.is_active && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-700/50 text-slate-400">paused</span>
              )}
            </div>
            <div className="font-bold text-white truncate">{plan.name}</div>
            {plan.description && (
              <div className="text-xs text-slate-400 line-clamp-2 mt-0.5">{plan.description}</div>
            )}
          </div>
        </div>

        {/* Price */}
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-2xl font-bold" style={{ color: meta.color }}>
            {plan.is_trial && !plan.price_monthly ? 'Free' : fmtPrice(plan.price_monthly)}
          </span>
          {plan.price_monthly && <span className="text-[11px] text-slate-500">/ мес</span>}
        </div>
        {(plan.price_quarterly || plan.price_yearly) && (
          <div className="flex gap-3 text-[11px] text-slate-500 mb-3">
            {plan.price_quarterly && <span>{fmtPrice(plan.price_quarterly)} / 3 мес</span>}
            {plan.price_yearly &&    <span>{fmtPrice(plan.price_yearly)} / год</span>}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-3 text-xs text-slate-300 mb-3 pt-3 border-t border-slate-800/60">
          <div className="flex items-center gap-1">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span><b>{plan.traffic_gb || 0}</b> ГБ</span>
          </div>
          <div className="flex items-center gap-1">
            <Server className="w-3.5 h-3.5 text-violet-400" />
            <span><b>{squadCount}</b> сервер{squadCount === 1 ? '' : 'ов'}</span>
          </div>
          {Array.isArray(plan.features) && plan.features.length > 0 && (
            <div className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span><b>{plan.features.length}</b></span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 pt-2 border-t border-slate-800/60">
          <button
            onClick={onEdit}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-cyan-500/20 hover:text-cyan-200 border border-slate-700/60 hover:border-cyan-500/40 text-slate-200 transition"
          >
            <Edit3 className="w-3 h-3" />
            Изменить
          </button>
          <button
            onClick={onToggle}
            title={plan.is_active ? 'Приостановить' : 'Активировать'}
            className={`px-2 py-1.5 rounded-lg border transition ${
              plan.is_active
                ? 'bg-slate-800/60 hover:bg-amber-500/20 border-slate-700/60 hover:border-amber-500/40 text-slate-300 hover:text-amber-200'
                : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-200'
            }`}
          >
            {plan.is_active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
          <button
            onClick={onDelete}
            title="Удалить"
            className="px-2 py-1.5 rounded-lg bg-slate-800/60 hover:bg-red-500/20 hover:text-red-300 border border-slate-700/60 hover:border-red-500/40 text-slate-400 transition"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
