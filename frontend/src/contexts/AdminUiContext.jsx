import React, { createContext, useCallback, useContext, useState } from 'react'

// Версия оформления админки: 'classic' | 'v2'.
// Хранится в localStorage (у каждого браузера/админа своё). Вынесена в контекст,
// чтобы её видел и AdminLayoutSwitch (какой layout рендерить), и App-оболочка
// (скрывать ли публичный header/footer, когда активен полноэкранный v2).

const STORAGE_KEY = 'admin_ui_version'
const AdminUiContext = createContext(null)

export function useAdminUi() {
  return useContext(AdminUiContext) || { version: 'classic', setVersion: () => {} }
}

function readVersion() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'v2' ? 'v2' : 'classic'
  } catch {
    return 'classic'
  }
}

export function AdminUiProvider({ children }) {
  const [version, setVersionState] = useState(readVersion)

  const setVersion = useCallback((v) => {
    const next = v === 'v2' ? 'v2' : 'classic'
    setVersionState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }, [])

  return (
    <AdminUiContext.Provider value={{ version, setVersion }}>
      {children}
    </AdminUiContext.Provider>
  )
}
