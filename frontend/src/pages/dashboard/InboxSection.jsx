import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Inbox, MailOpen, CheckCheck, Trash2, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Info, PartyPopper,
  CreditCard, ClipboardList, Gift, Globe, Megaphone
} from 'lucide-react'
import { authFetch } from '../../services/api'

const TYPE_ICON = {
  success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
  error:   <XCircle className="w-5 h-5 text-red-400" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-400" />,
  info:    <Info className="w-5 h-5 text-blue-400" />,
  promo:   <PartyPopper className="w-5 h-5 text-violet-400" />,
}

const CATEGORY_META = {
  payment:      { label: 'Платежи',     Icon: CreditCard,    color: 'text-blue-400' },
  subscription: { label: 'Подписка',    Icon: ClipboardList, color: 'text-cyan-400' },
  referral:     { label: 'Рефералы',    Icon: Gift,          color: 'text-emerald-400' },
  server:       { label: 'Серверы',     Icon: Globe,         color: 'text-indigo-400' },
  admin:        { label: 'Объявления',  Icon: Megaphone,     color: 'text-orange-400' },
  system:       { label: 'Система',     Icon: Info,          color: 'text-slate-400' },
}

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'payment', label: 'Платежи' },
  { id: 'subscription', label: 'Подписка' },
  { id: 'referral', label: 'Рефералы' },
  { id: 'server', label: 'Серверы' },
  { id: 'admin', label: 'Объявления' },
]

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  if (diff < 604800) return `${Math.floor(diff / 86400)} дн назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function InboxSection() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const navigate = useNavigate()

  const limit = 30

  const load = useCallback(async (reset = true) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      qs.set('limit', String(limit))
      qs.set('offset', String(reset ? 0 : offset))
      if (filter === 'unread') qs.set('unread_only', 'true')
      const res = await authFetch(`/api/notifications?${qs.toString()}`)
      if (res.ok) {
        const d = await res.json()
        let arr = d.notifications || []
        if (filter !== 'all' && filter !== 'unread') {
          arr = arr.filter(n => n.category === filter)
        }
        setItems(prev => reset ? arr : [...prev, ...arr])
        setTotal(d.total || 0)
        if (reset) setOffset(arr.length)
        else setOffset(prev => prev + arr.length)
      }
    } catch (e) {
      // silent
    } finally {
      setLoading(false)
    }
  }, [filter, offset])

  useEffect(() => { load(true) }, [filter])

  async function markRead(id) {
    try {
      await authFetch(`/api/notifications/${id}/read`, { method: 'PUT' })
      setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    } catch {}
  }

  async function markAllRead() {
    try {
      await authFetch('/api/notifications/read-all', { method: 'PUT' })
      setItems(prev => prev.map(n => ({ ...n, is_read: true })))
    } catch {}
  }

  async function remove(id) {
    try {
      await authFetch(`/api/notifications/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(n => n.id !== id))
      setTotal(t => Math.max(0, t - 1))
    } catch {}
  }

  function open(notif) {
    if (!notif.is_read) markRead(notif.id)
    if (notif.link) navigate(notif.link)
  }

  const unreadCount = items.filter(n => !n.is_read).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Inbox className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">Уведомления</h2>
            <p className="text-sm text-slate-400">
              {unreadCount > 0 ? `Непрочитано: ${unreadCount}` : 'Всё прочитано'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            className="p-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
            aria-label="Обновить"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/15 border border-blue-500/40 text-blue-300 hover:bg-blue-500/25 transition-all text-sm"
            >
              <CheckCheck className="w-4 h-4" /> Прочитать все
            </button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              filter === f.id
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-500">
            <MailOpen className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Уведомлений нет</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {items.map(n => {
              const cat = CATEGORY_META[n.category] || CATEGORY_META.system
              return (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 px-4 py-3.5 transition-colors ${
                    n.is_read ? 'hover:bg-slate-800/20' : 'bg-blue-500/5 hover:bg-blue-500/10'
                  }`}
                >
                  <button
                    onClick={() => open(n)}
                    className="shrink-0 mt-0.5"
                    aria-label="Открыть"
                  >
                    {TYPE_ICON[n.type] || <cat.Icon className={`w-5 h-5 ${cat.color}`} />}
                  </button>
                  <button
                    onClick={() => open(n)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className={`text-sm leading-tight ${n.is_read ? 'text-slate-400' : 'text-slate-100 font-semibold'}`}>
                        {n.title}
                      </span>
                      <span className="text-[11px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/50">
                        {cat.label}
                      </span>
                    </div>
                    {n.message && (
                      <p className="text-sm text-slate-400 leading-snug">{n.message}</p>
                    )}
                    <p className="text-[11px] text-slate-500 mt-1">{timeAgo(n.created_at)}</p>
                  </button>
                  <div className="shrink-0 flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {!n.is_read && (
                      <button
                        onClick={() => markRead(n.id)}
                        className="p-1.5 rounded text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                        aria-label="Отметить прочитанным"
                        title="Отметить прочитанным"
                      >
                        <MailOpen className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => remove(n.id)}
                      className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      aria-label="Удалить"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Load more */}
      {filter === 'all' && items.length < total && (
        <div className="text-center">
          <button
            onClick={() => load(false)}
            disabled={loading}
            className="px-4 py-2 bg-slate-800/50 border border-slate-700/50 text-slate-300 rounded-lg hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50 text-sm"
          >
            {loading ? 'Загрузка…' : `Показать ещё (осталось ${total - items.length})`}
          </button>
        </div>
      )}
    </div>
  )
}
