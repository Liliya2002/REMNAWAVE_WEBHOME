import React, { useState } from 'react'
import TemplateBuilder from './TemplateBuilder'

/**
 * Админ-панель с управ версия для Dashboard
 */
export function AdminPanelNav({ adminSection, setAdminSection }) {
  return (
    <div className="flex gap-3 flex-wrap">
      <button 
        onClick={() => setAdminSection('overview')}
        className={`px-6 py-3 rounded-lg font-semibold transition-all ${
          adminSection === 'overview' 
            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/50' 
            : 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:border-blue-500/50'
        }`}
      >
        📊 Обзор
      </button>
      <button 
        onClick={() => setAdminSection('plans')}
        className={`px-6 py-3 rounded-lg font-semibold transition-all ${
          adminSection === 'plans' 
            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/50' 
            : 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:border-blue-500/50'
        }`}
      >
        ✨ Тарифы
      </button>
      <button 
        onClick={() => setAdminSection('referrals')}
        className={`px-6 py-3 rounded-lg font-semibold transition-all ${
          adminSection === 'referrals' 
            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/50' 
            : 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:border-blue-500/50'
        }`}
      >
        🎁 Рефералы
      </button>
      <button 
        onClick={() => setAdminSection('settings')}
        className={`px-6 py-3 rounded-lg font-semibold transition-all ${
          adminSection === 'settings' 
            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/50' 
            : 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:border-blue-500/50'
        }`}
      >
        ⚙️ Настройки
      </button>
    </div>
  )
}
