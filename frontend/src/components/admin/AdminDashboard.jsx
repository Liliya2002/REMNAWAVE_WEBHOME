import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock, Users as UsersIcon, Layers, Wallet, MailWarning,
  Server, UserPlus, Sparkles, FileText, Palette, Cloud,
  History, ArrowUpRight, TrendingUp, BarChart3,
} from 'lucide-react'
import { authFetch } from '../../services/api'

// ─── Дашборд (главный экран нового вида админки) ──────────────────────────────
// Заменяет дублирующую сетку-навигацию: слева уже есть сайдбар со всеми
// разделами, поэтому по центру — реальные виджеты (метрики, динамика,
// быстрые действия, последние события журнала аудита).

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d}д`)
  if (h) parts.push(`${h}ч`)
  parts.push(`${m}м`)
  return parts.join(' ')
}

function fmtMoney(n) {
  const v = Number(n || 0)
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽'
}

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

// Относительное время для свежих событий; для старше 7 дней — точная дата,
// т.к. «73 дн назад» плохо читается.
function fmtEventDate(iso) {
  if (!iso) return ''
  const dt = new Date(iso)
  const diff = Math.max(0, Date.now() - dt.getTime())
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d <= 7) return `${d} дн назад`
  // Старше недели — точная дата.
  const now = new Date()
  if (dt.getFullYear() === now.getFullYear()) return `${dt.getDate()} ${MONTHS_RU[dt.getMonth()]}`
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${dt.getFullYear()}`
}

// Человекочитаемые ярлыки для кодов действий аудита (fallback — сам код).
const ACTION_LABELS = {
  'rw.node.create': 'Создана нода',
  'rw.node.delete': 'Удалена нода',
  'rw.node.restart_all': 'Перезапуск всех нод',
  'config.update': 'Изменены настройки',
  'user.update': 'Изменён пользователь',
  'plan.create': 'Создан тариф',
  'plan.update': 'Изменён тариф',
}
function actionLabel(a) {
  return ACTION_LABELS[a] || (a || '').replace(/[._]/g, ' ')
}

// ─── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ icon: Icon, label, value, sub, subTone = 'muted', tone = 'default', loading }) {
  const tones = {
    default: 'text-slate-300',
    ok:      'text-emerald-300',
    alert:   'text-amber-300',
    money:   'text-cyan-300',
  }
  const subTones = {
    muted:   'text-slate-500',
    up:      'text-emerald-400',
    down:    'text-rose-400',
  }
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3.5 top-lit">
      {/* Водяной знак — крупная полупрозрачная иконка, заполняет пустое место справа */}
      <Icon className="pointer-events-none absolute -right-3 -bottom-3 w-20 h-20 text-slate-100/[0.03]" strokeWidth={1.5} />

      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-slate-400">{label}</span>
          <Icon className={`w-4 h-4 shrink-0 ${tones[tone] || tones.default}`} />
        </div>
        <div className="text-2xl font-bold text-white leading-none font-mono truncate mt-2">
          {loading ? '…' : value}
        </div>
        {sub != null && (
          <div className={`text-[11px] mt-1.5 truncate ${subTones[subTone] || subTones.muted}`}>{sub}</div>
        )}
      </div>
    </div>
  )
}

// ─── Quick actions ──────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { to: '/admin/servers',      Icon: Server,   label: 'Добавить сервер', hint: 'RemnaWave-нода' },
  { to: '/admin/users',        Icon: UserPlus, label: 'Пользователи',    hint: 'поиск и управление' },
  { to: '/admin/plans',        Icon: Sparkles, label: 'Тарифы',          hint: 'создать / изменить' },
  { to: '/admin/landings',     Icon: FileText, label: 'Лендинги',        hint: 'контент сайта' },
  { to: '/admin/settings',     Icon: Palette,  label: 'Настройки',       hint: 'внешний вид, режимы' },
  { to: '/admin/yandex-cloud', Icon: Cloud,    label: 'Yandex Cloud',    hint: 'VM и IP' },
]

