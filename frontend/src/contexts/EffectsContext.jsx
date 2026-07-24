import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

// Локальные (пер-браузерные) настройки визуальных эффектов:
//   • bgMode     — анимированный фон: 'auto' (следовать глобальной настройке
//                  сайта), 'on' (принудительно вкл), 'off' (принудительно выкл)
//   • cursorMode — свечение курсора в админке: 'on' | 'off'
//
// Глобальные настройки (плотность, светлая тема, параллакс, дефолтный вкл/выкл)
// живут в site_config и приходят через SiteConfigContext. Здесь — только
// персональные переопределения.

const EffectsContext = createContext(null)
export function useEffects() {
  return useContext(EffectsContext) || { bgMode: 'auto', setBgMode: () => {}, cursorMode: 'on', setCursorMode: () => {} }
}

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

export function EffectsProvider({ children }) {
  const [bgMode, setBgModeState] = useState(() => read('fx_bg', 'auto'))
  const [cursorMode, setCursorModeState] = useState(() => read('fx_cursor', 'on'))

  const setBgMode = useCallback((v) => {
    setBgModeState(v)
    try { localStorage.setItem('fx_bg', v) } catch { /* ignore */ }
  }, [])
  const setCursorMode = useCallback((v) => {
    setCursorModeState(v)
    try { localStorage.setItem('fx_cursor', v) } catch { /* ignore */ }
  }, [])

  // Синхронизация между вкладками.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'fx_bg' && e.newValue) setBgModeState(e.newValue)
      if (e.key === 'fx_cursor' && e.newValue) setCursorModeState(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <EffectsContext.Provider value={{ bgMode, setBgMode, cursorMode, setCursorMode }}>
      {children}
    </EffectsContext.Provider>
  )
}
