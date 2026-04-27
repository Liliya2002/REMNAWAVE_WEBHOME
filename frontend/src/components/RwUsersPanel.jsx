import React, { useEffect, useMemo, useState } from 'react'
import {
  Users, Search, RefreshCcw, Plus, Pencil, Trash2, X, ChevronDown,
  Eye, EyeOff, CheckCircle2, AlertCircle, Power, PauseCircle, PlayCircle,
  Send, Activity, Calendar, Mail, User as UserIcon, Hash, Tag,
  Smartphone, Globe, Wallet, RotateCcw, ShieldOff, Database,
  ChevronLeft, ChevronRight, AlertTriangle, Filter
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

function authHeaders() {
  return {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }
}

async function apiFetch(url, opts = {}) {
  return fetch(`${API}${url}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } })
}

function formatBytes(b) {
  if (!b || b < 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.max(1, b)) / Math.log(k))
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${units[i]}`
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatRelative(d) {
  if (!d) return '—'
  const ms = new Date(d) - new Date()
  const days = Math.round(ms / 86400000)
  if (days === 0) return 'сегодня'
  if (days > 0) return `через ${days} дн.`
  return `${Math.abs(days)} дн. назад`
}

function dateToInput(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  return dt.toISOString().slice(0, 16)
}

const STATUS_META = {
  ACTIVE:   { label: 'Активен',   pill: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300', dot: 'bg-emerald-400' },
  DISABLED: { label: 'Отключен',  pill: 'bg-slate-700/60 border-slate-600/50 text-slate-400',       dot: 'bg-slate-500' },
  LIMITED:  { label: 'Лимит',     pill: 'bg-amber-500/15 border-amber-500/40 text-amber-300',       dot: 'bg-amber-400' },
  EXPIRED:  { label: 'Истёк',     pill: 'bg-red-500/15 border-red-500/40 text-red-300',             dot: 'bg-red-400' },
}

const TRAFFIC_STRATEGIES = [
  { value: 'NO_RESET', label: 'Без сброса' },
  { value: 'DAY',      label: 'Каждый день' },
  { value: 'WEEK',     label: 'Каждую неделю' },
  { value: 'MONTH',    label: 'Каждый месяц' },
]

export default function RwUsersPanel() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters / pagination
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [status, setStatus] = useState('')
  const [sortBy, setSortBy] = useState('updatedAt')
  const [sortDirection, setSortDirection] = useState('desc')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)

  // Squads (для редактора и фильтров)
  const [squads, setSquads] = useState([])

  // Modals
  const [editing, setEditing] = useState(null) // null | 'new' | userObject
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [actionBusy, setActionBusy] = useState({})

  // Expanded HWID
  const [expandedUuid, setExpandedUuid] = useState(null)
  const [hwidByUser, setHwidByUser] = useState({})

  const pages = Math.max(1, Math.ceil((total || 0) / size))

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const qs = new URLSearchParams({
        page: String(page), size: String(size),
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        sortBy, sortDirection,
      })
      const res = await apiFetch(`/api/admin/rwusers?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      setUsers(data.users || [])
      setTotal(data.total ?? data.users?.length ?? 0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadSquads() {
    try {
      const res = await apiFetch('/api/admin/squads')
      if (!res.ok) return
      const data = await res.json()
      setSquads(data.squads || [])
    } catch {}
  }

  useEffect(() => { load() }, [page, size, search, status, sortBy, sortDirection])
  useEffect(() => { loadSquads() }, [])

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) { setPage(1); setSearch(searchInput) }
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line
  }, [searchInput])

  async function runUserAction(uuid, action) {
    setActionBusy(p => ({ ...p, [`${uuid}_${action}`]: true }))
    try {
      const res = await apiFetch(`/api/admin/rwusers/${uuid}/${action}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setActionBusy(p => ({ ...p, [`${uuid}_${action}`]: false }))
    }
  }

  async function deleteUser(uuid) {
    setActionBusy(p => ({ ...p, [`${uuid}_delete`]: true }))
    try {
      const res = await apiFetch(`/api/admin/rwusers/${uuid}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setDeleteConfirm(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setActionBusy(p => ({ ...p, [`${uuid}_delete`]: false }))
    }
  }

  async function loadHwid(uuid) {
    if (hwidByUser[uuid]) return
    try {
      const res = await apiFetch(`/api/admin/rwusers/${uuid}/hwid`)
      const data = await res.json()
      if (res.ok) setHwidByUser(p => ({ ...p, [uuid]: data.devices || [] }))
    } catch {}
  }

  async function deleteHwid(userUuid, hwid) {
    setActionBusy(p => ({ ...p, [`hwid_${hwid}`]: true }))
    try {
      const res = await apiFetch(`/api/admin/rwusers/${userUuid}/hwid/${encodeURIComponent(hwid)}`, { method: 'DELETE' })
      if (res.ok) {
        setHwidByUser(p => ({ ...p, [userUuid]: (p[userUuid] || []).filter(d => d.hwid !== hwid) }))
      }
    } finally {
      setActionBusy(p => ({ ...p, [`hwid_${hwid}`]: false }))
    }
  }

  async function deleteAllHwid(userUuid) {
    if (!confirm('Удалить все привязанные устройства этого пользователя?')) return
    setActionBusy(p => ({ ...p, [`hwid_all_${userUuid}`]: true }))
    try {
      const res = await apiFetch(`/api/admin/rwusers/${userUuid}/hwid`, { method: 'DELETE' })
      if (res.ok) setHwidByUser(p => ({ ...p, [userUuid]: [] }))
    } finally {
      setActionBusy(p => ({ ...p, [`hwid_all_${userUuid}`]: false }))
    }
  }

  function toggleExpand(uuid) {
    if (expandedUuid === uuid) {
      setExpandedUuid(null)
    } else {
      setExpandedUuid(uuid)
      loadHwid(uuid)
    }
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDirection('desc') }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Пользователи Remnawave</h3>
            <p className="text-xs text-slate-400">Полное управление через Remnawave Panel API</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/60 border border-slate-700/50 hover:border-blue-500/40 rounded-xl text-sm text-slate-300 hover:text-blue-300 transition-all disabled:opacity-50">
            <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
          </button>
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all active:scale-95">
            <Plus className="w-4 h-4" /> Создать пользователя
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-900/40 border border-slate-700/40 rounded-2xl">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-1 pl-1.5">
          <Filter className="w-3.5 h-3.5" /> Фильтр:
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Поиск по username..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60"
          />
        </div>

        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/60 border border-slate-700/50 text-slate-300 focus:outline-none focus:border-blue-500/50 cursor-pointer">
          <option value="">Все статусы</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>

        <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1) }}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/60 border border-slate-700/50 text-slate-300 focus:outline-none focus:border-blue-500/50 cursor-pointer">
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}/стр.</option>)}
        </select>

        <span className="ml-auto text-xs text-slate-500">
          Найдено: <span className="text-slate-200 font-semibold">{total}</span>
        </span>
      </div>

      {/* Table */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCcw className="w-6 h-6 text-blue-400 animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <Users className="w-10 h-10 text-slate-700 mb-3" />
            <p className="text-slate-400 font-medium">Пользователи не найдены</p>
            <p className="text-xs text-slate-600 mt-1">Попробуйте изменить фильтры или создать нового</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-900/40 text-xs font-semibold text-slate-500 uppercase">
                  <Th label="Username" col="username" sortBy={sortBy} dir={sortDirection} onClick={toggleSort} />
                  <Th label="Статус" col="status" sortBy={sortBy} dir={sortDirection} onClick={toggleSort} />
                  <Th label="Трафик" col="usedTrafficBytes" sortBy={sortBy} dir={sortDirection} onClick={toggleSort} className="text-right" />
                  <Th label="Истекает" col="expireAt" sortBy={sortBy} dir={sortDirection} onClick={toggleSort} />
                  <th className="text-left py-2.5 px-3">Контакты</th>
                  <th className="text-left py-2.5 px-3">Squads</th>
                  <Th label="Обновлён" col="updatedAt" sortBy={sortBy} dir={sortDirection} onClick={toggleSort} />
                  <th className="text-right py-2.5 px-3">Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const meta = STATUS_META[u.status] || STATUS_META.DISABLED
                  const trafficUsed = Number(u.usedTrafficBytes || 0)
                  const trafficLimit = Number(u.trafficLimitBytes || 0)
                  const trafficPct = trafficLimit > 0 ? Math.min(100, (trafficUsed / trafficLimit) * 100) : 0
                  const isExpanded = expandedUuid === u.uuid

                  return (
                    <React.Fragment key={u.uuid}>
                      <tr className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                        {/* Username */}
                        <td className="py-2.5 px-3">
                          <button onClick={() => toggleExpand(u.uuid)} className="flex items-center gap-2 text-left group">
                            <ChevronDown className={`w-3.5 h-3.5 text-slate-600 transition-transform ${isExpanded ? 'rotate-180 text-slate-300' : ''}`} />
                            <div className="min-w-0">
                              <div className="text-sm text-white font-semibold truncate">{u.username}</div>
                              <div className="text-[10px] text-slate-500 font-mono truncate">{String(u.uuid || '').slice(0, 8)}...</div>
                            </div>
                          </button>
                        </td>
                        {/* Status */}
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.pill}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${u.status === 'ACTIVE' ? 'animate-pulse' : ''}`} />
                            {meta.label}
                          </span>
                        </td>
                        {/* Traffic */}
                        <td className="py-2.5 px-3 text-right min-w-[140px]">
                          <div className="text-xs text-slate-300 font-mono">{formatBytes(trafficUsed)}</div>
                          <div className="text-[10px] text-slate-600 font-mono">/ {trafficLimit > 0 ? formatBytes(trafficLimit) : '∞'}</div>
                          {trafficLimit > 0 && (
                            <div className="h-1 bg-slate-800 rounded-full overflow-hidden mt-1">
                              <div className={`h-full ${trafficPct > 90 ? 'bg-red-500' : trafficPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${trafficPct}%` }} />
                            </div>
                          )}
                        </td>
                        {/* Expire */}
                        <td className="py-2.5 px-3">
                          <div className="text-xs text-slate-300">{formatDate(u.expireAt)}</div>
                          <div className="text-[10px] text-slate-500">{formatRelative(u.expireAt)}</div>
                        </td>
                        {/* Contacts */}
                        <td className="py-2.5 px-3">
                          <div className="text-[11px] space-y-0.5">
                            {u.email && <div className="flex items-center gap-1 text-slate-400"><Mail className="w-3 h-3" /> <span className="truncate max-w-[140px]">{u.email}</span></div>}
                            {u.telegramId && <div className="flex items-center gap-1 text-slate-400"><Send className="w-3 h-3" /> {u.telegramId}</div>}
                            {!u.email && !u.telegramId && <span className="text-slate-700">—</span>}
                          </div>
                        </td>
                        {/* Squads */}
                        <td className="py-2.5 px-3">
                          {(u.activeInternalSquads || []).length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {u.activeInternalSquads.slice(0, 2).map(s => (
                                <span key={s.uuid} className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/10 text-violet-300 border border-violet-500/20">{s.name || s.uuid?.slice(0, 8)}</span>
                              ))}
                              {u.activeInternalSquads.length > 2 && (
                                <span className="px-1.5 py-0.5 text-[10px] text-slate-500">+{u.activeInternalSquads.length - 2}</span>
                              )}
                            </div>
                          ) : <span className="text-slate-700 text-xs">—</span>}
                        </td>
                        {/* Updated */}
                        <td className="py-2.5 px-3">
                          <div className="text-[11px] text-slate-400">{formatDate(u.updatedAt)}</div>
                        </td>
                        {/* Actions */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-end gap-1">
                            {u.status === 'ACTIVE' ? (
                              <IconBtn title="Отключить" Icon={PauseCircle} color="amber" onClick={() => runUserAction(u.uuid, 'disable')} loading={actionBusy[`${u.uuid}_disable`]} />
                            ) : (
                              <IconBtn title="Включить" Icon={PlayCircle} color="emerald" onClick={() => runUserAction(u.uuid, 'enable')} loading={actionBusy[`${u.uuid}_enable`]} />
                            )}
                            <IconBtn title="Сбросить трафик" Icon={RotateCcw} color="cyan" onClick={() => runUserAction(u.uuid, 'reset-traffic')} loading={actionBusy[`${u.uuid}_reset-traffic`]} />
                            <IconBtn title="Перевыпустить подписку" Icon={ShieldOff} color="violet" onClick={() => { if (confirm('Перевыпустить ссылку подписки? Старая станет недействительной.')) runUserAction(u.uuid, 'revoke') }} loading={actionBusy[`${u.uuid}_revoke`]} />
                            <IconBtn title="Редактировать" Icon={Pencil} color="blue" onClick={() => setEditing(u)} />
                            <IconBtn title="Удалить" Icon={Trash2} color="red" onClick={() => setDeleteConfirm(u)} />
                          </div>
                        </td>
                      </tr>

                      {/* Expanded — HWID + details */}
                      {isExpanded && (
                        <tr className="bg-slate-950/40 border-b border-slate-800/40">
                          <td colSpan={8} className="px-5 py-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-3">
                                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                  <UserIcon className="w-3.5 h-3.5" /> Подробности
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                                  <span className="text-slate-500">UUID:</span>
                                  <span className="font-mono text-slate-300 truncate">{u.uuid}</span>
                                  <span className="text-slate-500">Short UUID:</span>
                                  <span className="font-mono text-slate-300">{u.shortUuid || '—'}</span>
                                  <span className="text-slate-500">Стратегия трафика:</span>
                                  <span className="text-slate-300">{TRAFFIC_STRATEGIES.find(s => s.value === u.trafficLimitStrategy)?.label || u.trafficLimitStrategy || '—'}</span>
                                  <span className="text-slate-500">Лимит устройств:</span>
                                  <span className="text-slate-300">{u.hwidDeviceLimit ?? 'не задан'}</span>
                                  <span className="text-slate-500">Тег:</span>
                                  <span className="text-slate-300">{u.tag || '—'}</span>
                                  <span className="text-slate-500">Создан:</span>
                                  <span className="text-slate-300">{formatDate(u.createdAt)}</span>
                                  <span className="text-slate-500">Subscription URL:</span>
                                  <span className="font-mono text-cyan-300 truncate">{u.subscriptionUrl || '—'}</span>
                                </div>
                                {u.description && (
                                  <div className="mt-2 pt-2 border-t border-slate-700/30 text-xs text-slate-300 whitespace-pre-wrap">{u.description}</div>
                                )}
                              </div>

                              <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                    <Smartphone className="w-3.5 h-3.5" /> HWID устройства ({(hwidByUser[u.uuid] || []).length})
                                  </div>
                                  {(hwidByUser[u.uuid] || []).length > 0 && (
                                    <button onClick={() => deleteAllHwid(u.uuid)} disabled={actionBusy[`hwid_all_${u.uuid}`]}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 hover:bg-red-500/20 transition disabled:opacity-50">
                                      <Trash2 className="w-3 h-3" /> Удалить все
                                    </button>
                                  )}
                                </div>
                                {(hwidByUser[u.uuid] || []).length === 0 ? (
                                  <p className="text-xs text-slate-600 italic">Нет привязанных устройств</p>
                                ) : (
                                  <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {hwidByUser[u.uuid].map(d => (
                                      <div key={d.hwid} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/30 text-xs">
                                        <Smartphone className="w-3 h-3 text-slate-500 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <div className="font-mono text-slate-300 truncate">{d.platform || d.osName || d.hwid?.slice(0, 12)}</div>
                                          <div className="font-mono text-[10px] text-slate-600 truncate">{d.hwid}</div>
                                        </div>
                                        <button onClick={() => deleteHwid(u.uuid, d.hwid)} disabled={actionBusy[`hwid_${d.hwid}`]}
                                          className="p-1 rounded text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition disabled:opacity-50">
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {users.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-700/40 bg-slate-900/30">
            <span className="text-xs text-slate-500">
              Стр. <span className="text-slate-300 font-semibold">{page}</span> из <span className="text-slate-300 font-semibold">{pages}</span>
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="px-2 py-1 rounded-md bg-slate-800/60 border border-slate-700/50 text-slate-400 text-xs hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-md bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}
                className="p-1.5 rounded-md bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight className="w-3.5 h-3.5" /></button>
              <button onClick={() => setPage(pages)} disabled={page >= pages}
                className="px-2 py-1 rounded-md bg-slate-800/60 border border-slate-700/50 text-slate-400 text-xs hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">»</button>
            </div>
          </div>
        )}
      </div>

      {/* Editor modal */}
      {editing && (
        <UserEditorModal
          user={editing === 'new' ? null : editing}
          squads={squads}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-full max-w-md bg-gradient-to-br from-slate-900 to-slate-950 border border-red-500/40 rounded-2xl shadow-2xl shadow-red-500/10 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-300" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Удалить пользователя?</h3>
                <p className="text-xs text-slate-400 mt-0.5"><span className="font-mono text-slate-300">{deleteConfirm.username}</span> — действие необратимо</p>
              </div>
            </div>
            <p className="text-sm text-slate-300 mb-5">Пользователь будет удалён из Remnawave. Это также завершит все активные сессии и недействительной подписку.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300 hover:text-white">Отмена</button>
              <button onClick={() => deleteUser(deleteConfirm.uuid)} disabled={actionBusy[`${deleteConfirm.uuid}_delete`]}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-red-500/30 disabled:opacity-50">
                {actionBusy[`${deleteConfirm.uuid}_delete`] ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ label, col, sortBy, dir, onClick, className = '' }) {
  const active = sortBy === col
  return (
    <th className={`text-left py-2.5 px-3 ${className}`}>
      <button onClick={() => onClick(col)} className={`inline-flex items-center gap-1 hover:text-slate-300 transition ${active ? 'text-blue-300' : ''}`}>
        {label}
        {active && <ChevronDown className={`w-3 h-3 transition-transform ${dir === 'asc' ? 'rotate-180' : ''}`} />}
      </button>
    </th>
  )
}

function IconBtn({ title, Icon, color = 'slate', onClick, loading }) {
  const colorMap = {
    slate:   'hover:bg-slate-700/60 hover:text-slate-200',
    emerald: 'hover:bg-emerald-500/15 hover:text-emerald-300 hover:border-emerald-500/40',
    amber:   'hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-500/40',
    cyan:    'hover:bg-cyan-500/15 hover:text-cyan-300 hover:border-cyan-500/40',
    violet:  'hover:bg-violet-500/15 hover:text-violet-300 hover:border-violet-500/40',
    blue:    'hover:bg-blue-500/15 hover:text-blue-300 hover:border-blue-500/40',
    red:     'hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/40',
  }
  return (
    <button title={title} onClick={onClick} disabled={loading}
      className={`p-1.5 rounded-lg border border-transparent text-slate-400 transition disabled:opacity-50 ${colorMap[color] || colorMap.slate}`}>
      {loading ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
    </button>
  )
}

function UserEditorModal({ user, squads, onClose, onSaved }) {
  const isNew = !user
  const [form, setForm] = useState(() => ({
    username: user?.username || '',
    status: user?.status || 'ACTIVE',
    expireAt: dateToInput(user?.expireAt) || (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return dateToInput(d) })(),
    trafficLimitBytes: user?.trafficLimitBytes ?? 0,
    trafficLimitStrategy: user?.trafficLimitStrategy || 'NO_RESET',
    description: user?.description || '',
    tag: user?.tag || '',
    email: user?.email || '',
    telegramId: user?.telegramId || '',
    hwidDeviceLimit: user?.hwidDeviceLimit ?? 0,
    activeInternalSquads: (user?.activeInternalSquads || []).map(s => s.uuid),
  }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [trafficUnit, setTrafficUnit] = useState('GB')
  const trafficValue = useMemo(() => {
    const bytes = Number(form.trafficLimitBytes || 0)
    if (trafficUnit === 'GB') return bytes ? (bytes / 1024 / 1024 / 1024).toFixed(2) : '0'
    if (trafficUnit === 'MB') return bytes ? (bytes / 1024 / 1024).toFixed(0) : '0'
    return String(bytes)
  }, [form.trafficLimitBytes, trafficUnit])

  function setField(k, v) { setForm(p => ({ ...p, [k]: v })) }

  function setTraffic(value) {
    const n = Number(value || 0)
    let bytes = 0
    if (trafficUnit === 'GB') bytes = Math.round(n * 1024 * 1024 * 1024)
    else if (trafficUnit === 'MB') bytes = Math.round(n * 1024 * 1024)
    else bytes = Math.round(n)
    setField('trafficLimitBytes', bytes)
  }

  function toggleSquad(uuid) {
    setForm(p => ({
      ...p,
      activeInternalSquads: p.activeInternalSquads.includes(uuid)
        ? p.activeInternalSquads.filter(x => x !== uuid)
        : [...p.activeInternalSquads, uuid]
    }))
  }

  async function save() {
    try {
      setSaving(true); setErr(null)
      const body = {
        username: form.username.trim(),
        status: form.status,
        expireAt: form.expireAt ? new Date(form.expireAt).toISOString() : null,
        trafficLimitBytes: Number(form.trafficLimitBytes) || 0,
        trafficLimitStrategy: form.trafficLimitStrategy,
        description: form.description || null,
        tag: form.tag || null,
        email: form.email || null,
        telegramId: form.telegramId ? Number(form.telegramId) : null,
        hwidDeviceLimit: Number(form.hwidDeviceLimit) || 0,
        activeInternalSquads: form.activeInternalSquads,
      }
      const res = await apiFetch(isNew ? '/api/admin/rwusers' : `/api/admin/rwusers/${user.uuid}`, {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      onSaved()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-2xl sm:max-h-[92vh] flex flex-col bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 sm:rounded-3xl shadow-2xl shadow-blue-500/10 overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800/60 bg-gradient-to-r from-blue-500/10 via-cyan-500/5 to-transparent flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30 shrink-0">
            {isNew ? <Plus className="w-5 h-5 text-white" /> : <Pencil className="w-5 h-5 text-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white truncate">{isNew ? 'Новый пользователь' : 'Редактирование пользователя'}</h3>
            {!isNew && <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">{user.uuid}</p>}
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {err && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {err}
            </div>
          )}

          {/* Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Username" required Icon={UserIcon}>
              <input value={form.username} disabled={!isNew} onChange={e => setField('username', e.target.value)}
                placeholder="user_alice"
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60" />
            </Field>
            <Field label="Статус" Icon={Power}>
              <div className="grid grid-cols-4 gap-1">
                {['ACTIVE', 'DISABLED', 'LIMITED', 'EXPIRED'].map(s => (
                  <button key={s} type="button" onClick={() => setField('status', s)}
                    className={`px-2 py-2 rounded-lg text-[11px] font-bold border transition ${
                      form.status === s
                        ? STATUS_META[s].pill + ' shadow-md'
                        : 'bg-slate-800/60 border-slate-700/50 text-slate-500 hover:text-slate-300'
                    }`}>
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* Expire + traffic */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Истекает" Icon={Calendar}>
              <input type="datetime-local" value={form.expireAt} onChange={e => setField('expireAt', e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20" />
            </Field>
            <Field label="Лимит трафика" Icon={Database} hint="0 = без лимита">
              <div className="flex gap-2">
                <input type="number" min="0" value={trafficValue} onChange={e => setTraffic(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20" />
                <select value={trafficUnit} onChange={e => setTrafficUnit(e.target.value)}
                  className="px-3 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/60">
                  <option value="GB">GB</option>
                  <option value="MB">MB</option>
                  <option value="B">B</option>
                </select>
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Стратегия сброса трафика" Icon={RotateCcw}>
              <select value={form.trafficLimitStrategy} onChange={e => setField('trafficLimitStrategy', e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20">
                {TRAFFIC_STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Лимит устройств (HWID)" Icon={Smartphone} hint="0 = без ограничений">
              <input type="number" min="0" value={form.hwidDeviceLimit} onChange={e => setField('hwidDeviceLimit', Number(e.target.value) || 0)}
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20" />
            </Field>
          </div>

          {/* Squads */}
          <Field label={`Squads (${form.activeInternalSquads.length} выбрано)`} Icon={Globe}>
            {squads.length === 0 ? (
              <div className="text-xs text-slate-500 italic">Squads не загружены — проверьте /admin/servers</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto p-2 rounded-xl bg-slate-900/40 border border-slate-700/40">
                {squads.map(s => {
                  const sel = form.activeInternalSquads.includes(s.uuid)
                  return (
                    <label key={s.uuid} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition border ${
                      sel ? 'bg-violet-500/15 border-violet-500/40' : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600'
                    }`}>
                      <input type="checkbox" checked={sel} onChange={() => toggleSquad(s.uuid)} className="accent-violet-500" />
                      <span className={`text-xs font-medium truncate ${sel ? 'text-violet-200' : 'text-slate-300'}`}>
                        {s.display_name || s.tag || s.name || s.uuid?.slice(0, 8)}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </Field>

          {/* Contacts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Email" Icon={Mail}>
              <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="user@example.com"
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20" />
            </Field>
            <Field label="Telegram ID" Icon={Send}>
              <input type="number" value={form.telegramId} onChange={e => setField('telegramId', e.target.value)} placeholder="123456789"
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Тег" Icon={Tag}>
              <input value={form.tag} onChange={e => setField('tag', e.target.value)} placeholder="vip"
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20" />
            </Field>
            <Field label="Описание" Icon={Hash}>
              <input value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Заметка для админа"
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20" />
            </Field>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800/60 bg-slate-900/40 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-all">Отмена</button>
          <button onClick={save} disabled={saving || !form.username.trim()}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95">
            {saving ? <><RefreshCcw className="w-4 h-4 animate-spin" /> Сохранение...</>
              : isNew ? <><Plus className="w-4 h-4" /> Создать</>
              : <><CheckCircle2 className="w-4 h-4" /> Сохранить</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, Icon, hint, required, children }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
        {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <div className="mt-1 text-[10px] text-slate-500">{hint}</div>}
    </div>
  )
}
