import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Users, ShieldCheck, Wallet, TrendingUp, AlertCircle,
  RefreshCcw, Calendar, UserPlus, Gift, Crown, Medal, Award,
  CreditCard, Activity, LineChart
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

function formatRub(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
}
function formatNum(v) {
  return Number(v || 0).toLocaleString('ru-RU')
}

export default function AdminStats() {
  const [stats, setStats] = useState(null)
  const [chartData, setChartData] = useState([])
  const [referralStats, setReferralStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('month')
  const [metric, setMetric] = useState('revenue')

  async function loadStats() {
    try {
      setLoading(true); setError(null)
      const token = localStorage.getItem('token')
      if (!token) throw new Error('Требуется авторизация')
      const headers = { Authorization: `Bearer ${token}` }

      const [statsRes, chartRes, refRes] = await Promise.all([
        fetch(`${API}/api/admin/stats`, { headers }),
        fetch(`${API}/api/admin/stats/chart?period=${period}&metric=${metric}`, { headers }),
        fetch(`${API}/api/admin/stats/referrals`, { headers }),
      ])
      if (!statsRes.ok) throw new Error('Не удалось загрузить основную статистику')
      if (!chartRes.ok) throw new Error('Не удалось загрузить данные графика')
      if (!refRes.ok) throw new Error('Не удалось загрузить реферальную статистику')

      const statsPayload = await statsRes.json()
      setStats(statsPayload?.stats || statsPayload || null)

      const chartPayload = await chartRes.json()
      const arr = Array.isArray(chartPayload) ? chartPayload
        : Array.isArray(chartPayload?.data) ? chartPayload.data
        : Array.isArray(chartPayload?.items) ? chartPayload.items : []
      setChartData(arr)

      setReferralStats(await refRes.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStats() }, [period, metric])

  // === Аналитика графика ===
  const chartAnalysis = useMemo(() => {
    const values = chartData.map(d => Number(d.value || 0))
    if (!values.length) return { max: 0, sum: 0, avg: 0 }
    const max = Math.max(...values)
    const sum = values.reduce((a, b) => a + b, 0)
    const avg = sum / values.length
    return { max, sum, avg }
  }, [chartData])

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCcw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ===== Header ===== */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-700/50 bg-gradient-to-br from-blue-500/10 via-slate-900/60 to-slate-900/80 p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30 shrink-0">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl sm:text-2xl font-bold text-white">Статистика</h3>
            <p className="text-sm text-slate-400 mt-1">Доходы, активность и реферальная программа</p>
          </div>
          <button
            onClick={loadStats}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800/60 border border-slate-700/50 hover:border-blue-500/40 rounded-xl text-sm font-bold text-slate-300 hover:text-blue-300 transition-all disabled:opacity-50"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-4 bg-red-500/10 border border-red-500/40 rounded-2xl text-red-300 text-sm">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* ===== Главные метрики (4) ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <BigStat
          Icon={Users}
          label="Всего пользователей"
          value={formatNum(stats?.totalUsers)}
          accent="blue"
        />
        <BigStat
          Icon={ShieldCheck}
          label="Активных подписок"
          value={formatNum(stats?.activeSubscriptions)}
          accent="emerald"
        />
        <BigStat
          Icon={Wallet}
          label="Оплачено всего"
          value={formatRub(stats?.totalAmount)}
          accent="violet"
        />
        <BigStat
          Icon={AlertCircle}
          label="Незавершённых"
          value={formatNum(stats?.unpaidPayments || Math.max((stats?.totalPayments || 0) - (stats?.completedPayments || 0), 0))}
          accent="amber"
          subtitle="оплат / неуспешных"
        />
      </div>

      {/* ===== Дополнительные метрики (3) ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BigStat
          Icon={TrendingUp}
          label="Месячный доход"
          value={formatRub(stats?.monthlyRevenue)}
          accent="cyan"
          size="md"
        />
        <BigStat
          Icon={UserPlus}
          label="Новых юзеров за месяц"
          value={formatNum(stats?.newUsersThisMonth)}
          accent="teal"
          size="md"
        />
        <BigStat
          Icon={CreditCard}
          label="Средняя цена подписки"
          value={formatRub(stats?.avgSubscriptionPrice)}
          accent="rose"
          size="md"
        />
      </div>

      {/* ===== График ===== */}
      <div className="rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-800/40 to-slate-900/60 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <LineChart className="w-5 h-5 text-violet-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                {metric === 'revenue' ? 'График доходов' : 'График подписок'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {period === 'week' && 'Последние 7 дней'}
                {period === 'month' && 'Последние 30 дней'}
                {period === 'year' && 'Последние 12 месяцев'}
              </p>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-2">
            <Pills value={period} onChange={setPeriod} options={[
              { value: 'week',  label: 'Неделя' },
              { value: 'month', label: 'Месяц'  },
              { value: 'year',  label: 'Год'    },
            ]} accent="blue" />
            <Pills value={metric} onChange={setMetric} options={[
              { value: 'revenue',       label: 'Доход'    },
              { value: 'subscriptions', label: 'Подписки' },
            ]} accent="violet" />
          </div>
        </div>

        {/* Chart summary */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <ChartMetric
            label="Сумма за период"
            value={metric === 'revenue' ? formatRub(chartAnalysis.sum) : formatNum(chartAnalysis.sum)}
            color="text-violet-300"
          />
          <ChartMetric
            label="Среднее"
            value={metric === 'revenue' ? formatRub(chartAnalysis.avg) : formatNum(Math.round(chartAnalysis.avg))}
            color="text-cyan-300"
          />
          <ChartMetric
            label="Максимум"
            value={metric === 'revenue' ? formatRub(chartAnalysis.max) : formatNum(chartAnalysis.max)}
            color="text-emerald-300"
          />
        </div>

        {/* Bar chart */}
        {chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <BarChart3 className="w-10 h-10 text-slate-700 mb-2" />
            <p className="text-sm">Нет данных для графика</p>
          </div>
        ) : (
          <BarChart
            data={chartData}
            max={chartAnalysis.max}
            metric={metric}
          />
        )}
      </div>

      {/* ===== Реферальная статистика ===== */}
      {referralStats && (
        <div className="rounded-2xl border border-slate-700/50 bg-gradient-to-br from-amber-500/5 to-slate-900/60 p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <Gift className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Реферальная программа</h3>
              <p className="text-[11px] text-slate-500">Активность пользователей и распределение бонусов</p>
            </div>
          </div>

          {/* Refs metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <BigStat
              Icon={Users}
              label="Всего рефералов"
              value={formatNum(referralStats.totalReferrals || referralStats.stats?.totalReferrals)}
              accent="amber"
              size="md"
            />
            <BigStat
              Icon={Activity}
              label="Активных рефереров"
              value={formatNum(referralStats.uniqueReferrers || referralStats.stats?.activeReferrers)}
              accent="orange"
              size="md"
            />
            <BigStat
              Icon={Calendar}
              label="Бонусных дней"
              value={formatNum(referralStats.totalBonusDays)}
              accent="emerald"
              size="md"
            />
          </div>

          {/* Top referrers leaderboard */}
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-4">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              <Crown className="w-3.5 h-3.5 text-amber-400" /> Топ рефереры
            </h4>

            {referralStats.topReferrers && referralStats.topReferrers.length > 0 ? (
              <div className="space-y-2">
                {referralStats.topReferrers.map((ref, idx) => {
                  const place = idx + 1
                  const meta = place === 1 ? { Icon: Crown,  iconColor: 'text-amber-300',  bg: 'from-amber-500/15  to-yellow-500/5  border-amber-500/30',  badge: 'bg-amber-500/20  text-amber-300  border-amber-500/40'  }
                             : place === 2 ? { Icon: Medal,  iconColor: 'text-slate-200',  bg: 'from-slate-500/15  to-slate-400/5  border-slate-500/30',  badge: 'bg-slate-500/20  text-slate-200  border-slate-400/40'  }
                             : place === 3 ? { Icon: Award,  iconColor: 'text-orange-300', bg: 'from-orange-500/10 to-amber-500/5  border-orange-500/30', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40' }
                             :                { Icon: null,  iconColor: 'text-slate-500',  bg: 'from-slate-800/40  to-slate-900/40 border-slate-700/30',  badge: 'bg-slate-800/60  text-slate-400  border-slate-700/40'  }
                  const refsCount = ref.count || ref.referrals_count || 0
                  const bonusDays = ref.bonus_days || ref.total_bonus_days || 0
                  return (
                    <div key={idx} className={`flex items-center gap-3 p-3 rounded-xl border bg-gradient-to-r ${meta.bg}`}>
                      <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 font-bold text-sm ${meta.badge}`}>
                        {meta.Icon ? <meta.Icon className={`w-4 h-4 ${meta.iconColor}`} /> : `#${place}`}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-semibold truncate">
                          {ref.referrer_login || ref.login || 'Unknown'}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {ref.referrer_email || ref.email || '—'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm text-white font-bold">
                          {formatNum(refsCount)} <span className="text-[11px] text-slate-400 font-normal">рефералов</span>
                        </div>
                        <div className="text-[11px] text-emerald-300 font-medium">
                          + {formatNum(bonusDays)} дн.
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-slate-600">
                <Gift className="w-10 h-10 text-slate-700 mb-2" />
                <p className="text-sm">Нет данных о рефералах</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// === Stat-карточка с иконкой в круге, цветным акцентом ===
function BigStat({ Icon, label, value, subtitle, accent = 'blue', size = 'lg' }) {
  const accentMap = {
    blue:    { box: 'from-blue-500/10 to-slate-900/60 border-blue-500/20',       icon: 'bg-blue-500/20 text-blue-300',       text: 'text-blue-100' },
    cyan:    { box: 'from-cyan-500/10 to-slate-900/60 border-cyan-500/20',       icon: 'bg-cyan-500/20 text-cyan-300',       text: 'text-cyan-100' },
    violet:  { box: 'from-violet-500/10 to-slate-900/60 border-violet-500/20',   icon: 'bg-violet-500/20 text-violet-300',   text: 'text-violet-100' },
    emerald: { box: 'from-emerald-500/10 to-slate-900/60 border-emerald-500/20', icon: 'bg-emerald-500/20 text-emerald-300', text: 'text-emerald-100' },
    teal:    { box: 'from-teal-500/10 to-slate-900/60 border-teal-500/20',       icon: 'bg-teal-500/20 text-teal-300',       text: 'text-teal-100' },
    amber:   { box: 'from-amber-500/10 to-slate-900/60 border-amber-500/20',     icon: 'bg-amber-500/20 text-amber-300',     text: 'text-amber-100' },
    orange:  { box: 'from-orange-500/10 to-slate-900/60 border-orange-500/20',   icon: 'bg-orange-500/20 text-orange-300',   text: 'text-orange-100' },
    rose:    { box: 'from-rose-500/10 to-slate-900/60 border-rose-500/20',       icon: 'bg-rose-500/20 text-rose-300',       text: 'text-rose-100' },
    slate:   { box: 'from-slate-700/40 to-slate-900/60 border-slate-700/40',     icon: 'bg-slate-700/60 text-slate-300',     text: 'text-slate-100' },
  }
  const a = accentMap[accent] || accentMap.slate
  const valueClass = size === 'lg' ? 'text-3xl' : 'text-2xl'
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${a.box} p-4`}>
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 rounded-xl ${a.icon} flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{label}</div>
          <div className={`${valueClass} font-extrabold ${a.text} mt-1 leading-tight truncate`}>{value}</div>
          {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
      </div>
    </div>
  )
}

// === Pills-переключатель ===
function Pills({ value, onChange, options, accent = 'blue' }) {
  const accentMap = {
    blue:   'bg-blue-500/20 border-blue-500/50 text-blue-200 shadow-md shadow-blue-500/10',
    violet: 'bg-violet-500/20 border-violet-500/50 text-violet-200 shadow-md shadow-violet-500/10',
  }
  return (
    <div className="flex gap-1 p-0.5 bg-slate-800/60 border border-slate-700/50 rounded-lg">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            value === opt.value
              ? `border ${accentMap[accent] || accentMap.blue}`
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// === Метрика для chart-summary ===
function ChartMetric({ label, value, color }) {
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-3">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-base sm:text-lg font-bold ${color} truncate`}>{value}</div>
    </div>
  )
}

// === Сам столбчатый график ===
function BarChart({ data, max, metric }) {
  const fmt = (v) => metric === 'revenue'
    ? `${Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`
    : `${Number(v || 0).toLocaleString('ru-RU')}`

  return (
    <div className="space-y-3">
      <div className="relative h-72 rounded-xl border border-slate-700/40 bg-slate-900/40 p-4">
        {/* Grid lines */}
        <div className="absolute inset-4 flex flex-col justify-between pointer-events-none">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="border-t border-slate-700/30" />
          ))}
        </div>
        {/* Y-axis labels */}
        <div className="absolute left-1 top-4 bottom-4 flex flex-col justify-between text-[9px] text-slate-600 font-mono pointer-events-none w-10 text-right pr-1">
          {[1, 0.75, 0.5, 0.25, 0].map(p => (
            <div key={p}>{metric === 'revenue' ? `${Math.round(max * p / 1000)}k` : Math.round(max * p)}</div>
          ))}
        </div>
        {/* Bars */}
        <div className="relative h-full flex items-end gap-1 ml-12">
          {data.map((item, idx) => {
            const value = Number(item.value || 0)
            const height = max > 0 ? (value / max) * 100 : 0
            return (
              <div
                key={idx}
                className="group flex-1 h-full flex items-end min-w-0 relative"
                title={`${item.date}: ${fmt(value)}`}
              >
                <div
                  className="w-full rounded-t bg-gradient-to-t from-violet-600 to-fuchsia-400 group-hover:from-violet-500 group-hover:to-fuchsia-300 transition-all shadow-lg shadow-violet-500/20"
                  style={{ height: `${Math.max(height, 1)}%` }}
                />
                {/* Tooltip on hover */}
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-950 border border-violet-500/40 text-[11px] text-white font-semibold opacity-0 group-hover:opacity-100 pointer-events-none transition shadow-xl z-10">
                  {fmt(value)}
                  <div className="text-[9px] text-slate-400 font-normal">{item.date}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* X-axis labels (compact) */}
      <div className="flex gap-1 ml-12 text-[9px] text-slate-500 font-mono">
        {data.map((item, idx) => {
          // Показываем каждую N-ную дату чтобы не было каши
          const step = Math.ceil(data.length / 12)
          const show = idx === 0 || idx === data.length - 1 || idx % step === 0
          return (
            <div key={idx} className="flex-1 text-center truncate">
              {show ? item.date : ''}
            </div>
          )
        })}
      </div>
    </div>
  )
}
