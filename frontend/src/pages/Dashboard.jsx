import React, { useEffect, useState } from 'react'
import { User, Ticket, CreditCard, Gift, ShieldCheck, Hand, Ban, Inbox } from 'lucide-react'
import { authFetch } from '../services/api'
import ProfileSection from './dashboard/ProfileSection'
import SecuritySection from './dashboard/SecuritySection'
import SubscriptionsSection from './dashboard/SubscriptionsSection'
import ReferralsSection from './dashboard/ReferralsSection'
import BalanceSection from './dashboard/BalanceSection'
import InboxSection from './dashboard/InboxSection'
import EmailConfirmBanner from '../components/EmailConfirmBanner'

export default function Dashboard() {
  const [user, setUser] = useState(null)
  const [subscriptions, setSubscriptions] = useState([])
  const [pendingPayments, setPendingPayments] = useState([])
  const [pendingBonusDays, setPendingBonusDays] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState(null)
  const [copySuccess, setCopySuccess] = useState(null)
  const [activeSection, setActiveSection] = useState('profile')

  useEffect(() => {
    fetchMe()
    fetchSubscriptions()
    fetchPendingPayments()
    fetchBonusDays()
    fetchUnread()

    const interval = setInterval(() => {
      fetchMe()
      fetchSubscriptions()
      fetchPendingPayments()
      fetchBonusDays()
      fetchUnread()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  async function fetchUnread() {
    try {
      const res = await authFetch('/api/notifications/unread')
      if (res.ok) {
        const d = await res.json()
        setUnreadCount(d.count || 0)
      }
    } catch (err) { /* silent */ }
  }

  async function fetchMe() {
    try {
      const res = await authFetch('/api/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        console.error('Error fetching user:', err)
        setError('Ошибка загрузки профиля')
      }
    }
  }

  async function fetchSubscriptions() {
    try {
      const res = await authFetch('/api/subscriptions/my')
      if (res.ok) {
        const data = await res.json()
        setSubscriptions(data.subscriptions || [])
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        console.error('Error fetching subscriptions:', err)
      }
    }
  }

  async function fetchPendingPayments() {
    try {
      const res = await authFetch('/api/payments/history')
      if (res.ok) {
        const data = await res.json()
        setPendingPayments(data.filter(p => 
          p.status === 'pending' && p.payment_url && 
          (!p.expires_at || new Date(p.expires_at) > new Date())
        ))
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        console.error('Error fetching pending payments:', err)
      }
    }
  }

  async function fetchBonusDays() {
    try {
      const res = await authFetch('/api/subscriptions/bonus')
      if (res.ok) {
        const data = await res.json()
        setPendingBonusDays(data.pendingBonusDays || 0)
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        console.error('Error fetching bonus days:', err)
      }
    }
  }

  const menuItems = [
    { id: 'profile', label: 'Профиль', Icon: User },
    { id: 'subscriptions', label: 'Подписка', Icon: Ticket },
    { id: 'inbox', label: 'Уведомления', Icon: Inbox, badge: unreadCount },
    { id: 'balance', label: 'Баланс', Icon: CreditCard },
    { id: 'referrals', label: 'Рефералы', Icon: Gift },
    { id: 'security', label: 'Безопасность', Icon: ShieldCheck },
  ]

  return (
    <div className="w-full pb-24 lg:pb-0">
      {/* Email confirmation banner */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6 max-w-7xl mx-auto">
        <EmailConfirmBanner />
      </div>

      {/* Hero раздел */}
      <div className="relative mb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="relative bg-gradient-to-r from-blue-600 to-cyan-600 rounded-2xl p-8 sm:p-12 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/50 to-cyan-600/50 blur-3xl opacity-30"></div>
            <div className="relative z-10">
              <h1 className="text-4xl sm:text-5xl font-bold text-sky-900 dark:text-white mb-3 flex items-center gap-3">
                <Hand className="w-10 h-10 shrink-0" /> Добро пожаловать, {user?.login || 'пользователь'}!
              </h1>
              <p className="text-blue-100 text-lg">
                Управляйте своим аккаунтом, подписками и заработками
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6">
          <div className="p-4 bg-red-500/10 border border-red-500/50 text-red-600 dark:text-red-400 rounded-xl text-center">
            {error}
          </div>
        </div>
      )}

      {/* Баннер неоплаченных платежей */}
      {pendingPayments.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6">
          {pendingPayments.map(p => (
            <div key={p.id} className="p-4 mb-3 bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border border-yellow-500/40 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CreditCard className="w-6 h-6 text-yellow-600 dark:text-yellow-400 shrink-0" />
                <div>
                  <p className="text-yellow-200 font-semibold text-sm">Ожидает оплаты: {p.plan_name}</p>
                  <p className="text-yellow-700 dark:text-yellow-300/60 text-xs mt-0.5">{Number(p.amount).toFixed(0)} ₽ • {new Date(p.created_at).toLocaleDateString('ru-RU')}</p>
                </div>
              </div>
              <a
                href={p.payment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 px-5 py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg font-semibold text-sm hover:shadow-[0_0_20px_rgba(234,179,8,0.4)] transition-all"
              >
                Оплатить
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Боковая навигация (десктоп) */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              {/* Профиль карточка */}
              {user && (
                <div className="bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                      <User className="w-6 h-6 text-sky-900 dark:text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sky-900 dark:text-white text-sm">{user.login}</div>
                      <div className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 truncate">{user.email}</div>
                    </div>
                  </div>
                  {user.is_admin && (
                    <div className="px-2 py-1 bg-red-500/20 border border-red-500/50 rounded text-xs text-red-600 dark:text-red-400 font-semibold inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span> АДМИНИСТРАТОР
                    </div>
                  )}
                </div>
              )}

              {/* Статус подписки */}
              <div className={`bg-gradient-to-br rounded-xl p-4 border ${
                user?.hasActiveSubscription
                  ? 'from-slate-800/40 to-slate-900/50 border-sky-200 dark:border-slate-700/50'
                  : 'from-red-900/20 to-orange-900/20 border-red-500/30'
              }`}>
                <div className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 uppercase font-bold mb-3">Статус подписки</div>
                {user?.hasActiveSubscription ? (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></span>
                      <span className="text-sm text-green-600 dark:text-green-400 font-semibold">✓ Активна</span>
                    </div>
                    {user?.subscriptionExpiresAt && (
                      <div className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400">
                        Истекает: <span className="text-sky-700 dark:text-slate-300 font-semibold">
                          {new Date(user.subscriptionExpiresAt).toLocaleDateString('ru-RU')}
                        </span>
                      </div>
                    )}
                    {user?.subscriptionPlan && (
                      <div className="text-xs text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-1">
                        Тариф: <span className="text-blue-600 dark:text-blue-400 font-semibold">{user.subscriptionPlan}</span>
                      </div>
                    )}
                  </div>
                ) : user?.subscriptionPlan ? (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Ban className="w-5 h-5 text-red-600 dark:text-red-400" />
                      <span className="text-sm text-red-600 dark:text-red-400 font-semibold">Подписка истекла</span>
                    </div>
                    <a href="/pricing" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-300 font-semibold block mt-3">
                      Продлить подписку →
                    </a>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-3 h-3 rounded-full bg-slate-500"></span>
                      <span className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 font-semibold">Нет подписки</span>
                    </div>
                    <a href="/pricing" className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-300 font-semibold block mt-3">
                      Выбрать тариф →
                    </a>
                  </div>
                )}
              </div>

              {/* Меню навигации */}
              <div className="space-y-2">
                {menuItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all font-medium flex items-center gap-2 ${
                      activeSection === item.id
                        ? 'bg-blue-500/20 border border-blue-500/50 text-blue-700 dark:text-blue-300 shadow-lg shadow-blue-500/20'
                        : 'text-sky-700 dark:text-slate-300 hover:bg-slate-800/50 border border-transparent'
                    }`}
                  >
                    <item.Icon className="w-5 h-5 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-bold">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Основной контент */}
          <div className="col-span-1 lg:col-span-3">
            {activeSection === 'profile' && user && (
              <ProfileSection user={user} onUpdate={fetchMe} onOpenBalance={() => setActiveSection('balance')} />
            )}

            {activeSection === 'subscriptions' && (
              <SubscriptionsSection
                subscriptions={subscriptions}
                copySuccess={copySuccess}
                setCopySuccess={setCopySuccess}
                pendingBonusDays={pendingBonusDays}
                onBonusActivated={() => { fetchSubscriptions(); fetchBonusDays() }}
              />
            )}

            {activeSection === 'inbox' && (
              <InboxSection />
            )}

            {activeSection === 'balance' && (
              <BalanceSection />
            )}

            {activeSection === 'referrals' && (
              <ReferralsSection />
            )}

            {activeSection === 'security' && user && (
              <SecuritySection user={user} />
            )}
          </div>
        </div>
      </div>

      {/* Мобильная нижняя навигация — фиксированная, скрыта на десктопе */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-sky-200 dark:border-slate-800/60 bg-sky-50/90 dark:bg-slate-950/90 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Разделы личного кабинета"
      >
        <div className="flex overflow-x-auto scrollbar-hide px-2 py-2 gap-1">
          {menuItems.map(item => {
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id)
                  // плавно к началу контента — иначе пользователь видит ту же область
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                aria-current={active ? 'page' : undefined}
                className={`relative flex-1 min-w-[68px] flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-xl transition-all ${
                  active
                    ? 'bg-gradient-to-br from-blue-500/25 to-cyan-500/15 border border-blue-500/40 shadow-lg shadow-blue-500/20'
                    : 'border border-transparent'
                }`}
              >
                <div className="relative">
                  <item.Icon
                    className={`w-6 h-6 transition-colors ${
                      active
                        ? 'text-blue-600 dark:text-blue-300'
                        : 'text-sky-700 dark:text-slate-400'
                    }`}
                    strokeWidth={active ? 2.25 : 1.75}
                  />
                  {item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold ring-2 ring-sky-50 dark:ring-slate-950">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] leading-tight font-medium truncate max-w-full ${
                    active
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-sky-700 dark:text-slate-400'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
