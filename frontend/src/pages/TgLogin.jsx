import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

/**
 * Авто-логин по одноразовому токену из Telegram-бота.
 * URL: /tg-login?t=<token>&redirect=/pricing?plan=5
 *
 * 1. Шлёт GET /auth/tg-login?t=<token>
 * 2. Backend резолвит токен, выдаёт JWT
 * 3. Кладём в localStorage и редиректим в redirect (или /dashboard по умолчанию)
 */
export default function TgLogin() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [status, setStatus] = useState('loading') // loading | error | success
  const [error, setError] = useState(null)
  // Guard от двойного fetch — токен одноразовый и в БД помечается used_at
  // атомарно, поэтому второй запрос гарантированно вернёт 410.
  // Дублирование может произойти из-за StrictMode (dev), back/forward cache
  // или browser-prefetch. useRef переживает re-renders и StrictMode'овский
  // mount→unmount→mount.
  const startedRef = useRef(false)

  useEffect(() => {
    const t = params.get('t')
    const redirect = params.get('redirect') || '/dashboard'

    if (!t) {
      setStatus('error'); setError('Токен не передан в URL')
      return
    }

    if (startedRef.current) return
    startedRef.current = true

    let cancelled = false
    fetch(`${API}/auth/tg-login?t=${encodeURIComponent(t)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (cancelled) return
        if (!data.token) throw new Error('Сервер не вернул JWT')

        localStorage.setItem('token', data.token)
        setStatus('success')
        // small delay чтобы юзер увидел "успех"
        setTimeout(() => {
          if (!cancelled) {
            // redirect может быть как абсолютным path так и URL с query
            navigate(redirect, { replace: true })
          }
        }, 400)
      })
      .catch(err => {
        if (cancelled) return
        setStatus('error')
        setError(err.message)
      })

    return () => { cancelled = true }
  }, [params, navigate])

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-950 border border-sky-200 dark:border-slate-700/50 rounded-2xl p-8 text-center shadow-2xl">
        {status === 'loading' && (
          <>
            <RefreshCw className="w-12 h-12 mx-auto text-blue-500 animate-spin mb-4" />
            <h2 className="text-xl font-bold text-sky-900 dark:text-white mb-2">Вход через Telegram</h2>
            <p className="text-sky-700 dark:text-slate-400 text-sm">Проверяем токен...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
            <h2 className="text-xl font-bold text-sky-900 dark:text-white mb-2">Готово!</h2>
            <p className="text-sky-700 dark:text-slate-400 text-sm">Перенаправляем в личный кабинет...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-12 h-12 mx-auto text-red-500 mb-4" />
            <h2 className="text-xl font-bold text-sky-900 dark:text-white mb-2">Не удалось войти</h2>
            <p className="text-sky-700 dark:text-slate-400 text-sm mb-1">{error}</p>
            <p className="text-xs text-slate-500 mb-6">
              Ссылка одноразовая и живёт 5 минут. Запроси новую — нажми в боте «🌐 Веб-Панель».
            </p>
            <div className="flex flex-col gap-2">
              <Link to="/login" className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-bold text-sm">
                Войти по логину
              </Link>
              <Link to="/" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                На главную
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
