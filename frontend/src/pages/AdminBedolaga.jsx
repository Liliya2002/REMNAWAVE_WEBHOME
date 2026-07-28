import React, { useEffect, useState } from 'react'
import {
  Bot, Plus, RefreshCw, Trash2, Pencil, X, CheckCircle2, AlertCircle,
  Eye, EyeOff, Wifi, ChevronDown, ChevronRight, ChevronLeft,
  Users, Ticket, CreditCard, LifeBuoy, Search, Braces, Wallet, TrendingUp, Clock,
  Layers, CalendarClock, Send, AlertTriangle,
  User, Gift, Copy, Link2, Mail, Globe,
} from 'lucide-react'
import { useParams } from 'react-router-dom'
import { authFetch } from '../services/api'

// ─── Bedolaga Bot: мониторинг Web Admin API (read-only) ────────────────────────
// Активная секция (пользователи/подписки/транзакции/тикеты) выбирается пунктом
// левого меню — приходит через маршрут /admin/bedolaga/:section.

const EMPTY_FORM = { name: '', base_url: '', api_token: '', notes: '' }
const LIMIT = 25
const SECTION_META = {
  users:         { label: 'Пользователи', Icon: Users },
  subscriptions: { label: 'Подписки',     Icon: Ticket },
  transactions:  { label: 'Транзакции',   Icon: CreditCard },
  tickets:       { label: 'Тикеты',       Icon: LifeBuoy },
}
const SECTIONS = Object.keys(SECTION_META)

const API = '/api/admin/bedolaga'

// Достать массив из ответа неизвестной формы + total.
function asList(d) {
  if (Array.isArray(d)) return { items: d, total: d.length }
  if (!d || typeof d !== 'object') return { items: [], total: 0 }
  const arr = d.items || d.users || d.subscriptions || d.transactions || d.tickets || d.results || d.data || []
  const items = Array.isArray(arr) ? arr : []
  const total = d.total ?? d.count ?? d.total_count ?? items.length
  return { items, total }
}
// Первое определённое ПРИМИТИВНОЕ поле из списка ключей (поддержка dot-path).
// Объекты/массивы игнорируются — чтобы случайно не отрендерить объект в JSX.
function pick(obj, keys, fallback = undefined) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), obj)
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') return v
  }
  return fallback
}
const fmtNum = n => (n == null || n === '' || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('ru-RU')
const fmtDate = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString('ru-RU') }
const fmtDT = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }

