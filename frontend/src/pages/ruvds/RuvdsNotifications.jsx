import React, { useState } from 'react'
import { Bell, BellOff, RefreshCw, CheckCheck, Server, Circle } from 'lucide-react'
import { useRuvds, useRuvdsData } from './context'
import { Panel, Loading, ErrorBox, Empty, DataList, IconBtn, Pager, fmtDT, card } from './ui'

// Статусы уведомлений RUVDS
const FILTERS = [
  { key: '',        label: 'Все' },
  { key: 'new',     label: 'Новые' },
  { key: 'read',    label: 'Прочитанные' },
]

export default function RuvdsNotifications() {
  const { account, canWrite, api } = useRuvds()
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const per = 25

  const { data, loading, error, reload } = useRuvdsData(
    `/notifications?per_page=${per}&page=${page + 1}${status ? `&status=${status}` : ''}`,
    { deps: [page, status] }
  )

  if (!account) return null
  const items = data?.notifications || []
  const total = data?.pagination?.total ?? data?.pagination?.total_count

  async function markOne(id) {
    setBusy(true)
    try { await api(`/notifications/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'read' }) }); reload() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }
  async function markAll() {
    if (!confirm('Пометить все уведомления как прочитанные?')) return
    setBusy(true)
    try { await api('/notifications-all', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'read' }) }); reload() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  const isNew = n => String(n.status || '').toLowerCase() === 'new'

  // notification_data — произвольный объект; вытаскиваем человекочитаемое.
  const textOf = n => {
    const d = n.notification_data
    if (!d) return n.type || 'Уведомление'
    if (typeof d === 'string') return d
    return d.message || d.text || d.title || n.type || JSON.stringify(d).slice(0, 120)
  }

  const cols = [
    { key: 'text', h: 'Уведомление', mobile: 'title', render: n => (
      <span className="flex items-start gap-2 min-w-0">
        {isNew(n) && <Circle className="w-2 h-2 fill-cyan-400 text-cyan-400 shrink-0 mt-1.5" />}
        <span className={`truncate ${isNew(n) ? 'text-white font-medium' : 'text-slate-300'}`}>{textOf(n)}</span>
      </span>
    ) },
    { key: 'type', h: 'Тип', mobile: 'sub', render: n => <span className="text-slate-400 text-[11px]">{n.type || '—'}</span> },
    { key: 'srv', h: 'Сервер', render: n => n.virtual_server_id
      ? <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1"><Server className="w-3 h-3" /> {n.virtual_server_id}</span>
      : <span className="text-slate-600">—</span> },
    { key: 'dt', h: 'Дата', render: n => <span className="text-slate-500 whitespace-nowrap">{fmtDT(n.add_dt)}</span> },
  ]

  const actions = n => (canWrite && isNew(n)) ? (
    <IconBtn onClick={e => { e?.stopPropagation?.(); markOne(n.notification_id) }} title="Пометить прочитанным"
      className="!p-1.5 hover:!text-emerald-300" disabled={busy}><CheckCheck className="w-3.5 h-3.5" /></IconBtn>
  ) : null

  const newCount = items.filter(isNew).length

  return (
    <div className="space-y-4">
      <Panel
        title="Уведомления"
        Icon={Bell}
        accent="text-amber-400"
        ring="bg-amber-500/10"
        actions={
          <>
            {canWrite && newCount > 0 && (
              <button onClick={markAll} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-800/60 border border-slate-700/50 text-slate-200 rounded-lg flex items-center gap-1.5 hover:text-white disabled:opacity-50">
                <CheckCheck className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Прочитать все</span>
              </button>
            )}
            <IconBtn onClick={reload} title="Обновить" spinning={loading}><RefreshCw className="w-4 h-4" /></IconBtn>
          </>
        }
      >
        {/* Фильтр по статусу */}
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto thin-scroll">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => { setStatus(f.key); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap ${
                status === f.key ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'bg-slate-900/40 border-slate-800/60 text-slate-400 hover:text-white'}`}>
              {f.label}
            </button>
          ))}
          {newCount > 0 && (
            <span className="ml-auto text-[11px] text-cyan-400 whitespace-nowrap shrink-0">новых на странице: {newCount}</span>
          )}
        </div>

        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading />
          : items.length === 0 ? <Empty icon={BellOff} title="Уведомлений нет" hint={status ? 'Попробуйте другой фильтр.' : 'RUVDS пока не присылал уведомлений по этому аккаунту.'} />
          : (
            <>
              <DataList cols={cols} rows={items} keyOf={n => n.notification_id} actions={actions} />
              <Pager page={page} hasMore={items.length >= per} onPage={setPage} loading={loading} total={total} />
            </>
          )}
      </Panel>
    </div>
  )
}
