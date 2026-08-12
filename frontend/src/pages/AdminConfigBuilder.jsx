import React, { useEffect, useMemo, useState } from 'react'
import {
  Wrench, KeyRound, Copy, Download, CheckCircle2, AlertCircle, AlertTriangle,
  RefreshCw, FileJson, Layers, Shuffle,
} from 'lucide-react'
import { authFetch } from '../services/api'
import { buildConfig, validate, DEFAULTS, TRANSPORTS, SECURITIES } from '../lib/xrayConfig'

const API = '/api/admin/config-builder'

/**
 * Конструктор конфигов RemnaWave: форма слева, готовый JSON справа.
 *
 * Сборка идёт на фронте (модуль lib/xrayConfig.js) — предпросмотр обновляется
 * сразу. На сервер ходим только за тем, чего в браузере не сделать:
 * ключи Reality и список существующих профилей панели.
 */

const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-100 text-sm focus:border-cyan-500 focus:outline-none transition'

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
  </div>
)

const Check = ({ checked, onChange, children }) => (
  <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-cyan-500 mt-0.5" />
    <span>{children}</span>
  </label>
)

export default function AdminConfigBuilder() {
  const [f, setF] = useState(DEFAULTS)
  const [presets, setPresets] = useState([])
  const [presetsError, setPresetsError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState(null)

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const config = useMemo(() => buildConfig(f), [f])
  const json = useMemo(() => JSON.stringify(config, null, 2), [config])
  const check = useMemo(() => validate(f), [f])

  useEffect(() => {
    authFetch(`${API}/presets`).then(async r => {
      const d = await r.json()
      if (!r.ok) { setPresetsError(d.error); return }
      setPresets(d.presets || [])
    }).catch(e => setPresetsError(e.message))
  }, [])

  async function genKeys() {
    setBusy(true); setMsg(null)
    try {
      const r = await authFetch(`${API}/reality-keys`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortIdCount: 4 }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setF(p => ({ ...p, privateKey: d.privateKey, shortIds: d.shortIds.join(' ') }))
      // Публичный ключ в конфиг не идёт — он нужен клиентам, поэтому просто показываем
      setMsg(`Ключи созданы. Публичный ключ для клиентов: ${d.publicKey}`)
    } catch (e) { setMsg('Не удалось: ' + e.message) } finally { setBusy(false) }
  }

  async function genShortIds() {
    const r = await authFetch(`${API}/short-ids`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 4 }),
    })
    const d = await r.json()
    if (r.ok) set('shortIds', d.shortIds.join(' '))
  }

  /** Взять существующий профиль как основу: вытаскиваем из него, что понимаем. */
  function loadPreset(uuid) {
    const p = presets.find(x => x.uuid === uuid)
    if (!p) return
    const ib = p.config?.inbounds?.[0]
    if (!ib) { setMsg('В этом профиле нет inbound — брать нечего'); return }

    const ss = ib.streamSettings || {}
    const rs = ss.realitySettings || {}
    const net = ss.network === 'raw' ? 'tcp' : (ss.network || 'tcp')

    setF(p2 => ({
      ...p2,
      name: p.name + '_COPY',
      tag: ib.tag || p2.tag,
      port: ib.port || p2.port,
      listen: ib.listen || '0.0.0.0',
      transport: TRANSPORTS.some(t => t.id === net) ? net : 'tcp',
      security: SECURITIES.some(s => s.id === ss.security) ? ss.security : 'none',
      dest: rs.dest || p2.dest,
      serverNames: (rs.serverNames || []).join(' ') || p2.serverNames,
      shortIds: (rs.shortIds || []).join(' '),
      spiderX: rs.spiderX || '/',
      xver: rs.xver ?? 0,
      // Ключ намеренно НЕ переносим: копировать приватный ключ в новый профиль
      // — плохая идея, два узла с одним ключом обесценивают его смысл.
      privateKey: '',
      realityKeyField: 'password' in rs ? 'password' : 'privateKey',
      grpcServiceName: ss.grpcSettings?.serviceName || p2.grpcServiceName,
      xhttpPath: ss.xhttpSettings?.path || p2.xhttpPath,
      wsPath: ss.wsSettings?.path || p2.wsPath,
      sniffing: !!ib.sniffing?.enabled,
      mptcp: ss.sockopt?.tcpMptcp ?? true,
      tcpFastOpen: ss.sockopt?.tcpFastOpen ?? true,
    }))
    setMsg(`Взят за основу «${p.name}». Ключ Reality не скопирован — сгенерируйте свой.`)
  }

  function copyJson() {
    navigator.clipboard?.writeText(json)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  function downloadJson() {
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(f.name || 'config').replace(/[^\w.-]+/g, '_')}.json`
    a.click(); URL.revokeObjectURL(a.href)
  }

  const isReality = f.security === 'reality'

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.15),transparent_35%),rgba(2,6,23,0.85)] p-6">
        <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
          <Wrench className="w-7 h-7 text-cyan-300" /> Конструктор конфигов
        </h2>
        <p className="text-slate-400 mt-1 text-sm">
          Собирает JSON для профиля RemnaWave. Готовый конфиг копируется в панель — создавать профиль
          отсюда нельзя, схема API панели закрыта.
        </p>
      </div>

      {msg && (
        <div className="p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-sm flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-mono text-xs break-all">{msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* ── Форма ── */}
        <div className="space-y-4">
          {/* Основа из существующего */}
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-3">
            <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" /> Взять за основу
            </div>
            {presetsError && <p className="text-xs text-rose-400">{presetsError}</p>}
            <select defaultValue="" onChange={e => e.target.value && loadPreset(e.target.value)} className={inputCls}>
              <option value="">— собрать с нуля —</option>
              {presets.map(p => (
                <option key={p.uuid} value={p.uuid}>
                  {p.name} ({p.inboundCount} inbound{p.nodeCount ? `, ${p.nodeCount} нод` : ''})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">
              Берёт рабочий профиль из панели и подставляет его настройки. Приватный ключ Reality
              не копируется — один ключ на два узла лишает его смысла.
            </p>
          </div>

          {/* Основное */}
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-4">
            <div className="text-sm font-semibold text-slate-200">Основное</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Имя профиля" hint="Только для файла и удобства">
                <input value={f.name} onChange={e => set('name', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Тег inbound">
                <input value={f.tag} onChange={e => set('tag', e.target.value)} className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Порт">
                <input type="number" min="1" max="65535" value={f.port} onChange={e => set('port', e.target.value)} className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Listen">
                <input value={f.listen} onChange={e => set('listen', e.target.value)} className={`${inputCls} font-mono`} />
              </Field>
            </div>

            <Field label="Транспорт">
              <div className="grid grid-cols-2 gap-2">
                {TRANSPORTS.map(t => (
                  <button key={t.id} onClick={() => set('transport', t.id)} title={t.hint}
                    className={`px-3 py-2 rounded-lg text-sm border transition text-left ${
                      f.transport === t.id ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                                           : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-slate-200'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">{TRANSPORTS.find(t => t.id === f.transport)?.hint}</p>
            </Field>

            <Field label="Безопасность">
              <div className="grid grid-cols-3 gap-2">
                {SECURITIES.map(s => (
                  <button key={s.id} onClick={() => set('security', s.id)} title={s.hint}
                    className={`px-3 py-2 rounded-lg text-sm border transition ${
                      f.security === s.id ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                                          : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-slate-200'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">{SECURITIES.find(s => s.id === f.security)?.hint}</p>
            </Field>
          </div>

          {/* Reality */}
          {isReality && (
            <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-cyan-400" /> Reality
                </div>
                <button onClick={genKeys} disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Сгенерировать ключи
                </button>
              </div>

              <Field label="dest" hint="Чужой сайт, под который маскируемся. С портом.">
                <input value={f.dest} onChange={e => set('dest', e.target.value)} className={`${inputCls} font-mono`} />
              </Field>
              <Field label="serverNames" hint="Через пробел или запятую. Обычно тот же домен, что в dest.">
                <input value={f.serverNames} onChange={e => set('serverNames', e.target.value)} className={`${inputCls} font-mono`} />
              </Field>

              <Field label="Приватный ключ" hint="То же, что даёт `xray x25519` на сервере.">
                <input value={f.privateKey} onChange={e => set('privateKey', e.target.value)}
                  placeholder="нажмите «Сгенерировать ключи»" className={`${inputCls} font-mono text-xs`} />
              </Field>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400">shortIds</label>
                  <button onClick={genShortIds} className="text-[11px] text-cyan-400 hover:underline inline-flex items-center gap-1">
                    <Shuffle className="w-3 h-3" /> перегенерировать
                  </button>
                </div>
                <input value={f.shortIds} onChange={e => set('shortIds', e.target.value)}
                  className={`${inputCls} font-mono text-xs`} />
                <p className="text-[11px] text-slate-500 mt-1">Hex, чётной длины, до 16 символов. Через пробел.</p>
              </div>

              <Field label="Формат ключа" hint="Xray 25.9+ переименовал privateKey в password. В вашей панели встречаются оба.">
                <select value={f.realityKeyField} onChange={e => set('realityKeyField', e.target.value)} className={inputCls}>
                  <option value="privateKey">privateKey — классический</option>
                  <option value="password">password — Xray 25.9+</option>
                </select>
              </Field>
            </div>
          )}

          {/* TLS */}
          {f.security === 'tls' && (
            <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-3">
              <div className="text-sm font-semibold text-slate-200">TLS</div>
              <Field label="Путь к сертификату">
                <input value={f.tlsCertFile} onChange={e => set('tlsCertFile', e.target.value)} className={`${inputCls} font-mono text-xs`} />
              </Field>
              <Field label="Путь к ключу">
                <input value={f.tlsKeyFile} onChange={e => set('tlsKeyFile', e.target.value)} className={`${inputCls} font-mono text-xs`} />
              </Field>
              <Field label="serverName" hint="Необязательно">
                <input value={f.tlsServerName} onChange={e => set('tlsServerName', e.target.value)} className={`${inputCls} font-mono`} />
              </Field>
            </div>
          )}

          {/* Транспорт */}
          {f.transport !== 'tcp' && (
            <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-3">
              <div className="text-sm font-semibold text-slate-200">Параметры транспорта</div>
              {f.transport === 'grpc' && (
                <>
                  <Field label="serviceName">
                    <input value={f.grpcServiceName} onChange={e => set('grpcServiceName', e.target.value)} className={`${inputCls} font-mono`} />
                  </Field>
                  <Check checked={f.grpcMultiMode} onChange={v => set('grpcMultiMode', v)}>multiMode</Check>
                </>
              )}
              {f.transport === 'xhttp' && (
                <>
                  <Field label="path"><input value={f.xhttpPath} onChange={e => set('xhttpPath', e.target.value)} className={`${inputCls} font-mono`} /></Field>
                  <Field label="host" hint="Необязательно"><input value={f.xhttpHost} onChange={e => set('xhttpHost', e.target.value)} className={`${inputCls} font-mono`} /></Field>
                  <Field label="mode">
                    <select value={f.xhttpMode} onChange={e => set('xhttpMode', e.target.value)} className={inputCls}>
                      {['auto', 'packet-up', 'stream-up', 'stream-one'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Field>
                </>
              )}
              {f.transport === 'ws' && (
                <>
                  <Field label="path"><input value={f.wsPath} onChange={e => set('wsPath', e.target.value)} className={`${inputCls} font-mono`} /></Field>
                  <Field label="Host-заголовок" hint="Необязательно"><input value={f.wsHost} onChange={e => set('wsHost', e.target.value)} className={`${inputCls} font-mono`} /></Field>
                </>
              )}
            </div>
          )}

          {/* Прочее */}
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-2.5">
            <div className="text-sm font-semibold text-slate-200 mb-1">Прочее</div>
            <Check checked={f.sniffing} onChange={v => set('sniffing', v)}>Sniffing — нужен для маршрутизации по доменам</Check>
            <Check checked={f.mptcp} onChange={v => set('mptcp', v)}>MPTCP</Check>
            <Check checked={f.tcpFastOpen} onChange={v => set('tcpFastOpen', v)}>TCP Fast Open</Check>
            <Check checked={f.blockPrivate} onChange={v => set('blockPrivate', v)}>Блокировать приватные адреса</Check>
            <Check checked={f.blockBittorrent} onChange={v => set('blockBittorrent', v)}>Блокировать BitTorrent</Check>
          </div>
        </div>

        {/* ── JSON ── */}
        <div className="space-y-3">
          {check.problems.length > 0 && (
            <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 space-y-1">
              {check.problems.map((p, i) => (
                <p key={i} className="text-sm text-red-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {p}
                </p>
              ))}
            </div>
          )}
          {check.warn.length > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-1">
              {check.warn.map((p, i) => (
                <p key={i} className="text-sm text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {p}
                </p>
              ))}
            </div>
          )}
          {check.ok && check.warn.length === 0 && (
            <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Конфиг выглядит корректно
            </div>
          )}

          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 overflow-hidden sticky top-4">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/50">
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <FileJson className="w-4 h-4 text-cyan-400" /> Готовый JSON
              </span>
              <div className="flex gap-2">
                <button onClick={copyJson}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs inline-flex items-center gap-1.5 hover:bg-slate-700">
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
                <button onClick={downloadJson}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs inline-flex items-center gap-1.5 hover:bg-slate-700">
                  <Download className="w-3.5 h-3.5" /> Скачать
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-auto max-h-[70vh] leading-relaxed">{json}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
