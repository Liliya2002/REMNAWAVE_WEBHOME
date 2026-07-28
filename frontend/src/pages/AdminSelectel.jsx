import React, { useEffect, useState } from 'react'
import {
  Cloud, Plus, RefreshCw, Wallet, Server, Trash2, Pencil, X,
  CheckCircle2, AlertCircle, Eye, EyeOff, Info, Wifi, TrendingDown, Network, Key,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { authFetch } from '../services/api'

// ─── Selectel Cloud: аккаунты, баланс, облачные серверы (read-only MVP) ────────

const EMPTY_FORM = {
  name: '', api_key: '', account_id: '', service_username: '', service_password: '',
  default_project: '', default_region: '', notes: '', low_balance_threshold: '',
}

export default function AdminSelectel() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null)      // { editId, form } | null
  const [saving, setSaving] = useState(false)
  const [showSecret, setShowSecret] = useState({})
  const [data, setData] = useState({})           // { [id]: { balance, servers, projects, errors, lb, ls, test } }
  const [confirmDel, setConfirmDel] = useState(null)
  const [ui, setUi] = useState({})               // { [id]: { card, billing, net } } — свёрнутость
  const toggleUi = (id, key) => setUi(p => ({ ...p, [id]: { ...(p[id] || {}), [key]: !p[id]?.[key] } }))
  const isCol = (id, key) => !!ui[id]?.[key]

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await authFetch('/api/admin/selectel/accounts')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки')
      setAccounts(d.accounts || [])
      // Авто-подгрузка данных по всем аккаунтам (если есть креды)
      ;(d.accounts || []).forEach(autoLoad)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  // Подгружает всё, что доступно по кредам аккаунта.
  function autoLoad(a) {
    if (a.has_api_key) { loadBalance(a.id); loadStatistics(a.id); loadTransactions(a.id) }
    if (a.has_service_password) { loadServers(a.id); loadNet(a.id) }
  }
  useEffect(() => { load() }, [])

  const setD = (id, patch) => setData(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))

  async function save() {
    setSaving(true)
    try {
      const editId = modal.editId
      const body = { ...modal.form }
      // В edit-режиме пустые секреты не отправляем (не затирать)
      if (editId) { if (!body.api_key) delete body.api_key; if (!body.service_password) delete body.service_password }
      const r = await authFetch(`/api/admin/selectel/accounts${editId ? '/' + editId : ''}`, {
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
    const r = await authFetch(`/api/admin/selectel/accounts/${id}`, { method: 'DELETE' })
    if (r.ok) { setConfirmDel(null); load() } else { const d = await r.json().catch(() => ({})); alert(d.error || 'Ошибка удаления') }
  }

  async function loadBalance(id) {
    setD(id, { lb: true, balanceErr: null })
    try {
      const r = await authFetch(`/api/admin/selectel/accounts/${id}/balance`)
      const d = await r.json()
      if (!r.ok) setD(id, { lb: false, balance: null, balanceErr: d.error })
      else setD(id, { lb: false, balance: d.balance, balanceErr: null })
    } catch (e) { setD(id, { lb: false, balanceErr: e.message }) }
  }

  async function loadServers(id) {
    setD(id, { ls: true, serversErr: null })
    try {
      const r = await authFetch(`/api/admin/selectel/accounts/${id}/servers`)
      const d = await r.json()
      if (!r.ok) setD(id, { ls: false, servers: null, serversErr: d.error })
      else setD(id, { ls: false, servers: d.servers || [], projects: d.projects || [], errors: d.errors || [], serversErr: null })
    } catch (e) { setD(id, { ls: false, serversErr: e.message }) }
  }

  async function loadStatistics(id) {
    setD(id, { lstat: true, statErr: null })
    try {
      const r = await authFetch(`/api/admin/selectel/accounts/${id}/statistics?days=30`)
      const dd = await r.json()
      if (!r.ok) setD(id, { lstat: false, stats: null, statErr: dd.error })
      else setD(id, { lstat: false, stats: dd.data || [], statDays: dd.days, statErr: null })
    } catch (e) { setD(id, { lstat: false, statErr: e.message }) }
  }

  async function loadTransactions(id) {
    setD(id, { ltx: true, txErr: null })
    try {
      const r = await authFetch(`/api/admin/selectel/accounts/${id}/transactions?days=30&limit=50`)
      const dd = await r.json()
      if (!r.ok) setD(id, { ltx: false, txs: null, txErr: dd.error })
      else setD(id, { ltx: false, txs: dd.transactions || [], txErr: null })
    } catch (e) { setD(id, { ltx: false, txErr: e.message }) }
  }

  async function loadNet(id) {
    setD(id, { lnet: true })
    try {
      const [kr, fr] = await Promise.all([
        authFetch(`/api/admin/selectel/accounts/${id}/ssh-keys`).then(async r => ({ ok: r.ok, j: await r.json() })),
        authFetch(`/api/admin/selectel/accounts/${id}/floating-ips`).then(async r => ({ ok: r.ok, j: await r.json() })),
      ])
      setD(id, {
        lnet: false,
        sshKeys: kr.ok ? (kr.j.keys || []) : null, sshErr: kr.ok ? null : kr.j.error,
        fips: fr.ok ? (fr.j.ips || []) : null, fipErr: fr.ok ? null : fr.j.error,
      })
    } catch (e) { setD(id, { lnet: false, sshErr: e.message, fipErr: e.message }) }
  }
  async function addKey(id, name, publicKey) {
    const r = await authFetch(`/api/admin/selectel/accounts/${id}/ssh-keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, publicKey }),
    })
    if (r.ok) loadNet(id); else { const d = await r.json().catch(() => ({})); alert(d.error || 'Ошибка') }
  }
  async function delKey(id, name) {
    const r = await authFetch(`/api/admin/selectel/accounts/${id}/ssh-keys/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (r.ok) loadNet(id); else { const d = await r.json().catch(() => ({})); alert(d.error || 'Ошибка') }
  }
  async function fipAction(id, path, method = 'POST', body) {
    const r = await authFetch(`/api/admin/selectel/accounts/${id}/floating-ips${path}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    })
    if (r.ok) loadNet(id); else { const d = await r.json().catch(() => ({})); alert(d.error || 'Ошибка') }
  }

  async function test(id) {
    setD(id, { test: { loading: true } })
    try {
      const r = await authFetch(`/api/admin/selectel/accounts/${id}/test`, { method: 'POST' })
      const d = await r.json()
      setD(id, { test: { loading: false, ...d } })
    } catch (e) { setD(id, { test: { loading: false, error: e.message } } ) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-sky-500/25">
          <Cloud className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Selectel Cloud</h1>
          <p className="text-xs text-slate-400">Баланс и облачные серверы (selectel.ru)</p>
        </div>
        <button onClick={load} className="px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/60 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Обновить
        </button>
        <button onClick={() => setModal({ editId: null, form: { ...EMPTY_FORM } })}
          className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-sky-500 to-cyan-500 text-white rounded-lg flex items-center gap-1.5 hover:shadow-lg hover:shadow-sky-500/30">
          <Plus className="w-4 h-4" /> Аккаунт
        </button>
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Загрузка…</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30">
          <Cloud className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">Аккаунтов Selectel пока нет</p>
          <p className="text-xs text-slate-500 mt-1">Добавьте аккаунт: API-ключ для баланса и/или сервисного пользователя для серверов</p>
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map(a => {
            const d = data[a.id] || {}
            // Индикатор низкого баланса: живой баланс (если загружен) или последнее значение из крона.
            const balTotal = d.balance ? balanceTotalRub(d.balance) : (a.last_balance_rub ?? null)
            const lowBal = a.low_balance_threshold != null && balTotal != null && balTotal < a.low_balance_threshold
            return (
              <div key={a.id} className="rounded-2xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
                {/* header */}
                <div className={`flex items-center gap-3 px-4 py-3 ${isCol(a.id, 'card') ? '' : 'border-b border-slate-800/60'}`}>
                  <button onClick={() => toggleUi(a.id, 'card')} className="text-slate-400 hover:text-white shrink-0" title={isCol(a.id, 'card') ? 'Развернуть' : 'Свернуть'}>
                    {isCol(a.id, 'card') ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <Cloud className="w-4 h-4 text-sky-300 shrink-0" />
                  <button onClick={() => toggleUi(a.id, 'card')} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white truncate">{a.name}</span>
                      {a.account_id && <span className="text-[11px] text-slate-500 font-mono">acc {a.account_id}</span>}
                      {a.has_api_key && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">API-ключ</span>}
                      {a.has_service_password && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">сервис.юзер</span>}
                      {!a.is_active && <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/60 text-slate-400">выкл</span>}
                      {lowBal && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 border border-amber-500/40 text-amber-300 flex items-center gap-1" title={`Порог ${a.low_balance_threshold} ₽`}><AlertCircle className="w-3 h-3" /> низкий баланс</span>}
                    </div>
                    {a.notes && <div className="text-xs text-slate-500 truncate">{a.notes}</div>}
                  </button>
                  <button onClick={() => test(a.id)} className="px-3 py-1.5 text-xs rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white flex items-center gap-1.5">
                    {d.test?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} Тест
                  </button>
                  <button onClick={() => setModal({ editId: a.id, form: { ...EMPTY_FORM, name: a.name, account_id: a.account_id || '', service_username: a.service_username || '', default_project: a.default_project || '', default_region: a.default_region || '', notes: a.notes || '', low_balance_threshold: a.low_balance_threshold ?? '', api_key: '', service_password: '' } })}
                    className="p-2 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800/60"><Pencil className="w-4 h-4" /></button>
                  {confirmDel === a.id ? (
                    <span className="flex items-center gap-1">
                      <button onClick={() => del(a.id)} className="px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-500/50 text-[11px] font-bold text-rose-300">Да</button>
                      <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300">Нет</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDel(a.id)} className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>

                {!isCol(a.id, 'card') && (<>
                {/* test result */}
                {d.test && !d.test.loading && (
                  <div className="px-4 py-2 border-b border-slate-800/40 flex flex-wrap gap-3 text-xs">
                    <TestChip label="Баланс" res={d.test.balance} />
                    <TestChip label="Серверы" res={d.test.servers} extra={d.test.servers?.ok ? `${d.test.servers.count} шт` : ''} />
                  </div>
                )}

                {/* body */}
                <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Баланс */}
                  <div className="rounded-xl border border-slate-800/60 bg-slate-950/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-200 flex items-center gap-1.5"><Wallet className="w-4 h-4 text-emerald-400" /> Баланс</span>
                      <button onClick={() => loadBalance(a.id)} disabled={!a.has_api_key}
                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1">
                        {d.lb ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {d.balance ? 'Обновить' : 'Загрузить'}
                      </button>
                    </div>
                    {!a.has_api_key ? <div className="text-xs text-slate-500">Нет API-ключа — баланс недоступен</div>
                      : d.balanceErr ? <div className="text-xs text-rose-400">{d.balanceErr}</div>
                      : d.balance ? <BalanceView balance={d.balance} />
                      : <div className="text-xs text-slate-500">Нажмите «Загрузить»</div>}
                  </div>

                  {/* Серверы */}
                  <div className="rounded-xl border border-slate-800/60 bg-slate-950/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-200 flex items-center gap-1.5"><Server className="w-4 h-4 text-cyan-400" /> Облачные серверы</span>
                      <button onClick={() => loadServers(a.id)} disabled={!a.has_service_password}
                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1">
                        {d.ls ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {d.servers ? 'Обновить' : 'Загрузить'}
                      </button>
                    </div>
                    {!a.has_service_password ? <div className="text-xs text-slate-500">Нет сервисного пользователя — серверы недоступны</div>
                      : d.serversErr ? <div className="text-xs text-rose-400">{d.serversErr}</div>
                      : d.servers ? <ServersView servers={d.servers} errors={d.errors} />
                      : <div className="text-xs text-slate-500">Нажмите «Загрузить»</div>}
                  </div>
                </div>

                {/* Биллинг */}
                <div className="px-4 pb-4">
                  <div className="rounded-xl border border-slate-800/60 bg-slate-950/30 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <button onClick={() => toggleUi(a.id, 'billing')} className="text-slate-400 hover:text-white shrink-0" title={isCol(a.id, 'billing') ? 'Развернуть' : 'Свернуть'}>
                        {isCol(a.id, 'billing') ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <TrendingDown className="w-4 h-4 text-amber-400" />
                      <button onClick={() => toggleUi(a.id, 'billing')} className="text-sm font-semibold text-slate-200">Биллинг · за 30 дней</button>
                      <button onClick={() => { loadStatistics(a.id); loadTransactions(a.id); if (!d.balance) loadBalance(a.id) }} disabled={!a.has_api_key}
                        className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1">
                        {(d.lstat || d.ltx) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Загрузить
                      </button>
                    </div>
                    {isCol(a.id, 'billing') ? null : !a.has_api_key ? <div className="text-xs text-slate-500">Нет API-ключа — биллинг недоступен</div> : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div>
                          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Расходы по продуктам</div>
                          {d.statErr ? <div className="text-xs text-rose-400">{d.statErr}</div>
                            : d.stats ? <StatsView stats={d.stats} days={d.statDays} balance={d.balance} />
                            : <div className="text-xs text-slate-500">Нажмите «Загрузить»</div>}
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Транзакции</div>
                          {d.txErr ? <div className="text-xs text-rose-400">{d.txErr}</div>
                            : d.txs ? <TxView txs={d.txs} />
                            : <div className="text-xs text-slate-500">Нажмите «Загрузить»</div>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Сеть / IP */}
                <div className="px-4 pb-4">
                  <NetPanel a={a} d={d} loadNet={() => loadNet(a.id)} addKey={addKey} delKey={delKey} fipAction={fipAction}
                    collapsed={isCol(a.id, 'net')} onToggle={() => toggleUi(a.id, 'net')} />
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
    </div>
  )
}

function TestChip({ label, res, extra }) {
  if (!res) return null
  return (
    <span className={`inline-flex items-center gap-1 ${res.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
      {res.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
      {label}: {res.ok ? (extra || 'ок') : (res.error || 'ошибка')}
    </span>
  )
}

function BalanceView({ balance }) {
  // Selectel: { data: { billings: [{ balance_type, balances_values_sum, final_sum }], debt_status } }
  // Суммы приходят в копейках → делим на 100 для рублей.
  const billings = balance?.data?.billings
  if (Array.isArray(billings) && billings.length) {
    // Структура: billings[].balances[] = { balance_type, value } (копейки); billings[].balances_values_sum = сумма
    const TYPE_LABEL = { main: 'Основной', bonus: 'Бонусы', vk_rub: 'VK ₽' }
    const rows = []
    for (const b of billings) for (const bal of (b.balances || [])) {
      rows.push({ type: TYPE_LABEL[bal.balance_type] || bal.balance_type, sum: (Number(bal.value) || 0) / 100 })
    }
    const total = billings.reduce((s, b) => s + (Number(b.balances_values_sum) || 0), 0) / 100
    const debt = balance?.data?.debt_status
    const fmt = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    return (
      <div>
        <div className="text-2xl font-bold text-white font-mono mb-2">{fmt(total)} <span className="text-sm text-slate-400">₽</span></div>
        <div className="space-y-0.5 text-xs">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-slate-400">{r.type}</span>
              <span className="font-mono text-slate-200">{fmt(r.sum)} ₽</span>
            </div>
          ))}
        </div>
        {debt && debt !== 'no_debt' && <div className="text-[11px] text-amber-400 mt-1.5">Статус долга: {debt}</div>}
      </div>
    )
  }
  // Fallback: неизвестная структура — покажем сырой JSON
  return (
    <pre className="text-[11px] text-slate-400 font-mono bg-slate-900/60 rounded-lg p-2 overflow-x-auto max-h-40">{JSON.stringify(balance, null, 2)}</pre>
  )
}

function ServersView({ servers, errors }) {
  if ((!servers || servers.length === 0) && (!errors || errors.length === 0)) {
    return <div className="text-xs text-slate-500">Серверов не найдено</div>
  }
  const statusCls = s => s === 'ACTIVE' ? 'text-emerald-400' : s === 'SHUTOFF' ? 'text-slate-400' : s === 'ERROR' ? 'text-rose-400' : 'text-amber-400'
  return (
    <div className="space-y-1.5">
      {(servers || []).map(s => (
        <div key={s.id} className="rounded-lg bg-slate-800/40 border border-slate-700/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${s.status === 'ACTIVE' ? 'bg-emerald-400' : s.status === 'ERROR' ? 'bg-rose-500' : 'bg-slate-500'}`} />
            <span className="text-sm font-semibold text-white truncate flex-1">{s.name}</span>
            <span className={`text-[11px] font-bold ${statusCls(s.status)}`}>{s.status}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mt-1 pl-4">
            <span>{s.region}{s.az ? ` · ${s.az}` : ''}</span>
            {(s.vcpus || s.ram) && <span>{s.vcpus ? `${s.vcpus} vCPU` : ''}{s.ram ? ` · ${Math.round(s.ram / 1024)} GB` : ''}{s.disk ? ` · ${s.disk} GB` : ''}</span>}
            {s.ips?.length > 0 && <span className="font-mono text-slate-500">{s.ips.join(', ')}</span>}
          </div>
        </div>
      ))}
      {errors?.length > 0 && (
        <div className="text-[11px] text-amber-400/80 flex items-start gap-1 mt-1"><Info className="w-3 h-3 mt-0.5 shrink-0" /> {errors.join('; ')}</div>
      )}
    </div>
  )
}

const PRODUCT_LABEL = { vpc: 'Облачные серверы', dbaas: 'Базы данных', mks: 'Kubernetes', storage: 'Хранилище', cdn: 'CDN' }

function balanceTotalRub(balance) {
  const billings = balance?.data?.billings
  if (!Array.isArray(billings)) return null
  return billings.reduce((s, b) => s + (Number(b.balances_values_sum) || 0), 0) / 100
}

function StatsView({ stats, days, balance }) {
  const byProduct = {}
  let total = 0
  for (const row of (stats || [])) {
    const v = (Number(row.value) || 0) / 100
    byProduct[row.provider_key] = (byProduct[row.provider_key] || 0) + v
    total += v
  }
  const rows = Object.entries(byProduct).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const fmt = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

  // Прогноз: баланс / средний дневной расход
  let forecast = null
  const balTotal = balanceTotalRub(balance)
  if (balTotal != null && total > 0 && days) {
    const daily = total / days
    if (daily > 0) forecast = Math.floor(balTotal / daily)
  }

  if (rows.length === 0) return <div className="text-xs text-slate-500">Нет расходов за период</div>
  const max = Math.max(...rows.map(r => r[1]), 1)
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k}>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-slate-300">{PRODUCT_LABEL[k] || k}</span>
            <span className="font-mono text-slate-200">{fmt(v)} ₽</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full" style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="flex justify-between text-xs pt-1.5 border-t border-slate-800/60 mt-1.5">
        <span className="text-slate-400 font-semibold">Итого за {days} дн.</span>
        <span className="font-mono font-bold text-white">{fmt(total)} ₽</span>
      </div>
      {forecast != null && (
        <div className="text-[11px] text-cyan-300 mt-1">📅 Баланса хватит ещё на ~<b>{forecast}</b> дн. при текущем расходе</div>
      )}
    </div>
  )
}

function TxView({ txs }) {
  if (!txs || !txs.length) return <div className="text-xs text-slate-500">Нет транзакций за период</div>
  const fmt = n => (n / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  const desc = t => typeof t.description === 'object' && t.description
    ? (t.description.ru || t.description.en || Object.values(t.description)[0] || '—')
    : (t.description || t.transaction_type || '—')
  return (
    <div className="space-y-0.5 max-h-56 overflow-y-auto thin-scroll">
      {txs.slice(0, 50).map((t, i) => {
        const out = t.dir === 'outgoing' || (Number(t.price) || 0) < 0
        return (
          <div key={t.id || i} className="flex items-center gap-2 text-xs py-1 border-b border-slate-800/40 last:border-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${out ? 'bg-rose-400' : 'bg-emerald-400'}`} />
            <span className="text-slate-400 truncate flex-1" title={desc(t)}>{desc(t)}</span>
            <span className={`font-mono shrink-0 ${out ? 'text-rose-300' : 'text-emerald-300'}`}>{out ? '−' : '+'}{fmt(Math.abs(Number(t.price) || 0))} ₽</span>
            <span className="text-[10px] text-slate-600 shrink-0 hidden sm:inline">{t.created ? new Date(t.created).toLocaleDateString('ru-RU') : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function NetPanel({ a, d, loadNet, addKey, delKey, fipAction, collapsed, onToggle }) {
  const [keyName, setKeyName] = useState('')
  const [keyVal, setKeyVal] = useState('')
  const [attachSel, setAttachSel] = useState({})
  const servers = d.servers || []
  const canNet = a.has_service_password

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-950/30 p-3">
      <div className="flex items-center gap-2 mb-2">
        <button onClick={onToggle} className="text-slate-400 hover:text-white shrink-0" title={collapsed ? 'Развернуть' : 'Свернуть'}>
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <Network className="w-4 h-4 text-cyan-400" />
        <button onClick={onToggle} className="text-sm font-semibold text-slate-200">Сеть / IP</button>
        <button onClick={loadNet} disabled={!canNet}
          className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1">
          {d.lnet ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Загрузить
        </button>
      </div>
      {collapsed ? null : !canNet ? <div className="text-xs text-slate-500">Нет сервисного пользователя — сеть недоступна</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* SSH-ключи */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">SSH-ключи проекта</div>
            {d.sshErr ? <div className="text-xs text-rose-400">{d.sshErr}</div>
              : d.sshKeys ? (
                <div className="space-y-1">
                  {d.sshKeys.length === 0 && <div className="text-xs text-slate-500">Ключей нет</div>}
                  {d.sshKeys.map(k => (
                    <div key={k.name} className="flex items-center gap-2 text-xs bg-slate-800/40 border border-slate-700/30 rounded-lg px-2 py-1">
                      <Key className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="text-slate-200 truncate flex-1" title={k.fingerprint}>{k.name}</span>
                      <button onClick={() => { if (confirm(`Удалить ключ «${k.name}»?`)) delKey(a.id, k.name) }} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <div className="pt-1.5 space-y-1.5">
                    <input value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="имя ключа" autoComplete="off"
                      className="w-full px-2 py-1 text-xs bg-slate-950/60 border border-slate-700 rounded text-white" />
                    <textarea value={keyVal} onChange={e => setKeyVal(e.target.value)} placeholder="ssh-ed25519 AAAA..." rows={2} autoComplete="off"
                      className="w-full px-2 py-1 text-xs bg-slate-950/60 border border-slate-700 rounded text-white font-mono" />
                    <button onClick={() => { if (keyName.trim() && keyVal.trim()) { addKey(a.id, keyName.trim(), keyVal.trim()); setKeyName(''); setKeyVal('') } }}
                      disabled={!keyName.trim() || !keyVal.trim()}
                      className="text-xs px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 disabled:opacity-40 flex items-center gap-1"><Plus className="w-3 h-3" /> Добавить ключ</button>
                  </div>
                </div>
              ) : <div className="text-xs text-slate-500">Нажмите «Загрузить»</div>}
          </div>

          {/* Floating IP */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Публичные IP</span>
              {d.fips && <button onClick={() => fipAction(a.id, '/allocate')} className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1"><Plus className="w-3 h-3" /> Выделить</button>}
            </div>
            {d.fipErr ? <div className="text-xs text-rose-400">{d.fipErr}</div>
              : d.fips ? (
                <div className="space-y-1">
                  {d.fips.length === 0 && <div className="text-xs text-slate-500">Публичных IP нет</div>}
                  {d.fips.map(f => (
                    <div key={f.id} className="bg-slate-800/40 border border-slate-700/30 rounded-lg px-2 py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${f.status === 'ACTIVE' ? 'bg-emerald-400' : f.portId ? 'bg-amber-400' : 'bg-slate-500'}`} />
                        <span className="font-mono text-slate-200 flex-1">{f.ip}</span>
                        <span className="text-[10px] text-slate-500">{f.portId ? `→ ${f.fixedIp || 'привязан'}` : 'свободен'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        {f.portId ? (
                          <button onClick={() => fipAction(a.id, `/${f.id}/detach`)} className="text-[11px] px-2 py-0.5 rounded bg-slate-700/60 text-slate-300">Отвязать</button>
                        ) : (
                          <>
                            <select value={attachSel[f.id] || ''} onChange={e => setAttachSel(s => ({ ...s, [f.id]: e.target.value }))}
                              className="text-[11px] px-1 py-0.5 rounded bg-slate-950/60 border border-slate-700 text-slate-200 flex-1 min-w-0">
                              <option value="">— сервер —</option>
                              {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <button onClick={() => { const sid = attachSel[f.id]; if (sid) fipAction(a.id, `/${f.id}/attach`, 'POST', { serverId: sid }) }}
                              disabled={!attachSel[f.id]} className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 disabled:opacity-40">Привязать</button>
                          </>
                        )}
                        <button onClick={() => { if (confirm(`Освободить IP ${f.ip}?`)) fipAction(a.id, `/${f.id}`, 'DELETE') }}
                          className="text-[11px] px-2 py-0.5 rounded text-rose-400 hover:bg-rose-500/10 ml-auto">Освободить</button>
                      </div>
                    </div>
                  ))}
                  {servers.length === 0 && (d.fips.length > 0) && <div className="text-[10px] text-slate-600 mt-1">Для привязки загрузите список серверов выше ↑</div>}
                </div>
              ) : <div className="text-xs text-slate-500">Нажмите «Загрузить»</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function AccountModal({ modal, setModal, save, saving, showSecret, setShowSecret }) {
  const f = modal.form
  const set = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }))
  const inputCls = 'w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-sky-500 focus:outline-none'
  const secretField = (key, label, placeholder) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <input autoComplete="new-password" type={showSecret[key] ? 'text' : 'password'} value={f[key]} onChange={e => set(key, e.target.value)}
          placeholder={placeholder} className={inputCls + ' pr-9 font-mono'} />
        <button type="button" onClick={() => setShowSecret(s => ({ ...s, [key]: !s[key] }))}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
          {showSecret[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setModal(null)} />
      <div className="relative w-full max-w-lg bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between shrink-0">
          <h3 className="text-white font-bold">{modal.editId ? 'Изменить аккаунт Selectel' : 'Новый аккаунт Selectel'}</h3>
          <button onClick={() => setModal(null)} className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto thin-scroll">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Название *</label>
            <input autoComplete="off" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Selectel основной" className={inputCls} />
          </div>

          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pt-1">Баланс (API-ключ)</div>
          {secretField('api_key', 'Статический API-ключ (X-Token)', modal.editId ? 'оставьте пустым чтобы не менять' : 'Профиль → Доступ → API-ключи')}

          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pt-1">Облачные серверы (OpenStack)</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Account ID</label>
              <input autoComplete="off" value={f.account_id} onChange={e => set('account_id', e.target.value)} placeholder="123456" className={inputCls + ' font-mono'} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Проект (опц.)</label>
              <input autoComplete="off" value={f.default_project} onChange={e => set('default_project', e.target.value)} placeholder="пусто = все" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Сервисный пользователь (логин)</label>
            <input autoComplete="off" value={f.service_username} onChange={e => set('service_username', e.target.value)} placeholder="имя сервисного юзера" className={inputCls} />
          </div>
          {secretField('service_password', 'Пароль сервисного пользователя', modal.editId ? 'оставьте пустым чтобы не менять' : '')}

          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pt-1">Уведомления</div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Порог низкого баланса, ₽</label>
            <input autoComplete="off" type="number" min="0" step="1" value={f.low_balance_threshold}
              onChange={e => set('low_balance_threshold', e.target.value)} placeholder="напр. 500 (пусто = выкл)"
              className={inputCls + ' font-mono'} />
            <p className="text-[11px] text-slate-500 mt-1">Когда баланс опустится ниже — придёт уведомление админу в Telegram (бейдж «низкий баланс» на карточке). Требуется API-ключ. Проверка раз в час.</p>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Заметки</label>
            <textarea autoComplete="off" value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} className={inputCls} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-800/60 flex justify-end gap-2 shrink-0">
          <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300">Отмена</button>
          <button onClick={save} disabled={saving || !f.name.trim()}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-sky-500 to-cyan-500 text-white disabled:opacity-50 flex items-center gap-1.5">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
