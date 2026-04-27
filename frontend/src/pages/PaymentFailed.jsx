import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function PaymentFailed() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-dark via-surface to-dark p-4">
      <div className="max-w-md w-full bg-surface/80 backdrop-blur-sm border border-red-500/30 rounded-2xl p-6 sm:p-8 text-center shadow-2xl">
        <div className="mb-6">
          <div className="mx-auto w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
            <svg className="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Оплата не прошла</h1>
          <p className="text-slate-300">Что-то пошло не так</p>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-left">
            <p className="text-sm text-slate-300 mb-2">Возможные причины:</p>
            <ul className="text-sm text-slate-400 space-y-1 list-disc list-inside">
              <li>Недостаточно средств на счете</li>
              <li>Платеж был отменен</li>
              <li>Истекло время на оплату</li>
              <li>Технические проблемы у платежной системы</li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => navigate('/pricing')}
              className="flex-1 px-5 py-3 bg-brand text-white rounded-lg hover:bg-brand/90 transition-all font-semibold text-sm sm:text-base"
            >
              Попробовать снова
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="flex-1 px-5 py-3 bg-surface border border-slate-600 text-white rounded-lg hover:bg-slate-700 transition-all text-sm sm:text-base"
            >
              В личный кабинет
            </button>
          </div>

          <p className="text-sm text-slate-400 mt-4">
            Если проблема повторяется, свяжитесь с поддержкой
          </p>
        </div>
      </div>
    </div>
  )
}
