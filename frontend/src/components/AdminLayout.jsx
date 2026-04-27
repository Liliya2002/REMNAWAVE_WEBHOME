import React, { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, BarChart3, Users, CreditCard, Sparkles,
  Gift, Globe, Server, Bell, Palette, Settings, ArrowLeft, Menu, X, ShoppingCart, FileText, History, Cpu
} from 'lucide-react'

const sidebarItems = [
  { to: '/admin',          label: 'Обзор',         Icon: LayoutDashboard, end: true },
  { to: '/admin/stats',    label: 'Статистика',    Icon: BarChart3 },
  { to: '/admin/users',    label: 'Пользователи',  Icon: Users },
  { to: '/admin/payments',  label: 'Платежи',      Icon: CreditCard },
  { to: '/admin/plans',     label: 'Тарифы',       Icon: Sparkles },
  { to: '/admin/referrals', label: 'Рефералы',     Icon: Gift },
  { to: '/admin/servers',   label: 'RemnaWave',    Icon: Globe },
  { to: '/admin/vps',        label: 'Управление VPS', Icon: Server },
  { to: '/admin/hosting-order', label: 'Заказать Хостинг', Icon: ShoppingCart },
  { to: '/admin/landings',  label: 'Лендинги',     Icon: FileText },
  { to: '/admin/notifications', label: 'Уведомления', Icon: Bell },
  { to: '/admin/audit',     label: 'Журнал действий', Icon: History },
  { to: '/admin/system',    label: 'Система',      Icon: Cpu },
  { to: '/admin/settings',  label: 'Настройки',    Icon: Palette },
]

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-blue-500/20 border border-blue-500/50 text-blue-300 shadow-lg shadow-blue-500/10'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
    }`

  const sidebarContent = (
    <>
      {/* Логотип / заголовок */}
      <div className="p-6 border-b border-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
            <Settings className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Админ-панель</h2>
            <p className="text-xs text-slate-500">Управление системой</p>
          </div>
        </div>
      </div>

      {/* Навигация */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        {sidebarItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={linkClass}
            onClick={() => setSidebarOpen(false)}
          >
            <item.Icon className="w-5 h-5 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Кнопка назад */}
      <div className="p-4 border-t border-slate-800/50">
        <button
          onClick={() => { navigate('/dashboard'); setSidebarOpen(false) }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
        >
          <ArrowLeft className="w-5 h-5 shrink-0" />
          <span>Личный кабинет</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-6 py-4 sm:py-5">
      <div className="flex min-h-[calc(100vh-78px)] gap-4 lg:gap-5">
        {/* === Десктоп сайдбар === */}
        <aside className="hidden lg:flex lg:flex-col w-[248px] shrink-0 rounded-2xl bg-slate-900/60 border border-slate-800/60 sticky top-[78px] h-[calc(100vh-90px)] overflow-hidden shadow-[0_12px_35px_rgba(0,0,0,0.35)]">
          {sidebarContent}
        </aside>

        {/* === Мобильная кнопка меню === */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed bottom-6 right-6 z-40 w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl flex items-center justify-center text-white text-2xl shadow-xl shadow-blue-500/30 hover:shadow-blue-500/50 transition-all active:scale-95"
          aria-label="Открыть меню"
        >
          <Menu className="w-6 h-6" />
        </button>

        {/* === Мобильный drawer === */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
            {/* Drawer */}
            <aside className="relative w-[280px] h-full bg-slate-900 border-r border-slate-800/50 flex flex-col animate-in slide-in-from-left duration-300">
              {/* Кнопка закрытия */}
              <button
                onClick={() => setSidebarOpen(false)}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              {sidebarContent}
            </aside>
          </div>
        )}

        {/* === Основной контент === */}
        <main className="flex-1 min-w-0">
          <div className="w-full min-h-full rounded-2xl border border-slate-800/60 bg-slate-950/30 px-4 sm:px-6 lg:px-7 py-5 sm:py-6">
            {/* Мобильный breadcrumb */}
            <div className="lg:hidden mb-4 flex items-center gap-2 text-sm">
              <span className="text-slate-500"><Settings className="w-4 h-4 inline" /> Админ-панель</span>
            </div>
            <Outlet />
          </div>
        </main>
      </div>
      </div>
    </div>
  )
}