export default function AdminBedolaga() {
  const { section: sectionParam } = useParams()
  const section = SECTIONS.includes(sectionParam) ? sectionParam : 'users'
  const meta = SECTION_META[section]
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null)         // { editId, form } | null
  const [saving, setSaving] = useState(false)
  const [showSecret, setShowSecret] = useState({})
  const [data, setData] = useState({})             // { [id]: {...} }
  const [confirmDel, setConfirmDel] = useState(null)
  const [collapsed, setCollapsed] = useState({})   // { [id]: bool }
  const [notify, setNotify] = useState(null)        // { accountId, expiring } | null — модалка рассылки
  const [userCard, setUserCard] = useState(null)    // { accountId, userId } | null
  const [uc, setUc] = useState({})                  // { loading, user, transactions, squads, err, txErr }

  const setD = (id, patch) => setData(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))
  const setTab = (id, tab, patch) => setData(prev => {
    const cur = prev[id] || {}
    const t = cur.t || {}
    return { ...prev, [id]: { ...cur, t: { ...t, [tab]: { ...(t[tab] || {}), ...patch } } } }
  })

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await authFetch(`${API}/accounts`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки')
      setAccounts(d.accounts || [])
      ;(d.accounts || []).forEach(autoLoad)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  // При входе — тест связи + overview + выручка (плитки/спарклайн видны на всех секциях).
  function autoLoad(a) {
    test(a.id)
    loadOverview(a.id)
    loadRevenue(a.id)
  }
  useEffect(() => { load() }, [])

  // Ленивая загрузка данных активной секции при её открытии / появлении аккаунтов.
  useEffect(() => {
    accounts.forEach(a => {
      if (!data[a.id]?.t?.[section]?.items) loadTab(a.id, section, 0)
      if (section === 'transactions' && !data[a.id]?.revenue) loadRevenue(a.id)
      if (section === 'subscriptions' && !data[a.id]?.substats) loadSubStats(a.id)
    })
  }, [section, accounts]) // eslint-disable-line

  // Отправка рассылки (реальное действие) — после подтверждения в модалке.
  async function sendBroadcast(id, target, message_text) {
    const r = await authFetch(`${API}/accounts/${id}/broadcast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, message_text }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || 'Ошибка отправки')
    return d.broadcast
  }
  // Открыть детальную карточку пользователя (профиль + подписки + платежи).
  async function openUserCard(accountId, userId) {
    setUserCard({ accountId, userId })
    setUc({ loading: true })
    try {
      const r = await authFetch(`${API}/accounts/${accountId}/users/${userId}/full`)
      const d = await r.json()
      if (!r.ok) setUc({ loading: false, err: d.error })
      else setUc({ loading: false, user: d.user, transactions: d.transactions || [], squads: d.squads || {}, txErr: d.tx_error })
    } catch (e) { setUc({ loading: false, err: e.message }) }
  }

  // Опрос статуса рассылки (счётчики заполняются асинхронно на стороне бота).
  async function pollBroadcast(id, bid) {
    const r = await authFetch(`${API}/accounts/${id}/broadcasts/${bid}`)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || 'Ошибка опроса')
    return d.broadcast
  }

  async function save() {
    setSaving(true)
    try {
      const editId = modal.editId
      const body = { ...modal.form }
      if (editId && !body.api_token) delete body.api_token   // не затирать токен пустым
      const r = await authFetch(`${API}/accounts${editId ? '/' + editId : ''}`, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка сохранения')
      setModal(null); load()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  async function del(id) {
    const r = await authFetch(`${API}/accounts/${id}`, { method: 'DELETE' })
    if (r.ok) { setConfirmDel(null); load() } else { const d = await r.json().catch(() => ({})); alert(d.error || 'Ошибка удаления') }
  }

  async function test(id) {
    setD(id, { test: { loading: true } })
    try {
      const r = await authFetch(`${API}/accounts/${id}/test`, { method: 'POST' })
      const d = await r.json()
      setD(id, { test: { loading: false, ...d } })
    } catch (e) { setD(id, { test: { loading: false, ok: false, error: e.message } }) }
  }

  async function loadOverview(id) {
    setD(id, { lov: true, ovErr: null })
    try {
      const r = await authFetch(`${API}/accounts/${id}/overview`)
      const d = await r.json()
      if (!r.ok) setD(id, { lov: false, overview: null, ovErr: d.error })
      else setD(id, { lov: false, overview: d, ovErr: null })
    } catch (e) { setD(id, { lov: false, ovErr: e.message }) }
  }

  async function loadRevenue(id, force) {
    setD(id, { lrev: true })
    try {
      const r = await authFetch(`${API}/accounts/${id}/revenue${force ? '?force=1' : ''}`)
      const d = await r.json()
      if (!r.ok) setD(id, { lrev: false, revErr: d.error })
      else setD(id, { lrev: false, revenue: d.revenue, revErr: null })
    } catch (e) { setD(id, { lrev: false, revErr: e.message }) }
  }

  async function loadSubStats(id, force) {
    setD(id, { lss: true })
    try {
      const r = await authFetch(`${API}/accounts/${id}/subscription-stats${force ? '?force=1' : ''}`)
      const d = await r.json()
      if (!r.ok) setD(id, { lss: false, ssErr: d.error })
      else setD(id, { lss: false, substats: d.stats, ssErr: null })
    } catch (e) { setD(id, { lss: false, ssErr: e.message }) }
  }

  async function loadTab(id, tab, offset = 0, search) {
    const q = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
    if (tab === 'users' && search) q.set('search', search)
    setTab(id, tab, { loading: true, err: null, offset })
    try {
      const r = await authFetch(`${API}/accounts/${id}/${tab}?${q}`)
      const d = await r.json()
      if (!r.ok) setTab(id, tab, { loading: false, items: null, err: d.error })
      else { const { items, total } = asList(d); setTab(id, tab, { loading: false, items, total, err: null }) }
    } catch (e) { setTab(id, tab, { loading: false, err: e.message }) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
          <meta.Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Bedolaga Bot · {meta.label}</h1>
          <p className="text-xs text-slate-400">Мониторинг Telegram-бота продаж (Web Admin API)</p>
        </div>
        <button onClick={load} className="px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/60 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Обновить
        </button>
        <button onClick={() => setModal({ editId: null, form: { ...EMPTY_FORM } })}
          className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white rounded-lg flex items-center gap-1.5 hover:shadow-lg hover:shadow-violet-500/30">
          <Plus className="w-4 h-4" /> Аккаунт
        </button>
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Загрузка…</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30">
          <Bot className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">Подключений к боту Bedolaga пока нет</p>
          <p className="text-xs text-slate-500 mt-1">Добавьте аккаунт: Base URL (напр. http://host:8080) и токен Web API бота</p>
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map(a => {
            const d = data[a.id] || {}
            const col = !!collapsed[a.id]
            return (
              <div key={a.id} className="rounded-2xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
                {/* header */}
                <div className={`flex items-center gap-3 px-4 py-3 ${col ? '' : 'border-b border-slate-800/60'}`}>
                  <button onClick={() => setCollapsed(p => ({ ...p, [a.id]: !p[a.id] }))} className="text-slate-400 hover:text-white shrink-0" title={col ? 'Развернуть' : 'Свернуть'}>
                    {col ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <Bot className="w-4 h-4 text-violet-300 shrink-0" />
                  <button onClick={() => setCollapsed(p => ({ ...p, [a.id]: !p[a.id] }))} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white truncate">{a.name}</span>
                      <HealthBadge test={d.test} />
                      {!a.is_active && <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/60 text-slate-400">выкл</span>}
                    </div>
                    {a.notes ? <div className="text-xs text-slate-500 truncate">{a.notes}</div>
                      : <div className="text-[11px] text-slate-600 font-mono truncate" title={a.base_url}>{a.base_url?.replace(/^https?:\/\//, '')}</div>}
                  </button>
                  <button onClick={() => test(a.id)} className="px-3 py-1.5 text-xs rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white flex items-center gap-1.5">
                    {d.test?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} Тест
                  </button>
                  <button onClick={() => setModal({ editId: a.id, form: { ...EMPTY_FORM, name: a.name, base_url: a.base_url, notes: a.notes || '', api_token: '' } })}
                    className="p-2 rounded-lg text-slate-400 hover:text-violet-300 hover:bg-slate-800/60"><Pencil className="w-4 h-4" /></button>
                  {confirmDel === a.id ? (
                    <span className="flex items-center gap-1">
                      <button onClick={() => del(a.id)} className="px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-500/50 text-[11px] font-bold text-rose-300">Да</button>
                      <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300">Нет</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDel(a.id)} className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>

                {!col && (<>
                  {/* overview tiles — постоянная KPI-шапка на всех секциях */}
                  <div className="p-4">
                    {d.ovErr ? (
                      <div className="text-xs text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {d.ovErr}</div>
                    ) : (
                      <OverviewTiles ov={d.overview} loading={d.lov} rev={d.revenue} />
                    )}
                  </div>

                  {/* активная секция */}
                  <div className="px-4 pb-4">
                    <div className="rounded-xl border border-slate-800/60 bg-slate-950/30 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/60">
                        <meta.Icon className="w-4 h-4 text-violet-300 shrink-0" />
                        <span className="text-sm font-semibold text-slate-200">{meta.label}</span>
                        <div className="ml-auto flex items-center gap-2">
                          {section === 'users' && (
                            <SearchBox onSearch={s => loadTab(a.id, 'users', 0, s)} />
                          )}
                          <button onClick={() => loadTab(a.id, section, d.t?.[section]?.offset || 0)} title="Обновить"
                            className="p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white">
                            <RefreshCw className={`w-3.5 h-3.5 ${d.t?.[section]?.loading ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </div>
                      {section === 'transactions' && (
                        <RevenueStrip rev={d.revenue} loading={d.lrev} err={d.revErr} onRefresh={() => loadRevenue(a.id, true)} />
                      )}
                      {section === 'subscriptions' && (
                        <SubStatsBlocks stats={d.substats} loading={d.lss} err={d.ssErr}
                          onRefresh={() => loadSubStats(a.id, true)}
                          onNotify={() => setNotify({ accountId: a.id, expiring: d.substats?.expiring })} />
                      )}
                      <div className="p-3">
                        <TabTable tab={section} state={d.t?.[section]}
                          onPage={off => loadTab(a.id, section, off)}
                          onRowClick={
                            section === 'users' ? (it) => openUserCard(a.id, it.id)
                            : section === 'subscriptions' ? (it) => openUserCard(a.id, it.user_id)
                            : undefined
                          } />
                      </div>
                    </div>
                  </div>
                </>)}
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <AccountModal modal={modal} setModal={setModal} save={save} saving={saving}
          showSecret={showSecret} setShowSecret={setShowSecret} />
      )}

      {notify && (
        <NotifyModal notify={notify} onClose={() => setNotify(null)}
          onSend={(target, text) => sendBroadcast(notify.accountId, target, text)}
          onPoll={(bid) => pollBroadcast(notify.accountId, bid)}
          onSent={() => { loadSubStats(notify.accountId, true) }} />
      )}

      {userCard && (
        <UserCard uc={uc} onClose={() => { setUserCard(null); setUc({}) }} />
      )}
    </div>
  )
}

