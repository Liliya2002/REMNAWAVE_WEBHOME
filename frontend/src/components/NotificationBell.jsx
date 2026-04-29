import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, AlertTriangle, Info, PartyPopper, CreditCard, ClipboardList, Gift, Globe, Megaphone } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''

// Иконки типов
const typeIcons = {
  success: <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />,
  error: <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />,
  warning: <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />,
  info: <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
  promo: <PartyPopper className="w-5 h-5 text-purple-600 dark:text-purple-400" />
}

const categoryIcons = {
  payment: <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
  subscription: <ClipboardList className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />,
  referral: <Gift className="w-5 h-5 text-green-600 dark:text-green-400" />,
  server: <Globe className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
  admin: <Megaphone className="w-5 h-5 text-orange-600 dark:text-orange-400" />,
  system: <Info className="w-5 h-5 text-sky-700 dark:text-slate-400 dark:text-slate-400" />
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef(null)
  const bellRef = useRef(null)
  const navigate = useNavigate()

  const token = localStorage.getItem('token')

  // Закрытие при клике вне панели
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        bellRef.current && !bellRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Загрузка количества непрочитанных
  const fetchUnreadCount = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/api/notifications/unread`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count)
      }
    } catch (err) {
      // silent
    }
  }, [token])

  // Загрузка списка уведомлений
  const fetchNotifications = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/notifications?limit=20`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
      }
    } catch (err) {
      // silent
    } finally {
      setLoading(false)
    }
  }, [token])

  // Периодический polling непрочитанных (каждые 30 сек)
  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [fetchUnreadCount])

  // Загрузить уведомления при открытии
  useEffect(() => {
    if (isOpen) {
      fetchNotifications()
    }
  }, [isOpen, fetchNotifications])

  // Пометить одно как прочитанное
  async function markAsRead(id) {
    try {
      await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (err) { /* silent */ }
  }

  // Пометить все как прочитанные
  async function markAllAsRead() {
    try {
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch (err) { /* silent */ }
  }

  // Удалить уведомление
  async function deleteNotification(e, id) {
    e.stopPropagation()
    try {
      await fetch(`${API_URL}/api/notifications/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const removed = notifications.find(n => n.id === id)
      setNotifications(prev => prev.filter(n => n.id !== id))
      if (removed && !removed.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (err) { /* silent */ }
  }

  // Клик по уведомлению
  function handleNotificationClick(notif) {
    if (!notif.is_read) markAsRead(notif.id)
    if (notif.link) {
      navigate(notif.link)
      setIsOpen(false)
    }
  }

  // Время в относительном формате
  function timeAgo(dateStr) {
    const now = new Date()
    const date = new Date(dateStr)
    const diff = Math.floor((now - date) / 1000)

    if (diff < 60) return 'только что'
    if (diff < 3600) return `${Math.floor(diff / 60)} мин`
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч`
    if (diff < 604800) return `${Math.floor(diff / 86400)} д`
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }

  if (!token) return null

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={bellRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-10 h-10 flex items-center justify-center rounded-lg text-sky-700 dark:text-slate-400 dark:text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
        aria-label="Уведомления"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        
        {/* Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white bg-red-500 rounded-full animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          {/* Mobile fullscreen backdrop */}
          <div className="sm:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[99]" onClick={() => setIsOpen(false)} />

          <div
            ref={panelRef}
            className="fixed inset-x-0 top-[65px] bottom-0 sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:w-96 sm:max-h-[480px] sm:rounded-xl bg-sky-50/95 dark:bg-slate-900/95 backdrop-blur-xl border-0 sm:border border-sky-200 dark:border-slate-700/50 shadow-2xl shadow-black/30 overflow-hidden z-[100] animate-in slide-in-from-top-2 duration-200"
          >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-sky-200 dark:border-slate-700/50">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-sky-700 dark:text-slate-200">Уведомления</h3>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-500/20 rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-300 transition-colors"
              >
                Прочитать все
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="overflow-y-auto max-h-[calc(100vh-140px)] sm:max-h-[400px] scrollbar-hide">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-sky-700 dark:text-slate-400">
                <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <p className="text-sm">Нет уведомлений</p>
              </div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`group relative flex items-start gap-3 px-4 py-3 border-b border-slate-800/30 cursor-pointer transition-colors ${
                    notif.is_read
                      ? 'hover:bg-slate-800/30'
                      : 'bg-blue-500/5 hover:bg-blue-500/10'
                  }`}
                >
                  {/* Unread dot */}
                  {!notif.is_read && (
                    <span className="absolute left-1.5 top-4 w-1.5 h-1.5 bg-blue-400 rounded-full" />
                  )}

                  {/* Icon */}
                  <span className="flex-shrink-0 mt-0.5">
                    {categoryIcons[notif.category] || typeIcons[notif.type] || <Info className="w-5 h-5 text-sky-700 dark:text-slate-400 dark:text-slate-400" />}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${notif.is_read ? 'text-sky-700 dark:text-slate-400 dark:text-slate-400' : 'text-sky-700 dark:text-slate-200 font-medium'}`}>
                      {notif.title}
                    </p>
                    {notif.message && (
                      <p className="text-xs text-sky-700 dark:text-slate-400 mt-0.5 line-clamp-2">{notif.message}</p>
                    )}
                    <p className="text-[10px] text-sky-700 mt-1">{timeAgo(notif.created_at)}</p>
                  </div>

                  {/* Delete — always visible on touch, hover on desktop */}
                  <button
                    onClick={(e) => deleteNotification(e, notif.id)}
                    className="flex-shrink-0 w-7 h-7 flex sm:hidden group-hover:flex items-center justify-center rounded text-sky-700 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        </>
      )}
    </div>
  )
}
