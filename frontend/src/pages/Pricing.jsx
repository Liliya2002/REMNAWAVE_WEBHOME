import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PeriodSelectionModal from '../components/PeriodSelectionModal'
import { authFetch } from '../services/api'
import { Gift, Rocket, Infinity, Globe, Lock, Smartphone, Flame } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''

export default function Pricing(){
  const navigate = useNavigate()
  const [isAuth, setIsAuth] = useState(false)
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false)
  const [hasUsedFreeTrial, setHasUsedFreeTrial] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  
  // Plans from database
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  
  // Payment state
  const [showPeriodModal, setShowPeriodModal] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [balance, setBalance] = useState(0)
  
  useEffect(() => {
    const token = localStorage.getItem('token')
    setIsAuth(!!token)
    
    if (token) {
      checkActiveSubscription(token)
      loadBalance()
    }
    
    fetchPlans()
  }, [])
  
  const fetchPlans = async () => {
    setPlansLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/plans`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (res.ok) {
        const data = await res.json()
        setPlans(data.plans || [])
      }
    } catch (err) {
      console.error('Error fetching plans:', err)
    } finally {
      setPlansLoading(false)
    }
  }
  
  const checkActiveSubscription = async (token) => {
    try {
      const res = await authFetch('/api/subscriptions/my')
      if (res.ok) {
        const data = await res.json()
        const subs = data.subscriptions || []
        const activeSub = subs.find(sub => sub.is_active)
        const usedTrial = subs.some(sub => String(sub.plan_name || '').toUpperCase() === 'FREE_TRIAL')
        setHasActiveSubscription(!!activeSub)
        setHasUsedFreeTrial(usedTrial)
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        console.error('Error checking subscriptions:', err)
      }
    }
  }

  const loadBalance = async () => {
    try {
      const res = await authFetch('/api/payments/balance')
      if (!res.ok) return
      const data = await res.json()
      setBalance(Number(data.balance || 0))
    } catch (err) {
      console.error('Error loading balance:', err)
    }
  }
  
  const handleActivateFreeTrial = async () => {
    const token = localStorage.getItem('token')
    
    if (!token) {
      navigate('/login')
      return
    }
    
    setLoading(true)
    setError(null)
    setSuccess(null)
    
    try {
      const res = await authFetch('/api/subscriptions/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка активации')
      }
      
      setSuccess(`Тестовый период активирован! Username: ${data.subscription.username}`)
      setHasActiveSubscription(true)
      
      if (data.subscription.subscriptionUrl) {
        console.log('Subscription URL:', data.subscription.subscriptionUrl)
      }
      
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  
  const handlePaymentClick = (plan) => {
    const token = localStorage.getItem('token')
    
    if (!token) {
      navigate('/login')
      return
    }
    
    loadBalance()
    setSelectedPlan(plan)
    setShowPeriodModal(true)
  }
  
  const handleCreatePayment = async (period) => {
    const token = localStorage.getItem('token')
    
    if (!token || !selectedPlan) return
    
    setPaymentLoading(true)
    setError(null)
    
    try {
      const res = await authFetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: selectedPlan.id,
          period: period
        })
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка создания платежа')
      }
      
      // Redirect to Platega payment page
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl
      } else {
        throw new Error('Payment URL not received')
      }
      
    } catch (err) {
      setError(err.message)
      setShowPeriodModal(false)
      setPaymentLoading(false)
    }
  }

  const handlePayWithBalance = async (period) => {
    const token = localStorage.getItem('token')
    if (!token || !selectedPlan) return

    setPaymentLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await authFetch('/api/payments/pay-with-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: selectedPlan.id,
          period,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка оплаты с баланса')

      setSuccess('Подписка успешно оплачена с баланса')
      setShowPeriodModal(false)
      setSelectedPlan(null)
      await loadBalance()
      await checkActiveSubscription(token)
    } catch (err) {
      setError(err.message)
    } finally {
      setPaymentLoading(false)
    }
  }

  const renderFreeTrialButton = () => {
    if (!isAuth) {
      return (
        <button 
          onClick={() => navigate('/login')}
          className="w-full px-4 py-2 bg-brand text-sky-900 dark:text-white rounded hover:bg-brand/90"
        >
          Войти для активации
        </button>
      )
    }
    
    if (hasUsedFreeTrial) {
      return (
        <button 
          disabled
          className="w-full px-4 py-2 bg-slate-700 text-sky-700 dark:text-slate-400 dark:text-slate-400 rounded cursor-not-allowed"
        >
          Пробный период уже использован
        </button>
      )
    }

    if (hasActiveSubscription) {
      return (
        <button 
          disabled
          className="w-full px-4 py-2 bg-slate-700 text-sky-700 dark:text-slate-400 dark:text-slate-400 rounded cursor-not-allowed"
        >
          Уже активировано
        </button>
      )
    }
    
    return (
      <button 
        onClick={handleActivateFreeTrial}
        disabled={loading}
        className="w-full px-4 py-2 rounded transition-all bg-neon text-sky-900 dark:text-white hover:bg-neon/90 disabled:opacity-50"
      >
        {loading ? 'Активация...' : 'Активировать бесплатно'}
      </button>
    )
  }
  
  return (
    <div className="w-full bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 min-h-screen py-10 sm:py-16 lg:py-24 px-4 sm:px-6 lg:px-8">
      <section className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-12 lg:mb-16">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 leading-tight">
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Прозрачные цены
            </span>
            <br />
            <span className="text-sky-700 dark:text-slate-300">без скрытых платежей</span>
          </h1>
          <p className="text-base sm:text-lg text-sky-700 dark:text-slate-400 dark:text-slate-400 max-w-2xl mx-auto">
            Каждый аккаунт - неограниченный трафик и полная приватность. Без подписки и автосписаний.
          </p>
        </div>
      
      {/* Error/Success Messages */}
      {error && (
        <div className="mb-8 max-w-2xl mx-auto p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-600 dark:text-red-400 text-center">
          {error}
        </div>
      )}
      
      {success && (
        <div className="mb-8 max-w-2xl mx-auto p-4 bg-green-500/10 border border-green-500/50 rounded-lg text-green-600 dark:text-green-400 text-center">
          {success}
        </div>
      )}
      
      {/* Period Selection Modal */}
      {showPeriodModal && selectedPlan && (
        <PeriodSelectionModal
          plan={selectedPlan}
          balance={balance}
          paymentLoading={paymentLoading}
          onSelectGateway={handleCreatePayment}
          onSelectBalance={handlePayWithBalance}
          onClose={() => {
            setShowPeriodModal(false)
            setSelectedPlan(null)
          }}
        />
      )}

      {/* Free Trial Card */}
      {plans.filter(p => p.is_trial).length > 0 && (!isAuth || !hasUsedFreeTrial) && (
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-2">Начните бесплатно</h2>
            <p className="text-sky-700 dark:text-slate-400 dark:text-slate-400">7 дней полноценного доступа для тестирования</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-1 gap-6 max-w-2xl mx-auto">
            {plans.filter(p => p.is_trial).map((trialPlan) => (
              <div 
                key={trialPlan.id} 
                className="relative p-8 rounded-2xl border-2 border-cyan-500/60 dark:bg-slate-900 bg-gradient-to-br from-cyan-50 via-sky-50 to-cyan-100 dark:from-cyan-500/10 dark:via-slate-900 dark:to-slate-950 shadow-[0_0_40px_rgba(34,211,238,0.2)] hover:shadow-[0_0_60px_rgba(34,211,238,0.3)] transition-all duration-300"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent rounded-2xl" />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <div className="text-xs text-cyan-600 dark:text-cyan-400 uppercase tracking-widest font-bold mb-2 flex items-center gap-1"><Gift className="w-4 h-4" /> Полностью бесплатно</div>
                      <h3 className="text-3xl font-bold text-sky-900 dark:text-white">{trialPlan.name}</h3>
                    </div>
                    <div className="text-5xl"><Rocket className="w-12 h-12 text-cyan-600 dark:text-cyan-400" /></div>
                  </div>
                  
                  <div className="mb-8 py-6 border-y border-sky-200 dark:border-slate-700/50">
                    <div className="flex items-baseline gap-2">
                      <span className="text-6xl font-extrabold text-cyan-600 dark:text-cyan-400">0</span>
                      <span className="text-2xl text-cyan-600 dark:text-cyan-400">₽</span>
                    </div>
                    <p className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-3">7 полных дней со всеми возможностями</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                      <div className="mb-2"><Infinity className="w-7 h-7 text-cyan-600 dark:text-cyan-400" /></div>
                      <div className="text-sm text-sky-700 dark:text-slate-300">Неограниченный трафик</div>
                    </div>
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                      <div className="mb-2"><Globe className="w-7 h-7 text-cyan-600 dark:text-cyan-400" /></div>
                      <div className="text-sm text-sky-700 dark:text-slate-300">Все локации доступны</div>
                    </div>
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                      <div className="mb-2"><Lock className="w-7 h-7 text-cyan-600 dark:text-cyan-400" /></div>
                      <div className="text-sm text-sky-700 dark:text-slate-300">No-logs шифрование</div>
                    </div>
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                      <div className="mb-2"><Smartphone className="w-7 h-7 text-cyan-600 dark:text-cyan-400" /></div>
                      <div className="text-sm text-sky-700 dark:text-slate-300">Все устройства</div>
                    </div>
                  </div>
                  
                  <div className="mt-8">
                    {renderFreeTrialButton()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Paid Plans */}
      <div>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-2">Платные подписки</h2>
          <p className="text-sky-700 dark:text-slate-400 dark:text-slate-400">Выберите период оплаты - чем дольше, тем выгоднее</p>
        </div>
        
        {plansLoading ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center gap-3 text-sky-700 dark:text-slate-400 dark:text-slate-400">
              <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Загрузка тарифов...
            </div>
          </div>
        ) : plans.filter(p => !p.is_trial).length === 0 ? (
          <div className="text-center py-20 text-sky-700 dark:text-slate-400 dark:text-slate-400">Платные тарифы недоступны</div>
        ) : (
          <div className={`grid gap-8 justify-center ${
            (() => {
              const count = plans.filter(p => !p.is_trial).length
              if (count === 1) return 'grid-cols-1 max-w-lg mx-auto'
              if (count === 2) return 'grid-cols-1 sm:grid-cols-2 max-w-3xl mx-auto'
              return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            })()
          }`}>
            {plans.filter(p => !p.is_trial).map((plan, idx, arr) => (
              <div 
                key={plan.id} 
                className={`group relative rounded-2xl border overflow-visible transition-all duration-300 ${
                  idx === 0 && arr.length > 1
                    ? 'border-blue-500/60 dark:bg-slate-900 bg-gradient-to-br from-blue-50 via-sky-50 to-cyan-50 dark:from-blue-900/20 dark:via-slate-900 dark:to-slate-950 shadow-[0_0_40px_rgba(59,130,246,0.25)] hover:shadow-[0_0_60px_rgba(59,130,246,0.35)] mt-4'
                    : idx === 0 && arr.length === 1
                    ? 'border-blue-500/60 dark:bg-slate-900 bg-gradient-to-br from-blue-50 via-sky-50 to-cyan-50 dark:from-blue-900/20 dark:via-slate-900 dark:to-slate-950 shadow-[0_0_40px_rgba(59,130,246,0.25)] hover:shadow-[0_0_60px_rgba(59,130,246,0.35)]'
                    : 'border-sky-200 dark:border-slate-700/50 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/30 dark:via-slate-900 dark:to-slate-950 hover:border-blue-500/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.15)]'
                }`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 via-transparent to-transparent opacity-0 group-hover:opacity-10 transition-opacity duration-300" />
                
                {idx === 0 && arr.length > 1 && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-4 py-1 rounded-full text-sm font-bold whitespace-nowrap z-10 flex items-center gap-1">
                    <Flame className="w-4 h-4" /> Самый популярный
                  </div>
                )}
                
                <div className="p-8 relative z-10 h-full flex flex-col">
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold text-sky-900 dark:text-white mb-2">{plan.name}</h3>
                    {plan.description && (
                      <p className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">{plan.description}</p>
                    )}
                  </div>
                  
                  <div className="mb-8 py-6 border-y border-sky-200 dark:border-slate-700/50">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-extrabold text-blue-600 dark:text-blue-400">{plan.price_monthly}</span>
                      <span className="text-sky-700 dark:text-slate-400 dark:text-slate-400">₽/мес</span>
                    </div>
                    <p className="text-xs text-sky-700 dark:text-slate-400 mt-2">Может быть дешевле при длительной подписке</p>
                  </div>
                  
                  {/* Traffic highlight */}
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                    <div className="flex items-center justify-between">
                      <span className="text-sky-700 dark:text-slate-300 font-semibold">Трафик</span>
                      <span className="text-xl font-bold text-blue-600 dark:text-blue-400">{plan.traffic_gb} GB/мес</span>
                    </div>
                  </div>
                  
                  {/* Features */}
                  <div className="mb-8 flex-grow">
                    <p className="text-xs text-sky-700 dark:text-slate-400 uppercase font-semibold mb-3">Включено:</p>
                    <ul className="space-y-2">
                      {plan.features?.slice(0, 5).map((feat, fidx) => (
                        <li key={fidx} className="flex items-start gap-2 text-sm text-sky-700 dark:text-slate-300">
                          <span className="text-blue-600 dark:text-blue-400 mt-1 text-lg">✓</span>
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  {/* Action Button */}
                  <button 
                    onClick={() => handlePaymentClick(plan)}
                    disabled={paymentLoading}
                    className={`w-full px-6 py-3 rounded-lg font-semibold transition-all duration-300 disabled:opacity-50 ${
                      idx === 0
                        ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] hover:from-blue-600 hover:to-cyan-600'
                        : 'border border-slate-600 text-sky-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-300'
                    }`}
                  >
                    {paymentLoading ? 'Обработка...' : 'Выбрать тариф'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
    </div>
  )
}
