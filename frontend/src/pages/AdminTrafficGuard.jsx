import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Shield, ShieldOff, Settings as SettingsIcon, Server, Layers,
  AlertTriangle, History, RefreshCw, Loader2, Save, Check, X,
  Play, Unlock, Power, Trash2, AlertCircle, Ban, UserX, Search,
  Globe, Plus, Pencil, Clock,
} from 'lucide-react'
import { authFetch } from '../services/api'

const TABS = [
  { id: 'settings',     label: 'Настройки',          Icon: SettingsIcon },
  { id: 'node-limits',  label: 'Лимиты по нодам',    Icon: Server },
  { id: 'plan-limits',  label: 'Лимиты по тарифам',  Icon: Layers },
  { id: 'violations',   label: 'Нарушения',          Icon: History },
  { id: 'blocked',      label: 'Заблокированные',    Icon: ShieldOff },
  { id: 'banned-ips',   label: 'Бан по IP',          Icon: Globe },
]

const PERIOD_OPTS = [
  { id: 'day',   label: 'День' },
  { id: 'week',  label: 'Неделя' },
  { id: 'month', label: 'Месяц (календарный)' },
  { id: '30d',   label: '30 дней (скользящих)' },
]

const ACTION_OPTS = [
  { id: 'disable_user',  label: 'Отключить юзера полностью' },
  { id: 'disable_squad', label: 'Отключить только этот squad (fallback на user)' },
  { id: 'warn_only',     label: 'Только предупреждать (без блокировки)' },
]

const SOURCE_OPTS = [
  { id: 'node', label: 'Только по нодам' },
  { id: 'plan', label: 'Только по тарифам' },
  { id: 'both', label: 'Оба (берётся более строгий)' },
]