// ─── Health-бейдж (онлайн/оффлайн + версия) ───────────────────────────────────
function HealthBadge({ test }) {
  if (!test || test.loading) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/50 text-slate-400">проверка…</span>
  if (!test.ok) return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400" title={test.error}>оффлайн</span>
  const ver = pick(test.health, ['version', 'bot_version', 'app_version'])
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
      🟢 онлайн{ver ? ` v${ver}` : ''}
    </span>
  )
}

// ─── Плитки overview ──────────────────────────────────────────────────────────
function OverviewTiles({ ov, loading, rev }) {
  const [raw, setRaw] = useState(false)
  if (loading && !ov) return <div className="text-xs text-slate-500 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Загрузка сводки…</div>
  if (!ov) return <div className="text-xs text-slate-500">Нет данных сводки</div>

  const openTickets = pick(ov, ['support.open_tickets', 'tickets.open', 'open_tickets'])
  const tiles = [
    { label: 'Пользователи', Icon: Users, ring: 'bg-emerald-500/10 text-emerald-400',
      main: fmtNum(pick(ov, ['users.total', 'total_users'])),
      sub:  subLine(pick(ov, ['users.active', 'active_users']), 'активных', pick(ov, ['users.blocked']), 'заблок.') },
    { label: 'Активные подписки', Icon: Ticket, ring: 'bg-sky-500/10 text-sky-400',
      main: fmtNum(pick(ov, ['subscriptions.active', 'active_subscriptions'])),
      sub:  subLine(pick(ov, ['subscriptions.expired']), 'истекло', pick(ov, ['subscriptions.trial']), 'триал') },
    { label: 'Выручка за сегодня', Icon: Wallet, ring: 'bg-amber-500/10 text-amber-400',
      main: money(pick(ov, ['payments.today_rubles', 'payments.total_rubles', 'payments.total'])),
      spark: rev?.series, sparkColor: '#f59e0b',
      sub:  subLine(pick(ov, ['users.balance_rubles']), '₽ на балансах', null, null) },
    { label: 'Открытые тикеты', Icon: LifeBuoy, ring: 'bg-rose-500/10 text-rose-400',
      main: fmtNum(openTickets),
      priority: pick(ov, ['support.priority', 'tickets.priority', 'support.high_priority']) },
  ]
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-2xl border border-slate-800/70 bg-slate-900/50 p-4 flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400 truncate">{t.label}</div>
                <div className="text-2xl font-bold text-white font-mono leading-tight mt-1">{t.main ?? '—'}</div>
              </div>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${t.ring}`}><t.Icon className="w-4 h-4" /></div>
            </div>
            <div className="mt-2 h-[30px] flex items-end">
              {t.spark && t.spark.length > 1
                ? <Sparkline data={t.spark} color={t.sparkColor} />
                : t.sub ? <div className="text-[11px] text-slate-500 pb-1">{t.sub}</div>
                : t.priority != null && Number(t.priority) > 0 ? <div className="text-[11px] text-rose-400 pb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {fmtNum(t.priority)} срочных</div>
                : t.label === 'Открытые тикеты' ? <div className="text-[11px] text-slate-500 pb-1">приоритетных: 0</div>
                : null}
            </div>
            {t.spark && t.sub && <div className="text-[11px] text-slate-500 mt-0.5">{t.sub}</div>}
          </div>
        ))}
      </div>
      <button onClick={() => setRaw(v => !v)} className="mt-2 text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1">
        <Braces className="w-3 h-3" /> {raw ? 'скрыть' : 'показать'} сырой ответ
      </button>
      {raw && <pre className="mt-1 text-[11px] text-slate-400 font-mono bg-slate-950/60 rounded-lg p-2 overflow-auto max-h-52 thin-scroll">{JSON.stringify(ov, null, 2)}</pre>}
    </div>
  )
}
function subLine(a, aL, b, bL) {
  const parts = []
  if (a != null && a !== '') parts.push(`${fmtNum(a)} ${aL}`)
  if (b != null && b !== '') parts.push(`${fmtNum(b)} ${bL}`)
  return parts.join(' · ') || null
}
function money(v) {
  if (v == null || v === '' || typeof v === 'object' || isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}
// ГБ с округлением до 2 знаков без хвостовых нулей (0.019180… → 0.02, 15 → 15)
const fmtGB = v => { const n = Number(v); if (!isFinite(n)) return '0'; return String(Number(n.toFixed(2))) }

// Валидированная категориальная палитра для тёмного фона (dataviz).
const DONUT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767']
const DONUT_OTHER = '#64748b'

// Лёгкий спарклайн (тренд за N дней).
function Sparkline({ data, color = '#34d399', width = 104, height = 30 }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data), min = Math.min(...data)
  const span = (max - min) || 1
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * (width - 2) + 1,
    height - 3 - ((v - min) / span) * (height - 6),
  ])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`
  const gid = React.useId()
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.22" />
        <stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// Кольцевая диаграмма (donut). segments: [{ label, value, color }].
function Donut({ segments, size = 140, thickness = 20 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = (size - thickness) / 2
  const cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  const gap = total > 1 ? 2 : 0
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={thickness} />
      {segments.map((seg, i) => {
        const frac = seg.value / total
        const len = Math.max(0, frac * circ - gap)
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={thickness}
            strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc * circ}
            transform={`rotate(-90 ${cx} ${cy})`} />
        )
        acc += frac
        return el
      })}
    </svg>
  )
}

