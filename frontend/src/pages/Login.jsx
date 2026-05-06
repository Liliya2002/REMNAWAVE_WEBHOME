import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login, telegramLogin } from '../services/auth'
import TelegramLoginButton from '../components/TelegramLoginButton'

const API = import.meta.env.VITE_API_URL || ''

export default function Login(){
  const [loginField, setLoginField] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [oidcAvailable, setOidcAvailable] = useState(false)
  const navigate = useNavigate()

  // Проверяем доступность OIDC-кнопки (публичный endpoint, без авторизации)
  useEffect(() => {
    fetch(`${API}/auth/telegram/oidc/info`)
      .then(r => r.ok ? r.json() : { available: false })
      .then(d => setOidcAvailable(!!d.available))
      .catch(() => setOidcAvailable(false))
  }, [])

  // CapsLock detect для пароля — показывает warning под полем
  function detectCapsLock(e) {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'))
    }
  }

  async function handleLogin(e){
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await login(loginField, password)
    setLoading(false)
    if (res.ok) navigate('/dashboard')
    else setError(res.error)
  }

  const handleTelegramAuth = useCallback(async (user) => {
    setError(null)
    setLoading(true)
    const res = await telegramLogin(user)
    setLoading(false)
    if (res.ok) navigate('/dashboard')
    else setError(res.error)
  }, [navigate])

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:via-slate-900/50 dark:to-slate-950 border border-sky-200 dark:border-slate-700/50 rounded-2xl p-5 sm:p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">
              Добро пожаловать
            </h1>
            <p className="text-sm sm:text-base text-sky-700 dark:text-slate-400 dark:text-slate-400">Войдите в свой аккаунт</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4 mb-6">
            <div>
              <label htmlFor="login" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">
                Логин или Email
              </label>
              <input
                id="login"
                value={loginField}
                onChange={e => setLoginField(e.target.value.toLowerCase())}
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck="false"
                className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 placeholder-slate-500"
                placeholder="your_login"
                required
              />
              <p className="text-[11px] text-sky-700/60 dark:text-slate-500 mt-1.5">Регистр не важен — Vasya и vasya это одно и то же</p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">
                Пароль
              </label>
              <input
                id="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyUp={detectCapsLock}
                onKeyDown={detectCapsLock}
                onBlur={() => setCapsLockOn(false)}
                type="password"
                autoComplete="current-password"
                className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 placeholder-slate-500"
                placeholder="••••••••"
                required
              />
              {capsLockOn && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 font-semibold flex items-center gap-1">
                  <span aria-hidden>⚠️</span> Включён CapsLock — пароль учитывает регистр
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Вход...
                </span>
              ) : (
                'Войти'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-sky-200 dark:border-slate-700/50"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-sky-100 dark:bg-slate-900 text-sky-700 dark:text-slate-400">или</span>
            </div>
          </div>

          {/* Telegram Login */}
          <div className="mb-6 space-y-3">
            <TelegramLoginButton
              botName={import.meta.env.VITE_TELEGRAM_BOT_NAME}
              onAuth={handleTelegramAuth}
            />

            {oidcAvailable && (
              <a
                href={`${API}/auth/telegram/oidc/start`}
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-semibold text-sm bg-[#229ED9] hover:bg-[#1d8bc1] text-white shadow-lg transition-colors"
                title="Войти через Telegram OAuth 2.0 / OpenID Connect"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
                </svg>
                Войти через Telegram (OIDC)
              </a>
            )}
          </div>

          {/* Register Link */}
          <div className="text-center">
            <p className="text-sky-700 dark:text-slate-400 dark:text-slate-400 text-sm mb-4">
              Нет аккаунта?{' '}
              <Link to="/register" className="text-blue-600 dark:text-blue-400 hover:text-blue-300 font-semibold transition-colors">
                Создайте один
              </Link>
            </p>
            <p className="text-sky-700 dark:text-slate-400 dark:text-slate-400 text-sm">
              <Link to="/forgot-password" className="text-blue-600 dark:text-blue-400 hover:text-blue-300 transition-colors">
                Забыли пароль?
              </Link>
            </p>
          </div>

          {/* Features */}
          <div className="border-t border-sky-200 dark:border-slate-700/50 pt-6 mt-6">
            <p className="text-xs text-sky-700 dark:text-slate-400 uppercase font-semibold mb-3">После входа вы получите доступ к:</p>
            <ul className="space-y-2 text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">
              <li className="flex items-center gap-2">
                <span className="text-cyan-600 dark:text-cyan-400">✓</span> Личному кабинету
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-600 dark:text-cyan-400">✓</span> Истории платежей
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-600 dark:text-cyan-400">✓</span> Управлению подписками
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
