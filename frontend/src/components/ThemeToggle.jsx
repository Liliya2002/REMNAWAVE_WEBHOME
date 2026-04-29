import React from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

/**
 * Кнопка переключения темы. Цикл: light → dark → system → light.
 * Используется в header публичной части.
 */
export default function ThemeToggle({ className = '' }) {
  const { pref, toggle } = useTheme()

  const icon = pref === 'light' ? <Sun className="w-4 h-4" />
    : pref === 'dark' ? <Moon className="w-4 h-4" />
    : <Monitor className="w-4 h-4" />

  const tooltip = pref === 'light' ? 'Светлая (клик — Тёмная)'
    : pref === 'dark' ? 'Тёмная (клик — Авто по системе)'
    : 'Авто (клик — Светлая)'

  return (
    <button
      onClick={toggle}
      title={tooltip}
      aria-label={tooltip}
      className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg
        text-sky-700 hover:text-slate-900 hover:bg-slate-200
        dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800
        transition-colors ${className}`}
    >
      {icon}
    </button>
  )
}
