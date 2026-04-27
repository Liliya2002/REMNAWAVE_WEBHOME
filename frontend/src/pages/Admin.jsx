import React, { useState } from 'react'
import AdminUsers from './AdminUsers'
import AdminStats from './AdminStats'
import PaymentHistory from './PaymentHistory'
import AdminNotifications from '../components/AdminNotifications'

export default function Admin() {
  const [activeTab, setActiveTab] = useState('stats')

  const tabs = [
    { id: 'stats', name: '📊 Статистика', component: AdminStats },
    { id: 'users', name: '👥 Пользователи', component: AdminUsers },
    { id: 'payments', name: '💳 Платежи', component: PaymentHistory },
    { id: 'notifications', name: '🔔 Уведомления', component: AdminNotifications }
  ]

  const activeTabData = tabs.find(t => t.id === activeTab)
  const Component = activeTabData?.component || AdminStats

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark to-slate-900 pt-20 pb-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Заголовок */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2">⚙️ Админ-панель</h1>
          <p className="text-sm sm:text-base text-slate-400">Управление, статистика и платежи</p>
        </div>

        {/* Табы */}
        <div className="flex gap-2 sm:gap-4 mb-8 border-b border-slate-700 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-3 font-medium transition border-b-2 whitespace-nowrap text-sm sm:text-base ${
                activeTab === tab.id
                  ? 'text-primary border-primary'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        {/* Содержимое таба */}
        <div className="animate-fadeIn">
          <Component />
        </div>
      </div>
    </div>
  )
}
