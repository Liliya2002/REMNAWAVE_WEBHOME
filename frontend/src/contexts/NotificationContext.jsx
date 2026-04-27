import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

const NotificationContext = createContext(null)

let toastIdCounter = 0

export function useNotification() {
  return useContext(NotificationContext)
}

/**
 * Провайдер уведомлений
 * - toast(type, title, message) — всплывающее уведомление
 * - success/error/warning/info(title, message) — shorthand
 */
export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef({})

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id])
        delete timersRef.current[id]
      }
    }, 300) // время анимации выхода
  }, [])

  const addToast = useCallback(({ type = 'info', title, message, duration = 5000 }) => {
    const id = ++toastIdCounter
    const toast = { id, type, title, message, leaving: false, createdAt: Date.now() }

    setToasts(prev => {
      // Макс 5 тостов одновременно
      const updated = prev.length >= 5 ? prev.slice(1) : prev
      return [...updated, toast]
    })

    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => removeToast(id), duration)
    }

    return id
  }, [removeToast])

  const toast = useCallback((type, title, message, duration) => {
    return addToast({ type, title, message, duration })
  }, [addToast])

  const success = useCallback((title, message) => toast('success', title, message), [toast])
  const error = useCallback((title, message) => toast('error', title, message, 8000), [toast])
  const warning = useCallback((title, message) => toast('warning', title, message, 6000), [toast])
  const info = useCallback((title, message) => toast('info', title, message), [toast])

  return (
    <NotificationContext.Provider value={{ toast, success, error, warning, info, removeToast }}>
      {children}
      {/* Toast Container — centered on mobile, right-aligned on desktop */}
      <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-4 z-[9999] flex flex-col gap-3 pointer-events-none sm:max-w-md sm:w-full">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={removeToast} />
        ))}
      </div>
    </NotificationContext.Provider>
  )
}

// =================== TOAST ITEM ===================

const typeConfig = {
  success: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    colors: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    iconBg: 'bg-emerald-500/20 text-emerald-400',
    progressColor: 'bg-emerald-500'
  },
  error: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
    ),
    colors: 'text-red-400 bg-red-500/10 border-red-500/30',
    iconBg: 'bg-red-500/20 text-red-400',
    progressColor: 'bg-red-500'
  },
  warning: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    colors: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    iconBg: 'bg-amber-500/20 text-amber-400',
    progressColor: 'bg-amber-500'
  },
  info: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    ),
    colors: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    iconBg: 'bg-blue-500/20 text-blue-400',
    progressColor: 'bg-blue-500'
  }
}

function ToastItem({ toast, onClose }) {
  const config = typeConfig[toast.type] || typeConfig.info

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border backdrop-blur-xl shadow-2xl shadow-black/20 transition-all duration-300 ${
        toast.leaving
          ? 'opacity-0 translate-x-8 scale-95'
          : 'opacity-100 translate-x-0 scale-100 animate-in slide-in-from-right'
      } ${config.colors}`}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${config.iconBg}`}>
        {config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-semibold text-slate-100 leading-tight">{toast.title}</p>
        )}
        {toast.message && (
          <p className="text-sm text-slate-400 mt-0.5 leading-snug">{toast.message}</p>
        )}
      </div>

      {/* Close */}
      <button
        onClick={() => onClose(toast.id)}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
