import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Wrench, ShieldCheck, LogIn, Mail, Send, Lock } from 'lucide-react'
import { useSiteConfig } from '../contexts/SiteConfigContext'

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
 *   - «Админский режим» (adminOnly) имеет приоритет над техработами:
 *       adminOnly ON + не админ → фуллскрин «Доступ ограничен»
 *       adminOnly ON + админ    → баннер «Админский режим»
 *   - Иначе — обычная логика техработ:
 *       maintenance ON + не админ → фуллскрин «Техработы»
 *       maintenance ON + админ    → баннер
 *   - Всё OFF → пропускает без плашки
 *
 * Параллельно проверяет /api/me чтобы знать is_admin (если есть токен).
 */
export default function MaintenanceGate({ children }) {
  const [status, setStatus] = useState(null)   // { maintenance, message, adminOnly }
  const [isAdmin, setIsAdmin] = useState(false)
  const [checked, setChecked] = useState(false)
  const location = useLocation()
  // Наличие токена — часть зависимостей эффекта: сразу после логина статус
  // нужно перепроверить, иначе гейт продолжает считать юзера гостем.
  const hasToken = !!localStorage.getItem('token')

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
          setStatus(s || { maintenance: false, message: '', adminOnly: false })
          setIsAdmin(admin)
          setChecked(true)
        }
      } catch {
        if (!cancelled) {
          setStatus({ maintenance: false, message: '', adminOnly: false })
          setChecked(true)
        }
      }
    }

    check()
    const id = setInterval(check, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // Перепроверяем при навигации и при появлении/пропаже токена: раньше
    // зависимости были пустыми, поэтому после входа гейт до 30 сек (или до F5)
    // держал старое is_admin=false и в админ-режиме показывал «Доступ ограничен»
    // уже авторизованному админу.
  }, [location.pathname, hasToken])

  // Страницы логина / восстановления пароля доступны всегда — иначе админ
  // не сможет войти после выхода во время техработ.
  const isAuthPage = ALWAYS_OPEN_PATHS.some(p => location.pathname.startsWith(p))

  // Блокирующие экраны показываем только после первой проверки статуса,
  // иначе на медленной сети мелькает пустой экран. Админский режим
  // приоритетнее техработ.
  if (checked && !isAdmin && !isAuthPage) {
    if (status?.adminOnly) return <AdminOnlyPage />
    if (status?.maintenance) return <MaintenancePage message={status.message} />
  }

  // ВАЖНО: структура ниже постоянна — всегда фрагмент с двумя слотами баннеров
  // (пустыми, пока баннер не нужен) и children последним. Если менять число или
  // позицию детей (например возвращать то `children`, то `<>…{children}</>`),
  // React считает это другим деревом и ПЕРЕМОНТИРУЕТ всё поддерево. Из-за этого
  // одноразовые эффекты выполнялись дважды — /tg-login повторно обменивал уже
  // использованный токен и показывал ошибку поверх успешного входа.
  return (
    <>
      {checked && status?.adminOnly && isAdmin ? <AdminOnlyBanner /> : null}
      {checked && status?.maintenance && isAdmin && !status?.adminOnly ? <MaintenanceBanner /> : null}
      {children}
    </>
  )
}

// ─── Fullscreen «Доступ ограничен» (админский режим) ─────────────────────────
function AdminOnlyPage() {
  const { config } = useSiteConfig()
  const supportEmail = config?.support_email || ''
  const supportTelegram = config?.support_telegram || ''
  const hasSupport = !!(supportEmail || supportTelegram)

  return (
    <div className="min-h-screen bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-slate-500/15 border border-slate-500/40 flex items-center justify-center">
          <Lock className="w-10 h-10 text-slate-500 dark:text-slate-300" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-sky-900 dark:text-white mb-3">Доступ ограничен</h1>
        <p className="text-sky-700 dark:text-slate-300 leading-relaxed">
          Сайт временно доступен только администраторам.
        </p>

        {hasSupport && (
          <div className="mt-8 pt-6 border-t border-sky-200 dark:border-slate-800">
            <p className="text-xs text-sky-700 dark:text-slate-400 mb-3">Возникли вопросы? Напишите в поддержку:</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              {supportEmail && (
                <a
                  href={`mailto:${supportEmail}`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-sky-100 hover:bg-sky-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-sky-300 dark:border-slate-700 text-sky-900 dark:text-slate-200 text-sm transition-all"
                >
                  <Mail className="w-4 h-4" />
                  <span className="break-all">{supportEmail}</span>
                </a>
              )}
              {supportTelegram && (
                <a
                  href={supportTelegram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-sm transition-all"
                >
                  <Send className="w-4 h-4" />
                  Telegram
                </a>
              )}
            </div>
          </div>
        )}

        <Link
          to="/login"
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/60 border border-sky-300 dark:border-slate-700 hover:bg-slate-800 hover:border-slate-600 text-sky-700 dark:text-slate-400 hover:text-slate-200 text-xs transition-all"
        >
          <LogIn className="w-3.5 h-3.5" />
          Вход для администратора
        </Link>
      </div>
    </div>
  )
}

// ─── Banner для админа в админском режиме ─────────────────────────────────────
function AdminOnlyBanner() {
  return (
    <div className="bg-slate-500/10 border-b border-slate-500/30 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-sm text-slate-300">
        <Lock className="w-4 h-4 shrink-0" />
        <span className="font-medium">Включён админский режим.</span>
        <span className="text-slate-400">Проект закрыт: вход и регистрация доступны только администраторам.</span>
      </div>
    </div>
  )
}

// ─── Fullscreen для обычных юзеров ───────────────────────────────────────────
function MaintenancePage({ message }) {
  const { config } = useSiteConfig()
  const supportEmail = config?.support_email || ''
  const supportTelegram = config?.support_telegram || ''
  const hasSupport = !!(supportEmail || supportTelegram)

  return (
    <div className="min-h-screen bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
          <Wrench className="w-10 h-10 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-sky-900 dark:text-white mb-3">Технические работы</h1>
        <p className="text-sky-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">{message}</p>
        <p className="text-xs text-sky-700 dark:text-slate-400 mt-8">Сайт скоро будет доступен. Спасибо за терпение.</p>

        {hasSupport && (
          <div className="mt-8 pt-6 border-t border-sky-200 dark:border-slate-800">
            <p className="text-xs text-sky-700 dark:text-slate-400 mb-3">Возникли вопросы? Напишите в поддержку:</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              {supportEmail && (
                <a
                  href={`mailto:${supportEmail}`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-sky-100 hover:bg-sky-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-sky-300 dark:border-slate-700 text-sky-900 dark:text-slate-200 text-sm transition-all"
                >
                  <Mail className="w-4 h-4" />
                  <span className="break-all">{supportEmail}</span>
                </a>
              )}
              {supportTelegram && (
                <a
                  href={supportTelegram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-sm transition-all"
                >
                  <Send className="w-4 h-4" />
                  Telegram
                </a>
              )}
            </div>
          </div>
        )}

        <Link
          to="/login"
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/60 border border-sky-300 dark:border-slate-700 hover:bg-slate-800 hover:border-slate-600 text-sky-700 dark:text-slate-400 dark:text-slate-400 hover:text-slate-200 text-xs transition-all"
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
        <span className="text-amber-700 dark:text-amber-300/80">Сайт виден только администраторам.</span>
      </div>
    </div>
  )
}
