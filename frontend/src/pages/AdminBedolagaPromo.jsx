import React, { useEffect, useState, useCallback } from 'react'
import {
  Ticket, RefreshCw, AlertCircle, Search, X, Copy, CheckCircle2, Clock,
  Users, Gift, Wallet, CalendarDays, ChevronRight, Info,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/bedolaga'

// ─── Промокоды Bedolaga: список + карточка с последними активациями ───────────

const fmtNum  = n => (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('ru-RU')
const fmtRub  = k => (Number(k || 0) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
const fmtDate = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU') }
const fmtDT   = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) }

/** Что даёт промокод — по номиналу, а не по полю type: у комбинированных
 *  кодов заполнены оба поля, и номинал честнее описывает суть. */
function reward(pc) {
  const days = Number(pc?.subscription_days || 0)
  const kop  = Number(pc?.balance_bonus_kopeks || 0)
  if (days && kop) return { Icon: Gift,   text: `${days} дн. + ${fmtRub(kop)}`, tone: 'text-violet-400' }
  if (days)        return { Icon: CalendarDays, text: `${days} дн. подписки`,   tone: 'text-emerald-400' }
  if (kop)         return { Icon: Wallet, text: `${fmtRub(kop)} на баланс`,     tone: 'text-sky-400' }
  return { Icon: Gift, text: pc?.type || '—', tone: 'text-slate-400' }
}

function CopyBtn({ value }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(String(value)); setDone(true); setTimeout(() => setDone(false), 1200) }}
      className="p-1 rounded hover:bg-slate-700/60 text-slate-500 hover:text-slate-300 transition"
      title="Скопировать"
    >
      {done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

/* Карточка пользователя, активировавшего промокод. Данные приходят прямо
   в recent_uses — отдельный запрос за юзером не нужен. */
function UserRow({ u }) {
  const name = u.user_full_name || u.user_username || `ID ${u.user_id}`
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-700/50">
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/20
                      border border-cyan-500/30 flex items-center justify-center shrink-0 text-cyan-300 text-xs font-bold">
        {String(name).slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-200 truncate">{name}</div>
        <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
          {u.user_username && <span className="truncate">@{u.user_username}</span>}
          <span className="inline-flex items-center gap-1">
            TG {fmtNum(u.user_telegram_id)} <CopyBtn value={u.user_telegram_id} />
          </span>
        </div>
      </div>
      <div className="text-xs text-slate-400 shrink-0 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> {fmtDT(u.used_at)}
      </div>
    </div>
  )
}

export default function AdminBedolagaPromo() {
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Фильтры: is_active — серверный (поддержан API), search — по коду локально
  const [isActive, setIsActive] = useState('')      // '' | 'true' | 'false'
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)

  const [detail, setDetail] = useState(null)        // раскрытая карточка кода
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    authFetch(`${API}/accounts`).then(r => r.json())
      .then(d => {
        const list = d.accounts || []
        setAccounts(list)
        setAccountId(prev => prev ?? (list.find(a => a.is_active) || list[0])?.id ?? null)
      })
      .catch(e => setError(e.message))
  }, [])

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ limit, offset })
      if (isActive !== '') qs.set('is_active', isActive)
      const res = await authFetch(`${API}/accounts/${accountId}/promo-codes?${qs}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка загрузки')
      setData(d)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [accountId, isActive, limit, offset])

  useEffect(() => { load() }, [load])

  async function openDetail(pc) {
    if (detail?.id === pc.id) { setDetail(null); return }
    setDetailLoading(true); setDetail({ id: pc.id })
    try {
      const res = await authFetch(`${API}/accounts/${accountId}/promo-codes/${pc.id}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setDetail(d)
    } catch (e) { setDetail({ id: pc.id, _error: e.message }) } finally { setDetailLoading(false) }
  }

  const items = (data?.items || []).filter(pc =>
    !search || String(pc.code || '').toLowerCase().includes(search.toLowerCase())
  )
  const total = data?.total ?? 0

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <Ticket className="w-6 h-6 text-cyan-400" /> Промокоды
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Данные из API бота в реальном времени. Всего кодов: {fmtNum(total)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 1 && (
            <select value={accountId || ''} onChange={e => { setAccountId(Number(e.target.value)); setOffset(0) }}
              className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={load} disabled={loading}
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Обновить
          </button>
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по коду…"
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-100 text-sm focus:border-cyan-500 focus:outline-none" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>}
        </div>
        <select value={isActive} onChange={e => { setIsActive(e.target.value); setOffset(0) }}
          className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm">
          <option value="">Все статусы</option>
          <option value="true">Только активные</option>
          <option value="false">Только неактивные</option>
        </select>
        <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setOffset(0) }}
          className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm">
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>по {n}</option>)}
        </select>
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Загрузка…
        </div>
      )}

      {/* Список кодов */}
      <div className="space-y-2">
        {items.map(pc => {
          const rw = reward(pc)
          const open = detail?.id === pc.id
          const pct = pc.max_uses ? Math.min(100, Math.round(pc.current_uses / pc.max_uses * 100)) : 0
          return (
            <div key={pc.id} className="rounded-2xl border border-slate-700/50 bg-slate-900/35 overflow-hidden">
              <button onClick={() => openDetail(pc)} className="w-full p-4 text-left hover:bg-slate-800/30 transition">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 min-w-0 sm:w-56">
                    <ChevronRight className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="font-mono font-bold text-cyan-300 truncate">{pc.code}</span>
                    <CopyBtn value={pc.code} />
                  </div>

                  <div className={`flex items-center gap-1.5 text-sm shrink-0 sm:w-48 ${rw.tone}`}>
                    <rw.Icon className="w-4 h-4" /> {rw.text}
                  </div>

                  <div className="flex-1 min-w-[140px]">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>{fmtNum(pc.current_uses)} из {pc.max_uses ? fmtNum(pc.max_uses) : '∞'}</span>
                      <span>{pc.uses_left != null ? `осталось ${fmtNum(pc.uses_left)}` : ''}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      pc.is_valid ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                                  : 'bg-slate-700/40 border-slate-600 text-slate-400'}`}>
                      {pc.is_valid ? 'действует' : pc.is_active ? 'истёк' : 'выключен'}
                    </span>
                    <span className="text-xs text-slate-500 hidden md:inline">до {fmtDate(pc.valid_until)}</span>
                  </div>
                </div>
              </button>

              {/* Раскрытая карточка: последние активации */}
              {open && (
                <div className="border-t border-slate-700/50 p-4 bg-slate-950/40 space-y-3">
                  {detailLoading && (
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Загрузка активаций…
                    </div>
                  )}
                  {detail?._error && (
                    <div className="text-sm text-red-400 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> {detail._error}
                    </div>
                  )}
                  {detail?.recent_uses && (
                    <>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <span className="text-slate-400">Всего активаций: <b className="text-slate-200">{fmtNum(detail.total_uses)}</b></span>
                        <span className="text-slate-400">Сегодня: <b className="text-slate-200">{fmtNum(detail.today_uses)}</b></span>
                      </div>

                      {/* API отдаёт максимум 10 записей и не умеет пагинировать —
                          говорим об этом прямо, чтобы список не считали полным. */}
                      {detail.total_uses > detail.recent_uses.length && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
                          <Info className="w-4 h-4 shrink-0 mt-px" />
                          <span>
                            API бота отдаёт только последние {detail.recent_uses.length} активаций из {fmtNum(detail.total_uses)}.
                            Полная накопленная история — в разделе «Активации».
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
                        <Users className="w-3.5 h-3.5" /> Кто активировал
                      </div>
                      <div className="space-y-2">
                        {detail.recent_uses.length === 0 && <p className="text-sm text-slate-500">Активаций пока нет.</p>}
                        {detail.recent_uses.map(u => <UserRow key={u.id} u={u} />)}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!loading && items.length === 0 && (
          <p className="text-center text-slate-500 py-10 text-sm">Промокодов не найдено.</p>
        )}
      </div>

      {/* Пагинация — параметры поддержаны API (limit до 200, offset) */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40">
            Назад
          </button>
          <span className="text-slate-500">{offset + 1}–{Math.min(offset + limit, total)} из {fmtNum(total)}</span>
          <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40">
            Вперёд
          </button>
        </div>
      )}
    </div>
  )
}
