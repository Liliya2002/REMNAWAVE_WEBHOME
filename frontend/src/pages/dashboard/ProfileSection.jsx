import React, { useState } from 'react'
import { User, Star, Mail, Pencil, CalendarDays, Wallet } from 'lucide-react'
import { authFetch } from '../../services/api'

export default function ProfileSection({ user, onUpdate, onOpenBalance }) {
  const [editMode, setEditMode] = useState(false)
  const [newEmail, setNewEmail] = useState(user?.email || '')
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [balance, setBalance] = useState(0)

  React.useEffect(() => {
    loadBalance()
  }, [])

  const loadBalance = async () => {
    try {
      const res = await authFetch('/api/payments/balance')
      if (!res.ok) return
      const data = await res.json()
      setBalance(Number(data.balance || 0))
    } catch (_) {}
  }

  const handleUpdateEmail = async () => {
    try {
      setMessage(null)
      setError(null)
      const res = await authFetch('/api/profile/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail })
      })
      const data = await res.json()
      if (res.ok) {
        setMessage('Email успешно обновлен')
        setEditMode(false)
        onUpdate()
      } else {
        setError(data.error || 'Ошибка обновления email')
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        setError('Ошибка сети')
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="p-4 sm:p-8 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl">
        {/* Верхний блок: баланс слева + инфо пользователя справа */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 sm:mb-8">
          {/* Левая карточка — баланс */}
          <button
            type="button"
            onClick={() => onOpenBalance && onOpenBalance()}
            className="rounded-2xl border border-cyan-500/25 bg-[radial-gradient(circle_at_10%_10%,rgba(34,211,238,0.1),transparent_35%),rgba(2,6,23,0.8)] p-5 hover:border-cyan-500/50 transition-all cursor-pointer text-left flex flex-col justify-center"
          >
            <div className="text-[10px] uppercase tracking-widest text-cyan-300 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Баланс аккаунта</div>
            <div className="text-3xl font-extrabold text-white mt-2">{balance.toFixed(2)} ₽</div>
            <div className="text-xs text-slate-500 mt-1">Нажмите, чтобы пополнить →</div>
          </button>

          {/* Правая карточка — инфо пользователя */}
          <div className="rounded-2xl border border-blue-500/25 bg-[radial-gradient(circle_at_90%_10%,rgba(59,130,246,0.1),transparent_35%),rgba(2,6,23,0.8)] p-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-bold text-white break-all">{user?.login}</h3>
              <p className="text-slate-400 mt-0.5 text-sm break-all">{user?.email}</p>
              {user?.is_admin && (
                <div className="mt-1.5 inline-flex px-2.5 py-0.5 bg-red-500/20 border border-red-500/50 rounded text-[10px] text-red-400 font-semibold items-center gap-1">
                  <Star className="w-3 h-3" /> АДМИНИСТРАТОР
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-slate-900/50 border border-slate-700/50 rounded-lg">
            <label className="block text-sm text-slate-400 mb-2 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email адрес</label>
            {editMode ? (
              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                <input 
                  type="email" 
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1 min-w-0 px-4 py-2 bg-slate-800/50 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none transition-colors"
                />
                <div className="flex gap-2">
                <button 
                  onClick={handleUpdateEmail}
                  className="flex-1 sm:flex-none px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all font-medium"
                >
                  Сохранить
                </button>
                <button 
                  onClick={() => setEditMode(false)}
                  className="flex-1 sm:flex-none px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-all font-medium"
                >
                  Отмена
                </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between mt-2">
                <span className="text-white font-mono text-sm">{user?.email}</span>
                <button 
                  onClick={() => setEditMode(true)}
                  className="px-3 py-1 text-sm bg-blue-500/20 border border-blue-500/50 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" /> Изменить
                </button>
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-900/50 border border-slate-700/50 rounded-lg">
            <label className="block text-sm text-slate-400 mb-2 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Дата регистрации</label>
            <div className="text-white font-medium">
              {user?.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }) : '—'}
            </div>
          </div>
        </div>

        {message && <div className="mt-4 p-4 bg-green-500/10 border border-green-500/50 rounded-lg text-green-400 text-sm flex items-center gap-2"><span>✓</span> {message}</div>}
        {error && <div className="mt-4 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm flex items-center gap-2"><span>✕</span> {error}</div>}
      </div>
    </div>
  )
}
