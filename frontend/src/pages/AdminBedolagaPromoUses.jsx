import React, { useEffect, useState, useCallback } from 'react'
import {
  Database, RefreshCw, AlertCircle, AlertTriangle, Search, X, Copy, CheckCircle2,
  Clock, CalendarDays, Wallet, Gift, Download, Zap,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/bedolaga'

/**
 * Накопленная база активаций промокодов.
 *
 * Отличие от страницы «Промокоды»: там живые данные из API бота, ограниченные
 * десятью последними активациями на код. Здесь — наша таблица, которую крон
 * пополняет по расписанию, поэтому история со временем становится глубже.
 */

const fmtNum  = n => (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('ru-RU')
const fmtRub  = k => (Number(k || 0) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
const fmtDT   = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) }

const TYPE_LABEL = {
  subscription_days: { label: 'Дни подписки', Icon: CalendarDays, tone: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  balance:           { label: 'Бонус на баланс', Icon: Wallet,    tone: 'text-sky-400 border-sky-500/40 bg-sky-500/10' },
}
const typeInfo = t => TYPE_LABEL[t] || { label: t || '—', Icon: Gift, tone: 'text-slate-400 border-slate-600 bg-slate-700/30' }

function CopyBtn({ value }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard?.writeText(String(value)); setDone(true); setTimeout(() => setDone(false), 1200) }}
      className="p-1 rounded hover:bg-slate-700/60 text-slate-500 hover:text-slate-300 transition" title="Скопировать">
      {done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

export default function AdminBedolagaPromoUses() {
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState(null)
  const [data, setData] = useState(null)
  const [facets, setFacets] = useState({ codes: [], types: [] })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)

  const [code, setCode] = useState('')
  const [promoType, setPromoType] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)

  // Поиск с задержкой — иначе запрос на каждую букву
  useEffect(() => { const t = setTimeout(() => { setQ(search); setOffset(0) }, 400); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    authFetch(`${API}/accounts`).then(r => r.json())
      .then(d => {
        const list = d.accounts || []
        setAccounts(list)
        setAccountId(prev => prev ?? (list.find(a => a.is_active) || list[0])?.id ?? null)
      })
      .catch(e => setError(e.message))
  }, [])

  const loadFacets = useCallback(() => {
    if (!accountId) return
    authFetch(`${API}/accounts/${accountId}/promo-uses/facets`).then(r => r.json())
      .then(d => setFacets({ codes: d.codes || [], types: d.types || [] })).catch(() => {})
  }, [accountId])

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ limit, offset })
      if (code)      qs.set('code', code)
      if (promoType) qs.set('promo_type', promoType)
      if (q)         qs.set('search', q)
      if (from)      qs.set('from', from)
      if (to)        qs.set('to', to)
      const res = await authFetch(`${API}/accounts/${accountId}/promo-uses?${qs}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка загрузки')
      setData(d)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [accountId, code, promoType, q, from, to, limit, offset])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadFacets() }, [loadFacets])

  async function runSync() {
    if (!accountId) return
    setSyncing(true); setError(null); setMsg(null)
    try {
      const res = await authFetch(`${API}/accounts/${accountId}/promo-uses/sync`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка синхронизации')
      setMsg(`Обработано кодов: ${d.codes}. Новых активаций: ${d.added}.` + (d.missedNow ? ` Потеряно: ${d.missedNow}.` : ''))
      await load(); loadFacets()
    } catch (e) { setError(e.message) } finally { setSyncing(false) }
  }

  function exportCsv() {
    const rows = data?.items || []
    if (!rows.length) return
    const head = ['code', 'promo_type', 'subscription_days', 'balance_bonus_kopeks',
                  'user_id', 'user_telegram_id', 'user_username', 'user_full_name', 'used_at']
    // Экранируем кавычки — в именах пользователей встречается что угодно
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [head.join(','), ...rows.map(r => head.map(h => esc(r[h])).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `promo-uses-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const items = data?.items || []
  const total = data?.total ?? 0
  const sync = data?.sync
  const resetFilters = () => { setCode(''); setPromoType(''); setSearch(''); setFrom(''); setTo(''); setOffset(0) }
  const hasFilters = code || promoType || search || from || to

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <Database className="w-6 h-6 text-cyan-400" /> Активации промокодов
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Наша накопленная база. Записей: {fmtNum(total)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {accounts.length > 1 && (
            <select value={accountId || ''} onChange={e => { setAccountId(Number(e.target.value)); setOffset(0) }}
              className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={exportCsv} disabled={!items.length}
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
            <Download className="w-4 h-4" /> CSV
          </button>
          <button onClick={runSync} disabled={syncing}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold hover:shadow-lg hover:shadow-cyan-500/25 transition text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <Zap className={`w-4 h-4 ${syncing ? 'animate-pulse' : ''}`} /> {syncing ? 'Синхронизация…' : 'Синхронизировать'}
          </button>
        </div>
      </div>

      {/* Состояние синхронизации */}
      {sync && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-700/40">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Последняя: {sync.last_run_at ? fmtDT(sync.last_run_at) : 'ещё не было'}
          </span>
          <span className={sync.status === 'error' ? 'text-red-400' : 'text-emerald-400'}>
            {sync.status === 'error' ? 'сбой' : 'успешно'}
          </span>
          {sync.added != null && <span>добавлено в прошлый раз: {fmtNum(sync.added)}</span>}
          {sync.error && <span className="text-red-400">{sync.error}</span>}
        </div>
      )}

      {/* Честное предупреждение о потерях. API отдаёт максимум 10 активаций на
          код, поэтому при всплеске активности между прогонами часть записей
          не попадает к нам уже никогда. Молчать об этом нельзя — иначе база
          выглядит полной, не будучи таковой. */}
      {sync?.missed_total > 0 && (
        <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Пропущено активаций: {fmtNum(sync.missed_total)}</p>
            <p className="text-xs mt-0.5 text-amber-200/80">
              {sync.missed_note || 'Между синхронизациями промокод активировали больше 10 раз — API отдаёт только последние 10, остальные восстановить нельзя.'}
            </p>
            <p className="text-xs mt-1 text-amber-200/60">Чтобы терять меньше, уменьшите интервал в настройках проекта.</p>
          </div>
        </div>
      )}

      {msg && (
        <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {msg}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Сводка по типам */}
      {data?.by_type?.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.by_type.map(t => {
            const ti = typeInfo(t.promo_type)
            return (
              <div key={t.promo_type} className="p-4 rounded-2xl border border-slate-700/50 bg-slate-900/35">
                <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${ti.tone}`}>
                  <ti.Icon className="w-3.5 h-3.5" /> {ti.label}
                </div>
                <div className="text-2xl font-bold text-white mt-2">{fmtNum(t.n)}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {t.days > 0 && <>выдано {fmtNum(t.days)} дн. </>}
                  {t.kopeks > 0 && <>начислено {fmtRub(t.kopeks)}</>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Имя, username или Telegram ID…"
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-100 text-sm focus:border-cyan-500 focus:outline-none" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>}
        </div>
        <select value={code} onChange={e => { setCode(e.target.value); setOffset(0) }}
          className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm">
          <option value="">Все промокоды</option>
          {facets.codes.map(c => <option key={c.code} value={c.code}>{c.code} ({c.n})</option>)}
        </select>
        <select value={promoType} onChange={e => { setPromoType(e.target.value); setOffset(0) }}
          className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm">
          <option value="">Все типы</option>
          {facets.types.map(t => <option key={t.promo_type} value={t.promo_type}>{typeInfo(t.promo_type).label} ({t.n})</option>)}
        </select>
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0) }} title="Активации с"
          className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm" />
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0) }} title="Активации по"
          className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200 text-sm" />
        {hasFilters && (
          <button onClick={resetFilters} className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 text-sm">
            Сбросить
          </button>
        )}
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Загрузка…
        </div>
      )}

      {/* Таблица активаций */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-900/60 text-slate-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Пользователь</th>
                <th className="text-left px-4 py-3">Промокод</th>
                <th className="text-left px-4 py-3">Тип</th>
                <th className="text-left px-4 py-3">Получил</th>
                <th className="text-left px-4 py-3">Когда</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map(r => {
                const ti = typeInfo(r.promo_type)
                const name = r.user_full_name || r.user_username || `ID ${r.user_id}`
                return (
                  <tr key={r.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-4 py-3">
                      <div className="text-slate-200 truncate max-w-[220px]">{name}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        {r.user_username && <span>@{r.user_username}</span>}
                        <span className="inline-flex items-center">TG {fmtNum(r.user_telegram_id)} <CopyBtn value={r.user_telegram_id} /></span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-cyan-300">{r.code || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${ti.tone}`}>
                        <ti.Icon className="w-3 h-3" /> {ti.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {Number(r.subscription_days) > 0 && <span>{fmtNum(r.subscription_days)} дн.</span>}
                      {Number(r.subscription_days) > 0 && Number(r.balance_bonus_kopeks) > 0 && ' + '}
                      {Number(r.balance_bonus_kopeks) > 0 && <span>{fmtRub(r.balance_bonus_kopeks)}</span>}
                      {!Number(r.subscription_days) && !Number(r.balance_bonus_kopeks) && '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtDT(r.used_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && (
          <p className="text-center text-slate-500 py-10 text-sm">
            {hasFilters ? 'Под фильтры ничего не подошло.' : 'База пуста. Нажмите «Синхронизировать», чтобы забрать активации из бота.'}
          </p>
        )}
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40">Назад</button>
          <span className="text-slate-500">{offset + 1}–{Math.min(offset + limit, total)} из {fmtNum(total)}</span>
          <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40">Вперёд</button>
        </div>
      )}
    </div>
  )
}
