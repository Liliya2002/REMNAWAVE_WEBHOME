import React, { useEffect } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard } from 'lucide-react'

// Сайдбар убран — навигация по разделам идёт через стартовый экран /admin
// (groups + поиск). На каждой подстранице показываем минибар для возврата.
//
// Админка ВСЕГДА в тёмной теме — независимо от пользовательских настроек.
// Форсим класс 'dark' на <html> при заходе и снимаем при выходе с /admin.

export default function AdminLayout() {
  const location = useLocation()
  const isOverview = location.pathname === '/admin' || location.pathname === '/admin/'

  // Форсируем тёмную тему пока юзер в админке.
  // Сохраняем предыдущее состояние класса и восстанавливаем при unmount.
  useEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.add('dark')
    return () => {
      // Восстанавливаем как было ДО входа в админку (читаем из localStorage)
      try {
        const pref = localStorage.getItem('vpn_theme') || 'system'
        const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
        const shouldBeDark = pref === 'dark' || (pref === 'system' && sysDark)
        if (shouldBeDark) root.classList.add('dark')
        else root.classList.remove('dark')
      } catch {
        if (!wasDark) root.classList.remove('dark')
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-6xl mx-auto px-3 sm:px-5 lg:px-6 py-4 sm:py-5">
        {!isOverview && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 hover:text-white text-sm transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <LayoutDashboard className="w-4 h-4" />
              <span>К админ-панели</span>
            </Link>
          </div>
        )}

        <main className="w-full">
          <div className="w-full rounded-2xl border border-slate-800/60 bg-slate-950/30 px-4 sm:px-6 lg:px-7 py-5 sm:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
