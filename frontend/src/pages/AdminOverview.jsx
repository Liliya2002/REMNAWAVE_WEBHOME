import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AdminOverview() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchOverviewStats()
  }, [])

  async function fetchOverviewStats() {
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        setStats(await res.json())
      }
    } catch (err) {
      console.error('Error fetching admin stats:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="p-4 sm:p-8 bg-gradient-to-br from-red-900/20 to-orange-900/20 border border-red-500/30 rounded-2xl">
        <h1 className="text-xl sm:text-3xl font-bold flex items-center gap-2 text-red-400 mb-2">
          🎛️ Панель администратора
        </h1>
        <p className="text-slate-400 text-sm sm:text-base">Управление системой и мониторинг всех процессов</p>
      </div>

      {/* Карточки статистики */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="p-6 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-xl">
          <div className="text-sm text-blue-400 font-medium mb-2">👥 Всего пользователей</div>
          <div className="text-3xl font-bold text-blue-300">
            {loading ? '...' : (stats?.totalUsers ?? '—')}
          </div>
          <p className="text-xs text-slate-500 mt-3">Зарегистрировано в системе</p>
        </div>
        <div className="p-6 bg-gradient-to-br from-green-900/20 to-emerald-900/20 border border-green-500/30 rounded-xl">
          <div className="text-sm text-green-400 font-medium mb-2">📋 Активные подписки</div>
          <div className="text-3xl font-bold text-green-300">
            {loading ? '...' : (stats?.activeSubscriptions ?? '—')}
          </div>
          <p className="text-xs text-slate-500 mt-3">Действующих подписок</p>
        </div>
        <div className="p-6 bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-500/30 rounded-xl">
          <div className="text-sm text-purple-400 font-medium mb-2">💰 Доход за месяц</div>
          <div className="text-3xl font-bold text-purple-300">
            {loading ? '...' : (stats?.monthlyRevenue ? `${Number(stats.monthlyRevenue).toFixed(0)} ₽` : '—')}
          </div>
          <p className="text-xs text-slate-500 mt-3">Оплаченные платежи</p>
        </div>
      </div>

      {/* Быстрые действия */}
      <div className="p-4 sm:p-8 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl">
        <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-white">
          ⚡ Быстрые действия
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          <div
            onClick={() => navigate('/admin/stats')}
            className="p-4 sm:p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer group"
          >
            <div className="font-bold text-white text-base sm:text-lg group-hover:text-blue-300 transition-colors">📈 Статистика</div>
            <div className="text-sm text-slate-400 mt-1 sm:mt-2">Графики и аналитика</div>
          </div>
          <div
            onClick={() => navigate('/admin/users')}
            className="p-4 sm:p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer group"
          >
            <div className="font-bold text-white text-base sm:text-lg group-hover:text-blue-300 transition-colors">👥 Пользователи</div>
            <div className="text-sm text-slate-400 mt-1 sm:mt-2">Управление ролями и статусами</div>
          </div>
          <div
            onClick={() => navigate('/admin/plans')}
            className="p-4 sm:p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer group"
          >
            <div className="font-bold text-white text-base sm:text-lg group-hover:text-blue-300 transition-colors">✨ Тарифы</div>
            <div className="text-sm text-slate-400 mt-1 sm:mt-2">Создание и редактирование</div>
          </div>
          <div
            onClick={() => navigate('/admin/payments')}
            className="p-4 sm:p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer group"
          >
            <div className="font-bold text-white text-base sm:text-lg group-hover:text-blue-300 transition-colors">💳 Платежи</div>
            <div className="text-sm text-slate-400 mt-1 sm:mt-2">История и мониторинг</div>
          </div>
          <div
            onClick={() => navigate('/admin/referrals')}
            className="p-4 sm:p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer group"
          >
            <div className="font-bold text-white text-base sm:text-lg group-hover:text-blue-300 transition-colors">🎁 Рефералы</div>
            <div className="text-sm text-slate-400 mt-1 sm:mt-2">Настройка реферальной программы</div>
          </div>
          <div
            onClick={() => navigate('/admin/templates')}
            className="p-4 sm:p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer group"
          >
            <div className="font-bold text-white text-base sm:text-lg group-hover:text-blue-300 transition-colors">🎨 Шаблоны</div>
            <div className="text-sm text-slate-400 mt-1 sm:mt-2">Кастомизация и конфигурация</div>
          </div>
        </div>
      </div>
    </div>
  )
}
