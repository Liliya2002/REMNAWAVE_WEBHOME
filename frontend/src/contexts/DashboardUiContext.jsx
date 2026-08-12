import React, { createContext, useContext, useEffect } from 'react'
import { useSiteConfig } from './SiteConfigContext'

/**
 * Вид личного кабинета: 'classic' — исходный, 'premium' — тёмная тема
 * Digital Premium.
 *
 * Вид задаёт АДМИН в настройках проекта (site_config.dashboard_theme), и он
 * применяется всем пользователям. Своего переключателя у пользователя нет —
 * так кабинет выглядит одинаково у всех, и вид можно менять централизованно,
 * не прося никого ничего переключать.
 */
const Ctx = createContext(null)

export const useDashboardUi = () => useContext(Ctx) || { version: 'classic' }

export function DashboardUiProvider({ children }) {
  const { config } = useSiteConfig()
  // Пока конфиг не загрузился — классический вид: он не требует тёмной темы,
  // поэтому при загрузке не будет вспышки чужого оформления.
  const version = config?.dashboard_theme === 'premium' ? 'premium' : 'classic'

  useEffect(() => {
    const root = document.documentElement
    if (version !== 'premium') { root.classList.remove('dp-theme'); return }

    // Тема Digital Premium всегда тёмная — светлый режим её сломает.
    // dp-theme красит страницу целиком и убирает звёздный фон сайта: блок
    // темы непрозрачный, и там, где он кончается, был виден стык со звёздами.
    root.classList.add('dark', 'dp-theme')
    return () => root.classList.remove('dp-theme')
  }, [version])

  return <Ctx.Provider value={{ version }}>{children}</Ctx.Provider>
}
