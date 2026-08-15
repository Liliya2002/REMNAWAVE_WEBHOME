import React, { useEffect } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard, PanelLeft } from 'lucide-react'
import { lockDarkTheme } from '../contexts/ThemeContext'

// Сайдбар убран — навигация по разделам идёт через стартовый экран /admin
// (groups + поиск). На каждой подстранице показываем минибар для возврата.
//
// Админка ВСЕГДА в тёмной теме — независимо от пользовательских настроек.
// Форсим класс 'dark' на <html> при заходе и снимаем при выходе с /admin.
//
// Проп onSwitchToV2 — колбэк из AdminLayoutSwitch для перехода на новый дизайн.

export default function AdminLayout({ onSwitchToV2 }) {
  const location = useLocation()
  const isOverview = location.pathname === '/admin' || location.pathname === '/admin/'

  // Форсируем тёмную тему пока юзер в админке; при unmount возвращаем тему из
  // настройки. Замок нужен ещё и для того, чтобы пересинхронизация при возврате
  // приложения из фона не сбросила админку в светлую.
  useEffect(() => lockDarkTheme(), [])

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-3 sm:px-5 lg:px-6 py-4 sm:py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          {!isOverview ? (
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 hover:text-white text-sm transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <LayoutDashboard className="w-4 h-4" />
              <span>К админ-панели</span>
            </Link>
          ) : <span />}

          {onSwitchToV2 && (
            <button
              onClick={onSwitchToV2}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 hover:text-white text-sm transition-all"
              title="Переключиться на новый дизайн (сайдбар)"
            >
              <PanelLeft className="w-4 h-4" />
              <span>Новый вид</span>
            </button>
          )}
        </div>

        <main className="w-full">
          <div className="w-full rounded-2xl border border-slate-800/60 bg-slate-950/30 px-4 sm:px-6 lg:px-7 py-5 sm:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
