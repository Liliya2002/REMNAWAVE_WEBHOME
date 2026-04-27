import React, { useEffect, useMemo, useState } from 'react'
import { History, RefreshCw, ChevronLeft, ChevronRight, Filter, ChevronDown, ChevronUp } from 'lucide-react'
import { authFetch } from '../services/api'

const ACTION_LABELS = {
  'user.update': { label: 'Обновление пользователя', color: 'blue' },
  'user.delete': { label: 'Удаление пользователя', color: 'red' },
  'user.balance_set': { label: 'Изменение баланса', color: 'amber' },
  'user.toggle_admin': { label: 'Изменение прав admin', color: 'rose' },
  'user.toggle_active': { label: 'Активация/блокировка', color: 'orange' },
  'subscription.create': { label: 'Создание подписки', color: 'emerald' },
  'subscription.extend': { label: 'Продление подписки', color: 'cyan' },
  'subscription.sync_remnwave': { label: 'Синхр. с Remnawave', color: 'violet' },
  'vps.create': { label: 'Добавление VPS', color: 'emerald' },
  'vps.delete': { label: 'Удаление VPS', color: 'red' },
  'vps.renew': { label: 'Продление VPS', color: 'cyan' },
}

const COLOR_BG = {
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  slate: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

function actionBadge(action) {
  const meta = ACTION_LABELS[action] || { label: action, color: 'slate' }
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${COLOR_BG[meta.color]}`}>
      {meta.label}
    </span>
  )
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' })
}

export default function AdminAudit() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actions, setActions] = useState([])
  const [filters, setFilters] = useState({
    action: '',
    targetType: '',
    targetId: '',
    since: '',
    until: '',
  })
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(new Set())

  const limit = 50

  const queryString = useMemo(() => {
    const qs = new URLSearchParams()
    qs.set('limit', String(limit))
    qs.set('offset', String(page * limit))
    if (filters.action) qs.set('action', filters.action)
    if (filters.targetType) qs.set('targetType', filters.targetType)
    if (filters.targetId) qs.set('targetId', filters.targetId)
    if (filters.since) qs.set('since', filters.since)
    if (filters.until) qs.set('until', filters.until)
    return qs.toString()
  }, [filters, page])

  async function fetchActions() {
    try {
      const res = await authFetch('/api/admin/audit/actions')
      if (res.ok) {
        const d = await res.json()
        setActions(d.actions || [])
      }
    } catch (e) { /* silent */ }
  }

  async function fetchItems() {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/admin/audit?${queryString}`)
      if (res.ok) {
        const d = await res.json()
        setItems(d.items || [])
        setTotal(d.total || 0)
      } else {
        setError('Ошибка загрузки журнала')
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchActions() }, [])
  useEffect(() => { fetchItems() }, [queryString])

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
          <History className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Журнал действий</h1>
          <p className="text-sm text-slate-400">Все важные операции администраторов в системе</p>
        </div>
        <button
          onClick={fetchItems}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-sm">Обновить</span>
        </button>
      </div>

      {/* Filters */}
      <div className="p-4 bg-slate-900/40 border border-slate-800/60 rounded-xl">
        <div className="flex items-center gap-2 mb-3 text-sm text-slate-400">
          <Filter className="w-4 h-4" /> Фильтры
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select
            value={filters.action}
            onChange={e => { setPage(0); setFilters({ ...filters, action: e.target.value }) }}
            className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-slate-200"
          >
            <option value="">Все действия</option>
            {actions.map(a => (
              <option key={a.action} value={a.action}>
                {(ACTION_LABELS[a.action]?.label || a.action)} ({a.count})
              </option>
            ))}
          </select>
          <select
            value={filters.targetType}
            onChange={e => { setPage(0); setFilters({ ...filters, targetType: e.target.value }) }}
            className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-slate-200"
          >
            <option value="">Любой объект</option>
            <option value="user">Пользователь</option>
            <option value="subscription">Подписка</option>
            <option value="vps">VPS</option>
            <option value="payment">Платёж</option>
          </select>
          <input
            type="text"
            placeholder="ID объекта"
            value={filters.targetId}
            onChange={e => { setPage(0); setFilters({ ...filters, targetId: e.target.value }) }}
            className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-slate-200 placeholder-slate-500"
          />
          <input
            type="datetime-local"
            value={filters.since}
            onChange={e => { setPage(0); setFilters({ ...filters, since: e.target.value }) }}
            className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-slate-200"
          />
          <input
            type="datetime-local"
            value={filters.until}
            onChange={e => { setPage(0); setFilters({ ...filters, until: e.target.value }) }}
            className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-slate-200"
          />
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-400 rounded-lg text-sm">{error}</div>
      )}

      {/* Items */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden">
        {items.length === 0 && !loading ? (
          <div className="p-8 text-center text-slate-500">Журнал пуст</div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {items.map(it => (
              <div key={it.id} className="p-4 hover:bg-slate-800/20 transition-colors">
                <div className="flex flex-wrap items-center gap-3 mb-1">
                  {actionBadge(it.action)}
                  {it.target_type && (
                    <span className="text-xs text-slate-400">
                      {it.target_type}{it.target_id ? ` #${it.target_id}` : ''}
                    </span>
                  )}
                  <span className="text-xs text-slate-500 ml-auto">{fmtTime(it.created_at)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300 mb-1">
                  <span className="text-slate-400">Админ:</span>
                  <span className="font-medium text-slate-200">{it.admin_login || '—'}</span>
                  {it.ip && <span className="text-xs text-slate-500">IP: {it.ip}</span>}
                </div>
                {it.changes && Object.keys(it.changes).length > 0 && (
                  <button
                    onClick={() => toggle(it.id)}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                  >
                    {expanded.has(it.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Подробности
                  </button>
                )}
                {expanded.has(it.id) && (
                  <pre className="mt-2 p-3 bg-slate-950/60 border border-slate-800/60 rounded-md text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(it.changes, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-slate-400">
            Страница {page + 1} из {totalPages} · всего записей: {total}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" /> Назад
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page + 1 >= totalPages}
              className="flex items-center gap-1 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Вперёд <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
