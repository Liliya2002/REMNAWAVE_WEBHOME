import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:via-slate-900/50 dark:to-slate-950 border border-sky-200 dark:border-slate-700/50 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">
              Сброс пароля
            </h1>
            <p className="text-sky-700 dark:text-slate-400 dark:text-slate-400">
              {sent ? 'Проверьте вашу почту' : 'Введите email, привязанный к аккаунту'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {sent ? (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sky-700 dark:text-slate-300 mb-2">
                  Если аккаунт с адресом <span className="text-sky-900 dark:text-white font-medium">{email}</span> существует, мы отправили ссылку для сброса пароля.
                </p>
                <p className="text-sky-700 dark:text-slate-400 text-sm">Ссылка действительна 30 минут</p>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => { setSent(false); setError(null) }}
                  className="px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 text-sky-700 dark:text-slate-300 rounded-lg hover:bg-slate-700/50 transition text-sm"
                >
                  Отправить повторно
                </button>
                <Link
                  to="/login"
                  className="px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all duration-300 text-center"
                >
                  Вернуться к входу
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-sky-700 dark:text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value.toLowerCase())}
                    autoCapitalize="none" autoCorrect="off" autoComplete="email" spellCheck="false"
                    className="w-full pl-11 pr-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 placeholder-slate-500"
                    placeholder="your@email.com"
                    required
                  />
                </div>
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
                    Отправка...
                  </span>
                ) : (
                  'Отправить ссылку'
                )}
              </button>

              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-sky-700 dark:text-slate-400 dark:text-slate-400 hover:text-slate-300 text-sm transition mt-4"
              >
                <ArrowLeft className="w-4 h-4" />
                Вернуться к входу
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
