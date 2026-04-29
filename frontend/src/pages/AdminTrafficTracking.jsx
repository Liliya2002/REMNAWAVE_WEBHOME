import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, RefreshCw, Search, Loader2, AlertCircle,
  ArrowDownUp, Download, Server, Filter, Check, X, ExternalLink,
} from 'lucide-react'
import { authFetch } from '../services/api'

const PERIODS = [
  { id: '24h', label: '24 часа' },
  { id: '7d',  label: '7 дней'  },
  { id: '30d', label: '30 дней' },
]

const NODES_FILTER_KEY = 'admin_traffic_visible_nodes'

function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n === 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), units.length - 1)
  return `${(n / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

const COUNTRY_FLAGS = {
  RU: '🇷🇺', DE: '🇩🇪', US: '🇺🇸', NL: '🇳🇱', FI: '🇫🇮', SG: '🇸🇬',
  GB: '🇬🇧', FR: '🇫🇷', JP: '🇯🇵', CA: '🇨🇦', AU: '🇦🇺', KR: '🇰🇷',
  SE: '🇸🇪', CH: '🇨🇭', PL: '🇵🇱', TR: '🇹🇷', AE: '🇦🇪', IN: '🇮🇳',
  BR: '🇧🇷', HK: '🇭🇰', TW: '🇹🇼', UA: '🇺🇦', KZ: '🇰🇿', CZ: '🇨🇿', GE: '🇬🇪',
}

export default function AdminTrafficTracking() {
  const [period, setPeriod] = useState('24h')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('total')

  // Set<nodeUuid> — какие ноды показываем. null = "все" (дефолт до первой загрузки).
  const [selectedNodeUuids, setSelectedNodeUuids] = useState(() => {
    try {
      const saved = localStorage.getItem(NODES_FILTER_KEY)
      if (saved) return new Set(JSON.parse(saved))
    } catch {}
    return null
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef(null)

  // Закрытие dropdown по клику снаружи
  useEffect(() => {
    if (!filterOpen) return
    const onDocClick = (e) => {
      if (!filterRef.current?.contains(e.target)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [filterOpen])

  const load = useCallback(async (p = period, force = false) => {
    setLoading(true)
    setError(null)
    try {
      const url = `/api/admin/traffic/by-node?period=${p}${force ? `&_=${Date.now()}` : ''}`
      const res = await authFetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`)
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load(period) }, [period, load])

  // Когда приходят новые данные с нодами — если фильтр ещё не задан, выбираем все
  useEffect(() => {
    if (data?.nodes && selectedNodeUuids === null) {
      setSelectedNodeUuids(new Set(data.nodes.map(n => n.uuid)))
    }
  }, [data, selectedNodeUuids])

  // Persist filter
  useEffect(() => {
    if (selectedNodeUuids === null) return
    try { localStorage.setItem(NODES_FILTER_KEY, JSON.stringify([...selectedNodeUuids])) } catch {}
  }, [selectedNodeUuids])

  // Видимые ноды (с учётом фильтра)
  const visibleNodes = useMemo(() => {
    if (!data?.nodes) return []
    if (!selectedNodeUuids) return data.nodes
    return data.nodes.filter(n => selectedNodeUuids.has(n.uuid))
  }, [data, selectedNodeUuids])

  // Если sortBy указывает на скрытую ноду — переключиться на 'total'
  useEffect(() => {
    if (!data?.nodes) return
    if (sortBy !== 'total' && sortBy !== 'username') {
      const visible = visibleNodes.some(n => n.uuid === sortBy)
      if (!visible) setSortBy('total')
    }
  }, [visibleNodes, sortBy, data])

  // Пользователи: фильтр поиском + пересчёт total по видимым нодам + сортировка
  const filteredAndSorted = useMemo(() => {
    if (!data?.users) return []
    const q = query.trim().toLowerCase()
    const visibleUuids = new Set(visibleNodes.map(n => n.uuid))

    let rows = (q
      ? data.users.filter(u => (u.username || '').toLowerCase().includes(q) || (u.userUuid || '').toLowerCase().includes(q))
      : data.users.slice()
    ).map(u => {
      let visibleTotal = 0
      for (const uuid of visibleUuids) visibleTotal += (u.perNode[uuid] || 0)
      return { ...u, visibleTotal }
    })

    rows.sort((a, b) => {
      if (sortBy === 'username') return (a.username || '').localeCompare(b.username || '')
      if (sortBy === 'total') return b.visibleTotal - a.visibleTotal
      return (b.perNode[sortBy] || 0) - (a.perNode[sortBy] || 0)
    })
    return rows
  }, [data, query, sortBy, visibleNodes])

  // Total per visible node — сумма по нашим юзерам
  const visibleTotalPerNode = useMemo(() => {
    const out = {}
    if (!data?.users) return out
    for (const n of visibleNodes) {
      let sum = 0
      for (const u of data.users) sum += (u.perNode[n.uuid] || 0)
      out[n.uuid] = sum
    }
    return out
  }, [data, visibleNodes])

  const visibleGrandTotal = useMemo(
    () => Object.values(visibleTotalPerNode).reduce((s, v) => s + v, 0),
    [visibleTotalPerNode]
  )

  const totalUsers = data?.users?.length || 0
  const filteredCount = filteredAndSorted.length
  const totalNodesCount = data?.nodes?.length || 0
  const visibleNodesCount = visibleNodes.length
  const allNodesSelected = visibleNodesCount === totalNodesCount

  // ─── Действия с фильтром ─────────────────────────────────────────────
  const toggleNode = (uuid) => {
    setSelectedNodeUuids(prev => {
      const next = new Set(prev || data.nodes.map(n => n.uuid))
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }
  const selectAll = () => setSelectedNodeUuids(new Set(data.nodes.map(n => n.uuid)))
  const clearAll  = () => setSelectedNodeUuids(new Set())
  const invertSelection = () => {
    setSelectedNodeUuids(prev => {
      const all = new Set(data.nodes.map(n => n.uuid))
      const cur = prev || all
      const next = new Set()
      for (const uuid of all) if (!cur.has(uuid)) next.add(uuid)
      return next
    })
  }

  const exportCsv = () => {
    if (!data) return
    const header = ['User', 'UUID', ...visibleNodes.map(n => n.name), 'Total']
    const rows = filteredAndSorted.map(u => [
      u.username,
      u.userUuid,
      ...visibleNodes.map(n => u.perNode[n.uuid] || 0),
      u.visibleTotal,
    ])
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `traffic-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">Трафик / Отслеживание</h1>
            <p className="text-xs text-slate-400">Потребление трафика по нодам RemnaWave (live, кеш 60 сек)</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={!data || loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-300 hover:text-white bg-slate-900/60 hover:bg-slate-800/80 border border-slate-700/60 transition-all disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button
            onClick={() => load(period, true)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-300 hover:text-white bg-slate-900/60 hover:bg-slate-800/80 border border-slate-700/60 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1 p-1 bg-slate-900/50 border border-slate-800/60 rounded-xl w-full sm:w-fit">
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 sm:flex-none ${
              period === p.id
                ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary row */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Наших пользователей" value={totalUsers} accent="blue" />
          <SummaryCard
            label={allNodesSelected ? 'Нод RemnaWave' : 'Нод (выбрано / всего)'}
            value={allNodesSelected ? totalNodesCount : `${visibleNodesCount} / ${totalNodesCount}`}
            accent="violet"
            Icon={Server}
          />
          <SummaryCard label="Трафик (по выбору)" value={formatBytes(visibleGrandTotal)} accent="emerald" />
          <SummaryCard label="Среднее на юзера" value={formatBytes(totalUsers ? visibleGrandTotal / totalUsers : 0)} accent="amber" />
        </div>
      )}

      {/* Errors per-user */}
      {data?.errors?.length > 0 && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium mb-1">Не удалось получить данные для {data.errors.length} юзера(ов)</div>
              <ul className="text-xs text-amber-300/80 space-y-0.5 max-h-24 overflow-auto">
                {data.errors.slice(0, 5).map((e, i) => (
                  <li key={i}><b>{e.username || e.userUuid}</b>: <code className="font-mono">{e.error}</code></li>
                ))}
                {data.errors.length > 5 && <li>… ещё {data.errors.length - 5}</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Search + nodes filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по имени или UUID…"
            className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:bg-slate-900/80 transition-all"
          />
        </div>

        {/* Nodes filter dropdown */}
        {data?.nodes && data.nodes.length > 0 && (
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(o => !o)}
              className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                allNodesSelected
                  ? 'bg-slate-900/60 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/80'
                  : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/20'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>
                Ноды
                {!allNodesSelected && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/30">
                    {visibleNodesCount} / {totalNodesCount}
                  </span>
                )}
              </span>
            </button>

            {filterOpen && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 max-h-[70vh] overflow-hidden flex flex-col bg-slate-900 border border-slate-700/70 rounded-xl shadow-2xl shadow-black/50 z-30">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white">Показывать ноды</h4>
                  <button onClick={() => setFilterOpen(false)} className="text-slate-500 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-3 py-2 border-b border-slate-800 flex gap-2 text-xs">
                  <button onClick={selectAll}        className="flex-1 px-2 py-1.5 rounded-md text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40">Все</button>
                  <button onClick={clearAll}         className="flex-1 px-2 py-1.5 rounded-md text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40">Очистить</button>
                  <button onClick={invertSelection}  className="flex-1 px-2 py-1.5 rounded-md text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40">Инверт.</button>
                </div>
                <div className="overflow-y-auto py-1.5">
                  {data.nodes.map(n => {
                    const checked = selectedNodeUuids?.has(n.uuid) ?? true
                    const total = data.totalPerNode?.[n.uuid] || 0
                    return (
                      <label
                        key={n.uuid}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 cursor-pointer transition-colors"
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${checked ? 'bg-emerald-500 border-emerald-500' : 'bg-slate-800/50 border-slate-600'}`}>
                          {checked && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleNode(n.uuid)}
                          className="sr-only"
                        />
                        {n.countryCode && <span className="text-base leading-none">{COUNTRY_FLAGS[n.countryCode] || n.countryCode}</span>}
                        <span className="flex-1 text-sm text-slate-200 truncate">{n.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">{formatBytes(total)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-500 px-2">
          {query ? `${filteredCount} из ${totalUsers}` : `${totalUsers} пользователей`}
        </div>
      </div>

      {/* Table */}
      <div className="bg-gradient-to-br from-slate-900/60 to-slate-950/60 border border-slate-800/70 rounded-2xl overflow-hidden">
        {error && !data && (
          <div className="p-6 flex items-start gap-3 text-red-300 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Не удалось загрузить трафик</div>
              <div className="text-xs text-red-300/70 mt-1 font-mono break-all">{error}</div>
              <button
                onClick={() => load(period, true)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-200 hover:text-white bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Повторить
              </button>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-3" />
            Загружаю с RemnaWave…
          </div>
        )}

        {data && data.nodes.length === 0 && (
          <div className="py-20 text-center text-slate-500 text-sm">
            Нет нод в RemnaWave
          </div>
        )}

        {data && data.nodes.length > 0 && visibleNodesCount === 0 && (
          <div className="py-12 text-center text-slate-500 text-sm">
            Все ноды скрыты фильтром. Включи хотя бы одну, чтобы увидеть данные.
          </div>
        )}

        {data && visibleNodesCount > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/40">
                  <th
                    className="text-left px-4 py-3 font-semibold text-slate-300 sticky left-0 bg-slate-900/95 backdrop-blur z-10 cursor-pointer hover:text-white"
                    onClick={() => setSortBy('username')}
                  >
                    <div className="flex items-center gap-1.5">
                      Пользователь
                      {sortBy === 'username' && <ArrowDownUp className="w-3 h-3" />}
                    </div>
                  </th>
                  {visibleNodes.map(n => (
                    <th
                      key={n.uuid}
                      className="text-right px-3 py-3 font-medium text-slate-400 cursor-pointer hover:text-white whitespace-nowrap"
                      onClick={() => setSortBy(n.uuid)}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        {n.countryCode && <span>{COUNTRY_FLAGS[n.countryCode] || n.countryCode}</span>}
                        <span>{n.name}</span>
                        {sortBy === n.uuid && <ArrowDownUp className="w-3 h-3" />}
                      </div>
                    </th>
                  ))}
                  <th
                    className="text-right px-4 py-3 font-semibold text-emerald-300 cursor-pointer hover:text-emerald-200"
                    onClick={() => setSortBy('total')}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      Всего
                      {sortBy === 'total' && <ArrowDownUp className="w-3 h-3" />}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.length === 0 && !loading && (
                  <tr>
                    <td colSpan={visibleNodesCount + 2} className="text-center py-12 text-slate-500">
                      {query ? `Никого не нашли по запросу «${query}»` : 'Нет данных о трафике за выбранный период'}
                    </td>
                  </tr>
                )}
                {filteredAndSorted.map((u, idx) => (
                  <tr
                    key={u.userUuid}
                    className={`border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors ${idx % 2 === 0 ? 'bg-slate-900/20' : ''}`}
                  >
                    <td className="px-4 py-2.5 sticky left-0 bg-inherit">
                      {u.userId ? (
                        <Link
                          to={`/admin/users/${u.userId}`}
                          className="group inline-flex flex-col gap-0 hover:text-cyan-300 transition-colors"
                          title="Открыть карточку пользователя"
                        >
                          <span className="font-medium text-slate-200 group-hover:text-cyan-300 truncate max-w-[200px] flex items-center gap-1">
                            {u.username}
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]">{u.userUuid}</span>
                        </Link>
                      ) : (
                        <>
                          <div className="font-medium text-slate-200 truncate max-w-[200px]">{u.username}</div>
                          <div className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]">{u.userUuid}</div>
                        </>
                      )}
                    </td>
                    {visibleNodes.map(n => {
                      const bytes = u.perNode[n.uuid] || 0
                      return (
                        <td key={n.uuid} className={`text-right px-3 py-2.5 font-mono text-xs whitespace-nowrap ${bytes > 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                          {formatBytes(bytes)}
                        </td>
                      )
                    })}
                    <td className="text-right px-4 py-2.5 font-mono text-sm font-bold text-emerald-300 whitespace-nowrap">
                      {formatBytes(u.visibleTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {filteredAndSorted.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-700/80 bg-slate-900/60 font-semibold">
                    <td className="px-4 py-3 sticky left-0 bg-slate-900/95 text-slate-300">
                      Всего по нодам
                    </td>
                    {visibleNodes.map(n => (
                      <td key={n.uuid} className="text-right px-3 py-3 font-mono text-xs text-cyan-300 whitespace-nowrap">
                        {formatBytes(visibleTotalPerNode[n.uuid] || 0)}
                      </td>
                    ))}
                    <td className="text-right px-4 py-3 font-mono text-sm text-emerald-300 whitespace-nowrap">
                      {formatBytes(visibleGrandTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Footer meta */}
      {data && (
        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Период: {data.range.start} — {data.range.end}</span>
          <span>Обновлено: {new Date(data.fetchedAt).toLocaleString('ru-RU')}{data.cached ? ' (из кеша)' : ''}</span>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, accent = 'slate', Icon }) {
  const map = {
    blue:    'border-blue-500/30 bg-blue-500/10 text-blue-300',
    violet:  'border-violet-500/30 bg-violet-500/10 text-violet-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    amber:   'border-amber-500/30 bg-amber-500/10 text-amber-300',
    slate:   'border-slate-700 bg-slate-800/30 text-slate-200',
  }
  return (
    <div className={`p-4 rounded-xl border ${map[accent]}`}>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 opacity-80" />}
        <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
      </div>
      <div className="text-xl font-bold font-mono">{value}</div>
    </div>
  )
}
