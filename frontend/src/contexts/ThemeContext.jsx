import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'vpn_theme'

// Возможные значения: 'light' | 'dark' | 'system'
function getSystemTheme() {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}

function applyClass(effective) {
  const root = document.documentElement
  if (effective === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(readStored)
  const [effective, setEffective] = useState(() =>
    pref === 'system' ? getSystemTheme() : pref
  )

  // Применяем класс на <html>
  useEffect(() => {
    const eff = pref === 'system' ? getSystemTheme() : pref
    setEffective(eff)
    applyClass(eff)
  }, [pref])

  // Слушаем изменение системной темы (если pref=system)
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => {
      const eff = mq.matches ? 'dark' : 'light'
      setEffective(eff)
      applyClass(eff)
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [pref])

  const setPreference = useCallback((next) => {
    setPref(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }, [])

  const toggle = useCallback(() => {
    // toggle цикл: light → dark → system → light
    setPreference(pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light')
  }, [pref, setPreference])

  return (
    <ThemeContext.Provider value={{ pref, effective, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Без провайдера — fallback (например в админке используем форсированную тёмную)
    return {
      pref: 'dark',
      effective: 'dark',
      setPreference: () => {},
      toggle: () => {},
    }
  }
  return ctx
}

/**
 * Инициализирующий скрипт — должен быть вставлен в index.html ДО React,
 * чтобы избежать FOUC (мелькание светлой темы при загрузке когда сохранена тёмная).
 *
 * Но в нашем случае можно просто запускать applyClass в provider — небольшое мелькание
 * на 30мс при первом рендере не критично. Если важно — добавим inline-скрипт в index.html.
 */
