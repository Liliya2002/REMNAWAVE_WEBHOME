import React, { useEffect, useState, useCallback } from 'react'
import {
  Ticket, Plus, RefreshCw, AlertCircle, Search, X, Copy, CheckCircle2,
  Percent, Wallet, CalendarDays, Banknote, Power, Download, Layers,
  Info, History, TriangleAlert,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/promo'

// ─── Свои промокоды. Не путать с /admin/bedolaga/promo — там чужой бот ───────

const fmtDT = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) }
const fmtDate = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU') }
const fmtRub = v => Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'

const TYPES = [
  { id: 'percent', label: 'Скидка %',   Icon: Percent,      tone: 'text-amber-400',   unit: '%' },
  { id: 'fixed',   label: 'Скидка ₽',   Icon: Banknote,     tone: 'text-orange-400',  unit: '₽' },
  { id: 'days',    label: 'Дни',        Icon: CalendarDays, tone: 'text-emerald-400', unit: 'дн.' },
  { id: 'balance', label: 'На баланс',  Icon: Wallet,       tone: 'text-sky-400',     unit: '₽' },
]
const typeInfo = t => TYPES.find(x => x.id === t) || TYPES[0]

const PERIODS = [
  { id: 'monthly', label: 'Месяц' },
  { id: 'quarterly', label: '3 месяца' },
  { id: 'yearly', label: 'Год' },
]

const isDiscount = t => t === 'percent' || t === 'fixed'

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

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full mt-1 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 focus:outline-none'

/**
 * Расшифровка условий человеческим языком. Форма с десятью полями читается
 * плохо, а одна фраза сразу показывает, что получится.
 */
function describe(f) {
  const t = typeInfo(f.type)
  const parts = []

  if (f.type === 'percent') parts.push(`−${f.value || 0} % на заказ`)
  else if (f.type === 'fixed') parts.push(`−${f.value || 0} ₽ на заказ`)
  else if (f.type === 'days') parts.push(`+${f.value || 0} дн. подписки`)
  else parts.push(`+${f.value || 0} ₽ на баланс`)

  if (isDiscount(f.type)) {
    if (f.plan_ids?.length) parts.push(`только тарифы #${f.plan_ids.join(', #')}`)
    if (f.periods?.length) parts.push(`период: ${f.periods.map(p => PERIODS.find(x => x.id === p)?.label || p).join(', ')}`)
    if (f.min_amount) parts.push(`от ${f.min_amount} ₽`)
  }
  if (f.starts_at) parts.push(`с ${fmtDate(f.starts_at)}`)
  if (f.expires_at) parts.push(`до ${fmtDate(f.expires_at)}`)
  parts.push(f.max_uses ? `${f.max_uses} активаций` : 'без общего лимита')
  parts.push(`по ${f.max_uses_per_user || 1} на человека`)
  if (f.first_purchase_only) parts.push('только первая покупка')
  if (f.new_users_only_days) parts.push(`аккаунт не старше ${f.new_users_only_days} дн.`)
  if (f.assigned_user_id) parts.push(`персональный, для #${f.assigned_user_id}`)

  return { text: parts.join(', '), Icon: t.Icon, tone: t.tone }
}

const emptyForm = {
  code: '', type: 'percent', value: '', max_uses: '', max_uses_per_user: 1,
  starts_at: '', expires_at: '', min_amount: '', plan_ids: [], periods: [],
  first_purchase_only: false, new_users_only_days: '', assigned_user_id: '',
  comment: '', batch_label: '',
}

