import React, { useState } from 'react'
import { AdminPanelNav } from '../components/AdminPanelNav'
import TemplateBuilder from '../components/TemplateBuilder'

/**
 * Полная админ-панель с навигацией, если PlansManagement и ReferralAdminPanel
 * будут переданы как пропсы из Dashboard
 */
export function AdminPanelComplete({ 
  user, 
  PlansManagementComponent = null, 
  ReferralAdminPanelComponent = null 
}) {
  const [adminSection, setAdminSection] = useState('overview')

  return (
    <div className="space-y-6">
      <div className="p-8 bg-gradient-to-br from-red-900/20 to-orange-900/20 border border-red-500/30 rounded-2xl">
        <h3 className="text-3xl font-bold flex items-center gap-2 text-red-400 mb-2">
          🎛️ Панель администратора
        </h3>
        <p className="text-slate-400">Управление системой и мониторинг всех процессов</p>
      </div>

      {/* Навигация админ-панели */}
      <AdminPanelNav adminSection={adminSection} setAdminSection={setAdminSection} />

      {/* Обзор */}
      {adminSection === 'overview' && (
        <>
          {/* Статистика */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-6 bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-blue-500/30 rounded-xl">
              <div className="text-sm text-blue-400 font-medium mb-2">👥 Всего пользователей</div>
              <div className="text-3xl font-bold text-blue-300">—</div>
              <p className="text-xs text-slate-500 mt-3">Функция в разработке</p>
            </div>
            <div className="p-6 bg-gradient-to-br from-green-900/20 to-emerald-900/20 border border-green-500/30 rounded-xl">
              <div className="text-sm text-green-400 font-medium mb-2">📋 Активные подписки</div>
              <div className="text-3xl font-bold text-green-300">—</div>
              <p className="text-xs text-slate-500 mt-3">Функция в разработке</p>
            </div>
            <div className="p-6 bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-500/30 rounded-xl">
              <div className="text-sm text-purple-400 font-medium mb-2">⚡ Webhooks обработано</div>
              <div className="text-3xl font-bold text-purple-300">—</div>
              <p className="text-xs text-slate-500 mt-3">Функция в разработке</p>
            </div>
          </div>

          {/* Быстрые действия */}
          <div className="p-8 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl">
            <h3 className="text-2xl font-bold mb-6 flex items-center gap-2 text-white">
              ⚡ Быстрые действия
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer">
                <div className="font-bold text-white text-lg">📊 Просмотр логов</div>
                <div className="text-sm text-slate-400 mt-2">История всех операций системы</div>
              </div>
              <div className="p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer">
                <div className="font-bold text-white text-lg">👤 Пользователи</div>
                <div className="text-sm text-slate-400 mt-2">Управление ролями и статусами</div>
              </div>
              <div 
                onClick={() => setAdminSection('plans')}
                className="p-5 bg-slate-900/50 border border-slate-700/50 rounded-lg hover:border-blue-500/30 hover:bg-slate-900/70 transition-all cursor-pointer"
              >
                <div className="font-bold text-white text-lg">✨ Тарифы</div>
                <div className="text-sm text-slate-400 mt-2">Создание и редактирование тарифов</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Управление тарифами */}
      {adminSection === 'plans' && PlansManagementComponent && (
        <PlansManagementComponent />
      )}
      {adminSection === 'plans' && !PlansManagementComponent && (
        <div className="p-6 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-400">⚠️ Компонент PlansManagement не передан</p>
        </div>
      )}

      {/* Управление реферальной программой */}
      {adminSection === 'referrals' && ReferralAdminPanelComponent && (
        <ReferralAdminPanelComponent />
      )}
      {adminSection === 'referrals' && !ReferralAdminPanelComponent && (
        <div className="p-6 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-400">⚠️ Компонент ReferralAdminPanel не передан</p>
        </div>
      )}

      {/* Редактор шаблонов */}
      {adminSection === 'settings' && (
        <TemplateBuilder />
      )}
    </div>
  )
}

export default AdminPanelComplete