const COUNTRY_FLAGS = {
  RU: '🇷🇺', DE: '🇩🇪', US: '🇺🇸', NL: '🇳🇱', FI: '🇫🇮', SG: '🇸🇬',
  GB: '🇬🇧', FR: '🇫🇷', JP: '🇯🇵', CA: '🇨🇦', AU: '🇦🇺', KR: '🇰🇷',
  SE: '🇸🇪', CH: '🇨🇭', PL: '🇵🇱', TR: '🇹🇷', AE: '🇦🇪', IN: '🇮🇳',
  BR: '🇧🇷', HK: '🇭🇰', TW: '🇹🇼', UA: '🇺🇦', KZ: '🇰🇿', CZ: '🇨🇿', GE: '🇬🇪',
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n === 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), units.length - 1)
  return `${(n / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

export default function AdminTrafficGuard() {
  const [tab, setTab] = useState('settings')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-500 flex items-center justify-center shadow-lg shadow-rose-500/25">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">Traffic Guard</h1>
          <p className="text-xs text-slate-400">Авто-контроль превышений per-node лимитов с блокировкой и нотификациями</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-900/50 border border-slate-800/60 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              tab === t.id
                ? 'bg-gradient-to-br from-rose-500 to-red-500 text-white shadow-lg shadow-rose-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <t.Icon className="w-4 h-4" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'settings'    && <SettingsTab />}
      {tab === 'node-limits' && <NodeLimitsTab />}
      {tab === 'plan-limits' && <PlanLimitsTab />}
      {tab === 'violations'  && <ViolationsTab />}
      {tab === 'blocked'     && <BlockedTab />}
      {tab === 'banned-ips'  && <BannedIpsTab />}
    </div>
  )
}

// ─── SETTINGS TAB ────────────────────────────────────────────────────────────
function SettingsTab() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/admin/traffic-guard/settings')
      const data = await res.json()
      if (res.ok && data && typeof data.id !== 'undefined') setSettings(data)
      else setMsg({ type: 'error', text: data.error || `Ошибка загрузки (HTTP ${res.status})` })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      const res = await authFetch('/api/admin/traffic-guard/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) {
        const updated = await res.json()
        setSettings(updated)
        setMsg({ type: 'success', text: 'Настройки сохранены' })
      } else {
        const err = await res.json()
        setMsg({ type: 'error', text: err.error || 'Ошибка сохранения' })
      }
    } finally { setSaving(false) }
  }

  const runNow = async () => {
    setRunning(true); setLastRun(null)
    try {
      const res = await authFetch('/api/admin/traffic-guard/check-now', { method: 'POST' })
      const data = await res.json()
      setLastRun(data)
      load()
    } finally { setRunning(false) }
  }

  const runP2pScan = async () => {
    setRunning(true); setLastRun(null)
    try {
      const res = await authFetch('/api/admin/traffic-guard/p2p-scan-now', { method: 'POST' })
      const data = await res.json()
      setLastRun({ p2p: data })
    } finally { setRunning(false) }
  }

  if (loading) return <Loader />
  if (!settings) {
    return (
      <div className="p-6 rounded-2xl border border-red-500/40 bg-red-500/10 text-red-200 text-sm flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-medium">Не удалось загрузить настройки</div>
          {msg?.text && <div className="text-xs text-red-300/80 mt-1 font-mono break-all">{msg.text}</div>}
          <button onClick={load} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-200 hover:text-white bg-red-500/15 hover:bg-red-500/25 border border-red-500/40">
            <RefreshCw className="w-3.5 h-3.5" /> Повторить
          </button>
        </div>
      </div>
    )
  }

  const set = (k, v) => setSettings(prev => ({ ...prev, [k]: v }))

  return (
    <div className="space-y-5">
      {/* Status / kill switch */}
      <div className={`p-5 rounded-2xl border ${settings.enabled ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-slate-900/50 border-slate-700/60'}`}>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 mb-1">
              {settings.enabled ? <Shield className="w-5 h-5 text-emerald-300" /> : <ShieldOff className="w-5 h-5 text-slate-400" />}
              <h2 className="font-bold text-lg">{settings.enabled ? 'Traffic Guard включён' : 'Traffic Guard отключён'}</h2>
            </div>
            <p className="text-xs text-slate-400">
              {settings.enabled
                ? `Cron работает каждые ${settings.cron_interval_minutes} мин. Последняя проверка: ${settings.last_check_at ? new Date(settings.last_check_at).toLocaleString('ru-RU') : '—'}`
                : 'Активируйте чтобы начать автоматическую проверку лимитов.'}
            </p>
            {settings.last_check_summary && (
              <p className="text-xs text-slate-500 font-mono mt-1">{settings.last_check_summary}</p>
            )}
          </div>
          <Toggle checked={!!settings.enabled} onChange={v => set('enabled', v)} label={settings.enabled ? 'ВКЛ' : 'ВЫКЛ'} />
        </div>
      </div>

      {/* Settings form */}
      <div className="bg-gradient-to-br from-slate-900/60 to-slate-950/60 border border-slate-800/70 rounded-2xl p-5 space-y-5">
        <h3 className="font-semibold text-white text-base">Глобальные параметры</h3>

        <Field label="Период по умолчанию" hint="Используется когда у конкретной ноды/тарифа период не задан">
          <select value={settings.default_period} onChange={e => set('default_period', e.target.value)} className={selectClass}>
            {PERIOD_OPTS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>

        <Field label="Действие при превышении 100%">
          <select value={settings.default_action} onChange={e => set('default_action', e.target.value)} className={selectClass}>
            {ACTION_OPTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>

        <Field label="Источник лимитов">
          <select value={settings.limit_source} onChange={e => set('limit_source', e.target.value)} className={selectClass}>
            {SOURCE_OPTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Порог предупреждения (%)" hint="При достижении этого процента отправляется уведомление">
            <input type="number" min="1" max="99" value={settings.warn_threshold_percent} onChange={e => set('warn_threshold_percent', Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Интервал проверки (минут)" hint="Cron подхватит новое значение в течение 5 минут">
            <input type="number" min="1" max="1440" value={settings.cron_interval_minutes} onChange={e => set('cron_interval_minutes', Number(e.target.value))} className={inputClass} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ToggleRow label="In-app уведомления (в /dashboard)" checked={settings.inapp_enabled} onChange={v => set('inapp_enabled', v)} />
          <ToggleRow label="Email-уведомления" checked={settings.email_enabled} onChange={v => set('email_enabled', v)} />
        </div>

        {/* IP-ban section */}
        <div className="pt-4 border-t border-slate-800/60">
          <h3 className="font-semibold text-white text-base mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-rose-400" /> Авто-бан IP при превышении
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ToggleRow
              label="Авто-банить IP нарушителей"
              checked={!!settings.ip_ban_enabled}
              onChange={v => set('ip_ban_enabled', v)}
            />
            <Field
              label="Длительность бана (часов)"
              hint="0 = пока активна блокировка юзера (снимается при auto/manual unblock)"
            >
              <input
                type="number"
                min="0"
                value={settings.ip_ban_duration_hours ?? 0}
                onChange={e => set('ip_ban_duration_hours', Number(e.target.value))}
                disabled={!settings.ip_ban_enabled}
                className={inputClass + (!settings.ip_ban_enabled ? ' opacity-40' : '')}
              />
            </Field>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            При срабатывании blocked-нарушения (100% лимита) система автоматически забанит IP юзера. Источник IP — registration_ip + (если включен SSH-агент ниже) реальный IP с ноды через access.log.
          </p>
        </div>

        {/* SSH-agent section */}
        <SshAgentSection settings={settings} set={set} />

        {/* P2P section */}
        <P2pSection settings={settings} set={set} />

        {/* Squad Quotas section */}
        <SquadQuotasSection settings={settings} set={set} />

        {msg && (
          <div className={`px-4 py-2 rounded-lg text-sm ${msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/10 text-red-300 border border-red-500/30'}`}>
            {msg.text}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-rose-500 to-red-500 text-white hover:shadow-lg hover:shadow-rose-500/30 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
          <button onClick={runNow} disabled={running} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200 disabled:opacity-50 transition-all">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Запустить проверку лимитов
          </button>
          {settings.p2p_detect_enabled && (
            <button onClick={runP2pScan} disabled={running} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-200 disabled:opacity-50 transition-all">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Запустить P2P-скан
            </button>
          )}
        </div>

        {lastRun && (
          <div className="px-4 py-3 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-slate-300">
            <div className="font-semibold mb-1">Результат последней проверки:</div>
            <pre className="font-mono text-slate-400 overflow-auto">{JSON.stringify(lastRun, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── NODE LIMITS TAB ─────────────────────────────────────────────────────────
function NodeLimitsTab() {
  const [data, setData] = useState({ limits: [], nodes: [] })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/admin/traffic-guard/limits/nodes')
      const json = await res.json()
      if (res.ok && Array.isArray(json.limits)) setData(json)
      else setData({ limits: [], nodes: [], error: json.error || `HTTP ${res.status}` })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const limitByUuid = useMemo(() => {
    const m = new Map()
    for (const l of (data.limits || [])) m.set(l.node_uuid, l)
    return m
  }, [data.limits])

  // Если в БД есть лимит для ноды которой больше нет в RW — всё равно покажем
  const allNodes = useMemo(() => {
    const limits = data.limits || []
    const nodes = data.nodes || []
    const seen = new Set(nodes.map(n => n.uuid))
    const orphaned = limits.filter(l => !seen.has(l.node_uuid))
      .map(l => ({ uuid: l.node_uuid, name: l.node_name || '(удалена в RW)', countryCode: '' }))
    return [...nodes, ...orphaned]
  }, [data])

  if (loading) return <Loader />

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400">
        Каждая нода может иметь собственный лимит. Если лимит = 0 или выключен — нода не контролируется.
      </div>
      {allNodes.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">Нет нод RemnaWave</div>
      )}
      {allNodes.map(n => (
        <NodeLimitRow key={n.uuid} node={n} current={limitByUuid.get(n.uuid)} onSaved={load} />
      ))}
    </div>
  )
}

function NodeLimitRow({ node, current, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    limit_gb: current?.limit_gb ?? 0,
    period: current?.period ?? '',
    action: current?.action ?? '',
    enabled: current?.enabled ?? true,
    block_torrents: current?.block_torrents ?? false,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm({
      limit_gb: current?.limit_gb ?? 0,
      period: current?.period ?? '',
      action: current?.action ?? '',
      enabled: current?.enabled ?? true,
      block_torrents: current?.block_torrents ?? false,
    })
  }, [current])

  const save = async () => {
    setSaving(true)
    try {
      await authFetch(`/api/admin/traffic-guard/limits/nodes/${node.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, node_name: node.name, period: form.period || null, action: form.action || null }),
      })
      setEditing(false)
      onSaved?.()
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!current) return
    if (!confirm(`Удалить лимит для «${node.name}»?`)) return
    await authFetch(`/api/admin/traffic-guard/limits/nodes/${node.uuid}`, { method: 'DELETE' })
    onSaved?.()
  }

  const isActive = current && current.enabled && current.limit_gb > 0

  return (
    <div className={`bg-gradient-to-br border rounded-2xl p-4 transition-all ${isActive ? 'from-rose-500/5 to-slate-900/40 border-rose-500/30' : 'from-slate-900/40 to-slate-950/40 border-slate-800/60'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl shrink-0">{COUNTRY_FLAGS[node.countryCode] || '🌐'}</span>
        <div className="flex-1 min-w-[150px]">
          <div className="font-semibold text-slate-200">{node.name}</div>
          <div className="text-[10px] text-slate-500 font-mono truncate">{node.uuid}</div>
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="text-sm text-rose-300 font-bold">
                Лимит: {current.limit_gb} ГБ / {current.period || 'default'}
              </div>
            )}
            {current?.block_torrents && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5">
                <Ban className="w-2.5 h-2.5" /> P2P scan
              </span>
            )}
          </div>
        )}
        {!editing ? (
          <button onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200">
            {current ? 'Изменить' : 'Задать лимит'}
          </button>
        ) : (
          <div className="flex gap-1">
            <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Сохранить'}
            </button>
            <button onClick={() => setEditing(false)} className="px-2 py-1.5 rounded-lg text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Лимит (ГБ)" hint="0 = без лимита. Можно дробное (0.5, 1.25)">
            <input type="number" min="0" step="0.01" value={form.limit_gb} onChange={e => setForm(p => ({ ...p, limit_gb: Number(e.target.value) }))} className={inputClass} />
          </Field>
          <Field label="Период">
            <select value={form.period} onChange={e => setForm(p => ({ ...p, period: e.target.value }))} className={selectClass}>
              <option value="">По умолчанию</option>
              {PERIOD_OPTS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Действие при 100%">
            <select value={form.action} onChange={e => setForm(p => ({ ...p, action: e.target.value }))} className={selectClass}>
              <option value="">По умолчанию</option>
              {ACTION_OPTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Статус">
            <ToggleRow checked={form.enabled} onChange={v => setForm(p => ({ ...p, enabled: v }))} label={form.enabled ? 'Активен' : 'Выключен'} />
          </Field>
          <Field label="P2P/Torrent сканер" hint="Указывает что в RemnaWave настроен torrent-block для этой ноды">
            <ToggleRow
              checked={form.block_torrents}
              onChange={v => setForm(p => ({ ...p, block_torrents: v }))}
              label={form.block_torrents ? 'Сканировать на нарушения' : 'Не сканировать'}
            />
          </Field>
          {current && (
            <div className="md:col-span-4">
              <button onClick={remove} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/40">
                <Trash2 className="w-3.5 h-3.5" />
                Удалить лимит
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── PLAN LIMITS TAB ─────────────────────────────────────────────────────────
function PlanLimitsTab() {
  const [data, setData] = useState({ limits: [], plans: [] })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/admin/traffic-guard/limits/plans')
      const json = await res.json()
      if (res.ok && Array.isArray(json.limits)) setData(json)
      else setData({ limits: [], plans: [], error: json.error || `HTTP ${res.status}` })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const limitByPlan = useMemo(() => {
    const m = new Map()
    for (const l of (data.limits || [])) m.set(l.plan_id, l)
    return m
  }, [data.limits])

  if (loading) return <Loader />

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400">
        Лимит per-node для тарифа. При источнике "тариф" или "оба" применяется к юзерам с этим планом.
      </div>
      {data.plans.length === 0 && <div className="text-center py-12 text-slate-500 text-sm">Нет тарифов</div>}
      {data.plans.map(p => (
        <PlanLimitRow key={p.id} plan={p} current={limitByPlan.get(p.id)} onSaved={load} />
      ))}
    </div>
  )
}

function PlanLimitRow({ plan, current, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    per_node_limit_gb: current?.per_node_limit_gb ?? 0,
    period: current?.period ?? '',
    enabled: current?.enabled ?? true,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm({
      per_node_limit_gb: current?.per_node_limit_gb ?? 0,
      period: current?.period ?? '',
      enabled: current?.enabled ?? true,
    })
  }, [current])

  const save = async () => {
    setSaving(true)
    try {
      await authFetch(`/api/admin/traffic-guard/limits/plans/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, period: form.period || null }),
      })
      setEditing(false); onSaved?.()
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!current) return
    if (!confirm(`Удалить лимит для тарифа «${plan.name}»?`)) return
    await authFetch(`/api/admin/traffic-guard/limits/plans/${plan.id}`, { method: 'DELETE' })
    onSaved?.()
  }

  const isActive = current && current.enabled && current.per_node_limit_gb > 0

  return (
    <div className={`bg-gradient-to-br border rounded-2xl p-4 ${isActive ? 'from-rose-500/5 to-slate-900/40 border-rose-500/30' : 'from-slate-900/40 to-slate-950/40 border-slate-800/60'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Layers className="w-5 h-5 text-violet-400 shrink-0" />
        <div className="flex-1 min-w-[150px]">
          <div className="font-semibold text-slate-200">{plan.name}</div>
        </div>
        {isActive && !editing && (
          <div className="text-sm text-rose-300 font-bold">
            {current.per_node_limit_gb} ГБ/нода / {current.period || 'default'}
          </div>
        )}
        {!editing ? (
          <button onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200">
            {current ? 'Изменить' : 'Задать лимит'}
          </button>
        ) : (
          <div className="flex gap-1">
            <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Сохранить'}
            </button>
            <button onClick={() => setEditing(false)} className="px-2 py-1.5 rounded-lg text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Лимит per-node (ГБ)" hint="0 = без лимита. Можно дробное (0.5, 1.25)">
            <input type="number" min="0" step="0.01" value={form.per_node_limit_gb} onChange={e => setForm(p => ({ ...p, per_node_limit_gb: Number(e.target.value) }))} className={inputClass} />
          </Field>
          <Field label="Период">
            <select value={form.period} onChange={e => setForm(p => ({ ...p, period: e.target.value }))} className={selectClass}>
              <option value="">По умолчанию</option>
              {PERIOD_OPTS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Статус">
            <ToggleRow checked={form.enabled} onChange={v => setForm(p => ({ ...p, enabled: v }))} label={form.enabled ? 'Активен' : 'Выключен'} />
          </Field>
          {current && (
            <div className="md:col-span-3">
              <button onClick={remove} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/40">
                <Trash2 className="w-3.5 h-3.5" />
                Удалить лимит
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── VIOLATIONS TAB ──────────────────────────────────────────────────────────
function ViolationsTab() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterLevel, setFilterLevel] = useState('')
  const [filterResolved, setFilterResolved] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (filterLevel) qs.set('level', filterLevel)
      if (filterResolved) qs.set('resolved', filterResolved)
      const res = await authFetch(`/api/admin/traffic-guard/violations?${qs}`)
      const json = await res.json()
      if (res.ok) {
        setItems(Array.isArray(json.items) ? json.items : [])
        setTotal(json.total || 0)
      } else {
        setItems([]); setTotal(0)
      }
    } finally { setLoading(false) }
  }, [filterLevel, filterResolved])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className={selectClass + ' max-w-[200px]'}>
          <option value="">Все уровни</option>
          <option value="warning">Warning (трафик)</option>
          <option value="blocked">Blocked (трафик)</option>
          <option value="torrent_warning">Warning (P2P)</option>
          <option value="torrent_blocked">Blocked (P2P)</option>
        </select>
        <select value={filterResolved} onChange={e => setFilterResolved(e.target.value)} className={selectClass + ' max-w-[200px]'}>
          <option value="">Все статусы</option>
          <option value="false">Активные</option>
          <option value="true">Закрытые</option>
        </select>
        <button onClick={load} className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>
      <div className="text-xs text-slate-500">Всего: {total}</div>

      {loading && <Loader />}
      {!loading && items.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">Нарушений пока нет</div>
      )}
      <div className="space-y-2">
        {items.map(v => <ViolationCard key={v.id} v={v} onChanged={load} />)}
      </div>
    </div>
  )
}

function ViolationCard({ v, onChanged }) {
  const isBlocked = v.level === 'blocked' || v.level === 'torrent_blocked'
  const isResolved = !!v.resolved_at
  const isTorrent  = v.level?.startsWith('torrent_')

  const unblock = async () => {
    if (!confirm(`Разблокировать ${v.username}?`)) return
    await authFetch(`/api/admin/traffic-guard/violations/${v.id}/unblock`, { method: 'POST' })
    onChanged?.()
  }

  return (
    <div className={`p-4 rounded-xl border ${
      isBlocked && !isResolved ? (isTorrent ? 'bg-orange-500/10 border-orange-500/40' : 'bg-red-500/10 border-red-500/40')
      : isBlocked && isResolved ? 'bg-emerald-500/5 border-emerald-500/30'
      : (isTorrent ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-500/10 border-amber-500/30')
    }`}>
      <div className="flex flex-wrap gap-3 items-start">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
              isBlocked ? (isTorrent ? 'bg-orange-500/30 text-orange-200' : 'bg-red-500/30 text-red-200')
              : (isTorrent ? 'bg-amber-500/30 text-amber-200' : 'bg-amber-500/30 text-amber-200')
            }`}>{isTorrent ? `P2P ${v.level.replace('torrent_','')}` : v.level}</span>
            {isResolved && <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-500/30 text-emerald-200">resolved</span>}
            <span className="font-semibold text-slate-200">{v.username || v.user_email || v.remnwave_user_uuid}</span>
            <span className="text-xs text-slate-500">→ {v.node_name}</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {formatBytes(v.used_bytes)} из {formatBytes(v.limit_bytes)} ({Number(v.used_percent).toFixed(1)}%) · период {v.period} ({v.period_key}) · {v.action_taken || 'pending'}
          </div>
          {Array.isArray(v.client_ips) && v.client_ips.length > 0 && (
            <div className="mt-1 text-[11px] text-rose-300/90 flex items-center gap-1.5 flex-wrap">
              <Globe className="w-3 h-3 shrink-0" />
              <span className="opacity-60">IP:</span>
              {v.client_ips.map((ip, i) => (
                <code key={i} className="font-mono px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30">{ip}</code>
              ))}
            </div>
          )}
          <div className="mt-1 text-[10px] text-slate-500">
            Обнаружено: {new Date(v.detected_at).toLocaleString('ru-RU')}
            {v.resolved_at && ` · Закрыто: ${new Date(v.resolved_at).toLocaleString('ru-RU')}`}
          </div>
        </div>
        {isBlocked && !isResolved && (
          <button onClick={unblock} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200">
            <Unlock className="w-3.5 h-3.5" />
            Разблокировать
          </button>
        )}
      </div>
    </div>
  )
}

// ─── BLOCKED TAB ─────────────────────────────────────────────────────────────
function BlockedTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showManualBlock, setShowManualBlock] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/admin/traffic-guard/blocked')
      const json = await res.json()
      setItems(res.ok && Array.isArray(json.items) ? json.items : [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <Loader />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-400">Активные блокировки: {items.length}</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManualBlock(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-200"
          >
            <Ban className="w-3.5 h-3.5" />
            Заблокировать вручную
          </button>
          <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300">
            <RefreshCw className="w-3.5 h-3.5" /> Обновить
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          <Shield className="w-12 h-12 mx-auto mb-2 text-emerald-500/50" />
          Заблокированных нет — все юзеры в пределах лимитов
        </div>
      ) : items.map(v => <ViolationCard key={v.id} v={v} onChanged={load} />)}

      {showManualBlock && (
        <ManualBlockModal
          onClose={() => setShowManualBlock(false)}
          onSuccess={() => { setShowManualBlock(false); load() }}
        />
      )}
    </div>
  )
}

// ─── MANUAL BLOCK MODAL ──────────────────────────────────────────────────────
function ManualBlockModal({ onClose, onSuccess }) {
  const [step, setStep] = useState('user') // 'user' | 'node' | 'confirm'
  const [userQuery, setUserQuery] = useState('')
  const [users, setUsers] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [nodes, setNodes] = useState([])
  const [selectedNode, setSelectedNode] = useState(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Search users (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const qs = userQuery ? `?q=${encodeURIComponent(userQuery)}` : ''
        const res = await authFetch(`/api/admin/traffic-guard/users-for-block${qs}`)
        const json = await res.json()
        setUsers(json.items || [])
      } finally { setSearchLoading(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [userQuery])

  // Load nodes once
  useEffect(() => {
    (async () => {
      const res = await authFetch('/api/admin/traffic-guard/limits/nodes')
      const json = await res.json()
      setNodes(json.nodes || [])
    })()
  }, [])

  const submit = async () => {
    if (!selectedUser || !selectedNode) return
    setSubmitting(true); setError(null)
    try {
      const res = await authFetch('/api/admin/traffic-guard/manual-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_uuid: selectedUser.uuid,
          user_id:   selectedUser.user_id,
          username:  selectedUser.username,
          node_uuid: selectedNode.uuid,
          node_name: selectedNode.name,
          reason:    reason || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (!data.rw?.applied) {
        setError(`Юзер заблокирован в нашей БД, но в RemnaWave: ${data.rw?.error || 'не применено'}`)
        setSubmitting(false)
        return
      }
      onSuccess?.()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/70 rounded-2xl shadow-2xl shadow-red-500/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserX className="w-5 h-5 text-red-400" />
            <h3 className="font-semibold text-white">Заблокировать пользователя</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Step 1: User */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">1. Пользователь</label>
            {selectedUser ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/40">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-emerald-200 font-medium truncate">{selectedUser.username}</div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">{selectedUser.email || selectedUser.uuid}</div>
                </div>
                <button onClick={() => setSelectedUser(null)} className="text-slate-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    autoFocus
                    type="text"
                    value={userQuery}
                    onChange={e => setUserQuery(e.target.value)}
                    placeholder="Поиск по username/email/uuid…"
                    className="w-full pl-9 pr-3 py-2 bg-slate-800/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-red-500/50"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-800/60 divide-y divide-slate-800/60 bg-slate-900/40">
                  {searchLoading && (
                    <div className="px-3 py-3 text-xs text-slate-500 text-center"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> Поиск…</div>
                  )}
                  {!searchLoading && users.length === 0 && (
                    <div className="px-3 py-3 text-xs text-slate-500 text-center">Никого не найдено</div>
                  )}
                  {!searchLoading && users.map(u => (
                    <button
                      key={u.uuid}
                      onClick={() => setSelectedUser(u)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors"
                    >
                      <div className="text-sm text-slate-200 truncate">{u.username}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{u.email || u.uuid}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Node */}
          {selectedUser && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">2. Нода</label>
              <select
                value={selectedNode?.uuid || ''}
                onChange={e => setSelectedNode(nodes.find(n => n.uuid === e.target.value) || null)}
                className={selectClass}
              >
                <option value="">— выберите ноду —</option>
                {nodes.map(n => <option key={n.uuid} value={n.uuid}>{n.name}{n.countryCode ? ` (${n.countryCode})` : ''}</option>)}
              </select>
            </div>
          )}

          {/* Step 3: Reason */}
          {selectedUser && selectedNode && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">3. Причина (опционально)</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={2}
                placeholder="Например: Подозрительная активность"
                className={inputClass + ' resize-none'}
              />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/40">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1 text-amber-400" />
            Действие отключит пользователя в RemnaWave и пометит его как «заблокированный по нарушению трафика». Снять блокировку можно отдельной кнопкой «Разблокировать» в списке.
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-700/60 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={!selectedUser || !selectedNode || submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-red-500 to-rose-500 text-white hover:shadow-lg hover:shadow-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            Заблокировать
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SSH-agent section in Settings ───────────────────────────────────────────
function SshAgentSection({ settings, set }) {
  const [checking, setChecking] = useState(false)
  const [healthData, setHealthData] = useState(null)

  const runHealthCheck = async () => {
    setChecking(true); setHealthData(null)
    try {
      const res = await authFetch('/api/admin/traffic-guard/ssh/health-check')
      const data = await res.json()
      setHealthData(data)
    } catch (err) {
      setHealthData({ configured: false, error: err.message })
    } finally { setChecking(false) }
  }

  return (
    <div className="pt-4 border-t border-slate-800/60">
      <h3 className="font-semibold text-white text-base mb-3 flex items-center gap-2">
        <Server className="w-4 h-4 text-cyan-400" /> SSH-агент (lookup настоящего IP с ноды)
      </h3>
      <ToggleRow
        label="Включить SSH-lookup настоящих IP при автоблокировке"
        checked={!!settings.ssh_lookup_enabled}
        onChange={v => set('ssh_lookup_enabled', v)}
      />
      <p className="text-[11px] text-slate-500 mt-2">
        Чтобы это работало, на каждой ноде должен быть установлен агент-скрипт <code className="font-mono px-1 rounded bg-slate-800">access-log-query.sh</code> и SSH-ключ панели прописан в <code className="font-mono px-1 rounded bg-slate-800">authorized_keys</code> юзера <code className="font-mono px-1 rounded bg-slate-800">traffic-agent</code>. Инструкция: <code className="font-mono px-1 rounded bg-slate-800">infra/node-agent/README.md</code> в репо.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <button
          onClick={runHealthCheck}
          disabled={checking}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 disabled:opacity-50"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Проверить SSH на всех нодах
        </button>
      </div>

      {healthData && !healthData.configured && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
          SSH не настроен на бэкенде — задайте <code className="font-mono">TRAFFIC_AGENT_SSH_PRIVATE_KEY</code> или <code className="font-mono">TRAFFIC_AGENT_SSH_PRIVATE_KEY_PATH</code> в <code className="font-mono">backend/.env</code> и перезапустите backend.
        </div>
      )}

      {healthData?.configured && healthData.results?.length > 0 && (
        <div className="mt-3 space-y-1">
          {healthData.results.map(r => (
            <div key={r.uuid} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${r.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {r.ok ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-red-400 shrink-0" />}
                <div className="min-w-0">
                  <div className="text-sm text-slate-200 truncate">{r.name}</div>
                  {r.address && <div className="text-[10px] text-slate-500 font-mono truncate">{r.address}</div>}
                </div>
              </div>
              {!r.ok && r.error && (
                <code className="text-[10px] text-red-300 font-mono truncate max-w-[40%]">{r.error}</code>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── P2P section in Settings ─────────────────────────────────────────────────
function P2pSection({ settings, set }) {
  return (
    <div className="pt-4 border-t border-slate-800/60">
      <h3 className="font-semibold text-white text-base mb-3 flex items-center gap-2">
        <Ban className="w-4 h-4 text-amber-400" /> P2P / Torrent детекция
      </h3>
      <ToggleRow
        label="Включить P2P-детекцию (parse access.log)"
        checked={!!settings.p2p_detect_enabled}
        onChange={v => set('p2p_detect_enabled', v)}
      />
      <p className="text-[11px] text-slate-500 mt-2 mb-3">
        Парсит access.log на нодах через SSH-агент, ищет записи с тегом <code className="font-mono px-1 rounded bg-slate-800">[torrent-block]</code>. Сама блокировка торрентов настраивается в Xray-конфиге RemnaWave (см. инструкцию ниже).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Интервал сканирования (мин)">
          <input
            type="number" min="1" max="1440"
            value={settings.p2p_scan_interval_minutes ?? 5}
            onChange={e => set('p2p_scan_interval_minutes', Number(e.target.value))}
            disabled={!settings.p2p_detect_enabled}
            className={inputClass + (!settings.p2p_detect_enabled ? ' opacity-40' : '')}
          />
        </Field>
        <Field label="Порог попыток до санкции">
          <input
            type="number" min="1"
            value={settings.torrent_attempts_threshold ?? 5}
            onChange={e => set('torrent_attempts_threshold', Number(e.target.value))}
            disabled={!settings.p2p_detect_enabled}
            className={inputClass + (!settings.p2p_detect_enabled ? ' opacity-40' : '')}
          />
        </Field>
        <Field label="Действие при превышении">
          <select
            value={settings.torrent_action || 'warn_only'}
            onChange={e => set('torrent_action', e.target.value)}
            disabled={!settings.p2p_detect_enabled}
            className={selectClass + (!settings.p2p_detect_enabled ? ' opacity-40' : '')}
          >
            <option value="warn_only">Только предупреждение</option>
            <option value="disable_user">Отключить юзера</option>
            <option value="ip_ban">Бан по IP</option>
          </select>
        </Field>
      </div>

      <details className="mt-3 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs">
        <summary className="cursor-pointer text-slate-300 font-medium">
          Как настроить блокировку торрентов в RemnaWave (один раз на ноду)
        </summary>
        <div className="mt-3 space-y-2 text-slate-400">
          <p>В RemnaWave-панели → <b>Configs</b> → отредактируй config своей ноды. Добавь в раздел <code className="font-mono">routing</code>:</p>
          <pre className="px-3 py-2 rounded bg-slate-950/60 border border-slate-700/40 overflow-auto text-[11px] text-slate-300">{`"routing": {
  "rules": [
    {
      "type": "field",
      "protocol": ["bittorrent"],
      "outboundTag": "torrent-block"
    }
  ]
},
"outbounds": [
  { "tag": "torrent-block", "protocol": "blackhole" }
]`}</pre>
          <p>В каждом inbound где хочешь блокировать торренты включи sniffing:</p>
          <pre className="px-3 py-2 rounded bg-slate-950/60 border border-slate-700/40 overflow-auto text-[11px] text-slate-300">{`"sniffing": {
  "enabled": true,
  "destOverride": ["http", "tls", "quic", "bittorrent"],
  "metadataOnly": false
}`}</pre>
          <p>Сохрани и пересинхронизируй ноду. После этого Xray начнёт писать в access.log строки с <code className="font-mono">[torrent-block]</code>, и наш сканер их подхватит.</p>
        </div>
      </details>
    </div>
  )
}

// ─── Squad Quotas section in Settings ────────────────────────────────────────
function SquadQuotasSection({ settings, set }) {
  return (
    <div className="pt-4 border-t border-slate-800/60">
      <h3 className="font-semibold text-white text-base mb-3 flex items-center gap-2">
        <Server className="w-4 h-4 text-violet-400" /> Squad Quotas (per-server лимиты)
      </h3>
      <ToggleRow
        label="Включить per-squad лимиты с авто-отключением"
        checked={!!settings.squad_quota_enabled}
        onChange={v => set('squad_quota_enabled', v)}
      />
      <p className="text-[11px] text-slate-500 mt-2 mb-3">
        Cron каждые N минут проверяет потребление трафика по каждому squad'у в рамках тарифа. При превышении — squad удаляется из <code className="font-mono">activeInternalSquads</code> юзера в RemnaWave (доступ к серверу пропадает). Восстанавливается автоматически в новом периоде или при покупке доп. трафика. Лимиты per-squad задаются в форме редактирования тарифа.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Интервал проверки (мин)">
          <input
            type="number" min="1" max="1440"
            value={settings.squad_quota_interval_minutes ?? 10}
            onChange={e => set('squad_quota_interval_minutes', Number(e.target.value))}
            disabled={!settings.squad_quota_enabled}
            className={inputClass + (!settings.squad_quota_enabled ? ' opacity-40' : '')}
          />
        </Field>
        <Field label="Порог предупреждения (%)">
          <input
            type="number" min="1" max="99"
            value={settings.squad_quota_warn_percent ?? 80}
            onChange={e => set('squad_quota_warn_percent', Number(e.target.value))}
            disabled={!settings.squad_quota_enabled}
            className={inputClass + (!settings.squad_quota_enabled ? ' opacity-40' : '')}
          />
        </Field>
        <Field label="Период сброса">
          <select
            value={settings.squad_period_strategy || 'calendar_month'}
            onChange={e => set('squad_period_strategy', e.target.value)}
            disabled={!settings.squad_quota_enabled}
            className={selectClass + (!settings.squad_quota_enabled ? ' opacity-40' : '')}
          >
            <option value="calendar_month">Календарный месяц (1 числа)</option>
            <option value="subscription_period">30 дней с активации</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
        <Field label="Цена ₽/ГБ доп. трафика (default)" hint="Можно переопределить per-squad-per-plan">
          <input
            type="number" min="0" step="0.01"
            value={settings.squad_topup_default_price ?? 50}
            onChange={e => set('squad_topup_default_price', Number(e.target.value))}
            disabled={!settings.squad_quota_enabled}
            className={inputClass + (!settings.squad_quota_enabled ? ' opacity-40' : '')}
          />
        </Field>
        <Field label="Режим покупки">
          <select
            value={settings.squad_topup_mode || 'flexible'}
            onChange={e => set('squad_topup_mode', e.target.value)}
            disabled={!settings.squad_quota_enabled}
            className={selectClass + (!settings.squad_quota_enabled ? ' opacity-40' : '')}
          >
            <option value="flexible">Произвольный объём (slider)</option>
            <option value="packs">Фиксированные пакеты (10/25/50/100/250)</option>
          </select>
        </Field>
      </div>
    </div>
  )
}

// ─── BANNED IPs TAB ──────────────────────────────────────────────────────────
function BannedIpsTab() {
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active') // 'active' | 'expired' | 'all'
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(null) // null | 'create' | { ban for edit }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (filter === 'active')  qs.set('active', 'true')
      if (filter === 'expired') qs.set('active', 'false')
      if (search.trim()) qs.set('search', search.trim())
      qs.set('limit', '200')
      const res = await authFetch(`/api/admin/traffic-guard/banned-ips?${qs}`)
      const json = await res.json()
      if (res.ok) setData(json)
      else setData({ items: [], total: 0 })
    } finally { setLoading(false) }
  }, [filter, search])

  useEffect(() => { load() }, [load])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { load() }, 300)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line

  const remove = async (id) => {
    if (!confirm('Снять бан с этого IP?')) return
    await authFetch(`/api/admin/traffic-guard/banned-ips/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-400">Всего: {data.total}</div>
        <button
          onClick={() => setShowModal('create')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-rose-500 to-red-500 text-white hover:shadow-lg hover:shadow-rose-500/30"
        >
          <Plus className="w-3.5 h-3.5" />
          Забанить IP вручную
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select value={filter} onChange={e => setFilter(e.target.value)} className={selectClass + ' max-w-[200px]'}>
          <option value="active">Только активные</option>
          <option value="expired">Только истёкшие</option>
          <option value="all">Все</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по IP, причине, UUID юзера…"
            className="w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50"
          />
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && <Loader />}
      {!loading && data.items.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          <Globe className="w-12 h-12 mx-auto mb-2 text-slate-700" />
          Забаненных IP нет
        </div>
      )}
      <div className="space-y-2">
        {data.items.map(b => <BannedIpCard key={b.id} ban={b} onChanged={load} onEdit={() => setShowModal(b)} onRemove={() => remove(b.id)} />)}
      </div>

      {showModal && (
        <BanIpModal
          editing={showModal === 'create' ? null : showModal}
          onClose={() => setShowModal(null)}
          onSuccess={() => { setShowModal(null); load() }}
        />
      )}
    </div>
  )
}

function BannedIpCard({ ban, onEdit, onRemove }) {
  const isManual = ban.source === 'manual'
  const expired = ban.expires_at && new Date(ban.expires_at) < new Date()
  const expiresIn = ban.expires_at ? Math.round((new Date(ban.expires_at) - new Date()) / 3600000) : null

  return (
    <div className={`rounded-xl border p-4 ${expired ? 'bg-slate-900/40 border-slate-700/40 opacity-70' : isManual ? 'bg-violet-500/10 border-violet-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-base font-bold text-slate-200">{ban.ip}</code>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${isManual ? 'bg-violet-500/30 text-violet-200' : 'bg-rose-500/30 text-rose-200'}`}>
              {isManual ? 'manual' : 'auto'}
            </span>
            {expired && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-700/50 text-slate-400">expired</span>}
            {!ban.expires_at && !expired && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300">бессрочно</span>}
          </div>
          {ban.reason && <div className="text-xs text-slate-300 mt-1">{ban.reason}</div>}
          <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Создан: {new Date(ban.created_at).toLocaleString('ru-RU')}</span>
            {ban.created_by_login && <span>Кем: {ban.created_by_login}</span>}
            {ban.user_login && <span>Юзер: {ban.user_login}</span>}
            {ban.expires_at && (
              <span className={expired ? 'text-slate-500' : 'text-amber-400/80'}>
                <Clock className="w-3 h-3 inline" /> {expired ? 'Истёк' : `Ещё ${expiresIn}ч`}: {new Date(ban.expires_at).toLocaleString('ru-RU')}
              </span>
            )}
          </div>
          {ban.notes && <div className="text-[11px] text-slate-400 italic mt-1">{ban.notes}</div>}
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition" title="Редактировать">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} className="p-2 rounded-lg text-red-400 hover:text-red-200 hover:bg-red-500/15 transition" title="Снять бан">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function BanIpModal({ editing, onClose, onSuccess }) {
  const isEdit = !!editing
  const [ip, setIp] = useState(editing?.ip || '')
  const [reason, setReason] = useState(editing?.reason || '')
  const [duration, setDuration] = useState(() => {
    if (!editing?.expires_at) return ''
    const h = Math.max(0, Math.round((new Date(editing.expires_at) - new Date()) / 3600000))
    return String(h)
  })
  const [notes, setNotes] = useState(editing?.notes || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (!ip.trim() && !isEdit) { setError('Введите IP'); return }
    setSubmitting(true); setError(null)
    try {
      const body = {
        reason: reason || null,
        notes: notes || null,
        expires_in_hours: duration === '' ? null : Number(duration),
      }
      let res
      if (isEdit) {
        res = await authFetch(`/api/admin/traffic-guard/banned-ips/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await authFetch('/api/admin/traffic-guard/banned-ips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: ip.trim(), ...body }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      onSuccess?.()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/70 rounded-2xl shadow-2xl shadow-rose-500/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-rose-400" />
            <h3 className="font-semibold text-white">{isEdit ? 'Редактировать бан IP' : 'Забанить IP вручную'}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="IP-адрес">
            <input
              type="text"
              value={ip}
              onChange={e => setIp(e.target.value)}
              disabled={isEdit}
              placeholder="78.46.123.45 или 2001:db8::1"
              className={inputClass + (isEdit ? ' opacity-60' : '')}
              autoFocus={!isEdit}
            />
          </Field>

          <Field label="Причина (опционально)">
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Подозрительная активность"
              className={inputClass}
            />
          </Field>

          <Field label="Длительность (часов)" hint="Пусто = бессрочный, 0 = бессрочный, число = N часов">
            <input
              type="number"
              min="0"
              value={duration}
              onChange={e => setDuration(e.target.value)}
              placeholder="бессрочно"
              className={inputClass}
            />
          </Field>

          <Field label="Заметки (видны только админам)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Например: жалоба от userX, проверено логами"
              className={inputClass + ' resize-none'}
            />
          </Field>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-700/60 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={submitting || (!isEdit && !ip.trim())}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-rose-500 to-red-500 text-white hover:shadow-lg hover:shadow-rose-500/30 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? <Save className="w-4 h-4" /> : <Ban className="w-4 h-4" />)}
            {isEdit ? 'Сохранить' : 'Забанить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Common UI ───────────────────────────────────────────────────────────────
function Loader() { return <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div> }

const inputClass = 'w-full px-3 py-2 bg-slate-900/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50'
const selectClass = inputClass + ' appearance-none cursor-pointer'

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
        checked
          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
          : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
      }`}
    >
      <Power className="w-4 h-4" />
      {label}
    </button>
  )
}

function ToggleRow({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/60 hover:bg-slate-800/60 transition-all text-left"
    >
      <span className="text-sm text-slate-300">{label || (checked ? 'Включено' : 'Выключено')}</span>
      <span className={`relative w-10 h-5 rounded-full transition-all ${checked ? 'bg-emerald-500' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
