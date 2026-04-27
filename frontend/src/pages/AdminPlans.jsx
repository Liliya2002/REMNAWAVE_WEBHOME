import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarDays, Check, Edit3, Filter, LayoutGrid, Package, Pause, Play, Plus, Search, Server, Sparkles, Ticket, Trash2 } from 'lucide-react'
import PlanForm from '../components/PlanForm'

const FUSION_THEME = {
  page: 'space-y-6',
  title: 'text-slate-100 tracking-tight',
  panel: 'bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.08),transparent_38%),radial-gradient(circle_at_85%_90%,rgba(148,163,184,0.08),transparent_38%),rgba(2,6,23,0.75)] border border-cyan-500/20 rounded-2xl p-4 sm:p-5',
  actionBtn: 'bg-gradient-to-r from-cyan-400 to-slate-200 text-slate-900 hover:shadow-lg hover:shadow-cyan-500/30',
  card: 'from-slate-900/70 via-slate-900/60 to-cyan-950/20 border-slate-700/60 hover:border-cyan-400/45',
  cardMuted: 'from-slate-900/40 to-slate-950/70 border-slate-800/60 opacity-70',
  stat: 'bg-slate-950/55 border border-slate-700/50',
  tag: 'bg-cyan-500/10 border-cyan-400/35 text-cyan-200',
  font: 'font-sans',
}

function money(value) {
  if (value === null || value === undefined || value === '') return '—'
  return `$${value}`
}

