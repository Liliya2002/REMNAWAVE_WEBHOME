import React, { useEffect, useState, useCallback } from 'react'
import {
  CalendarClock, RefreshCw, AlertCircle, AlertTriangle, Search, ChevronDown, ChevronRight,
  MessageCircle, Copy, CheckCircle2, Send, X, Clock, CalendarDays, Users, Inbox, Bell,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/bedolaga'

// ─── Истекающие подписки Bedolaga, сгруппированные по месяцам ─────────────────

const fmtNum = n => (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('ru-RU')
const fmtDate = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU') }
const fmtGB = v => { const n = Number(v); return isFinite(n) ? String(Number(n.toFixed(2))) : '0' }

// Цвет срочности: чем меньше дней, тем горячее.
function urgency(days) {
  if (days < 0) return { dot: 'bg-rose-500', text: 'text-rose-400', label: `просрочена ${-days} дн.` }
  if (days <= 3) return { dot: 'bg-rose-400', text: 'text-rose-400', label: `осталось ${days} дн.` }
  if (days <= 7) return { dot: 'bg-amber-400', text: 'text-amber-400', label: `осталось ${days} дн.` }
  if (days <= 30) return { dot: 'bg-sky-400', text: 'text-sky-400', label: `осталось ${days} дн.` }
  return { dot: 'bg-slate-600', text: 'text-slate-500', label: `осталось ${days} дн.` }
}

export default function AdminBedolagaExpiring() {
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [months, setMonths] = useState(6)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})          // { [monthKey]: bool }
  const [notify, setNotify] = useState(null)    // пользователь для личного сообщения

  // Аккаунты Bedolaga (обычно один)
  useEffect(() => {
    authFetch(`${API}/accounts`)
      .then(r => r.json())
      .then(d => {
        const list = d.accounts || []
        setAccounts(list)
        setAccountId(prev => prev ?? (list.find(a => a.is_active) || list[0])?.id ?? null)
      })
      .catch(e => setError(e.message))
  }, [])

  const load = useCallback(async (force) => {
    if (!accountId) return
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ months: String(months) })
      if (q) qs.set('search', q)
      if (force) qs.set('force', '1')
      const r = await authFetch(`${API}/accounts/${accountId}/expiring?${qs}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки')
      setData(d)
      // Просроченные и текущий месяц раскрыты сразу — остальное свёрнуто,
      // иначе длинный список забивает экран.
      setOpen(prev => {
        const next = { ...prev }
        for (const m of d.months || []) {
          if (next[m.key] === undefined) next[m.key] = m.overdue || m.current
        }
        return next
      })
    } catch (e) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }, [accountId, months, q])

  useEffect(() => { load() }, [load])

  const s = data?.summary
  const tiles = [
    { label: 'Просрочено',      v: s?.overdue,   Icon: AlertTriangle, cls: 'text-rose-400 bg-rose-500/10' },
    { label: 'В этом месяце',   v: s?.thisMonth, Icon: Clock,         cls: 'text-amber-400 bg-amber-500/10' },
    { label: 'В следующем',     v: s?.nextMonth, Icon: CalendarDays,  cls: 'text-sky-400 bg-sky-500/10' },
    { label: `Всего за ${months} мес.`, v: s?.total, Icon: Users,     cls: 'text-slate-300 bg-slate-500/10' },
  ]

  if (accounts.length === 0 && !loading) {
    return (
      <div className="text-center py-16 rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30">
        <Inbox className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-300 font-medium">Подключений к боту Bedolaga нет</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25 shrink-0">
          <CalendarClock className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">Истекающие подписки</h1>
          <p className="text-xs text-slate-400 hidden sm:block">Группировка по месяцам окончания · Bedolaga Bot</p>
        </div>
        <button onClick={() => load(true)}
          className="px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/60 flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
        </button>
      </div>

      {/* Плитки */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400 truncate">{t.label}</div>
                <div className="text-2xl font-bold text-white font-mono leading-tight mt-1">{loading && !data ? '…' : fmtNum(t.v)}</div>
              </div>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${t.cls}`}><t.Icon className="w-4 h-4" /></div>
            </div>
          </div>
        ))}
      </div>

      {/* Фильтры */}
      <div className="flex items-center gap-2 flex-wrap">
        <form onSubmit={e => { e.preventDefault(); setQ(search.trim()) }} className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} autoComplete="off"
            placeholder="Поиск: @username, имя, tg id…"
            className="pl-8 pr-2 py-2 w-full text-xs bg-slate-950/60 border border-slate-700 rounded-lg text-white focus:border-amber-500 focus:outline-none" />
        </form>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 hidden sm:inline">Горизонт:</span>
          {[3, 6, 12].map(m => (
            <button key={m} onClick={() => setMonths(m)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ${
                months === m ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'bg-slate-900/40 border-slate-800/60 text-slate-400 hover:text-white'}`}>
              {m} мес.
            </button>
          ))}
        </div>
      </div>

      {error && <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-300 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Загрузка…</div>
      ) : !data?.months?.length ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">Истекающих подписок нет</p>
          <p className="text-xs text-slate-500 mt-1">{q ? 'Ничего не найдено по запросу.' : `В ближайшие ${months} мес. ничего не истекает.`}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.months.map(m => (
            <MonthGroup key={m.key} month={m}
              open={!!open[m.key]}
              onToggle={() => setOpen(p => ({ ...p, [m.key]: !p[m.key] }))}
              onNotify={u => setNotify(u)} />
          ))}
        </div>
      )}

      {data?.computed_at && (
        <p className="text-[11px] text-slate-600 text-center">
          Данные на {new Date(data.computed_at).toLocaleString('ru-RU')}{data.cached ? ' · из кэша' : ''}
        </p>
      )}

      {notify && (
        <NotifyUserModal user={notify} accountId={accountId} onClose={() => setNotify(null)} />
      )}
    </div>
  )
}

// ─── Группа-месяц ─────────────────────────────────────────────────────────────
function MonthGroup({ month, open, onToggle, onNotify }) {
  const accent = month.overdue ? 'bg-rose-500' : month.current ? 'bg-amber-500' : 'bg-sky-500'
  const headTint = month.overdue ? 'text-rose-300' : month.current ? 'text-amber-200' : 'text-slate-200'

  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors text-left">
        <span className={`w-1 h-8 rounded-full shrink-0 ${accent}`} />
        {open ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
        <span className={`font-semibold capitalize truncate ${headTint}`}>{month.label}</span>
        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-800/70 text-slate-300 shrink-0">{month.count}</span>
        {month.overdue && <span className="text-[10px] text-rose-400/80 hidden sm:inline">требуют внимания</span>}
      </button>

      {open && (
        <div className="border-t border-slate-800/60 divide-y divide-slate-800/40">
          {month.items.map(u => <UserRow key={`${u.subscription_id}-${u.user_id}`} u={u} onNotify={onNotify} />)}
        </div>
      )}
    </div>
  )
}

// ─── Строка пользователя ──────────────────────────────────────────────────────
function UserRow({ u, onNotify }) {
  const [copied, setCopied] = useState(false)
  const g = urgency(u.days_left)
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ')
  const title = u.username ? '@' + u.username : (name || `#${u.user_id}`)
  const tgLink = u.username ? `https://t.me/${u.username}` : (u.telegram_id ? `tg://user?id=${u.telegram_id}` : null)

  const limit = u.traffic_limit_gb
  const used = Number(u.traffic_used_gb) || 0
  const unlimited = !limit || limit === 0
  const pct = unlimited ? 0 : Math.min(100, (used / limit) * 100)

  const copy = () => {
    navigator.clipboard?.writeText(String(u.telegram_id || u.user_id))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {})
  }

  return (
    <div className="px-4 py-2.5 hover:bg-slate-800/20 transition-colors">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full shrink-0 ${g.dot}`} />

        {/* Пользователь */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-100 font-medium truncate">{title}</span>
            {u.is_trial
              ? <span className="px-1.5 py-0 rounded text-[9px] font-bold bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">триал</span>
              : u.tariff_name && <span className="px-1.5 py-0 rounded text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 truncate max-w-[140px]">{u.tariff_name}</span>}
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            {u.telegram_id ? `tg ${u.telegram_id}` : `uid ${u.user_id}`}{name && u.username ? ` · ${name}` : ''}
          </div>
        </div>

        {/* Трафик — только на широких экранах */}
        <div className="hidden lg:block w-28 shrink-0">
          <div className="text-[10px] text-slate-400 font-mono">{fmtGB(used)} / {unlimited ? '∞' : limit} GB</div>
          {!unlimited && (
            <div className="h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? '#f43f5e' : pct > 70 ? '#f59e0b' : '#10b981' }} />
            </div>
          )}
        </div>

        {/* Дата */}
        <div className="text-right shrink-0 w-24 hidden sm:block">
          <div className="text-xs text-slate-300">{fmtDate(u.end_date)}</div>
          <div className={`text-[10px] ${g.text}`}>{g.label}</div>
        </div>

        {/* Действия */}
        <div className="flex items-center gap-1 shrink-0">
          {tgLink && (
            <a href={tgLink} target="_blank" rel="noreferrer" title="Написать в Telegram"
              className="p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-sky-300">
              <MessageCircle className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={copy} title="Скопировать ID"
            className="p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white">
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {u.telegram_id && (
            <button onClick={() => onNotify(u)} title="Отправить через нашего бота"
              className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20">
              <Bell className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Дата на мобилке — отдельной строкой */}
      <div className="sm:hidden flex items-center gap-2 mt-1.5 pl-5 text-[11px]">
        <span className="text-slate-400">{fmtDate(u.end_date)}</span>
        <span className={g.text}>· {g.label}</span>
      </div>
    </div>
  )
}

// ─── Модалка личного уведомления ──────────────────────────────────────────────
function NotifyUserModal({ user, accountId, onClose }) {
  const name = user.username ? '@' + user.username : ([user.first_name, user.last_name].filter(Boolean).join(' ') || `#${user.user_id}`)
  const [text, setText] = useState(
    `Здравствуйте! Ваша подписка заканчивается ${fmtDate(user.end_date)}. Продлите её, чтобы не потерять доступ.`
  )
  const [stage, setStage] = useState('edit')   // edit | sending | done | fail
  const [error, setError] = useState(null)

  async function send() {
    setStage('sending'); setError(null)
    try {
      const r = await authFetch(`${API}/accounts/${accountId}/notify-user`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id: user.telegram_id, text: text.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка отправки')
      if (d.ok) setStage('done')
      else { setError(d.error); setStage('fail') }
    } catch (e) { setError(e.message); setStage('fail') }
  }

  const tgLink = user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.telegram_id}`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={stage === 'sending' ? undefined : onClose} />
      <div className="relative w-full sm:max-w-lg bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0"><Bell className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-white truncate">Сообщение пользователю</div>
            <div className="text-[11px] text-slate-500 truncate">{name} · tg {user.telegram_id}</div>
          </div>
          <button onClick={onClose} disabled={stage === 'sending'}
            className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center disabled:opacity-40 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto thin-scroll">
          {stage === 'done' ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Сообщение доставлено
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 p-3 text-[11px] text-slate-400">
                Отправляется через <b className="text-slate-200">нашего</b> Telegram-бота. Дойдёт только если
                пользователь когда-то его запускал — у бота Bedolaga персональной отправки в API нет.
                Если не получится, напишите напрямую.
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Текст сообщения</label>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={4} disabled={stage === 'sending'}
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none disabled:opacity-60" />
              </div>
              {error && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="min-w-0">{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800/60 flex justify-end gap-2 shrink-0">
          <a href={tgLink} target="_blank" rel="noreferrer"
            className="px-4 py-2 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" /> Написать самому
          </a>
          {stage === 'done' ? (
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200">Закрыть</button>
          ) : (
            <button onClick={send} disabled={stage === 'sending' || !text.trim()}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white disabled:opacity-50 flex items-center gap-1.5">
              {stage === 'sending' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {stage === 'fail' ? 'Повторить' : 'Отправить'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
