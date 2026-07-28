import React, { useEffect, useState } from 'react'
import { BarChart3, RefreshCw, Cpu, HardDrive, Network, Server } from 'lucide-react'
import { useRuvds } from './context'
import { Panel, Loading, ErrorBox, Empty, IconBtn, fmtNum } from './ui'

// Виды статистики RUVDS: /v2/stat/{kind}/{gran}/{server_id}
const KINDS = [
  { key: 'cpu',     label: 'CPU',   Icon: Cpu,      series: [{ f: 'cpu_usage',    name: 'Загрузка CPU', unit: '%',    color: '#3987e5' }] },
  { key: 'drive',   label: 'Диск',  Icon: HardDrive, series: [
      { f: 'read_iops',  name: 'Чтение',  unit: ' IOPS', color: '#199e70' },
      { f: 'write_iops', name: 'Запись',  unit: ' IOPS', color: '#c98500' }] },
  { key: 'network', label: 'Сеть',  Icon: Network,  series: [
      { f: 'inbound_pps',  name: 'Входящий',  unit: ' pps', color: '#9085e9' },
      { f: 'outbound_pps', name: 'Исходящий', unit: ' pps', color: '#d95926' }] },
]
const GRANS = [{ key: 'hourly', label: 'По часам' }, { key: 'daily', label: 'По дням (14)' }]

