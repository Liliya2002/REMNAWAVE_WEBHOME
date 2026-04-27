import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Wrench, ShieldCheck, LogIn } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''
const POLL_INTERVAL_MS = 30000

// Эти пути доступны всем даже в режиме техработ — иначе вышедший админ
// не сможет зайти заново.
const ALWAYS_OPEN_PATHS = [
  '/login',
  '/auth',
  '/forgot-password',
  '/reset-password',
]

/**
 * MaintenanceGate — обёртка над приложением:
 *   - Раз в 30 сек пингует /api/maintenance/status (публичный, не требует токена)
 *   - Если maintenance ON и юзер НЕ админ → показывает фуллскрин-страницу «техработы»
 *   - Если maintenance ON и юзер админ → пропускает + показывает плашку наверху
 *   - Иначе (maintenance OFF) → пропускает без плашки
 *
 * Параллельно проверяет /api/me чтобы знать is_admin (если есть токен).
 */
export default function MaintenanceGate({ children }) {
  const [status, setStatus] = useState(null)   // { maintenance, message }
  const [isAdmin, setIsAdmin] = useState(false)
  const [checked, setChecked] = useState(false)
  const location = useLocation()

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const sRes = await fetch(`${API}/api/maintenance/status`, { cache: 'no-store' })
        const s = sRes.ok ? await sRes.json() : null

        let admin = false
        const token = localStorage.getItem('token')
        if (token) {
          try {
            const meRes = await fetch(`${API}/api/me`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            })
            if (meRes.ok) {
              const me = await meRes.json()
              admin = !!me.user?.is_admin
            }
          } catch { /* token invalid — silently */ }
        }

        if (!cancelled) {
          setStatus(s || { maintenance: false, message: '' })
          setIsAdmin(admin)
          setChecked(true)
        }
      } catch {
        if (!cancelled) {
          setStatus({ maintenance: false, message: '' })
          setChecked(true)
        }
      }
    }

    check()
    const id = setInterval(check, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // До первой проверки рендерим children — чтобы не было пустого экрана при медленной сети
  if (!checked) return children

  // Страницы логина / восстановления пароля доступны всегда — иначе админ
  // не сможет войти после выхода во время техработ.
  const isAuthPage = ALWAYS_OPEN_PATHS.some(p => location.pathname.startsWith(p))

  if (status?.maintenance && !isAdmin && !isAuthPage) {
    return <MaintenancePage message={status.message} />
  }

  return (
    <>
      {status?.maintenance && isAdmin && <MaintenanceBanner />}
      {children}
    </>
  )
}

// ─── Fullscreen для обычных юзеров ───────────────────────────────────────────
function MaintenancePage({ message }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
          <Wrench className="w-10 h-10 text-amber-400" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">Технические работы</h1>
        <p className="text-slate-300 leading-relaxed whitespace-pre-line">{message}</p>
        <p className="text-xs text-slate-500 mt-8">Сайт скоро будет доступен. Спасибо за терпение.</p>

        <Link
          to="/login"
          className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700 hover:bg-slate-800 hover:border-slate-600 text-slate-400 hover:text-slate-200 text-xs transition-all"
        >
          <LogIn className="w-3.5 h-3.5" />
          Вход для администратора
        </Link>
      </div>
    </div>
  )
}

// ─── Banner для админа ───────────────────────────────────────────────────────
function MaintenanceBanner() {
  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-sm text-amber-200">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span className="font-medium">Включён режим техработ.</span>
        <span className="text-amber-300/80">Сайт виден только администраторам.</span>
      </div>
    </div>
  )
}
