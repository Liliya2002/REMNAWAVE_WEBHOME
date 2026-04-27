import React, { useState, useEffect } from 'react'
import { useNotification } from '../contexts/NotificationContext'

const API_URL = import.meta.env.VITE_API_URL || ''

export default function AdminNotifications() {
  const { success, error: showError } = useNotification()
  const token = localStorage.getItem('token')

  // Форма рассылки
  const [form, setForm] = useState({
    title: '',
    message: '',
    type: 'info',
    target: 'all',
    link: ''
  })
  const [sending, setSending] = useState(false)

  // История рассылок
  const [broadcasts, setBroadcasts] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  useEffect(() => {
    fetchBroadcasts()
  }, [])

  async function fetchBroadcasts() {
    try {
      const res = await fetch(`${API_URL}/api/notifications/broadcasts`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setBroadcasts(data)
      }
    } catch (err) {
      console.error('Failed to load broadcasts:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.message.trim()) {
      showError('Ошибка', 'Заголовок и сообщение обязательны')
      return
    }

    setSending(true)
    try {
      const body = { ...form }
      if (!body.link) delete body.link

      const res = await fetch(`${API_URL}/api/notifications/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      })

      const data = await res.json()
      if (res.ok) {
        success('Рассылка отправлена', `Уведомление доставлено ${data.recipients} пользователям`)
        setForm({ title: '', message: '', type: 'info', target: 'all', link: '' })
        fetchBroadcasts()
      } else {
        showError('Ошибка', data.error || 'Не удалось отправить')
      }
    } catch (err) {
      showError('Ошибка', 'Сетевая ошибка')
    } finally {
      setSending(false)
    }
  }

  const typeOptions = [
    { value: 'info', label: 'ℹ️ Информация', color: 'bg-blue-500/20 text-blue-300' },
    { value: 'success', label: '✅ Успех', color: 'bg-emerald-500/20 text-emerald-300' },
    { value: 'warning', label: '⚠️ Внимание', color: 'bg-amber-500/20 text-amber-300' },
    { value: 'promo', label: '🎉 Промо', color: 'bg-purple-500/20 text-purple-300' }
  ]

  const targetOptions = [
    { value: 'all', label: 'Все пользователи', desc: 'Отправить всем' },
    { value: 'active', label: 'Активные', desc: 'С активным аккаунтом' },
    { value: 'expiring', label: 'Истекающие', desc: 'Подписка через ≤7 дней' },
    { value: 'new', label: 'Новые', desc: 'Зарегистрированы ≤30 дн' }
  ]

  return (
    <div className="space-y-8">
      {/* Форма рассылки */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-bold text-slate-100 mb-4 sm:mb-6 flex items-center gap-2">
          <span className="text-2xl">📢</span> Рассылка уведомлений
        </h2>

        <form onSubmit={handleSend} className="space-y-5">
          {/* Тип */}
          <div>
            <label className="text-sm font-medium text-slate-400 mb-2 block">Тип уведомления</label>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: opt.value }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                    form.type === opt.value
                      ? `${opt.color} border-current`
                      : 'bg-slate-800/50 text-slate-500 border-slate-700/50 hover:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Аудитория */}
          <div>
            <label className="text-sm font-medium text-slate-400 mb-2 block">Аудитория</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {targetOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, target: opt.value }))}
                  className={`p-3 rounded-lg text-left border transition-all ${
                    form.target === opt.value
                      ? 'bg-blue-500/10 border-blue-500/40 text-blue-300'
                      : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs opacity-60 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Заголовок */}
          <div>
            <label className="text-sm font-medium text-slate-400 mb-2 block">Заголовок</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Например: Важное обновление"
              className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
              maxLength={200}
            />
          </div>

          {/* Сообщение */}
          <div>
            <label className="text-sm font-medium text-slate-400 mb-2 block">Сообщение</label>
            <textarea
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              placeholder="Текст уведомления..."
              rows={3}
              className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
            />
          </div>

          {/* Ссылка (опционально) */}
          <div>
            <label className="text-sm font-medium text-slate-400 mb-2 block">Ссылка (опционально)</label>
            <input
              type="text"
              value={form.link}
              onChange={e => setForm(f => ({ ...f, link: e.target.value }))}
              placeholder="/pricing или /dashboard"
              className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Превью */}
          {form.title && (
            <div className="p-4 bg-slate-900/50 border border-slate-700/30 rounded-lg">
              <p className="text-xs text-slate-500 mb-2">Превью:</p>
              <div className="flex items-start gap-3">
                <span className="text-lg">{typeOptions.find(o => o.value === form.type)?.label.split(' ')[0]}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{form.title}</p>
                  {form.message && <p className="text-xs text-slate-400 mt-0.5">{form.message}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Кнопка */}
          <button
            type="submit"
            disabled={sending || !form.title.trim() || !form.message.trim()}
            className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg hover:shadow-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Отправка...
              </span>
            ) : (
              '📤 Отправить рассылку'
            )}
          </button>
        </form>
      </div>

      {/* История рассылок */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
          <span className="text-2xl">📋</span> История рассылок
        </h2>

        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
          </div>
        ) : broadcasts.length === 0 ? (
          <p className="text-center text-slate-500 py-8">Рассылок ещё не было</p>
        ) : (
          <div className="space-y-3">
            {broadcasts.map(b => (
              <div key={b.id} className="p-4 bg-slate-900/50 border border-slate-700/30 rounded-lg">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    b.type === 'success' ? 'bg-emerald-500/20 text-emerald-300' :
                    b.type === 'warning' ? 'bg-amber-500/20 text-amber-300' :
                    b.type === 'promo' ? 'bg-purple-500/20 text-purple-300' :
                    'bg-blue-500/20 text-blue-300'
                  }`}>
                    {b.type}
                  </span>
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700/50 text-slate-400">
                    {b.target}
                  </span>
                  <span className="text-xs text-slate-500">
                    → {b.recipients_count} чел.
                  </span>
                  <span className="text-xs text-slate-600 ml-auto">
                    {new Date(b.created_at).toLocaleString('ru-RU')}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-200">{b.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{b.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
