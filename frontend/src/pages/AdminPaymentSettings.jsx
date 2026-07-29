import React, { useEffect, useState } from 'react'
import {
  CreditCard, RefreshCw, Save, Eye, EyeOff, CheckCircle2, AlertCircle,
  Wifi, Link2, Database, FileCog, Info, ExternalLink,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/payment-settings'

// Способы оплаты Platega (paymentMethod в API)
const METHODS = [
  { v: 2, label: 'СБП / QR', hint: 'Система быстрых платежей — по умолчанию' },
  { v: 1, label: 'Банковская карта', hint: 'Оплата картой' },
]

export default function AdminPaymentSettings() {
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const [showSecret, setShowSecret] = useState(false)
  const [test, setTest] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await authFetch(API)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось загрузить настройки')
      setData(d)
      setForm({
        enabled: d.platega.enabled,
        merchant_id: d.platega.merchant_id || '',
        secret: '',                       // пустое = не менять
        payment_method: d.platega.payment_method ?? 2,
        api_url: d.platega.api_url || '',
        success_url: d.platega.success_url || '',
        failed_url: d.platega.failed_url || '',
      })
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true); setError(null); setOk(null); setTest(null)
    try {
      const r = await authFetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка сохранения')
      setOk(d.configured ? 'Настройки сохранены и применены' : 'Сохранено, но ключи заданы не полностью')
      await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function runTest() {
    setTest({ loading: true })
    try {
      const r = await authFetch(`${API}/test`, { method: 'POST' })
      setTest({ loading: false, ...(await r.json()) })
    } catch (e) { setTest({ loading: false, ok: false, error: e.message }) }
  }

  const input = 'w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none'
  const eff = data?.effective

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/25 shrink-0">
          <CreditCard className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">Платёжки</h1>
          <p className="text-xs text-slate-400 hidden sm:block">Настройки платёжной системы — ключи хранятся в базе и применяются без перезапуска</p>
        </div>
        <button onClick={load} className="px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/60 flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
        </button>
      </div>

      {error && <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-300 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
      {ok && <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {ok}</div>}

      {loading && !form ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Загрузка…</div>
      ) : form && (
        <>
          {/* Текущее состояние */}
          <StatusCard eff={eff} updatedAt={data?.updated_at} />

          {/* Platega */}
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800/60 flex-wrap">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"><CreditCard className="w-4 h-4" /></div>
              <span className="text-sm font-semibold text-slate-200">Platega</span>
              <a href="https://platega.io" target="_blank" rel="noreferrer" className="text-[11px] text-slate-500 hover:text-emerald-400 flex items-center gap-1">
                platega.io <ExternalLink className="w-3 h-3" />
              </a>
              <label className="ml-auto flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
                <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 accent-emerald-500" />
                Приём платежей включён
              </label>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Merchant ID *</label>
                  <input autoComplete="off" value={form.merchant_id} onChange={e => set('merchant_id', e.target.value)}
                    placeholder="19e68707-488a-4652-…" className={input + ' font-mono'} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Secret {data?.platega.has_secret && <span className="text-emerald-400">· сохранён</span>}
                  </label>
                  <div className="relative">
                    <input autoComplete="new-password" type={showSecret ? 'text' : 'password'}
                      value={form.secret} onChange={e => set('secret', e.target.value)}
                      placeholder={data?.platega.has_secret ? 'оставьте пустым чтобы не менять' : 'секретный ключ из ЛК Platega'}
                      className={input + ' pr-9 font-mono'} />
                    <button type="button" onClick={() => setShowSecret(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Способ оплаты по умолчанию</label>
                <div className="flex gap-2 flex-wrap">
                  {METHODS.map(m => (
                    <button key={m.v} type="button" onClick={() => set('payment_method', m.v)}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                        form.payment_method === m.v ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-slate-950/40 border-slate-800/60 hover:border-slate-700'}`}>
                      <div className="text-xs font-semibold text-slate-100">{m.label}</div>
                      <div className="text-[10px] text-slate-500">{m.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Необязательные переопределения */}
              <details className="rounded-xl border border-slate-800/60 bg-slate-950/30">
                <summary className="px-3 py-2.5 text-xs text-slate-300 cursor-pointer select-none flex items-center gap-2">
                  <FileCog className="w-3.5 h-3.5 text-slate-500" /> Дополнительно — адреса возврата и API
                </summary>
                <div className="p-3 pt-0 space-y-3">
                  <p className="text-[11px] text-slate-500">Пусто = значения по умолчанию (берутся из <code className="text-slate-400">FRONTEND_URL</code>).</p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">URL успешной оплаты</label>
                      <input autoComplete="off" value={form.success_url} onChange={e => set('success_url', e.target.value)}
                        placeholder={eff?.success_url} className={input + ' font-mono text-xs'} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">URL неуспешной оплаты</label>
                      <input autoComplete="off" value={form.failed_url} onChange={e => set('failed_url', e.target.value)}
                        placeholder={eff?.failed_url} className={input + ' font-mono text-xs'} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">API URL Platega</label>
                    <input autoComplete="off" value={form.api_url} onChange={e => set('api_url', e.target.value)}
                      placeholder="https://app.platega.io" className={input + ' font-mono text-xs'} />
                  </div>
                </div>
              </details>

              {/* Результат теста */}
              {test && !test.loading && (
                <div className={`p-3 rounded-xl border text-sm flex items-start gap-2 ${test.ok ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' : 'bg-rose-500/10 border-rose-500/40 text-rose-300'}`}>
                  {test.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <div>{test.ok ? test.message : test.error}</div>
                    {test.transaction_id && <div className="text-[11px] opacity-70 font-mono mt-0.5 break-all">ID: {test.transaction_id}</div>}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap pt-1">
                <button onClick={save} disabled={saving}
                  className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg flex items-center gap-1.5 hover:shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50">
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Сохранить
                </button>
                <button onClick={runTest} disabled={test?.loading}
                  className="px-4 py-2 text-xs font-semibold bg-slate-800/60 border border-slate-700/50 text-slate-200 rounded-lg flex items-center gap-1.5 hover:text-white disabled:opacity-50">
                  {test?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} Проверить ключи
                </button>
                <span className="text-[11px] text-slate-500">Тест создаёт транзакцию на 10 ₽ и не оплачивает её — деньги не списываются.</span>
              </div>
            </div>
          </div>

          {/* Где взять ключи */}
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4">
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-400 space-y-1.5 min-w-0">
                <p><b className="text-slate-200">Где взять ключи:</b> личный кабинет Platega → раздел с настройками мерчанта. <code className="text-slate-300">Merchant ID</code> и <code className="text-slate-300">Secret</code> используются и для создания счетов, и для проверки подписи вебхука.</p>
                <p><b className="text-slate-200">Вебхук:</b> в кабинете Platega укажите адрес <code className="text-slate-300 break-all">{`${window.location.origin}/api/payments/webhook`}</code> — по нему подтверждается оплата и активируется подписка.</p>
                <p>Ключи хранятся в базе в зашифрованном виде и <b className="text-slate-200">применяются сразу</b>, перезапускать backend не нужно.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Карточка текущего состояния: настроено ли, откуда берутся ключи
function StatusCard({ eff, updatedAt }) {
  if (!eff) return null
  const srcLabel = { db: 'админка (база данных)', env: 'файл .env на сервере', none: '—' }[eff.source] || eff.source
  const good = eff.configured

  return (
    <div className={`rounded-2xl border p-4 ${good ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-amber-500/30 bg-amber-500/[0.06]'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${good ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
          {good ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${good ? 'text-emerald-200' : 'text-amber-200'}`}>
            {good ? 'Оплата настроена и работает' : 'Оплата не настроена — покупка подписок недоступна'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[11px]">
            <Row icon={Database} label="Источник ключей" value={srcLabel} />
            <Row icon={CreditCard} label="Merchant ID" value={eff.merchant_id_tail || '—'} mono />
            <Row icon={Link2} label="Возврат при успехе" value={eff.success_url} mono />
            <Row icon={Link2} label="Возврат при ошибке" value={eff.failed_url} mono />
          </div>
          {eff.source === 'env' && (
            <p className="text-[11px] text-amber-300/90 mt-2">
              Сейчас используются ключи из <code>.env</code>. Заполните поля ниже и сохраните — значения из базы получат приоритет, и менять их можно будет прямо отсюда.
            </p>
          )}
          {updatedAt && <p className="text-[10px] text-slate-500 mt-2">Изменено: {new Date(updatedAt).toLocaleString('ru-RU')}</p>}
        </div>
      </div>
    </div>
  )
}

const Row = ({ icon: Icon, label, value, mono }) => (
  <div className="flex items-center gap-1.5 min-w-0">
    <Icon className="w-3 h-3 text-slate-500 shrink-0" />
    <span className="text-slate-500 shrink-0">{label}:</span>
    <span className={`text-slate-300 truncate ${mono ? 'font-mono' : ''}`} title={value}>{value}</span>
  </div>
)