export default function RuvdsStats() {
  const { account, api } = useRuvds()
  const [servers, setServers] = useState([])
  const [serverId, setServerId] = useState(null)
  const [kind, setKind] = useState('cpu')
  const [gran, setGran] = useState('hourly')
  const [state, setState] = useState({ loading: false, points: null, error: null })

  // Список серверов для селектора
  useEffect(() => {
    if (!account) return
    let cancelled = false
    api('/servers?per_page=100')
      .then(d => {
        if (cancelled) return
        const list = d.servers || []
        setServers(list)
        setServerId(prev => (prev && list.some(s => s.virtual_server_id === prev)) ? prev : (list[0]?.virtual_server_id ?? null))
      })
      .catch(() => { if (!cancelled) setServers([]) })
    return () => { cancelled = true }
  }, [account, api])

  // Загрузка выбранной статистики
  useEffect(() => {
    if (!serverId) return
    let cancelled = false
    setState({ loading: true, points: null, error: null })
    api(`/stat/${kind}/${gran}/${serverId}`)
      .then(d => {
        if (cancelled) return
        // Ответ: { cpu_stat: [...] } | { drive_stat: [...] } | { network_stat: [...] }
        const arr = d[`${kind}_stat`] || d.stat || (Array.isArray(d) ? d : [])
        setState({ loading: false, points: Array.isArray(arr) ? arr : [], error: null })
      })
      .catch(e => { if (!cancelled) setState({ loading: false, points: null, error: e.message }) })
    return () => { cancelled = true }
  }, [serverId, kind, gran, api])

  if (!account) return null
  const meta = KINDS.find(k => k.key === kind)

  return (
    <div className="space-y-4">
      <Panel
        title="Статистика сервера"
        Icon={BarChart3}
        accent="text-violet-400"
        ring="bg-violet-500/10"
        actions={<IconBtn onClick={() => setServerId(v => v)} title="Обновить" spinning={state.loading}><RefreshCw className="w-4 h-4" /></IconBtn>}
      >
        {/* Фильтры: сервер + вид + гранулярность (в одну строку на десктопе, стопкой на мобилке) */}
        <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
          <div className="relative flex-1 min-w-0">
            <Server className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select value={serverId || ''} onChange={e => setServerId(Number(e.target.value))}
              className="w-full pl-8 pr-2 py-2 text-xs bg-slate-950/60 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none appearance-none">
              {servers.length === 0 && <option value="">Нет серверов</option>}
              {servers.map(s => (
                <option key={s.virtual_server_id} value={s.virtual_server_id}>
                  {s.user_comment || `Сервер #${s.virtual_server_id}`}{s.ip ? ` · ${s.ip}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5 overflow-x-auto thin-scroll">
            {KINDS.map(k => (
              <button key={k.key} onClick={() => setKind(k.key)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 border whitespace-nowrap ${
                  kind === k.key ? 'bg-violet-500/15 border-violet-500/40 text-violet-200' : 'bg-slate-900/40 border-slate-800/60 text-slate-400 hover:text-white'}`}>
                <k.Icon className="w-3.5 h-3.5" /> {k.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {GRANS.map(g => (
              <button key={g.key} onClick={() => setGran(g.key)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ${
                  gran === g.key ? 'bg-slate-700/60 border-slate-600 text-white' : 'bg-slate-900/40 border-slate-800/60 text-slate-400 hover:text-white'}`}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <ErrorBox error={state.error} />
        {!serverId ? <Empty icon={Server} title="Нет серверов" hint="Статистика доступна для существующих виртуальных серверов." />
          : state.loading ? <Loading text="Загрузка статистики…" />
          : !state.points || state.points.length === 0 ? <Empty icon={BarChart3} title="Нет данных за период" />
          : (
            <div className="space-y-5">
              {meta.series.map(s => (
                <Chart key={s.f} points={state.points} field={s.f} name={s.name} unit={s.unit} color={s.color} />
              ))}
            </div>
          )}
      </Panel>
    </div>
  )
}

/**
 * Линейный график с областью. Ось X — время (add_dt), Y — значение поля.
 * Ховер показывает точное значение — без него график только «красивая линия».
 */
function Chart({ points, field, name, unit, color }) {
  const [hover, setHover] = useState(null)
  const vals = points.map(p => Number(p[field]) || 0)
  if (vals.length === 0) return null

  const max = Math.max(...vals, 0.0001)
  const min = Math.min(...vals, 0)
  const span = (max - min) || 1
  const W = 600, H = 120, PAD = 4

  const xy = i => [
    (i / Math.max(1, vals.length - 1)) * (W - PAD * 2) + PAD,
    H - PAD - ((vals[i] - min) / span) * (H - PAD * 2),
  ]
  const line = vals.map((_, i) => { const [x, y] = xy(i); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}` }).join(' ')
  const [lx] = xy(vals.length - 1); const [fx] = xy(0)
  const area = `${line} L${lx.toFixed(1)} ${H} L${fx.toFixed(1)} ${H} Z`
  const gid = React.useId()

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const fmt = v => `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${unit}`
  const timeOf = i => {
    const t = points[i]?.add_dt
    if (!t) return ''
    const d = new Date(t)
    return isNaN(d) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
        <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} /> {name}
        </span>
        <span className="text-[11px] text-slate-500">
          макс <b className="text-slate-300 font-mono">{fmt(max)}</b> · среднее <b className="text-slate-300 font-mono">{fmt(avg)}</b>
        </span>
      </div>
      <div className="relative rounded-xl border border-slate-800/60 bg-slate-950/40 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-28 block"
          onMouseLeave={() => setHover(null)}
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect()
            const rel = (e.clientX - r.left) / r.width
            setHover(Math.min(vals.length - 1, Math.max(0, Math.round(rel * (vals.length - 1)))))
          }}>
          <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient></defs>
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover != null && (() => { const [x, y] = xy(hover); return (
            <g>
              <line x1={x} y1={0} x2={x} y2={H} stroke="#475569" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <circle cx={x} cy={y} r="4" fill={color} stroke="#020617" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </g>
          ) })()}
        </svg>
        {hover != null && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-slate-900/95 border border-slate-700 text-[11px] pointer-events-none">
            <div className="font-mono text-white">{fmt(vals[hover])}</div>
            <div className="text-slate-500">{timeOf(hover)}</div>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-slate-600 mt-1">
        <span>{timeOf(0)}</span>
        <span>{fmtNum(points.length)} точек</span>
        <span>{timeOf(points.length - 1)}</span>
      </div>
    </div>
  )
}