// ID с копированием в буфер (не всплывает до клика по строке).
function CopyId({ value, className = '' }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(String(value)).then(() => { setOk(true); setTimeout(() => setOk(false), 1200) }).catch(() => {}) }}
      className={`inline-flex items-center gap-1 hover:text-white group ${className}`} title="Скопировать ID">
      <span className="font-mono">{value}</span>
      {ok ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60" />}
    </button>
  )
}

// ─── Сводка по доходам (пополнения) за периоды ────────────────────────────────
function RevenueStrip({ rev, loading, err, onRefresh }) {
  const tiles = [
    { label: 'Сегодня · МСК', Icon: Clock,      v: rev?.today, accent: 'text-emerald-300' },
    { label: 'За 7 дней',     Icon: TrendingUp, v: rev?.d7,    accent: 'text-emerald-300' },
    { label: 'За 30 дней',    Icon: TrendingUp, v: rev?.d30,   accent: 'text-emerald-300' },
    { label: 'Всего доход',   Icon: Wallet,     v: rev?.total, accent: 'text-white', hint: rev?.count != null ? `${fmtNum(rev.count)} пополнений` : null },
  ]
  return (
    <div className="px-3 pt-3">
      <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] to-transparent p-3">
        <div className="flex items-center gap-2 mb-2">
          <Wallet className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-slate-300">Доход · пополнения баланса</span>
          {loading && <RefreshCw className="w-3 h-3 animate-spin text-slate-500" />}
          <button onClick={onRefresh} title="Пересчитать" className="ml-auto p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {err ? (
          <div className="text-xs text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {err}</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tiles.map(t => (
              <div key={t.label} className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1"><t.Icon className="w-3.5 h-3.5 text-emerald-400" /> {t.label}</div>
                <div className={`text-lg font-bold font-mono leading-none ${t.accent}`}>{loading && rev == null ? '…' : money(t.v)}</div>
                {t.hint && <div className="text-[10px] text-slate-500 mt-1">{t.hint}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Блоки раздела «Подписки»: по тарифам (donut) + истекающие ────────────────
function SubStatsBlocks({ stats, loading, err, onRefresh, onNotify }) {
  const tariffs = stats?.tariffs || []
  const exp = stats?.expiring || {}
  const expTiles = [
    { label: 'В течение 1 дня',  v: exp.d1, color: '#f43f5e' },
    { label: 'В течение 3 дней', v: exp.d3, color: '#f59e0b' },
    { label: 'В течение 7 дней', v: exp.d7, color: '#eab308' },
  ]

  // Сегменты donut: топ-7 тарифов + «Другие». Цвета из валидированной палитры.
  const top = tariffs.slice(0, 7)
  const restCount = tariffs.slice(7).reduce((s, t) => s + t.count, 0)
  const segs = top.map((t, i) => ({ ...t, color: DONUT_COLORS[i] }))
  if (restCount > 0) segs.push({ name: 'Другие', count: restCount, color: DONUT_OTHER, trial: false, other: true })
  const totalSeg = segs.reduce((s, x) => s + x.count, 0) || 1

  return (
    <div className="px-4 pt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Подписки по тарифам */}
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center"><Layers className="w-4 h-4" /></div>
          <span className="text-sm font-semibold text-slate-200">Подписки по тарифам</span>
          {loading && <RefreshCw className="w-3 h-3 animate-spin text-slate-500" />}
          <button onClick={onRefresh} title="Пересчитать" className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {err ? <div className="text-xs text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {err}</div>
          : loading && !stats ? <div className="text-xs text-slate-500 flex items-center gap-1.5 py-8 justify-center"><RefreshCw className="w-4 h-4 animate-spin" /> Подсчёт…</div>
          : tariffs.length === 0 ? <div className="text-xs text-slate-500">Нет данных</div>
          : (
            <div className="flex items-center gap-4">
              {/* Donut */}
              <div className="relative shrink-0" style={{ width: 140, height: 140 }}>
                <Donut segments={segs} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-2xl font-bold text-white font-mono leading-none">{fmtNum(stats.totalActive)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">активных</div>
                </div>
              </div>
              {/* Легенда */}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 text-[11px] pb-1.5 mb-1 border-b border-slate-800/50">
                  <span className="text-emerald-400">платных <b className="font-mono">{fmtNum(stats.paidCount)}</b></span>
                  <span className="text-cyan-400">триал <b className="font-mono">{fmtNum(stats.trialCount)}</b></span>
                </div>
                {segs.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                    <span className="text-slate-300 truncate flex-1" title={s.name}>{s.name}</span>
                    <span className="font-mono text-slate-200 shrink-0">{fmtNum(s.count)}</span>
                    <span className="text-slate-500 shrink-0 w-9 text-right">{Math.round((s.count / totalSeg) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>

      {/* Истекают в ближайшие дни */}
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center"><CalendarClock className="w-4 h-4" /></div>
          <span className="text-sm font-semibold text-slate-200">Истекают в ближайшие дни</span>
        </div>
        {err ? <div className="text-xs text-rose-400">{err}</div>
          : loading && !stats ? <div className="text-xs text-slate-500 flex items-center gap-1.5 py-8 justify-center"><RefreshCw className="w-4 h-4 animate-spin" /> Подсчёт…</div>
          : (
            <>
              <div className="grid grid-cols-3 gap-3 flex-1">
                {expTiles.map(t => (
                  <div key={t.label} className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 flex flex-col">
                    <div className="text-2xl font-bold font-mono leading-none" style={{ color: t.color }}>{fmtNum(t.v)}</div>
                    <div className="text-[10px] text-slate-500 mt-1.5 leading-tight">{t.label}</div>
                  </div>
                ))}
              </div>
              <button onClick={onNotify} disabled={!stats}
                className="mt-4 self-start px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 flex items-center gap-2 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" /> Уведомить истекающих
              </button>
              <div className="text-[10px] text-slate-500 mt-1.5">Telegram-рассылка сегменту бота «истекающие»</div>
            </>
          )}
      </div>
    </div>
  )
}

// ─── Модалка отправки уведомления (реальная рассылка) ─────────────────────────
function NotifyModal({ notify, onClose, onSend, onPoll, onSent }) {
  const [text, setText] = useState('')
  const [stage, setStage] = useState('edit')   // edit | confirm | sending | done
  const [result, setResult] = useState(null)
  const [tracking, setTracking] = useState(false)
  const [error, setError] = useState(null)
  const est = notify.expiring?.d7

  const isFinal = b => !!b && (b.completed_at || !['queued', 'running', 'sending', 'processing', 'pending'].includes(b.status))

  async function doSend() {
    setStage('sending'); setError(null)
    try {
      const b = await onSend('expiring', text.trim())
      setResult(b); setStage('done'); onSent?.()
      // Счётчики заполняются на боте асинхронно — опрашиваем статус до финала.
      if (b?.id && onPoll && !isFinal(b)) {
        setTracking(true)
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 1500))
          try {
            const upd = await onPoll(b.id)
            if (upd) setResult(upd)
            if (isFinal(upd)) break
          } catch { /* транзиентная ошибка опроса — продолжаем */ }
        }
        setTracking(false)
      }
    } catch (e) { setError(e.message); setStage('confirm'); setTracking(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={stage === 'sending' ? undefined : onClose} />
      <div className="relative w-full max-w-lg bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between shrink-0">
          <h3 className="text-white font-bold flex items-center gap-2"><Send className="w-4 h-4 text-amber-400" /> Уведомление истекающим</h3>
          <button onClick={onClose} disabled={stage === 'sending'} className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto thin-scroll">
          {stage === 'done' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                {tracking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {tracking ? 'Рассылка идёт…' : 'Рассылка завершена'}
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 py-2"><div className="text-lg font-bold font-mono text-white">{fmtNum(result?.total_count)}</div><div className="text-[10px] text-slate-500">всего</div></div>
                <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 py-2"><div className="text-lg font-bold font-mono text-emerald-300">{fmtNum(result?.sent_count)}</div><div className="text-[10px] text-slate-500">доставлено</div></div>
                <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 py-2"><div className="text-lg font-bold font-mono text-amber-300">{fmtNum(result?.blocked_count)}</div><div className="text-[10px] text-slate-500">заблок.</div></div>
                <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 py-2"><div className="text-lg font-bold font-mono text-rose-300">{fmtNum(result?.failed_count)}</div><div className="text-[10px] text-slate-500">ошибок</div></div>
              </div>
              <div className="text-[11px] text-slate-500">
                Статус: {result?.status || '—'}{tracking ? ' · обновляем счётчики…' : '.'} «Заблок.» — пользователи, заблокировавшие бота (доставка невозможна).
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Сообщение будет отправлено <b>реальным пользователям</b> сегмента «истекающие»{est != null ? <> (ориентировочно <b>~{fmtNum(est)}</b> чел.)</> : ''}. Точный список определяет бот.</span>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Текст сообщения *</label>
                <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={5} disabled={stage !== 'edit'}
                  placeholder="Ваша подписка скоро закончится. Продлите её, чтобы не потерять доступ…"
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none disabled:opacity-60" />
                <div className="text-[10px] text-slate-500 mt-1">{text.trim().length} символов</div>
              </div>
              {error && <div className="text-xs text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {error}</div>}
              {stage === 'confirm' && (
                <div className="rounded-lg bg-rose-500/10 border border-rose-500/40 p-3 text-xs text-rose-200">
                  Подтвердите отправку. Отменить рассылку после запуска нельзя.
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800/60 flex justify-end gap-2 shrink-0">
          {stage === 'done' ? (
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200">Закрыть</button>
          ) : stage === 'sending' ? (
            <button disabled className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500/60 text-white flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Отправка…</button>
          ) : stage === 'confirm' ? (
            <>
              <button onClick={() => setStage('edit')} className="px-4 py-2 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300">Назад</button>
              <button onClick={doSend} className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-rose-500 to-orange-500 text-white flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Отправить</button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300">Отмена</button>
              <button onClick={() => setStage('confirm')} disabled={!text.trim()} className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white disabled:opacity-50 flex items-center gap-1.5">Далее</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Таблица вкладки ──────────────────────────────────────────────────────────
function TabTable({ tab, state, onPage, onRowClick }) {
  const [raw, setRaw] = useState(false)
  if (!state) return <div className="text-xs text-slate-500 py-4 text-center">Нажмите на вкладку для загрузки</div>
  if (state.loading && !state.items) return <div className="text-xs text-slate-500 py-6 text-center flex items-center justify-center gap-1.5"><RefreshCw className="w-4 h-4 animate-spin" /> Загрузка…</div>
  if (state.err) return <div className="text-xs text-rose-400 py-4 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {state.err}</div>
  const items = state.items || []
  if (!items.length) return <div className="text-xs text-slate-500 py-6 text-center">Пусто</div>

  const total = Number(state.total)
  const offset = state.offset || 0
  const from = offset + 1, to = offset + items.length
  const hasMore = items.length >= LIMIT           // total у бота ненадёжен → судим по полноте страницы
  const showTotal = Number.isFinite(total) && total >= to
  const cols = TAB_COLUMNS[tab]

  return (
    <div>
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 text-left border-b border-slate-800/60">
              {cols.map(c => <th key={c.h} className="py-2.5 px-3 font-semibold whitespace-nowrap text-[11px] uppercase tracking-wider">{c.h}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id || it.telegram_id || i}
                onClick={onRowClick ? () => onRowClick(it) : undefined}
                className={`border-b border-slate-800/30 hover:bg-slate-800/30 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}>
                {cols.map(c => <td key={c.h} className="py-2.5 px-3 align-middle" title={c.title}>{c.render(it)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span>{from}–{to}{showTotal ? ` из ${fmtNum(total)}` : ''}</span>
          <button onClick={() => setRaw(v => !v)} className="hover:text-slate-300 flex items-center gap-1"><Braces className="w-3 h-3" /> raw</button>
        </div>
        <div className="flex items-center gap-1">
          <button disabled={offset <= 0 || state.loading} onClick={() => onPage(Math.max(0, offset - LIMIT))}
            className="p-1 rounded bg-slate-800/60 border border-slate-700/50 text-slate-300 disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <button disabled={!hasMore || state.loading} onClick={() => onPage(offset + LIMIT)}
            className="p-1 rounded bg-slate-800/60 border border-slate-700/50 text-slate-300 disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {raw && <pre className="mt-1 text-[11px] text-slate-400 font-mono bg-slate-950/60 rounded-lg p-2 overflow-auto max-h-52 thin-scroll">{JSON.stringify(items[0], null, 2)}</pre>}
    </div>
  )
}

const StatusBadge = ({ v }) => {
  if (v == null || v === '') return <span className="text-slate-600">—</span>
  const s = String(v).toLowerCase()
  const cls = /active|paid|success|completed|open|ok/.test(s) ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : /trial|pending|new|processing/.test(s) ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
    : /expired|blocked|failed|cancel|closed|error/.test(s) ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
    : 'bg-slate-700/40 text-slate-300 border-slate-600/40'
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${cls}`}>{String(v)}</span>
}
const mono = v => <span className="font-mono text-slate-300">{v ?? '—'}</span>
const userCell = it => {
  const uname = pick(it, ['username'])
  const fullName = [pick(it, ['first_name']), pick(it, ['last_name'])].filter(Boolean).join(' ')
  const tg = pick(it, ['telegram_id'])
  const uid = pick(it, ['user_id', 'id'])
  const primary = uname ? '@' + uname : (fullName || pick(it, ['full_name', 'name'], uid != null ? `#${uid}` : '—'))
  const secondary = tg != null ? `tg ${tg}` : (uid != null ? `uid ${uid}` : '')
  return (
    <div className="min-w-0">
      <div className="text-slate-200 truncate">{primary}</div>
      {secondary && <div className="text-[10px] text-slate-500 font-mono">{secondary}</div>}
    </div>
  )
}
// Трафик used / limit (limit 0 = безлимит) — округление до 2 знаков + прогресс-бар
const trafficCell = it => {
  const used = Number(pick(it, ['traffic_used_gb'])) || 0
  const l = pick(it, ['traffic_limit_gb'])
  const unlimited = l === 0 || l == null
  const pct = unlimited ? 0 : Math.min(100, (used / l) * 100)
  const barColor = pct > 90 ? '#f43f5e' : pct > 70 ? '#f59e0b' : '#10b981'
  return (
    <div className="min-w-[96px]">
      <div className="font-mono text-slate-300 text-[11px]">{fmtGB(used)} / {unlimited ? '∞' : l} GB</div>
      {!unlimited && (
        <div className="h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
        </div>
      )}
    </div>
  )
}

const TAB_COLUMNS = {
  users: [
    { h: 'Пользователь', render: userCell },
    { h: 'Имя', render: it => <span className="text-slate-400 truncate">{[pick(it, ['first_name']), pick(it, ['last_name'])].filter(Boolean).join(' ') || '—'}</span> },
    { h: 'Баланс', render: it => <span className="font-mono text-slate-200">{money(pick(it, ['balance_rubles']))}</span> },
    { h: 'Подписка', render: it => {
      const sub = it.subscription
      if (!sub || typeof sub !== 'object') return <span className="text-slate-600">нет</span>
      return <StatusBadge v={sub.is_trial ? 'trial' : (sub.actual_status || sub.status)} />
    } },
    { h: 'Статус', render: it => <StatusBadge v={pick(it, ['status'])} /> },
    { h: 'Регистрация', render: it => <span className="text-slate-500">{fmtDate(pick(it, ['created_at']))}</span> },
  ],
  subscriptions: [
    { h: 'ID пользователя', render: it => <span className="text-slate-300"><CopyId value={pick(it, ['user_id'])} /></span> },
    { h: 'Статус', render: it => <StatusBadge v={pick(it, ['is_trial']) ? 'trial' : pick(it, ['actual_status', 'status'])} /> },
    { h: 'Трафик', render: trafficCell },
    { h: 'Устройства', render: it => mono(pick(it, ['device_limit'])) },
    { h: 'Начало', render: it => <span className="text-slate-500">{fmtDate(pick(it, ['start_date']))}</span> },
    { h: 'Окончание', render: it => {
      const end = pick(it, ['end_date']); const dl = daysLeft(end)
      return (
        <div>
          <div className="text-slate-400">{fmtDate(end)}</div>
          {dl != null && dl >= 0 && <div className={`text-[10px] ${dl <= 3 ? 'text-rose-400' : dl <= 7 ? 'text-amber-400' : 'text-slate-500'}`}>осталось {dl} дн.</div>}
        </div>
      )
    } },
    { h: 'Действия', render: () => <User className="w-4 h-4 text-slate-500 hover:text-sky-300" />, title: 'Открыть профиль' },
  ],
  transactions: [
    { h: '', render: it => {
      const out = Number(pick(it, ['amount_rubles', 'amount_kopeks'], 0)) < 0
      return <span className={`inline-block w-1.5 h-1.5 rounded-full ${out ? 'bg-rose-400' : 'bg-emerald-400'}`} />
    } },
    { h: 'Описание', render: it => <span className="text-slate-300 truncate">{pick(it, ['description', 'type'], '—')}</span> },
    { h: 'Метод', render: it => <span className="text-slate-500">{pick(it, ['payment_method'], '—')}</span> },
    { h: 'Сумма', render: it => {
      const v = Number(pick(it, ['amount_rubles', 'amount_kopeks'], 0))
      const out = v < 0
      return <span className={`font-mono ${out ? 'text-rose-300' : 'text-emerald-300'}`}>{out ? '−' : '+'}{money(Math.abs(v))}</span>
    } },
    { h: 'Статус', render: it => <StatusBadge v={pick(it, ['is_completed']) ? 'completed' : 'pending'} /> },
    { h: 'Дата', render: it => <span className="text-slate-500">{fmtDate(pick(it, ['created_at']))}</span> },
  ],
  tickets: [
    { h: 'Тема', render: it => <span className="text-slate-200 truncate">{pick(it, ['title', 'subject'], `#${pick(it, ['id'], '')}`)}</span> },
    { h: 'Пользователь', render: userCell },
    { h: 'Статус', render: it => <StatusBadge v={pick(it, ['status'])} /> },
    { h: 'Приоритет', render: it => <StatusBadge v={pick(it, ['priority'])} /> },
    { h: 'Создан', render: it => <span className="text-slate-500">{fmtDate(pick(it, ['created_at']))}</span> },
  ],
}

// ─── Поиск (debounce) ─────────────────────────────────────────────────────────
function SearchBox({ onSearch }) {
  const [v, setV] = useState('')
  useEffect(() => { const t = setTimeout(() => onSearch(v.trim()), 400); return () => clearTimeout(t) }, [v]) // eslint-disable-line
  return (
    <div className="relative">
      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
      <input value={v} onChange={e => setV(e.target.value)} placeholder="поиск…" autoComplete="off"
        className="pl-7 pr-2 py-1 w-36 text-xs bg-slate-950/60 border border-slate-700 rounded-lg text-white focus:border-violet-500 focus:outline-none" />
    </div>
  )
}

// ─── Модалка аккаунта ─────────────────────────────────────────────────────────
function AccountModal({ modal, setModal, save, saving, showSecret, setShowSecret }) {
  const f = modal.form
  const set = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }))
  const inputCls = 'w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setModal(null)} />
      <div className="relative w-full max-w-lg bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between shrink-0">
          <h3 className="text-white font-bold">{modal.editId ? 'Изменить подключение' : 'Новое подключение к боту'}</h3>
          <button onClick={() => setModal(null)} className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto thin-scroll">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Название *</label>
            <input autoComplete="off" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Bedolaga прод" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Base URL *</label>
            <input autoComplete="off" value={f.base_url} onChange={e => set('base_url', e.target.value)} placeholder="http://host:8080" className={inputCls + ' font-mono'} />
            <p className="text-[11px] text-slate-500 mt-1">Адрес Web API бота (WEB_API_PORT, по умолч. 8080). При наличии префикса — включите его в URL.</p>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Токен Web API *</label>
            <div className="relative">
              <input autoComplete="new-password" type={showSecret.api_token ? 'text' : 'password'} value={f.api_token} onChange={e => set('api_token', e.target.value)}
                placeholder={modal.editId ? 'оставьте пустым чтобы не менять' : 'WEB_API_DEFAULT_TOKEN'} className={inputCls + ' pr-9 font-mono'} />
              <button type="button" onClick={() => setShowSecret(s => ({ ...s, api_token: !s.api_token }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showSecret.api_token ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Заметки</label>
            <textarea autoComplete="off" value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} className={inputCls} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-800/60 flex justify-end gap-2 shrink-0">
          <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300">Отмена</button>
          <button onClick={save} disabled={saving || !f.name.trim() || !f.base_url.trim() || (!modal.editId && !f.api_token.trim())}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white disabled:opacity-50 flex items-center gap-1.5">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Детальная карточка пользователя ──────────────────────────────────────────
const KV = ({ label, children }) => (
  <div className="flex justify-between gap-3 py-1 border-b border-slate-800/40 last:border-0">
    <span className="text-slate-500 shrink-0">{label}</span>
    <span className="text-slate-200 text-right min-w-0 break-words">{children ?? '—'}</span>
  </div>
)
const YesNo = ({ v }) => v
  ? <span className="text-emerald-400 font-semibold">да</span>
  : <span className="text-slate-500">нет</span>

function daysLeft(end) {
  if (!end) return null
  const ms = new Date(end).getTime() - Date.now()
  if (isNaN(ms)) return null
  return Math.ceil(ms / 86400000)
}

function UserCard({ uc, onClose }) {
  const { loading, user, transactions = [], squads = {}, err, txErr } = uc
  const [copied, setCopied] = useState(null)
  const copy = (url, key) => { navigator.clipboard?.writeText(url).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500) }).catch(() => {}) }

  const subs = user ? (user.subscriptions?.length ? user.subscriptions : (user.subscription ? [user.subscription] : [])) : []
  const fullName = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : ''
  const title = user ? (user.username ? '@' + user.username : (fullName || `#${user.id}`)) : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* header */}
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold shrink-0">
            {(fullName || user?.username || 'U').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white truncate">{title}</span>
              {user && <StatusBadge v={user.status} />}
            </div>
            {user && <div className="text-[11px] text-slate-500 font-mono">ID {user.id} · tg {user.telegram_id}</div>}
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto thin-scroll">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Загрузка…</div>
          ) : err ? (
            <div className="text-sm text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {err}</div>
          ) : user && (
            <>
              {/* Профиль */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5 gap-y-0 text-xs">
                <div>
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Профиль</div>
                  <KV label="Имя">{fullName || '—'}</KV>
                  <KV label="Username">{user.username ? '@' + user.username : '—'}</KV>
                  <KV label="Email">{user.email || '—'}</KV>
                  <KV label="Язык">{user.language || '—'}</KV>
                  <KV label="Статус"><StatusBadge v={user.status} /></KV>
                  <KV label="Баланс"><span className="font-mono text-white">{money(user.balance_rubles)}</span></KV>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Gift className="w-3.5 h-3.5" /> Активность и рефералы</div>
                  <KV label="Первое пополнение"><YesNo v={user.has_made_first_topup} /></KV>
                  <KV label="Была платная подписка"><YesNo v={user.has_had_paid_subscription} /></KV>
                  <KV label="Реф-код"><span className="font-mono">{user.referral_code || '—'}</span></KV>
                  <KV label="Пригласил (ID)">{user.referred_by_id ?? '—'}</KV>
                  <KV label="Промо-группа">{user.promo_group?.name || '—'}</KV>
                  <KV label="Регистрация">{fmtDT(user.created_at)}</KV>
                  <KV label="Последняя активность">{fmtDT(user.last_activity)}</KV>
                </div>
              </div>

              {/* Подписки */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Ticket className="w-3.5 h-3.5" /> Подписки ({subs.length})</div>
                {subs.length === 0 ? <div className="text-xs text-slate-500">Подписок нет</div> : (
                  <div className="space-y-2">
                    {subs.map(s => {
                      const dl = daysLeft(s.end_date)
                      const lim = s.traffic_limit_gb === 0 ? '∞' : s.traffic_limit_gb
                      return (
                        <div key={s.id} className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-xs">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <StatusBadge v={s.is_trial ? 'trial' : (s.actual_status || s.status)} />
                            <span className="font-semibold text-slate-200">{s.tariff_name || (s.is_trial ? 'Триал' : '(без тарифа)')}</span>
                            {s.tariff_id != null && <span className="text-[10px] text-slate-500 font-mono">tariff #{s.tariff_id}</span>}
                            {dl != null && <span className={`ml-auto text-[11px] font-semibold ${dl <= 3 ? 'text-rose-400' : dl <= 7 ? 'text-amber-400' : 'text-slate-400'}`}>{dl >= 0 ? `осталось ${dl} дн.` : `истекла ${-dl} дн. назад`}</span>}
                          </div>
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
                            <KV label="Начало">{fmtDate(s.start_date)}</KV>
                            <KV label="Окончание">{fmtDate(s.end_date)}</KV>
                            <KV label="Трафик"><span className="font-mono">{s.traffic_used_gb ?? 0} / {lim} GB</span></KV>
                            <KV label="Устройства"><span className="font-mono">{s.device_limit ?? '—'}</span></KV>
                            <KV label="Автоплатёж">{s.autopay_enabled ? `да (за ${s.autopay_days_before} дн.)` : 'нет'}</KV>
                            <KV label="Статус БД">{s.status}{s.actual_status && s.actual_status !== s.status ? ` / ${s.actual_status}` : ''}</KV>
                            <div className="col-span-2">
                              <KV label="Сквады">{(s.connected_squads || []).map(u => squads[u] || u.slice(0, 8)).join(', ') || '—'}</KV>
                            </div>
                          </div>
                          {s.subscription_url && (
                            <div className="mt-2 flex items-center gap-2">
                              <Link2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span className="text-[11px] text-slate-400 font-mono truncate flex-1">{s.subscription_url}</span>
                              <button onClick={() => copy(s.subscription_url, s.id)} className="px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white flex items-center gap-1 text-[11px] shrink-0">
                                {copied === s.id ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />} {copied === s.id ? 'скопировано' : 'копировать'}
                              </button>
                              <a href={s.subscription_url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white flex items-center gap-1 text-[11px] shrink-0"><Link2 className="w-3 h-3" /> открыть</a>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* История платежей */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" /> История платежей ({transactions.length})</div>
                {txErr ? <div className="text-xs text-rose-400">{txErr}</div>
                  : transactions.length === 0 ? <div className="text-xs text-slate-500">Транзакций нет</div>
                  : (
                    <div className="overflow-x-auto thin-scroll max-h-72 overflow-y-auto">
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-slate-950">
                          <tr className="text-slate-500 text-left border-b border-slate-800/60">
                            <th className="py-1.5 px-2"></th>
                            <th className="py-1.5 px-2 font-semibold">Описание</th>
                            <th className="py-1.5 px-2 font-semibold">Метод</th>
                            <th className="py-1.5 px-2 font-semibold text-right">Сумма</th>
                            <th className="py-1.5 px-2 font-semibold">Статус</th>
                            <th className="py-1.5 px-2 font-semibold">Дата</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transactions.map((t, i) => {
                            const v = Number(t.amount_rubles) || 0
                            const out = v < 0
                            return (
                              <tr key={t.id || i} className="border-b border-slate-800/30">
                                <td className="py-1.5 px-2"><span className={`inline-block w-1.5 h-1.5 rounded-full ${out ? 'bg-rose-400' : 'bg-emerald-400'}`} /></td>
                                <td className="py-1.5 px-2 text-slate-300 max-w-[240px] truncate" title={t.description}>{t.description || t.type || '—'}</td>
                                <td className="py-1.5 px-2 text-slate-500">{t.payment_method || '—'}</td>
                                <td className={`py-1.5 px-2 text-right font-mono ${out ? 'text-rose-300' : 'text-emerald-300'}`}>{out ? '−' : '+'}{money(Math.abs(v))}</td>
                                <td className="py-1.5 px-2"><StatusBadge v={t.is_completed ? 'completed' : 'pending'} /></td>
                                <td className="py-1.5 px-2 text-slate-500 whitespace-nowrap">{fmtDT(t.created_at)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
