import React, { useState, useEffect, useCallback } from 'react'
import { Lock, Radio, Globe, Clock, ShieldAlert, KeyRound, Ban, MailCheck, MessageCircle, Monitor, Smartphone, LogOut, Loader2 } from 'lucide-react'
import BotQrModal from '../../components/BotQrModal'

const API = import.meta.env.VITE_API_URL || ''

function parseUserAgent(ua) {
  if (!ua || ua === 'unknown') return { device: 'Неизвестное устройство', icon: 'desktop' }
  const isMobile = /mobile|android|iphone|ipad/i.test(ua)
  let browser = 'Браузер'
  if (/chrome/i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome'
  else if (/firefox/i.test(ua)) browser = 'Firefox'
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari'
  else if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opera|opr/i.test(ua)) browser = 'Opera'

  let os = ''
  if (/windows/i.test(ua)) os = 'Windows'
  else if (/mac/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua)) os = 'Linux'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/iphone|ipad/i.test(ua)) os = 'iOS'

  return { device: `${browser}${os ? ' · ' + os : ''}`, icon: isMobile ? 'mobile' : 'desktop' }
}

export default function SecuritySection({ user }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [tgLinked, setTgLinked] = useState(!!user?.telegram_id)
  const [tgUsername, setTgUsername] = useState(user?.telegram_username || null)
  const [tgMessage, setTgMessage] = useState(null)
  const [tgError, setTgError] = useState(null)
  const [tgBotAvailable, setTgBotAvailable] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)

  // Проверяем доступен ли бот для привязки. Фолбэк на sessionStorage если
  // запрос провалится (429/network) — кнопка не должна пропадать случайно.
  useEffect(() => {
    const cached = sessionStorage.getItem('bot_available')
    if (cached === '1') setTgBotAvailable(true)

    fetch(`${API}/auth/telegram/availability`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setTgBotAvailable(!!d.bot_available)
        sessionStorage.setItem('bot_available', d.bot_available ? '1' : '0')
      })
      .catch(() => { /* keep cached */ })
  }, [])
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionAction, setSessionAction] = useState(null)

  const loadSessions = useCallback(async () => {
    try {
      const { authFetch } = await import('../../services/api')
      const res = await authFetch('/api/sessions')
      const data = await res.json()
      if (res.ok) {
        setSessions(data.sessions || [])
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        console.error('Load sessions error:', err)
      }
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const terminateSession = async (sessionId) => {
    setSessionAction(sessionId)
    try {
      const { authFetch } = await import('../../services/api')
      const res = await authFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      if (res.ok) {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, is_active: false } : s))
      }
    } catch (err) {
      console.error('Terminate session error:', err)
    } finally {
      setSessionAction(null)
    }
  }

  const terminateAllSessions = async () => {
    setSessionAction('all')
    try {
      const { authFetch } = await import('../../services/api')
      const res = await authFetch('/api/sessions', { method: 'DELETE' })
      if (res.ok) {
        setSessions(prev => prev.map(s => s.is_current ? s : { ...s, is_active: false }))
      }
    } catch (err) {
      console.error('Terminate all sessions error:', err)
    } finally {
      setSessionAction(null)
    }
  }

  // Когда бот подтвердил привязку — обновляем UI и закрываем модалку через 1 сек
  const handleLinkConfirmed = useCallback(() => {
    setTgError(null)
    setTgLinked(true)
    setTgMessage('Telegram успешно привязан!')
    setTimeout(() => setShowLinkModal(false), 1500)
    // Юзер может обновить страницу чтобы подтянуть свежий tgUsername из /api/me,
    // но мы поставим заглушку — если бот не передал, останется null.
  }, [])

  const handleChangePassword = async () => {
    setError(null)
    setMessage(null)
    if (!currentPassword || !newPassword) {
      setError('Заполните все поля')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Новые пароли не совпадают')
      return
    }
    if (newPassword.length < 8) {
      setError('Пароль должен быть минимум 8 символов')
      return
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Пароль должен содержать буквы и цифры')
      return
    }

    try {
      const { authFetch } = await import('../../services/api')
      const res = await authFetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      })
      const data = await res.json()
      if (res.ok) {
        setMessage('Пароль успешно изменен')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setError(data.error || 'Ошибка смены пароля')
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        setError('Ошибка сети')
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Смена пароля */}
      <div className="p-4 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
        <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-sky-900 dark:text-white">
          <Lock className="w-5 h-5" /> Смена пароля
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Текущий пароль</label>
            <input 
              type="password" 
              placeholder="Введите текущий пароль"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-300 dark:border-slate-700 rounded-lg text-sky-900 dark:text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Новый пароль</label>
            <input 
              type="password" 
              placeholder="Придумайте новый пароль"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-300 dark:border-slate-700 rounded-lg text-sky-900 dark:text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Повторите пароль</label>
            <input 
              type="password" 
              placeholder="Повторите новый пароль"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-300 dark:border-slate-700 rounded-lg text-sky-900 dark:text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>
          <button 
            onClick={handleChangePassword}
            className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/50 font-bold transition-all duration-300"
          >
            Изменить пароль
          </button>
        </div>
        {message && <div className="mt-4 p-4 bg-green-500/10 border border-green-500/50 text-green-600 dark:text-green-400 rounded-lg text-sm flex items-center gap-2"><span>✓</span> {message}</div>}
        {error && <div className="mt-4 p-4 bg-red-500/10 border border-red-500/50 text-red-600 dark:text-red-400 rounded-lg text-sm flex items-center gap-2"><span>✕</span> {error}</div>}
      </div>

      {/* Привязка Telegram */}
      <div className="p-4 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
        <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-sky-900 dark:text-white">
          <MessageCircle className="w-5 h-5" /> Telegram
        </h3>
        {tgLinked ? (
          <div className="p-4 bg-green-500/10 border border-green-500/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <div className="font-semibold text-sky-900 dark:text-white">Аккаунт привязан</div>
                <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">{tgUsername ? `@${tgUsername}` : 'Telegram подключен'}</div>
              </div>
            </div>
          </div>
        ) : tgBotAvailable ? (
          <div className="space-y-3">
            <p className="text-sm text-sky-700 dark:text-slate-400">Привяжите Telegram для быстрого входа в аккаунт</p>
            <button
              type="button"
              onClick={() => { setTgError(null); setTgMessage(null); setShowLinkModal(true) }}
              className="flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 bg-[#229ED9] hover:bg-[#1d8bc1] text-white rounded-lg font-semibold text-sm shadow-lg transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
              </svg>
              Привязать через Telegram-бот
            </button>
            <p className="text-[11px] text-sky-700/60 dark:text-slate-500">
              Откроется QR-код с deeplink в бота. Бот привяжет твой Telegram к этому аккаунту.
            </p>
          </div>
        ) : (
          <p className="text-sm text-sky-700/70 dark:text-slate-500">
            Telegram-бот сейчас не настроен. Обратись к администратору.
          </p>
        )}
        {tgMessage && <div className="mt-4 p-4 bg-green-500/10 border border-green-500/50 text-green-600 dark:text-green-400 rounded-lg text-sm flex items-center gap-2"><span>✓</span> {tgMessage}</div>}
        {tgError && <div className="mt-4 p-4 bg-red-500/10 border border-red-500/50 text-red-600 dark:text-red-400 rounded-lg text-sm flex items-center gap-2"><span>✕</span> {tgError}</div>}
      </div>

      {/* Активные сессии */}
      <div className="p-4 sm:p-8 bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:to-slate-900/50 border border-sky-200 dark:border-slate-700/50 rounded-2xl">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h3 className="text-xl sm:text-2xl font-bold flex items-center gap-2 text-sky-900 dark:text-white">
            <Radio className="w-5 h-5" /> Активные сессии
          </h3>
          {sessions.filter(s => s.is_active && !s.is_current).length > 0 && (
            <button
              onClick={terminateAllSessions}
              disabled={sessionAction === 'all'}
              className="text-sm text-red-600 dark:text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {sessionAction === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              Завершить все
            </button>
          )}
        </div>

        {sessionsLoading ? (
          <div className="flex items-center justify-center py-8 text-sky-700 dark:text-slate-400 dark:text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Загрузка...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 text-sky-700 dark:text-slate-400">Нет данных о сессиях</div>
        ) : (
          <div className="space-y-3">
            {sessions.map(session => {
              const { device, icon } = parseUserAgent(session.user_agent)
              const isActive = session.is_active
              const isCurrent = session.is_current

              return (
                <div key={session.id} className={`p-3 sm:p-4 rounded-xl border transition-all ${
                  isCurrent
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : isActive
                      ? 'border-green-500/30 bg-green-500/5'
                      : 'border-sky-200 dark:border-slate-700/30 bg-sky-100/50 dark:bg-slate-900/30'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`mt-1 w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        isCurrent ? 'bg-blue-500/20' : isActive ? 'bg-green-500/20' : 'bg-slate-700/50'
                      }`}>
                        {icon === 'mobile' 
                          ? <Smartphone className={`w-5 h-5 ${isCurrent ? 'text-blue-600 dark:text-blue-400' : isActive ? 'text-green-600 dark:text-green-400' : 'text-sky-700 dark:text-slate-400'}`} /> 
                          : <Monitor className={`w-5 h-5 ${isCurrent ? 'text-blue-600 dark:text-blue-400' : isActive ? 'text-green-600 dark:text-green-400' : 'text-sky-700 dark:text-slate-400'}`} />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-sky-900 dark:text-white text-sm sm:text-base flex items-center gap-2 flex-wrap">
                          {device}
                          {isCurrent && <span className="text-xs bg-blue-500/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">Текущая</span>}
                        </div>
                        <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                          <Globe className="w-3.5 h-3.5 shrink-0" /> 
                          <code className="font-mono text-xs sm:text-sm text-sky-700 dark:text-slate-300">{session.ip_address}</code>
                        </div>
                        <div className="text-xs text-sky-700 dark:text-slate-400 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(session.created_at).toLocaleString('ru-RU', { 
                            day: 'numeric', month: 'short', year: 'numeric', 
                            hour: '2-digit', minute: '2-digit' 
                          })}
                          {isActive && session.last_active_at && (
                            <span className="text-sky-700 ml-2">
                              · последняя активность {new Date(session.last_active_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-center">
                      {isActive && !isCurrent && (
                        <button
                          onClick={() => terminateSession(session.id)}
                          disabled={sessionAction === session.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                        >
                          {sessionAction === session.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Завершить'}
                        </button>
                      )}
                      <div className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap ${
                        isCurrent
                          ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                          : isActive
                            ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                            : 'bg-slate-700/50 text-sky-700 dark:text-slate-400 dark:text-slate-400'
                      }`}>
                        {isCurrent ? 'Текущая' : isActive ? 'Активна' : 'Завершена'}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Рекомендации безопасности */}
      <div className="p-4 sm:p-8 bg-gradient-to-br from-yellow-900/20 to-orange-900/20 border border-yellow-500/30 rounded-2xl">
        <h3 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
          <ShieldAlert className="w-5 h-5" /> Советы по безопасности
        </h3>
        <div className="space-y-3">
          <div className="flex gap-3 p-3 bg-sky-50 dark:bg-slate-900/50 rounded-lg">
            <KeyRound className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sky-900 dark:text-white">Используйте сильный пароль</div>
              <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">Пароль длиной минимум 12 символов с буквами, цифрами и спецсимволами</div>
            </div>
          </div>
          <div className="flex gap-3 p-3 bg-sky-50 dark:bg-slate-900/50 rounded-lg">
            <Ban className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sky-900 dark:text-white">Не делитесь паролем</div>
              <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">Никому не сообщайте свой пароль, включая поддержку</div>
            </div>
          </div>
          <div className="flex gap-3 p-3 bg-sky-50 dark:bg-slate-900/50 rounded-lg">
            <MailCheck className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sky-900 dark:text-white">Проверяйте почту</div>
              <div className="text-sm text-sky-700 dark:text-slate-400 dark:text-slate-400">Используйте надежный и уникальный email адрес</div>
            </div>
          </div>
        </div>
      </div>

      <BotQrModal
        open={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        kind="link"
        startUrl="/auth/telegram/link/start"
        pollUrl="/auth/telegram/link/poll"
        payload={{}}
        authHeader={true}
        onSuccess={handleLinkConfirmed}
      />
    </div>
  )
}
