import React, { useState } from 'react'
import {
  Server, RefreshCw, Search, Cpu, MemoryStick, HardDrive, Shield, Globe,
  Play, Square, RotateCcw, X, Calendar, Monitor,
} from 'lucide-react'
import { useRuvds, useRuvdsData } from './context'
import {
  Panel, Loading, ErrorBox, Empty, DataList, Badge, CopyText, IconBtn, Pager,
  fmtNum, fmtDate, daysLeft, card,
} from './ui'

export default function RuvdsServers() {
  const { account, canWrite, api } = useRuvds()
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(null)

  const per = 25
  const { data, loading, error, reload } = useRuvdsData(
    `/servers?per_page=${per}&page=${page + 1}${q ? `&search=${encodeURIComponent(q)}` : ''}`,
    { deps: [page, q] }
  )

  const servers = data?.servers || []
  const total = data?.pagination?.total ?? data?.pagination?.total_count
  const hasMore = servers.length >= per

  // Отправка команды серверу (start/stop/restart) — нужны права write.
  async function sendCommand(sid, command) {
    setBusy(`${sid}:${command}`)
    try {
      await api(`/servers/${sid}/actions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      setTimeout(reload, 1200) // команда асинхронная — даём применить
    } catch (e) { alert(e.message) }
    finally { setBusy(null) }
  }

  const cols = [
    { key: 'name', h: 'Сервер', mobile: 'title', render: s => (
      <div className="min-w-0">
        <div className="text-slate-100 font-medium truncate">{s.user_comment || `Сервер #${s.virtual_server_id}`}</div>
        <div className="text-[10px] text-slate-500 font-mono">ID {s.virtual_server_id}</div>
      </div>
    ) },
    { key: 'status', h: 'Статус', mobile: 'sub', render: s => (
      <span className="flex items-center gap-1.5">
        <Badge v={s.status} />
        {s.status === 'initializing' && s.create_progress != null && (
          <span className="text-[10px] text-cyan-400">{s.create_progress}%</span>
        )}
      </span>
    ) },
    { key: 'ip', h: 'IP', render: s => s.ip
      ? <CopyText value={s.ip} className="text-slate-300 text-xs" />
      : <span className="text-slate-600">—</span> },
    { key: 'cfg', h: 'Конфигурация', render: s => (
      <span className="text-slate-300 whitespace-nowrap">{s.cpu ?? '?'} vCPU · {s.ram ?? '?'} MB · {s.drive ?? '?'} GB</span>
    ) },
    { key: 'dc', h: 'ДЦ', render: s => <span className="text-slate-400">{s.datacenter?.name || s.datacenter || '—'}</span> },
    { key: 'paid', h: 'Оплачен до', render: s => {
      const dl = daysLeft(s.paid_till)
      return (
        <div className="whitespace-nowrap">
          <div className="text-slate-400">{fmtDate(s.paid_till)}</div>
          {dl != null && (
            <div className={`text-[10px] ${dl < 0 ? 'text-rose-400' : dl <= 3 ? 'text-rose-400' : dl <= 7 ? 'text-amber-400' : 'text-slate-500'}`}>
              {dl < 0 ? `просрочен ${-dl} дн.` : `осталось ${dl} дн.`}
            </div>
          )}
        </div>
      )
    } },
  ]

  const rowActions = s => canWrite ? (
    <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <IconBtn onClick={() => sendCommand(s.virtual_server_id, 'start')} title="Запустить"
        spinning={busy === `${s.virtual_server_id}:start`} className="!p-1.5 hover:!text-emerald-300"><Play className="w-3.5 h-3.5" /></IconBtn>
      <IconBtn onClick={() => sendCommand(s.virtual_server_id, 'restart')} title="Перезагрузить"
        spinning={busy === `${s.virtual_server_id}:restart`} className="!p-1.5 hover:!text-amber-300"><RotateCcw className="w-3.5 h-3.5" /></IconBtn>
      <IconBtn onClick={() => sendCommand(s.virtual_server_id, 'stop')} title="Остановить"
        spinning={busy === `${s.virtual_server_id}:stop`} className="!p-1.5 hover:!text-rose-300"><Square className="w-3.5 h-3.5" /></IconBtn>
    </span>
  ) : null

  if (!account) return null

  return (
    <div className="space-y-4">
      {/* Сводка */}
      {servers.length > 0 && <SummaryTiles servers={servers} />}

      <Panel
        title="Виртуальные серверы"
        Icon={Server}
        accent="text-orange-400"
        ring="bg-orange-500/10"
        actions={
          <>
            <form onSubmit={e => { e.preventDefault(); setPage(0); setQ(search.trim()) }} className="relative hidden sm:block">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="поиск…" autoComplete="off"
                className="pl-8 pr-2 py-1.5 w-36 lg:w-48 text-xs bg-slate-950/60 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:outline-none" />
            </form>
            <IconBtn onClick={reload} title="Обновить" spinning={loading}><RefreshCw className="w-4 h-4" /></IconBtn>
          </>
        }
      >
        {/* Поиск на мобилке — отдельной строкой */}
        <form onSubmit={e => { e.preventDefault(); setPage(0); setQ(search.trim()) }} className="relative sm:hidden mb-3">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск сервера…" autoComplete="off"
            className="pl-8 pr-2 py-2 w-full text-xs bg-slate-950/60 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:outline-none" />
        </form>

        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading text="Загрузка серверов…" />
          : servers.length === 0 ? <Empty icon={Server} title="Серверов нет" hint={q ? 'Ничего не найдено по запросу.' : 'В этом аккаунте RUVDS пока нет виртуальных серверов.'} />
          : (
            <>
              <DataList cols={cols} rows={servers} keyOf={s => s.virtual_server_id}
                onRowClick={s => setDetail(s)} actions={rowActions} />
              <Pager page={page} hasMore={hasMore} onPage={setPage} loading={loading} total={total} />
            </>
          )}
      </Panel>

      {detail && <ServerDetail server={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

// Плитки-сводка по загруженной странице серверов
function SummaryTiles({ servers }) {
  const active = servers.filter(s => s.status === 'active').length
  const problem = servers.filter(s => ['notpaid', 'blocked'].includes(s.status)).length
  const cpu = servers.reduce((n, s) => n + (Number(s.cpu) || 0), 0)
  const ram = servers.reduce((n, s) => n + (Number(s.ram) || 0), 0)
  const expiring = servers.filter(s => { const d = daysLeft(s.paid_till); return d != null && d >= 0 && d <= 7 }).length

  const tiles = [
    { label: 'Серверов', v: fmtNum(servers.length), Icon: Server, cls: 'text-orange-400 bg-orange-500/10' },
    { label: 'Активных', v: fmtNum(active), Icon: Shield, cls: 'text-emerald-400 bg-emerald-500/10', sub: problem > 0 ? `${problem} с проблемой` : null },
    { label: 'Ядер / RAM', v: `${cpu} / ${(ram / 1024).toFixed(0)} GB`, Icon: Cpu, cls: 'text-sky-400 bg-sky-500/10' },
    { label: 'Истекают ≤7 дн.', v: fmtNum(expiring), Icon: Calendar, cls: expiring > 0 ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 bg-slate-500/10' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map(t => (
        <div key={t.label} className={`${card} p-3.5`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400 truncate">{t.label}</div>
              <div className="text-xl font-bold text-white font-mono leading-tight mt-1 truncate">{t.v}</div>
              {t.sub && <div className="text-[10px] text-amber-400 mt-0.5">{t.sub}</div>}
            </div>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${t.cls}`}><t.Icon className="w-4 h-4" /></div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Детали сервера: сеть, питание, стоимость — подгружаются по клику
function ServerDetail({ server: s, onClose }) {
  const { api } = useRuvds()
  const [extra, setExtra] = useState({ loading: true })

  React.useEffect(() => {
    let cancelled = false
    const id = s.virtual_server_id
    Promise.allSettled([api(`/servers/${id}/networks`), api(`/servers/${id}/power`), api(`/servers/${id}/cost`)])
      .then(([net, pow, cost]) => {
        if (cancelled) return
        setExtra({
          loading: false,
          networks: net.status === 'fulfilled' ? net.value : null,
          power: pow.status === 'fulfilled' ? pow.value : null,
          cost: cost.status === 'fulfilled' ? cost.value : null,
        })
      })
    return () => { cancelled = true }
  }, [s, api])

  const rows = [
    { l: 'Статус', v: <Badge v={s.status} /> },
    { l: 'ID', v: <CopyText value={s.virtual_server_id} className="text-slate-200" /> },
    { l: 'IP', v: s.ip ? <CopyText value={s.ip} className="text-slate-200" /> : '—' },
    { l: 'Дата-центр', v: s.datacenter?.name || s.datacenter || '—' },
    { l: 'CPU', v: `${s.cpu ?? '—'} vCPU` },
    { l: 'RAM', v: s.ram ? `${s.ram} MB` : '—' },
    { l: 'Диск', v: s.drive ? `${s.drive} GB` : '—' },
    { l: 'Доп. диск', v: s.additional_drive ? `${s.additional_drive} GB` : '—' },
    { l: 'DDoS-защита', v: s.ddos_protection ? 'включена' : 'нет' },
    { l: 'Оплачен до', v: fmtDate(s.paid_till) },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[88vh] sm:max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center shrink-0"><Server className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-white truncate">{s.user_comment || `Сервер #${s.virtual_server_id}`}</div>
            <div className="text-[11px] text-slate-500">{s.ip || 'без IP'}</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 overflow-y-auto thin-scroll space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {rows.map(r => (
              <div key={r.l} className="flex justify-between gap-2 py-1 border-b border-slate-800/40">
                <span className="text-slate-500 shrink-0">{r.l}</span>
                <span className="text-slate-200 text-right min-w-0 truncate">{r.v}</span>
              </div>
            ))}
          </div>

          {extra.loading ? <Loading text="Загрузка деталей…" /> : (
            <>
              {extra.power && (
                <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-xs">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Monitor className="w-3.5 h-3.5" /> Питание</div>
                  <Badge v={extra.power.power_state ?? extra.power.state ?? JSON.stringify(extra.power)} />
                </div>
              )}
              {extra.networks && (
                <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Сеть</div>
                  <pre className="text-[11px] text-slate-300 font-mono overflow-x-auto thin-scroll">{JSON.stringify(extra.networks.networks ?? extra.networks, null, 2)}</pre>
                </div>
              )}
              {extra.cost && (
                <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5" /> Стоимость продления</div>
                  <pre className="text-[11px] text-slate-300 font-mono overflow-x-auto thin-scroll">{JSON.stringify(extra.cost, null, 2)}</pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