function QuickActions() {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-950/30 p-4 sm:p-5 top-lit dot-grid">
      <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
        <ArrowUpRight className="w-4 h-4 text-slate-400" /> Быстрые действия
      </h3>
      <div className="grid grid-cols-2 gap-2.5">
        {QUICK_ACTIONS.map(({ to, Icon, label, hint }) => (
          <Link
            key={to}
            to={to}
            className="group flex items-center gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-800/60 hover:border-slate-700 transition-all"
          >
            <span className="w-9 h-9 rounded-lg bg-slate-800/70 group-hover:bg-blue-500/15 flex items-center justify-center shrink-0 transition-colors">
              <Icon className="w-4 h-4 text-slate-400 group-hover:text-blue-300 transition-colors" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-slate-200 group-hover:text-white truncate transition-colors">{label}</span>
              <span className="block text-[11px] text-slate-500 truncate">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Mini bar chart (одна серия, динамика во времени) ─────────────────────────
function MiniBarChart({ data, metric }) {
  const [hover, setHover] = useState(null) // index

  const bars = Array.isArray(data) ? data : []
  const max = Math.max(1, ...bars.map(b => b.value))
  const W = 100, H = 40 // viewBox units; svg масштабируется по ширине
  const gap = bars.length > 1 ? 1.5 : 0
  const bw = bars.length ? (W - gap * (bars.length - 1)) / bars.length : W

  const fmtVal = (v) => metric === 'revenue' ? fmtMoney(v) : `${v}`

  if (!bars.length) {
    return (
      <div className="relative h-40 rounded-lg border border-dashed border-slate-800 flex flex-col items-center justify-center gap-2 overflow-hidden">
        {/* Точечная сетка на фоне — чтобы блок не выглядел «провалившимся» */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: 'radial-gradient(circle, rgb(51 65 85 / 0.35) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        />
        <BarChart3 className="relative w-9 h-9 text-slate-700" strokeWidth={1.5} />
        <span className="relative text-sm text-slate-500">Пока нет данных за выбранный период</span>
      </div>
    )
  }

  const active = hover != null ? bars[hover] : null

  return (
    <div className="relative">
      {/* Tooltip */}
      <div className="h-8 mb-1">
        {active && (
          <div className="inline-flex items-baseline gap-2 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs">
            <span className="text-white font-semibold font-mono">{fmtVal(active.value)}</span>
            <span className="text-slate-400">{active.date}</span>
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-40" role="img" aria-label="Динамика по дням">
        {/* baseline */}
        <line x1="0" y1={H} x2={W} y2={H} stroke="rgb(51 65 85 / 0.6)" strokeWidth="0.3" />
        {bars.map((b, i) => {
          const h = (b.value / max) * (H - 2)
          const x = i * (bw + gap)
          const y = H - h
          const isActive = hover === i
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* невидимая широкая зона наведения */}
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              <rect
                x={x} y={y} width={bw} height={Math.max(h, 0.4)}
                rx={bw > 2 ? 1 : 0}
                fill={isActive ? '#7dd3fc' : '#38bdf8'}
                opacity={hover == null || isActive ? 1 : 0.55}
              />
            </g>
          )
        })}
      </svg>

      {/* x-подписи: первая и последняя */}
      <div className="flex justify-between text-[10px] text-slate-500 mt-1.5 font-mono">
        <span>{bars[0]?.date}</span>
        <span>{bars[bars.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function TrendWidget() {
  const [metric, setMetric] = useState('subscriptions') // subscriptions | revenue
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    authFetch(`/api/admin/stats/chart?period=month&metric=${metric}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setData(Array.isArray(d?.data) ? d.data : []) })
      .catch(() => { if (!cancelled) setData([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [metric])

  const total = useMemo(() => data.reduce((s, d) => s + (d.value || 0), 0), [data])

  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-950/30 p-4 sm:p-5 top-lit dot-grid">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-slate-400" /> Динамика за 30 дней
        </h3>
        <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/80 p-1 text-xs">
          {[['subscriptions', 'Подписки'], ['revenue', 'Выручка']].map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              aria-pressed={metric === m}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                metric === m
                  ? 'bg-blue-500/20 text-white border border-blue-500/40 shadow-sm'
                  : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-xs text-slate-500 mb-3">
        Всего за период: <span className="text-slate-300 font-mono">{metric === 'revenue' ? fmtMoney(total) : total}</span>
      </div>
      {loading
        ? <div className="h-40 flex items-center justify-center text-sm text-slate-500">Загрузка…</div>
        : <MiniBarChart data={data} metric={metric} />}
    </div>
  )
}

// ─── Recent events (журнал аудита) ────────────────────────────────────────────
function RecentEvents() {
  const [items, setItems] = useState(null)

  useEffect(() => {
    let cancelled = false
    authFetch('/api/admin/audit?limit=7')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setItems(Array.isArray(d?.items) ? d.items : []) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-950/30 p-4 sm:p-5 top-lit dot-grid">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-400" /> Последние события
        </h3>
        <Link to="/admin/audit" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Весь журнал →</Link>
      </div>

      {items == null ? (
        <div className="py-6 text-center text-sm text-slate-500">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500">Событий пока нет</div>
      ) : (
        <ul className="space-y-1">
          {items.map(it => (
            <li key={it.id} className="flex items-center gap-3 py-2 border-b border-slate-800/40 last:border-0">
              <span className="w-2 h-2 rounded-full bg-blue-400/70 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-200 truncate">
                  {actionLabel(it.action)}
                  {it.target_type && <span className="text-slate-500"> · {it.target_type}{it.target_id ? ` #${it.target_id}` : ''}</span>}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">{it.admin_login || 'system'}</span>
              </span>
              <span className="text-[11px] text-slate-500 shrink-0 whitespace-nowrap" title={new Date(it.created_at).toLocaleString('ru-RU')}>{fmtEventDate(it.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [systemInfo, setSystemInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [s, i] = await Promise.all([
          authFetch('/api/admin/stats').then(r => r.ok ? r.json() : null).catch(() => null),
          authFetch('/api/admin/system/info').then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        if (!cancelled) { setStats(s); setSystemInfo(i) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const unconfirmed = stats?.unconfirmedEmails ?? 0

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-white">Обзор</h1>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse dot-glow-emerald" />
          Онлайн
        </span>
      </div>

      {/* Метрики */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile icon={Clock}       label="Аптайм"              tone="ok"    loading={loading}
          value={fmtUptime(systemInfo?.uptimeSeconds)}
          sub={systemInfo?.version ? `v${systemInfo.version}${systemInfo?.shaShort ? ` · ${systemInfo.shaShort}` : ''}` : null} />
        <StatTile icon={UsersIcon}   label="Пользователей"       loading={loading}
          value={stats?.totalUsers ?? '—'}
          sub={stats?.newUsersThisMonth != null ? `+${stats.newUsersThisMonth} за месяц` : null}
          subTone={stats?.newUsersThisMonth > 0 ? 'up' : 'muted'} />
        <StatTile icon={Layers}      label="Активные подписки"   loading={loading}
          value={stats?.activeSubscriptions ?? '—'}
          sub={stats?.completedPayments != null ? `${stats.completedPayments} оплат всего` : null} />
        <StatTile icon={Wallet}      label="Выручка за месяц"    tone="money" loading={loading}
          value={fmtMoney(stats?.monthlyRevenue)}
          sub={stats?.avgSubscriptionPrice ? `средний чек ~${fmtMoney(stats.avgSubscriptionPrice)}` : null} />
        <StatTile icon={MailWarning} label="Без подтв. email"    tone={unconfirmed > 0 ? 'alert' : 'ok'} loading={loading}
          value={unconfirmed}
          sub={unconfirmed > 0 ? 'требуют действия' : 'все подтверждены'}
          subTone={unconfirmed > 0 ? 'down' : 'up'} />
      </div>

      {/* Динамика + быстрые действия */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><TrendWidget /></div>
        <QuickActions />
      </div>

      {/* Последние события */}
      <RecentEvents />
    </div>
  )
}
