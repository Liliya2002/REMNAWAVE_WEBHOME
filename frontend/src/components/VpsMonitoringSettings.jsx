import React, { useEffect, useState } from 'react'
import {
  Activity, RefreshCw, Save, AlertCircle, CheckCircle2, Play,
  Clock, Network, Globe2, Layers, Bell, Terminal, Info,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/vps-settings'

/**
 * Параметры мониторинга VPS (Настройки → VPS → Параметры мониторинга).
 * Раньше задавались только в .env и требовали перезапуска backend — теперь
 * применяются сразу: после сохранения крон перепланируется.
 */
const FIELDS = [
  { key: 'health_enabled', type: 'bool', Icon: Activity,
    label: 'Проверка доступности включена',
    hint: 'Выключение остановит health-check: статусы серверов перестанут обновляться, уведомления о падениях приходить не будут.' },
  { key: 'health_interval_min', type: 'int', Icon: Clock, unit: 'мин',
    label: 'Интервал проверки',
    hint: 'Как часто опрашиваются серверы. Падение замечается в среднем за половину интервала. Меньше 5 минут ставить не стоит — у внешнего сервиса свои лимиты.' },
  { key: 'health_ping_port', type: 'int', Icon: Network,
    label: 'Проверяемый порт',
    hint: 'TCP-порт, доступность которого означает «сервер жив». Обычно 22 (SSH).' },
  { key: 'health_check_nodes', type: 'int', Icon: Globe2,
    label: 'Точек проверки',
    hint: 'Сколько узлов check-host.net опрашивать. Сервер считается доступным, если ответил хотя бы с одного.' },
  { key: 'health_parallelism', type: 'int', Icon: Layers,
    label: 'Параллельных проверок',
    hint: 'Сколько серверов проверяется одновременно. Высокое значение может упереться в лимиты внешнего сервиса.' },
  { key: 'expiry_notify_hour', type: 'int', Icon: Bell, unit: 'ч UTC',
    label: 'Час напоминаний об оплате',
    hint: 'Во сколько (UTC) присылать сводку по серверам, у которых заканчивается оплата.' },
  { key: 'default_ssh_port', type: 'int', Icon: Terminal,
    label: 'SSH-порт по умолчанию',
    hint: 'Подставляется в форму нового сервера. Полезно, если хостер блокирует 22 и вы используете нестандартный порт.' },
]

export default function VpsMonitoringSettings() {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await authFetch(API)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось загрузить настройки')
      setData(d)
      // В поля кладём только явно сохранённое: пустое = «из .env».
      setForm(Object.fromEntries(Object.entries(d.saved).map(([k, v]) => [k, v ?? ''])))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save() {
    setSaving(true); setError(null); setOk(null)
    try {
      const r = await authFetch(API, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка сохранения')
      setOk('Сохранено и применено — перезапуск не нужен')
      await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function runNow() {
    setRunning(true); setError(null); setOk(null)
    try {
      const r = await authFetch(`${API}/run-check`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка запуска')
      setOk('Проверка выполнена — статусы серверов обновлены')
    } catch (e) { setError(e.message) }
    finally { setRunning(false) }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const eff = data?.effective
  const input = 'w-full px-2.5 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 focus:outline-none'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" /> Параметры мониторинга
          </h4>
          <p className="text-xs text-slate-400 mt-1">
            Доступность серверов проверяется снаружи, через check-host.net — блокировки
            на вашем сервере на неё не влияют.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={runNow} disabled={running}
            className="px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/50 text-slate-200 rounded-lg hover:text-white flex items-center gap-1.5 disabled:opacity-50">
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Проверить сейчас
          </button>
          <button onClick={save} disabled={saving || loading}
            className="px-3 py-2 text-xs font-bold bg-gradient-to-r from-cyan-500 to-sky-500 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Сохранить
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span className="min-w-0">{error}</span></div>}
      {ok && <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {ok}</div>}

      {loading && !data ? (
        <div className="py-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Загрузка…
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-800/60 bg-slate-950/30 p-3 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400">
              Пустое поле означает «взять значение из <code className="text-slate-300">.env</code>».
              Рядом с каждым параметром показано, что применяется сейчас и откуда взято.
            </p>
          </div>

          <div className="space-y-2.5">
            {FIELDS.map(f => {
              const from = eff?.source?.[f.key]
              const current = eff?.[f.key]
              const lim = data?.limits?.[f.key]
              return (
                <div key={f.key} className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3">
                  <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <f.Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {f.label}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">{f.hint}</p>
                    </div>

                    <div className="w-full sm:w-44 shrink-0">
                      {f.type === 'bool' ? (
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input type="checkbox"
                            checked={form[f.key] === '' ? !!current : !!form[f.key]}
                            onChange={e => set(f.key, e.target.checked)}
                            className="w-4 h-4 rounded bg-slate-950 border-slate-700 accent-cyan-500" />
                          {(form[f.key] === '' ? current : form[f.key]) ? 'включено' : 'выключено'}
                        </label>
                      ) : (
                        <div className="relative">
                          <input type="number" autoComplete="off"
                            value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}
                            placeholder={`из .env: ${current ?? '—'}`}
                            min={lim?.[0]} max={lim?.[1]} className={input + (f.unit ? ' pr-14' : '')} />
                          {f.unit && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">{f.unit}</span>}
                        </div>
                      )}
                      <div className="text-[10px] mt-1 flex items-center gap-1.5">
                        <span className="text-slate-500">сейчас:</span>
                        <span className="text-slate-300 font-mono">
                          {f.type === 'bool' ? (current ? 'вкл' : 'выкл') : current}
                        </span>
                        <span className={`px-1 rounded ${from === 'db' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-slate-700/60 text-slate-400'}`}>
                          {from === 'db' ? 'админка' : '.env'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {data?.updated_at && (
            <p className="text-[11px] text-slate-600">Изменено: {new Date(data.updated_at).toLocaleString('ru-RU')}</p>
          )}
        </>
      )}
    </div>
  )
}
