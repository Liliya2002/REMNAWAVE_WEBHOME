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

// Цвет статус-бара iOS в standalone-режиме («приложение» с домашнего экрана)
// берётся из theme-color. Держим его равным фону шапки, иначе над ней висит
// полоска чужого цвета. Те же значения продублированы в index.html — там они
// применяются до загрузки React, чтобы полоска не мигала.
const THEME_COLOR = { dark: '#060913', light: '#f0f9ff' }   // верх .site-bg / sky-50

function applyClass(effective) {
  const root = document.documentElement
  // Админка и premium-кабинет держат тёмную тему принудительно и помечают это
  // атрибутом на <html>. Пересинхронизация (см. ниже) не должна сбрасывать их
  // в светлую — иначе возврат из фона в админке ломал бы оформление.
  const eff = root.dataset.themeLock === 'dark' ? 'dark' : effective

  if (eff === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[eff] || THEME_COLOR.dark)
}

/**
 * Применить тему из сохранённой настройки — без React.
 * Нужно в cleanup'ах разделов, которые форсировали тёмную: раньше каждый
 * держал свою копию чтения localStorage + matchMedia, и копии разъезжались.
 */
export function applyStoredTheme() {
  const pref = readStored()
  applyClass(pref === 'system' ? getSystemTheme() : pref)
}

/**
 * Пометить, что раздел держит тёмную тему принудительно (админка,
 * premium-кабинет). Возвращает функцию снятия — её удобно вернуть из useEffect.
 */
export function lockDarkTheme() {
  const root = document.documentElement
  root.dataset.themeLock = 'dark'
  // Именно applyClass, а не classList.add: заодно перекрашивает статус-бар.
  // Иначе в админке со светлой темой страница тёмная, а полоска сверху светлая.
  applyClass('dark')
  return () => {
    delete root.dataset.themeLock
    applyStoredTheme()
  }
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

  // Пересчёт темы при возврате приложения из фона.
  //
  // Слушателя выше недостаточно. iOS усыпляет JS свёрнутого приложения, и
  // события change у matchMedia, случившиеся в это время, до нас не доходят
  // вообще — не откладываются, а теряются. Поэтому после сворачивания и
  // возврата состояние могло разойтись с системным и висело так до полного
  // перезапуска приложения: при холодном старте getSystemTheme() читает
  // актуальное значение, а в живой сессии его больше никто не перечитывал.
  //
  // pageshow нужен отдельно от visibilitychange: возврат страницы из bfcache
  // не всегда сопровождается сменой visibilityState.
  useEffect(() => {
    const resync = () => {
      const eff = pref === 'system' ? getSystemTheme() : pref
      setEffective(eff)
      applyClass(eff)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') resync() }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', resync)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', resync)
    }
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
