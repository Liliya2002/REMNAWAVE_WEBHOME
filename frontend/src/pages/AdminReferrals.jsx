import React, { useEffect, useMemo, useState } from 'react'
import {
  Users, Percent, CalendarDays, Gauge, Save, RefreshCw,
  CheckCircle, AlertCircle, Sparkles, Coins, Trophy
} from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''

function authHeaders() {
  return {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  }
}

function fmtMoney(n) {
  const v = Number(n) || 0
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}

export default function AdminReferrals() {
  const [config, setConfig] = useState(null)
  const [topRefs, setTopRefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [form, setForm] = useState({})

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [cfgRes, topRes] = await Promise.all([
        fetch(`${API_URL}/api/referrals/config`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/referrals/top?limit=10`, { headers: authHeaders() }),
      ])
      if (cfgRes.ok) {
        const data = await cfgRes.json()
        setConfig(data)
        setForm(data)
      }
      if (topRes.ok) {
        const t = await topRes.json()
        setTopRefs(t.referrers || [])
      }
    } catch {
      setError('Ошибка загрузки конфигурации')
    } finally {
      setLoading(false)
    }
  }

  function setField(k, v) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  const dirty = useMemo(() => {
    if (!config) return false
    const keys = [
      'firstPaymentRewardPercent', 'subsequentPaymentRewardPercent',
      'bonusEnabled', 'bonusDaysOnSignup', 'bonusDaysOnFirstPayment',
      'bonusDaysOnSubsequent', 'minPaymentForReward', 'maxMonthlyReward',
    ]
    return keys.some(k => String(form[k] ?? '') !== String(config[k] ?? ''))
  }, [form, config])

  async function saveConfig() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`${API_URL}/api/referrals/config`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          first_payment_reward_percent: parseFloat(form.firstPaymentRewardPercent) || 0,
          subsequent_payment_reward_percent: parseFloat(form.subsequentPaymentRewardPercent) || 0,
          referral_bonus_enabled: !!form.bonusEnabled,
          referral_bonus_days_on_signup: parseFloat(form.bonusDaysOnSignup) || 0,
          referral_bonus_days_on_first_payment: parseFloat(form.bonusDaysOnFirstPayment) || 0,
          referral_bonus_days_on_subsequent: parseFloat(form.bonusDaysOnSubsequent) || 0,
          min_payment_for_reward: parseFloat(form.minPaymentForReward) || 0,
          max_monthly_reward: parseFloat(form.maxMonthlyReward) || 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      setSuccess('Конфигурация сохранена')
      setTimeout(() => setSuccess(null), 2500)
      await loadAll()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
        <span className="ml-3 text-slate-400 text-sm">Загрузка конфигурации...</span>
      </div>
    )
  }

  // Превью реальной выплаты для текущих процентов
  const sampleAmount = 1000
  const firstReward = (sampleAmount * (parseFloat(form.firstPaymentRewardPercent) || 0)) / 100
  const subsequentReward = (sampleAmount * (parseFloat(form.subsequentPaymentRewardPercent) || 0)) / 100

  return (
    <div className="space-y-6 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">Реферальная программа</h1>
          <p className="text-xs text-slate-400">Проценты вознаграждений, бонусные дни и месячные лимиты</p>
        </div>
        <button
          onClick={loadAll}
          className="ml-auto px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/60 transition flex items-center gap-1.5"
          title="Обновить"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> {success}
        </div>
      )}

      {/* Проценты вознаграждений */}
      <section className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 flex items-center justify-center">
            <Percent className="w-[18px] h-[18px] text-blue-300" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Проценты вознаграждений</h2>
            <p className="text-[11px] text-slate-500">Сколько реферер получает с пополнений своих рефералов</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PercentField
            label="С первого пополнения"
            hint="Самая частая мотивация — поэтому здесь обычно ставят больший процент"
            value={form.firstPaymentRewardPercent}
            onChange={v => setField('firstPaymentRewardPercent', v)}
            sampleAmount={sampleAmount}
            sampleReward={firstReward}
            accent="blue"
          />
          <PercentField
            label="С последующих пополнений"
            hint="Долгосрочная мотивация — обычно ниже первого"
            value={form.subsequentPaymentRewardPercent}
            onChange={v => setField('subsequentPaymentRewardPercent', v)}
            sampleAmount={sampleAmount}
            sampleReward={subsequentReward}
            accent="cyan"
          />
        </div>
      </section>

      {/* Бонусные дни */}
      <section className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 sm:p-6">
        <div className="flex items-start sm:items-center justify-between gap-3 mb-5 flex-col sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center">
              <CalendarDays className="w-[18px] h-[18px] text-amber-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Бонусные дни подписки</h2>
              <p className="text-[11px] text-slate-500">Дополнительная награда сверх процентов — в днях VPN</p>
            </div>
          </div>
          <ToggleSwitch
            checked={!!form.bonusEnabled}
            onChange={v => setField('bonusEnabled', v)}
            label={form.bonusEnabled ? 'Включено' : 'Отключено'}
          />
        </div>

        {form.bonusEnabled ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DaysField
              label="За регистрацию"
              hint="Начисляются обоим — рефереру и рефералу"
              value={form.bonusDaysOnSignup}
              onChange={v => setField('bonusDaysOnSignup', v)}
            />
            <DaysField
              label="За первое пополнение"
              hint="Начисляются после первой оплаты реферала"
              value={form.bonusDaysOnFirstPayment}
              onChange={v => setField('bonusDaysOnFirstPayment', v)}
            />
            <DaysField
              label="За каждое пополнение"
              hint="Бессрочный бонус с любой оплаты реферала"
              value={form.bonusDaysOnSubsequent}
              onChange={v => setField('bonusDaysOnSubsequent', v)}
            />
          </div>
        ) : (
          <div className="text-sm text-slate-500 italic px-1">Бонусные дни отключены — рефереры получают только проценты</div>
        )}
      </section>

      {/* Лимиты */}
      <section className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500/20 to-red-500/20 border border-rose-500/30 flex items-center justify-center">
            <Gauge className="w-[18px] h-[18px] text-rose-300" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Лимиты и ограничения</h2>
            <p className="text-[11px] text-slate-500">Защита от злоупотреблений реферальной программой</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MoneyField
            label="Минимум для вознаграждения"
            hint="Платежи ниже этой суммы не приносят бонус рефереру"
            value={form.minPaymentForReward}
            step={10}
            onChange={v => setField('minPaymentForReward', v)}
          />
          <MoneyField
            label="Максимум в месяц"
            hint="Потолок заработка одного реферера за календарный месяц"
            value={form.maxMonthlyReward}
            step={100}
            onChange={v => setField('maxMonthlyReward', v)}
          />
        </div>
      </section>

      {/* Top referrers — read-only вспомогательная панель */}
      {topRefs.length > 0 && (
        <section className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-yellow-500/20 to-amber-500/20 border border-yellow-500/30 flex items-center justify-center">
              <Trophy className="w-[18px] h-[18px] text-yellow-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Топ рефереров</h2>
              <p className="text-[11px] text-slate-500">Рейтинг по числу активных рефералов</p>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-[11px] text-slate-400 uppercase">
                  <th className="text-left py-2 pr-3 font-semibold">#</th>
                  <th className="text-left py-2 pr-3 font-semibold">Логин</th>
                  <th className="text-right py-2 pr-3 font-semibold">Рефералов</th>
                  <th className="text-right py-2 pr-3 font-semibold">Заработано</th>
                  <th className="text-right py-2 pr-3 font-semibold">Бонус-дни</th>
                  <th className="text-left py-2 font-semibold">Последний</th>
                </tr>
              </thead>
              <tbody>
                {topRefs.map((r, i) => (
                  <tr key={r.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition">
                    <td className="py-2 pr-3">
                      {i < 3 ? (
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          i === 0 ? 'bg-yellow-500/20 text-yellow-300' :
                          i === 1 ? 'bg-slate-400/20 text-slate-300' :
                          'bg-amber-700/20 text-amber-400'
                        }`}>{i + 1}</span>
                      ) : (
                        <span className="text-slate-500 text-xs">{i + 1}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-white font-medium">{r.login}</td>
                    <td className="py-2 pr-3 text-right">
                      <span className="font-mono text-cyan-300">{r.referrals_count}</span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-emerald-300">{fmtMoney(r.total_earned)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-amber-300">{Number(r.total_bonus_days || 0).toFixed(1)}</td>
                    <td className="py-2 text-slate-400 text-xs">
                      {r.last_referral_date ? new Date(r.last_referral_date).toLocaleDateString('ru-RU') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Sticky save bar */}
      {dirty && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-auto z-40 animate-in slide-in-from-bottom">
          <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/60 rounded-2xl shadow-2xl shadow-black/40 p-3 flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span className="text-sm text-slate-300">Есть несохранённые изменения</span>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="ml-auto px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-lg text-sm hover:shadow-lg hover:shadow-blue-500/30 transition disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PercentField({ label, hint, value, onChange, sampleAmount, sampleReward, accent = 'blue' }) {
  const accentClasses = {
    blue: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
    cyan: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  }
  return (
    <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl p-4">
      <label className="block text-sm font-semibold text-slate-200 mb-2">{label}</label>
      <div className="relative mb-2">
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={value ?? 0}
          onChange={e => onChange(e.target.value)}
          className="w-full pl-4 pr-9 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white font-bold text-lg focus:border-blue-500 focus:outline-none transition-colors"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span>
      </div>
      <p className="text-[11px] text-slate-500 mb-2.5">{hint}</p>
      <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${accentClasses[accent]}`}>
        <Coins className="w-3.5 h-3.5" />
        <span className="text-[11px]">
          С пополнения <span className="font-mono">{fmtMoney(sampleAmount)}</span> →{' '}
          <span className="font-mono font-bold">{fmtMoney(sampleReward)}</span>
        </span>
      </div>
    </div>
  )
}

function DaysField({ label, hint, value, onChange }) {
  return (
    <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl p-4">
      <label className="block text-sm font-semibold text-slate-200 mb-2">{label}</label>
      <div className="relative mb-2">
        <input
          type="number"
          min="0"
          step="0.5"
          value={value ?? 0}
          onChange={e => onChange(e.target.value)}
          className="w-full pl-4 pr-12 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white font-bold text-lg focus:border-amber-500 focus:outline-none transition-colors"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-semibold">дней</span>
      </div>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}

function MoneyField({ label, hint, value, step, onChange }) {
  return (
    <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl p-4">
      <label className="block text-sm font-semibold text-slate-200 mb-2">{label}</label>
      <div className="relative mb-2">
        <input
          type="number"
          min="0"
          step={step}
          value={value ?? 0}
          onChange={e => onChange(e.target.value)}
          className="w-full pl-4 pr-9 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white font-bold text-lg focus:border-rose-500 focus:outline-none transition-colors"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">₽</span>
      </div>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <span className="text-sm text-slate-300 font-medium">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-block w-12 h-6 rounded-full transition-colors ${
          checked ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-slate-700'
        }`}
        aria-pressed={checked}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-0.5'
        }`} />
      </button>
    </label>
  )
}
