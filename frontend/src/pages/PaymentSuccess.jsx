import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Link2, Mail } from 'lucide-react'

export default function PaymentSuccess() {
  const navigate = useNavigate()

  useEffect(() => {
    // Auto redirect to dashboard after 5 seconds
    const timer = setTimeout(() => {
      navigate('/dashboard')
    }, 5000)

    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark via-surface to-dark p-4">
      <div className="max-w-md w-full bg-surface/80 backdrop-blur-sm border border-green-500/30 rounded-2xl p-6 sm:p-8 text-center shadow-2xl">
        <div className="mb-6">
          <div className="mx-auto w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mb-4">
            <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-sky-900 dark:text-white mb-2">Оплата успешна!</h1>
          <p className="text-sky-700 dark:text-slate-300">Ваша подписка активирована</p>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-left">
            <p className="text-sm text-sky-700 dark:text-slate-300 mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" /> Подписка активирована и готова к использованию</p>
            <p className="text-sm text-sky-700 dark:text-slate-300 mb-2 flex items-center gap-2"><Link2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" /> Данные для подключения доступны в личном кабинете</p>
            <p className="text-sm text-sky-700 dark:text-slate-300 flex items-center gap-2"><Mail className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" /> Детали отправлены на вашу почту</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex-1 px-5 py-3 bg-brand text-sky-900 dark:text-white rounded-lg hover:bg-brand/90 transition-all font-semibold text-sm sm:text-base"
            >
              Перейти в личный кабинет
            </button>
            <button
              onClick={() => navigate('/connect')}
              className="flex-1 px-5 py-3 bg-surface border border-slate-600 text-sky-900 dark:text-white rounded-lg hover:bg-slate-700 transition-all text-sm sm:text-base"
            >
              Подключиться
            </button>
          </div>

          <p className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 mt-4">
            Автоматическое перенаправление через 5 секунд...
          </p>
        </div>
      </div>
    </div>
  )
}