export default function AdminPlans() {
  const [plans, setPlans] = useState([])
  const [squads, setSquads] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingPlan, setEditingPlan] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    fetchPlans()
    fetchSquads()
  }, [])

  const activeTheme = FUSION_THEME

  const stats = useMemo(() => {
    const active = plans.filter(p => p.is_active).length
    const trial = plans.filter(p => p.is_trial).length
    const avgMonthly = (() => {
      const values = plans.map(p => Number(p.price_monthly)).filter(v => Number.isFinite(v) && v > 0)
      if (!values.length) return 0
      return values.reduce((a, b) => a + b, 0) / values.length
    })()
    const maxTraffic = Math.max(...plans.map(p => Number(p.traffic_gb) || 0), 0)
    return {
      total: plans.length,
      active,
      trial,
      paused: Math.max(plans.length - active, 0),
      avgMonthly,
      maxTraffic,
    }
  }, [plans])

  const filteredPlans = useMemo(() => {
    let next = [...plans]
    const q = searchTerm.trim().toLowerCase()
    if (q) {
      next = next.filter(p => {
        const haystack = [
          p.name,
          p.description,
          String(p.traffic_gb || ''),
          String(p.price_monthly || ''),
          String(p.price_quarterly || ''),
          String(p.price_yearly || ''),
        ].join(' ').toLowerCase()
        return haystack.includes(q)
      })
    }

    if (statusFilter === 'active') next = next.filter(p => !!p.is_active)
    if (statusFilter === 'paused') next = next.filter(p => !p.is_active)
    if (statusFilter === 'trial') next = next.filter(p => !!p.is_trial)

    return next
  }, [plans, searchTerm, statusFilter])

  async function fetchPlans() {
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setPlans(data.plans || [])
      }
    } catch (err) {
      console.error('Error fetching plans:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchSquads() {
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/squads`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSquads((data.squads || []).map(s => ({ uuid: s.uuid, name: s.display_name || s.tag || 'Без имени' })))
      }
    } catch (err) {
      console.error('Error fetching squads:', err)
    }
  }

  async function handleToggle(planId) {
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans/${planId}/toggle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        fetchPlans()
      }
    } catch (err) {
      console.error('Error toggling plan:', err)
    }
  }

  async function handleDelete(planId) {
    if (!confirm('Вы уверены что хотите удалить этот тариф?')) return
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans/${planId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        fetchPlans()
      }
    } catch (err) {
      console.error('Error deleting plan:', err)
    }
  }

  return (
    <div className={`${activeTheme.page} ${activeTheme.font}`}>
      <div className={activeTheme.panel}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className={`text-xl sm:text-2xl font-bold ${activeTheme.title} flex items-center gap-2`}>
              <Sparkles className="w-5 h-5 text-cyan-300" />
              <span>Управление тарифами</span>
            </h3>
            <p className="text-sm text-slate-400 mt-1">Управляйте тарифами, ценами, группами серверов и возможностями в одном интерфейсе</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm(true)}
              className={`px-5 py-2.5 rounded-xl font-bold transition-all ${activeTheme.actionBtn}`}
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <span>Новый тариф</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className={`${activeTheme.stat} rounded-xl p-3`}><div className="text-xs text-slate-500 flex items-center gap-1"><LayoutGrid className="w-3.5 h-3.5" />Всего тарифов</div><div className="text-xl font-bold text-white">{stats.total}</div></div>
        <div className={`${activeTheme.stat} rounded-xl p-3`}><div className="text-xs text-slate-500 flex items-center gap-1"><Check className="w-3.5 h-3.5" />Активные</div><div className="text-xl font-bold text-emerald-300">{stats.active}</div></div>
        <div className={`${activeTheme.stat} rounded-xl p-3`}><div className="text-xs text-slate-500 flex items-center gap-1"><Pause className="w-3.5 h-3.5" />На паузе</div><div className="text-xl font-bold text-orange-300">{stats.paused}</div></div>
        <div className={`${activeTheme.stat} rounded-xl p-3`}><div className="text-xs text-slate-500 flex items-center gap-1"><Ticket className="w-3.5 h-3.5" />Пробные</div><div className="text-xl font-bold text-cyan-300">{stats.trial}</div></div>
        <div className={`${activeTheme.stat} rounded-xl p-3`}><div className="text-xs text-slate-500 flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" />Средняя цена</div><div className="text-xl font-bold text-violet-300">{money(stats.avgMonthly.toFixed(2))}</div></div>
        <div className={`${activeTheme.stat} rounded-xl p-3`}><div className="text-xs text-slate-500 flex items-center gap-1"><Package className="w-3.5 h-3.5" />Макс. трафик</div><div className="text-xl font-bold text-blue-300">{stats.maxTraffic} GB</div></div>
      </div>

      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-3 sm:p-4">
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск по названию, описанию, цене, трафику"
              className="w-full h-10 pl-10 pr-3 rounded-xl border border-slate-700/70 bg-slate-950/70 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-cyan-400/50"
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="inline-flex items-center gap-1 text-xs text-slate-400 mr-1"><Filter className="w-3.5 h-3.5" />Фильтр</span>
            {[
              { key: 'all', label: 'Все' },
              { key: 'active', label: 'Активные' },
              { key: 'paused', label: 'На паузе' },
              { key: 'trial', label: 'Пробные' },
            ].map(item => (
              <button
                key={item.key}
                onClick={() => setStatusFilter(item.key)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${statusFilter === item.key ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <h4 className={`text-lg sm:text-xl font-bold ${activeTheme.title}`}>Тарифная матрица</h4>
      </div>

      {showAddForm && (
        <PlanForm 
          squads={squads} 
          onClose={() => setShowAddForm(false)} 
          onSave={() => { setShowAddForm(false); fetchPlans(); }}
        />
      )}

      {editingPlan && (
        <PlanForm 
          plan={editingPlan}
          squads={squads}
          onClose={() => setEditingPlan(null)}
          onSave={() => { setEditingPlan(null); fetchPlans(); }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Загрузка тарифов...
        </div>
      ) : (
          <div className="grid gap-4 grid-cols-1">
            {filteredPlans.map((plan, index) => (
              <div
                key={plan.id}
                className={`p-4 sm:p-5 bg-gradient-to-br border rounded-2xl transition-all duration-300 ${plan.is_active ? activeTheme.card : activeTheme.cardMuted}`}
                style={{ animationDelay: `${Math.min(index * 45, 300)}ms` }}
              >
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="text-base sm:text-xl font-bold text-white">{plan.name}</h4>
                      {plan.is_trial && (
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border inline-flex items-center gap-1 ${activeTheme.tag}`}>
                          <Ticket className="w-3 h-3" />
                          <span>Пробный</span>
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border inline-flex items-center gap-1 ${plan.is_active ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300' : 'bg-slate-700/40 border-slate-600 text-slate-400'}`}>
                        {plan.is_active ? <Check className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                        <span>{plan.is_active ? 'Активен' : 'Остановлен'}</span>
                      </span>
                    </div>
                    <p className="text-slate-400 text-xs sm:text-sm mb-3">{plan.description || 'Без описания'}</p>

                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2.5">
                      <div className={`p-2.5 rounded-lg ${activeTheme.stat}`}>
                        <div className="text-[11px] text-slate-500 font-semibold mb-1 inline-flex items-center gap-1"><Package className="w-3 h-3" />Трафик</div>
                        <div className="font-mono font-bold text-cyan-300 text-base">{plan.traffic_gb} GB</div>
                      </div>
                      <div className={`p-2.5 rounded-lg ${activeTheme.stat}`}>
                        <div className="text-[11px] text-slate-500 font-semibold mb-1 inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />1 мес</div>
                        <div className="font-mono font-bold text-blue-300 text-base">{money(plan.price_monthly)}</div>
                      </div>
                      <div className={`p-2.5 rounded-lg ${activeTheme.stat}`}>
                        <div className="text-[11px] text-slate-500 font-semibold mb-1 inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />3 мес</div>
                        <div className="font-mono font-bold text-blue-300 text-base">{money(plan.price_quarterly)}</div>
                      </div>
                      <div className={`p-2.5 rounded-lg ${activeTheme.stat}`}>
                        <div className="text-[11px] text-slate-500 font-semibold mb-1 inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />12 мес</div>
                        <div className="font-mono font-bold text-blue-300 text-base">{money(plan.price_yearly)}</div>
                      </div>
                    </div>

                    {plan.squad_uuids?.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[11px] text-slate-600 font-semibold mb-1.5 inline-flex items-center gap-1"><Server className="w-3 h-3" />Серверные группы:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {plan.squad_uuids.map(uuid => {
                            const squad = squads.find(s => s.uuid === uuid)
                            return (
                              <span key={uuid} className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${activeTheme.tag}`}>
                                {squad?.name || uuid.substring(0, 8)}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => setEditingPlan(plan)}
                      className="px-2.5 py-1.5 sm:px-3 bg-slate-800/50 border border-slate-700/50 rounded-md hover:border-cyan-400/50 hover:bg-slate-700/50 transition-all font-semibold text-slate-300 text-xs"
                      title="Редактировать"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Изменить</span>
                      </span>
                    </button>
                    <button
                      onClick={() => handleToggle(plan.id)}
                      className={`px-2.5 py-1.5 border rounded-md transition-all font-semibold ${plan.is_active ? 'bg-orange-500/20 border-orange-500/50 text-orange-300 hover:bg-orange-500/30' : 'bg-green-500/20 border-green-500/50 text-green-300 hover:bg-green-500/30'}`}
                      title={plan.is_active ? 'Остановить' : 'Запустить'}
                    >
                      {plan.is_active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleDelete(plan.id)}
                      className="px-2.5 py-1.5 bg-red-500/20 border border-red-500/50 rounded-md hover:bg-red-500/30 transition-all font-semibold text-red-300"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filteredPlans.length === 0 && (
              <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 py-12 text-center text-slate-500">
                По текущим фильтрам тарифы не найдены
              </div>
            )}
          </div>
      )}
    </div>
  )
}