export default function AdminPromo() {
  const [items, setItems] = useState([])
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const [q, setQ] = useState('')
  const [fType, setFType] = useState('')
  const [fActive, setFActive] = useState('')

  const [form, setForm] = useState(null)          // null = форма закрыта
  const [saving, setSaving] = useState(false)
  const [bulk, setBulk] = useState(null)          // null = генератор закрыт
  const [uses, setUses] = useState(null)          // { promo, items }
  const [stats, setStats] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const p = new URLSearchParams()
      if (q) p.set('q', q)
      if (fType) p.set('type', fType)
      if (fActive) p.set('active', fActive)
      const r = await authFetch(`${API}?${p}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки')
      setItems(d.items || [])
    } catch (e) {
      if (e.message !== 'Unauthorized' && e.message !== 'No token') setError(e.message)
    } finally { setLoading(false) }
  }, [q, fType, fActive])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    authFetch('/api/plans').then(r => r.ok ? r.json() : null)
      .then(d => setPlans(d?.plans || d || [])).catch(() => {})
  }, [])

  // Сводка пересчитывается вместе со списком: после создания или активации
  // цифры обязаны сойтись с тем, что видно в таблице.
  useEffect(() => {
    authFetch('/api/admin/stats/promo').then(r => r.ok ? r.json() : null)
      .then(d => d && setStats(d)).catch(() => {})
  }, [items])

  const flash = msg => { setNotice(msg); setTimeout(() => setNotice(null), 3500) }

  async function save() {
    setSaving(true); setError(null)
    try {
      const body = { ...form }
      // Пустые строки → null: бэкенд трактует их как «не задано».
      for (const k of ['max_uses', 'min_amount', 'new_users_only_days', 'assigned_user_id', 'starts_at', 'expires_at']) {
        if (body[k] === '') body[k] = null
      }
      const editing = !!form.id
      const r = await authFetch(editing ? `${API}/${form.id}` : API, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось сохранить')
      setForm(null); flash(editing ? 'Промокод изменён' : 'Промокод создан'); load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function deactivate(item) {
    if (!confirm(`Отключить промокод ${item.code}? Журнал активаций останется.`)) return
    try {
      const r = await authFetch(`${API}/${item.id}/deactivate`, { method: 'POST' })
      if (!r.ok) throw new Error((await r.json()).error || 'Ошибка')
      flash('Промокод отключён'); load()
    } catch (e) { setError(e.message) }
  }

  async function openUses(item) {
    try {
      const r = await authFetch(`${API}/uses?promo_id=${item.id}`)
      const d = await r.json()
      setUses({ promo: item, items: d.items || [] })
    } catch (e) { setError(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Ticket className="w-5 h-5 text-cyan-400" /> Промокоды
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Свои коды проекта. Коды стороннего бота — в разделе «Промокоды бота».
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Обновить
          </button>
          <a href={`${API}/export`} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2">
            <Download className="w-4 h-4" /> CSV
          </a>
          <button onClick={() => setBulk({ count: 10, length: 8, prefix: '', type: 'percent', value: '', max_uses_per_user: 1, batch_label: '' })}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" /> Пачка
          </button>
          <button onClick={() => setForm({ ...emptyForm })}
            className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4" /> Создать
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Сводка */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: 'Кодов всего',   value: stats.codes_total },
            { label: 'Активных',      value: stats.codes_active },
            { label: 'Активаций',     value: stats.uses_applied },
            { label: 'В резерве',     value: stats.uses_reserved, tone: stats.uses_reserved ? 'text-amber-400' : '' },
            { label: 'Скидок выдано', value: fmtRub(stats.discount_total) },
            { label: 'Дней начислено', value: stats.days_total },
          ].map(c => (
            <div key={c.label} className="p-3 rounded-xl bg-slate-900/50 border border-slate-700/60">
              <div className={`text-lg font-bold ${c.tone || 'text-white'}`}>{c.value}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      )}
      {stats?.uses_over_limit > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          Активаций сверх лимита: <b>{stats.uses_over_limit}</b>. Это платежи, подтверждённые после истечения резерва — деньги получены, скидка применена.
        </div>
      )}

      {/* Фильтры */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по коду"
            className="w-full pl-9 pr-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 focus:outline-none" />
        </div>
        <select value={fType} onChange={e => setFType(e.target.value)}
          className="px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-slate-200 text-sm">
          <option value="">Все типы</option>
          {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={fActive} onChange={e => setFActive(e.target.value)}
          className="px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-slate-200 text-sm">
          <option value="">Все</option>
          <option value="true">Активные</option>
          <option value="false">Отключённые</option>
        </select>
      </div>

      {/* Список */}
      {!loading && !items.length && (
        <div className="p-8 text-center text-slate-500 text-sm border border-dashed border-slate-700 rounded-xl">
          Промокодов пока нет
        </div>
      )}

      <div className="space-y-2">
        {items.map(it => {
          const t = typeInfo(it.type)
          const used = Number(it.used_count || 0)
          const reserved = Number(it.reserved_count || 0)
          const over = Number(it.over_limit_count || 0)
          const expired = it.expires_at && new Date(it.expires_at) < new Date()
          return (
            <div key={it.id}
              className={`p-3 rounded-xl border flex items-center gap-3 flex-wrap ${
                it.is_active && !expired
                  ? 'bg-slate-900/50 border-slate-700/60'
                  : 'bg-slate-900/30 border-slate-800 opacity-60'
              }`}>
              <t.Icon className={`w-5 h-5 shrink-0 ${t.tone}`} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-sm text-white">{it.code}</span>
                  <CopyBtn value={it.code} />
                  {!it.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">отключён</span>}
                  {expired && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">истёк</span>}
                  {it.assigned_login && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">персональный: {it.assigned_login}</span>}
                  {it.batch_label && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">{it.batch_label}</span>}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{describe(it).text}</div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-sm text-slate-200">
                  {used}{it.max_uses ? ` / ${it.max_uses}` : ''}
                  {reserved > 0 && <span className="text-amber-400 text-xs"> +{reserved} в резерве</span>}
                </div>
                <div className="text-[11px] text-slate-500">активаций</div>
              </div>

              {over > 0 && (
                <span title="Активаций сверх лимита: платёж подтвердился после истечения резерва"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 flex items-center gap-1">
                  <TriangleAlert className="w-3 h-3" /> {over}
                </span>
              )}

              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openUses(it)} title="Журнал активаций"
                  className="p-2 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-slate-200">
                  <History className="w-4 h-4" />
                </button>
                <button onClick={() => setForm({
                  ...emptyForm, ...it,
                  starts_at: it.starts_at ? it.starts_at.slice(0, 10) : '',
                  expires_at: it.expires_at ? it.expires_at.slice(0, 10) : '',
                  max_uses: it.max_uses ?? '', min_amount: it.min_amount ?? '',
                  new_users_only_days: it.new_users_only_days ?? '',
                  assigned_user_id: it.assigned_user_id ?? '',
                })} className="px-2 py-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 text-xs">
                  Изменить
                </button>
                {it.is_active && (
                  <button onClick={() => deactivate(it)} title="Отключить"
                    className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-300">
                    <Power className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Форма создания / изменения ── */}
      {form && (
        <Modal title={form.id ? `Промокод ${form.code}` : 'Новый промокод'} onClose={() => setForm(null)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Код" hint="Только латиница и цифры. Регистр и дефисы при вводе не важны.">
              <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                className={inputCls + ' font-mono'} placeholder="SUMMER25" />
            </Field>
            <Field label="Тип">
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={inputCls}>
                {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label={`Значение (${typeInfo(form.type).unit})`}>
              <input type="number" min="0" step="0.01" value={form.value}
                onChange={e => setForm({ ...form, value: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Всего активаций" hint="Пусто — без ограничения">
              <input type="number" min="1" value={form.max_uses}
                onChange={e => setForm({ ...form, max_uses: e.target.value })} className={inputCls} />
            </Field>
            <Field label="На одного пользователя">
              <input type="number" min="1" value={form.max_uses_per_user}
                onChange={e => setForm({ ...form, max_uses_per_user: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Персональный код" hint="ID пользователя. Пусто — код общий">
              <input type="number" value={form.assigned_user_id}
                onChange={e => setForm({ ...form, assigned_user_id: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Действует с"><input type="date" value={form.starts_at}
              onChange={e => setForm({ ...form, starts_at: e.target.value })} className={inputCls} /></Field>
            <Field label="Действует до"><input type="date" value={form.expires_at}
              onChange={e => setForm({ ...form, expires_at: e.target.value })} className={inputCls} /></Field>

            {isDiscount(form.type) && (
              <>
                <Field label="Минимальная сумма заказа, ₽">
                  <input type="number" min="0" value={form.min_amount}
                    onChange={e => setForm({ ...form, min_amount: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Периоды" hint="Ничего не выбрано — любой период">
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {PERIODS.map(p => (
                      <label key={p.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                        <input type="checkbox" className="accent-cyan-500"
                          checked={form.periods?.includes(p.id)}
                          onChange={e => setForm({
                            ...form,
                            periods: e.target.checked
                              ? [...(form.periods || []), p.id]
                              : (form.periods || []).filter(x => x !== p.id),
                          })} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Тарифы" hint="Ничего не выбрано — любой тариф">
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {plans.filter(p => !p.is_trial).map(p => (
                        <label key={p.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                          <input type="checkbox" className="accent-cyan-500"
                            checked={form.plan_ids?.includes(p.id)}
                            onChange={e => setForm({
                              ...form,
                              plan_ids: e.target.checked
                                ? [...(form.plan_ids || []), p.id]
                                : (form.plan_ids || []).filter(x => x !== p.id),
                            })} />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
              </>
            )}

            <Field label="Аккаунт не старше, дней" hint="Пусто — без ограничения">
              <input type="number" min="0" value={form.new_users_only_days}
                onChange={e => setForm({ ...form, new_users_only_days: e.target.value })} className={inputCls} />
            </Field>
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" className="accent-cyan-500 w-4 h-4" checked={!!form.first_purchase_only}
                onChange={e => setForm({ ...form, first_purchase_only: e.target.checked })} />
              <span className="text-sm text-slate-300">Только первая покупка</span>
            </label>

            <div className="sm:col-span-2">
              <Field label="Комментарий" hint="Для себя: откуда код, кому выдан">
                <input value={form.comment || ''} onChange={e => setForm({ ...form, comment: e.target.value })} className={inputCls} />
              </Field>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs text-slate-300 flex items-start gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <span>{describe(form).text}</span>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setForm(null)} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm">Отмена</button>
            <button onClick={save} disabled={saving}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-semibold">
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </Modal>
      )}

      {bulk && <BulkModal bulk={bulk} setBulk={setBulk} onDone={m => { flash(m); load() }} onError={setError} />}

      {uses && (
        <Modal title={`Активации ${uses.promo.code}`} onClose={() => setUses(null)}>
          {!uses.items.length && <div className="text-sm text-slate-500 py-6 text-center">Активаций пока нет</div>}
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto thin-scroll">
            {uses.items.map(u => (
              <div key={u.id} className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-700/50 flex items-center gap-3 text-sm">
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                  u.status === 'applied' ? 'bg-emerald-500/20 text-emerald-300'
                  : u.status === 'reserved' ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-slate-700 text-slate-400'}`}>{u.status}</span>
                <span className="text-slate-200 min-w-0 truncate flex-1">{u.login || `ID ${u.user_id}`}</span>
                {u.discount_amount != null && <span className="text-slate-400 text-xs shrink-0">−{fmtRub(u.discount_amount)}</span>}
                {u.granted_days != null && <span className="text-emerald-400 text-xs shrink-0">+{u.granted_days} дн.</span>}
                {u.granted_balance != null && <span className="text-sky-400 text-xs shrink-0">+{fmtRub(u.granted_balance)}</span>}
                {u.over_limit && <TriangleAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" title="Сверх лимита" />}
                <span className="text-slate-500 text-xs shrink-0">{fmtDT(u.created_at)}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="w-full max-w-2xl my-8 bg-slate-900 border border-slate-700 rounded-2xl p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Генератор пачки. Сначала обязательный предпросмотр (dry-run) — по правилу
 * проекта массовые действия не выполняются вслепую.
 */
function BulkModal({ bulk, setBulk, onDone, onError }) {
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(dryRun) {
    setBusy(true)
    try {
      const body = { ...bulk, dry_run: dryRun }
      for (const k of ['max_uses', 'min_amount']) if (body[k] === '') body[k] = null
      const r = await authFetch(`${API}/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка генерации')
      if (dryRun) setPreview(d)
      else { setBulk(null); onDone(`Создано кодов: ${d.created}`) }
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Сгенерировать пачку кодов" onClose={() => setBulk(null)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Количество"><input type="number" min="1" max="1000" value={bulk.count}
          onChange={e => setBulk({ ...bulk, count: Number(e.target.value) })} className={inputCls} /></Field>
        <Field label="Длина кода" hint="Без символов 0/O и 1/I/L — коды диктуют голосом">
          <input type="number" min="4" max="32" value={bulk.length}
            onChange={e => setBulk({ ...bulk, length: Number(e.target.value) })} className={inputCls} /></Field>
        <Field label="Префикс" hint="Необязательно, например NY2027">
          <input value={bulk.prefix} onChange={e => setBulk({ ...bulk, prefix: e.target.value.toUpperCase() })}
            className={inputCls + ' font-mono'} /></Field>
        <Field label="Метка пачки" hint="По ней потом фильтровать и выгружать">
          <input value={bulk.batch_label} onChange={e => setBulk({ ...bulk, batch_label: e.target.value })} className={inputCls} /></Field>
        <Field label="Тип">
          <select value={bulk.type} onChange={e => setBulk({ ...bulk, type: e.target.value })} className={inputCls}>
            {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select></Field>
        <Field label={`Значение (${typeInfo(bulk.type).unit})`}>
          <input type="number" min="0" step="0.01" value={bulk.value}
            onChange={e => setBulk({ ...bulk, value: e.target.value })} className={inputCls} /></Field>
        <Field label="Активаций на код" hint="Пусто — без ограничения">
          <input type="number" min="1" value={bulk.max_uses ?? ''}
            onChange={e => setBulk({ ...bulk, max_uses: e.target.value })} className={inputCls} /></Field>
        <Field label="На одного пользователя">
          <input type="number" min="1" value={bulk.max_uses_per_user}
            onChange={e => setBulk({ ...bulk, max_uses_per_user: Number(e.target.value) })} className={inputCls} /></Field>
      </div>

      {preview && (
        <div className="mt-4 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
          <div className="text-xs text-slate-400 mb-2">Будет создано кодов: <b className="text-white">{preview.count}</b>. Примеры:</div>
          <div className="font-mono text-xs text-cyan-300 flex flex-wrap gap-x-3 gap-y-1">
            {preview.sample.map(c => <span key={c}>{c}</span>)}
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => setBulk(null)} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm">Отмена</button>
        <button onClick={() => run(true)} disabled={busy}
          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm">
          Предпросмотр
        </button>
        <button onClick={() => run(false)} disabled={busy || !preview}
          title={!preview ? 'Сначала предпросмотр' : ''}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-semibold">
          Создать
        </button>
      </div>
    </Modal>
  )
}
