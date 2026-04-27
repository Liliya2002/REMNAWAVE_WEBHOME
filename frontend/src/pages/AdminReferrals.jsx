import React, { useEffect, useState } from 'react'

export default function AdminReferrals() {
  const API_URL = import.meta.env.VITE_API_URL || ''
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [formData, setFormData] = useState({})

  useEffect(() => {
    fetchConfig()
  }, [])

  async function fetchConfig() {
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`${API_URL}/api/referrals/config`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        setFormData(data)
      }
    } catch (err) {
      setError('Ошибка загрузки конфигурации')
    } finally {
      setLoading(false)
    }
  }

  async function saveConfig() {
    const token = localStorage.getItem('token')
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`${API_URL}/api/referrals/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          first_payment_reward_percent: parseFloat(formData.firstPaymentRewardPercent),
          subsequent_payment_reward_percent: parseFloat(formData.subsequentPaymentRewardPercent),
          referral_bonus_enabled: formData.bonusEnabled,
          referral_bonus_days_on_signup: parseFloat(formData.bonusDaysOnSignup),
          referral_bonus_days_on_first_payment: parseFloat(formData.bonusDaysOnFirstPayment),
          referral_bonus_days_on_subsequent: parseFloat(formData.bonusDaysOnSubsequent),
          min_payment_for_reward: parseFloat(formData.minPaymentForReward),
          max_monthly_reward: parseFloat(formData.maxMonthlyReward)
        })
      })

      if (res.ok) {
        setSuccess('Конфигурация сохранена успешно')
        fetchConfig()
      } else {
        const data = await res.json()
        setError(data.error || 'Ошибка сохранения')
      }
    } catch (err) {
      setError('Ошибка сохранения конфигурации')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="animate-spin h-8 w-8 text-blue-500 mr-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span className="text-slate-300">Загрузка конфигурации...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/50 text-red-400 rounded-xl flex items-center gap-2">
          <span>✕</span> {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-500/10 border border-green-500/50 text-green-400 rounded-xl flex items-center gap-2">
          <span>✓</span> {success}
        </div>
      )}

      {config && (
        <div className="space-y-6">
          {/* Проценты вознаграждений */}
          <div className="p-4 sm:p-8 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl">
            <h4 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-white">
              💰 Проценты вознаграждений
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-3">
                  Первое пополнение реферала (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.firstPaymentRewardPercent || 0}
                  onChange={(e) => setFormData({...formData, firstPaymentRewardPercent: e.target.value})}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-semibold text-lg focus:border-blue-500 focus:outline-none transition-colors"
                />
                <p className="text-xs text-slate-400 mt-2">От суммы пополнения реферала</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-3">
                  Последующие пополнения (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.subsequentPaymentRewardPercent || 0}
                  onChange={(e) => setFormData({...formData, subsequentPaymentRewardPercent: e.target.value})}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-semibold text-lg focus:border-blue-500 focus:outline-none transition-colors"
                />
                <p className="text-xs text-slate-400 mt-2">От суммы каждого пополнения</p>
              </div>
            </div>
          </div>

          {/* Бонусные дни */}
          <div className="p-4 sm:p-8 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
              <h4 className="text-xl sm:text-2xl font-bold flex items-center gap-2 text-white">
                📅 Бонусные дни подписки
              </h4>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative inline-block w-14 h-8 bg-slate-700 rounded-full transition-colors" style={{backgroundColor: formData.bonusEnabled ? '#0ea5e9' : '#334155'}}>
                  <div className={`absolute w-6 h-6 bg-white rounded-full top-1 transition-transform ${formData.bonusEnabled ? 'translate-x-7' : 'translate-x-1'}`}/>
                </div>
                <span className="text-sm text-slate-300 font-semibold">{formData.bonusEnabled ? 'Включена' : 'Отключена'}</span>
                <input
                  type="checkbox"
                  checked={formData.bonusEnabled || false}
                  onChange={(e) => setFormData({...formData, bonusEnabled: e.target.checked})}
                  className="hidden"
                />
              </label>
            </div>
            {formData.bonusEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-3">
                    Дни за регистрацию
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={formData.bonusDaysOnSignup || 0}
                    onChange={(e) => setFormData({...formData, bonusDaysOnSignup: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-semibold text-lg focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-3">
                    Дни за первое пополнение
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={formData.bonusDaysOnFirstPayment || 0}
                    onChange={(e) => setFormData({...formData, bonusDaysOnFirstPayment: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-semibold text-lg focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-3">
                    Дни за каждое пополнение
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={formData.bonusDaysOnSubsequent || 0}
                    onChange={(e) => setFormData({...formData, bonusDaysOnSubsequent: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-semibold text-lg focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Лимиты */}
          <div className="p-4 sm:p-8 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl">
            <h4 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-white">
              📊 Лимиты и ограничения
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-3">
                  Минимум для вознаграждения ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={formData.minPaymentForReward || 0}
                  onChange={(e) => setFormData({...formData, minPaymentForReward: e.target.value})}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-semibold text-lg focus:border-blue-500 focus:outline-none transition-colors"
                />
                <p className="text-xs text-slate-400 mt-2">Платеж ниже этой суммы не приносит вознаграждение</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-3">
                  Максимум в месяц ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={formData.maxMonthlyReward || 0}
                  onChange={(e) => setFormData({...formData, maxMonthlyReward: e.target.value})}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-semibold text-lg focus:border-blue-500 focus:outline-none transition-colors"
                />
                <p className="text-xs text-slate-400 mt-2">Максимум заработка от рефералов в месяц</p>
              </div>
            </div>
          </div>

          <button
            onClick={saveConfig}
            disabled={saving}
            className={`w-full px-6 py-4 rounded-lg font-bold transition-all text-lg ${
              saving 
                ? 'bg-slate-700/50 text-slate-400 cursor-not-allowed' 
                : 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-blue-500/50'
            }`}
          >
            {saving ? '💾 Сохранение...' : '💾 Сохранить конфигурацию'}
          </button>
        </div>
      )}
    </div>
  )
}
