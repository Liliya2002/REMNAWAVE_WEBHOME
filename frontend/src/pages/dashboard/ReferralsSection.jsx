import React, { useEffect, useState } from 'react'
import { Gift, Zap, Users, CalendarDays, Target, Link2, Clipboard, ClipboardCheck, Lightbulb, Sparkles, CheckCircle, Star, Banknote } from 'lucide-react'

export default function ReferralsSection() {
  const [stats, setStats] = useState(null)
  const [referralLink, setReferralLink] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [bonusDays, setBonusDays] = useState(0)
  const [activating, setActivating] = useState(false)
  const [activateResult, setActivateResult] = useState(null)
  const [activateError, setActivateError] = useState(null)

  const API_URL = import.meta.env.VITE_API_URL || ''

  useEffect(() => {
    fetchReferralData()
  }, [])

  async function fetchReferralData() {
    const { authFetch } = await import('../../services/api')
    setLoading(true)
    setError(null)

    try {
      const linkRes = await authFetch('/api/referrals/link')
      if (linkRes.ok) {
        setReferralLink(await linkRes.json())
      }

      const statsRes = await authFetch('/api/referrals/stats')
      if (statsRes.ok) {
        setStats(await statsRes.json())
      }

      const configRes = await fetch(`${API_URL}/api/referrals/config`)
      if (configRes.ok) {
        setConfig(await configRes.json())
      }

      const bonusRes = await authFetch('/api/subscriptions/bonus')
      if (bonusRes.ok) {
        const bonusData = await bonusRes.json()
        setBonusDays(bonusData.pendingBonusDays || 0)
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        setError('Ошибка загрузки данных рефералов')
        console.error(err)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleActivateBonus() {
    const { authFetch } = await import('../../services/api')
    setActivating(true)
    setActivateResult(null)
    setActivateError(null)
    try {
      const res = await authFetch('/api/subscriptions/apply-bonus', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setActivateResult(data)
        setBonusDays(0)
      } else {
        setActivateError(data.error || 'Ошибка активации')
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        setActivateError('Ошибка сети')
      }
    } finally {
      setActivating(false)
    }
  }

  const copyToClipboard = () => {
    if (referralLink?.url) {
      navigator.clipboard.writeText(referralLink.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sky-700 dark:text-slate-400 dark:text-slate-400">
        <svg className="animate-spin h-6 w-6 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Загрузка данных...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/50 text-red-600 dark:text-red-400 rounded-xl">
          {error}
        </div>
      )}

      {/* Активация бонусных дней */}
      {bonusDays > 0 && (
        <div className="p-4 sm:p-6 bg-gradient-to-br from-green-900/20 to-emerald-900/20 border border-green-500/30 rounded-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                <Gift className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <div className="text-lg font-bold text-sky-900 dark:text-white">У вас <span className="text-green-600 dark:text-green-400">{bonusDays}</span> бонусных дней!</div>
                <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">Активируйте их, чтобы продлить подписку</div>
              </div>
            </div>
            <button
              onClick={handleActivateBonus}
              disabled={activating}
              className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-green-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center gap-2"
            >
              {activating ? (
                <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Активация…</>
              ) : (
                <><Zap className="w-5 h-5" /> Активировать дни</>
              )}
            </button>
          </div>
          {activateResult && (
            <div className="mt-4 p-4 bg-green-500/10 border border-green-500/50 rounded-xl">
              <div className="text-sm text-green-600 dark:text-green-400 font-semibold">✓ {activateResult.message}</div>
              <div className="text-xs text-green-700 dark:text-green-300/70 mt-1">
                Подписка действует до {new Date(activateResult.newExpiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                {activateResult.wasReactivated && ' (подписка реактивирована!)'}
              </div>
            </div>
          )}
          {activateError && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-sm text-red-600 dark:text-red-400">
              ✕ {activateError}
            </div>
          )}
        </div>
      )}

      {/* Статистика */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 sm:p-6 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-xl">
            <div className="text-xs sm:text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 font-medium mb-1 sm:mb-2 flex items-center gap-1"><Users className="w-4 h-4" /> Всего рефералов</div>
            <div className="text-xl sm:text-3xl font-bold text-sky-900 dark:text-white">{stats.activeReferrals || 0}</div>
            <div className="text-xs text-sky-700 dark:text-slate-400 mt-1 sm:mt-2 hidden sm:block">приглашено пользователей</div>
          </div>
          <div className="p-4 sm:p-6 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-xl">
            <div className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 font-medium mb-1 sm:mb-2 flex items-center gap-1"><Banknote className="w-4 h-4" /> Заработано</div>
            <div className="text-xl sm:text-3xl font-bold text-blue-700 dark:text-blue-300">{Number(stats.totalEarned || 0).toFixed(2)} ₽</div>
            <div className="text-xs text-blue-600 dark:text-blue-400/70 mt-1 sm:mt-2 hidden sm:block">от пополнений рефералов</div>
          </div>
          <div className="p-4 sm:p-6 bg-gradient-to-br from-green-900/20 to-emerald-900/20 border border-green-500/30 rounded-xl">
            <div className="text-xs sm:text-sm text-green-600 dark:text-green-400 font-medium mb-1 sm:mb-2 flex items-center gap-1"><CalendarDays className="w-4 h-4" /> Бонусные дни</div>
            <div className="text-xl sm:text-3xl font-bold text-green-700 dark:text-green-300">{Number(stats.totalBonusDays || 0).toFixed(0)}</div>
            <div className="text-xs text-green-600 dark:text-green-400/70 mt-1 sm:mt-2 hidden sm:block">всего заработано</div>
          </div>
          <div className="p-4 sm:p-6 bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-500/30 rounded-xl">
            <div className="text-xs sm:text-sm text-purple-600 dark:text-purple-400 font-medium mb-1 sm:mb-2 flex items-center gap-1"><Target className="w-4 h-4" /> Награда</div>
            <div className="text-xl sm:text-3xl font-bold text-purple-700 dark:text-purple-300">{Number(config?.firstPaymentRewardPercent || 0).toFixed(1)}%</div>
            <div className="text-xs text-purple-600 dark:text-purple-400/70 mt-1 sm:mt-2 hidden sm:block">на первое пополнение</div>
          </div>
        </div>
      )}

      {/* Реферальная ссылка */}
      {referralLink && (
        <div className="p-4 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
          <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-sky-900 dark:text-white">
            <Link2 className="w-6 h-6" /> Ваша реферальная ссылка
          </h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={referralLink.url}
              readOnly
              className="flex-1 px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-300 dark:border-slate-700 rounded-lg text-sky-700 dark:text-slate-300 font-mono text-sm focus:outline-none"
            />
            <button
              onClick={copyToClipboard}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/50 font-bold transition-all duration-300 whitespace-nowrap"
            >
              {copied ? <><ClipboardCheck className="w-4 h-4 inline" /> Скопирована</> : <><Clipboard className="w-4 h-4 inline" /> Скопировать</>}
            </button>
          </div>
          <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2"><Lightbulb className="w-4 h-4 shrink-0" /> Поделитесь этой ссылкой с друзьями и получайте награды!</div>
          </div>
        </div>
      )}

      {/* Информация о программе */}
      {config && config.enabled && (
        <div className="p-4 sm:p-8 bg-gradient-to-br from-yellow-900/20 to-orange-900/20 border border-yellow-500/30 rounded-2xl">
          <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
            <Sparkles className="w-6 h-6" /> Условия программы
          </h3>
          <div className="space-y-3">
            <div className="flex gap-3 p-3 sm:p-4 bg-sky-50 dark:bg-slate-900/50 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sky-900 dark:text-white">За регистрацию по ссылке</div>
                <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">+{Number(config.bonusDaysOnSignup || 0).toFixed(0)} дней к подписке</div>
              </div>
            </div>
            <div className="flex gap-3 p-3 sm:p-4 bg-sky-50 dark:bg-slate-900/50 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sky-900 dark:text-white text-sm sm:text-base">За первое пополнение реферала</div>
                <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">+{Number(config.firstPaymentRewardPercent || 0).toFixed(1)}% от суммы + {Number(config.bonusDaysOnFirstPayment || 0).toFixed(0)} дней</div>
              </div>
            </div>
            <div className="flex gap-3 p-3 sm:p-4 bg-sky-50 dark:bg-slate-900/50 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sky-900 dark:text-white text-sm sm:text-base">За каждое пополнение реферала</div>
                <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">+{Number(config.subsequentPaymentRewardPercent || 0).toFixed(1)}% от суммы</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Таблица рефералов */}
      {stats?.referralsList && stats.referralsList.length > 0 && (
        <div className="p-4 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
          <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-sky-900 dark:text-white">
            <Users className="w-6 h-6" /> Ваши рефералы
          </h3>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b border-sky-200 dark:border-slate-700/50">
                  <th className="text-left py-3 px-3 sm:px-4 text-sky-700 dark:text-slate-400 dark:text-slate-400 font-semibold">Пользователь</th>
                  <th className="text-center py-3 px-3 sm:px-4 text-sky-700 dark:text-slate-400 dark:text-slate-400 font-semibold">Пополнения</th>
                  <th className="text-right py-3 px-3 sm:px-4 text-sky-700 dark:text-slate-400 dark:text-slate-400 font-semibold">Заработано</th>
                  <th className="text-right py-3 px-3 sm:px-4 text-sky-700 dark:text-slate-400 dark:text-slate-400 font-semibold">Дата</th>
                </tr>
              </thead>
              <tbody>
                {stats.referralsList.map(ref => (
                  <tr key={ref.id} className="border-b border-slate-700/20 hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 px-4">
                      <div className="font-semibold text-sky-900 dark:text-white">{ref.login}</div>
                      <div className="text-xs text-sky-700 dark:text-slate-400">{ref.email}</div>
                    </td>
                    <td className="py-4 px-4 text-center text-sky-700 dark:text-slate-300 font-medium">{ref.payments_count}</td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-green-600 dark:text-green-400 font-bold">{Number(ref.total_earned || 0).toFixed(2)} ₽</span>
                    </td>
                    <td className="py-4 px-4 text-right text-sky-700 dark:text-slate-400 dark:text-slate-400 text-xs">
                      {new Date(ref.created_at).toLocaleDateString('ru-RU')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* История вознаграждений */}
      {stats?.recentRewards && stats.recentRewards.length > 0 && (
        <div className="p-4 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
          <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-sky-900 dark:text-white">
            <Star className="w-6 h-6" /> Последние вознаграждения
          </h3>
          <div className="space-y-3">
            {stats.recentRewards.map(reward => (
              <div key={reward.id} className="flex items-center justify-between gap-3 p-3 sm:p-4 bg-sky-100/50 dark:bg-slate-900/30 rounded-lg border border-sky-200 dark:border-slate-700/30 hover:border-blue-500/30 transition-colors">
                <div className="flex-1">
                  <div className="font-semibold text-sky-900 dark:text-white">
                    {reward.reward_type === 'signup_bonus' && <><Sparkles className="w-4 h-4 inline text-yellow-600 dark:text-yellow-400" /> Бонус за регистрацию</>}
                    {reward.reward_type === 'first_payment' && <><Target className="w-4 h-4 inline text-purple-600 dark:text-purple-400" /> Бонус за первое пополнение</>}
                    {reward.reward_type === 'subsequent_payment' && <><Banknote className="w-4 h-4 inline text-green-600 dark:text-green-400" /> Бонус за пополнение</>}
                  </div>
                  <div className="text-xs text-sky-700 dark:text-slate-400 mt-1">
                    {new Date(reward.created_at).toLocaleDateString('ru-RU', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
                <div className="text-right">
                  {reward.amount_earned > 0 && (
                    <div className="text-green-600 dark:text-green-400 font-bold">
                      +{Number(reward.amount_earned || 0).toFixed(2)} ₽
                    </div>
                  )}
                  {reward.bonus_days_earned > 0 && (
                    <div className="text-cyan-600 dark:text-cyan-400 text-sm font-semibold">
                      +{Number(reward.bonus_days_earned || 0).toFixed(0)} дн
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
