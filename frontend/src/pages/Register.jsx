import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { register, login, sendEmailCode } from '../services/auth'
import { Gift, Mail, ArrowLeft } from 'lucide-react'
import BotQrModal from '../components/BotQrModal'
import { useSiteConfig } from '../contexts/SiteConfigContext'

const API = import.meta.env.VITE_API_URL || ''

export default function Register(){
  const { config } = useSiteConfig() || {}
  const requireEmail = config?.require_email_confirmation ?? false
  const [step, setStep] = useState(1) // 1 = форма, 2 = ввод кода
  const [loginField, setLoginField] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [botAvailable, setBotAvailable] = useState(false)
  const [showBotModal, setShowBotModal] = useState(false)
  const cooldownRef = useRef(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const referralCode = searchParams.get('ref')

  // Проверяем доступность регистрации через бот
  useEffect(() => {
    fetch(`${API}/auth/telegram/availability`)
      .then(r => r.ok ? r.json() : { bot_available: false })
      .then(d => setBotAvailable(!!d.bot_available))
      .catch(() => setBotAvailable(false))
  }, [])

  // Таймер обратного отсчёта для повторной отправки
  useEffect(() => {
    if (cooldown > 0) {
      cooldownRef.current = setTimeout(() => setCooldown(c => c - 1), 1000)
      return () => clearTimeout(cooldownRef.current)
    }
  }, [cooldown])

  function validateFields() {
    if (!loginField || loginField.length < 3) return 'Логин должен быть минимум 3 символа'
    if (!/^[a-z0-9_-]+$/.test(loginField)) return 'Логин: только латиница / цифры / _ / -'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Некорректный формат email'
    if (password !== confirmPassword) return 'Пароли не совпадают'
    if (password.length < 8) return 'Пароль должен быть минимум 8 символов'
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Пароль должен содержать буквы и цифры'
    return null
  }

  // Шаг 1: валидация + отправка кода на email (если требуется)
  async function handleSendCode(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const validationError = validateFields()
    if (validationError) { setError(validationError); setLoading(false); return }

    try {
      const res = await sendEmailCode(email)
      if (res.ok) { setStep(2); setCooldown(60); setError(null) }
      else setError(res.error)
    } catch { setError('Ошибка отправки кода') }
    finally { setLoading(false) }
  }

  async function handleDirectRegister(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const validationError = validateFields()
    if (validationError) { setError(validationError); setLoading(false); return }

    try {
      const res = await register(loginField, email, password, null, referralCode)
      if (res.ok) {
        if (referralCode) setSuccess('Регистрация успешна! Вы получили бонусный подарок за реферальную ссылку.')
        const l = await login(loginField, password)
        if (l.ok) setTimeout(() => navigate('/dashboard'), 1500)
        else setError('Регистрация успешна, но вход не выполнен')
      } else setError(res.error)
    } catch { setError('Ошибка регистрации') }
    finally { setLoading(false) }
  }

  async function handleResendCode() {
    if (cooldown > 0) return
    setError(null); setLoading(true)
    try {
      const res = await sendEmailCode(email)
      if (res.ok) {
        setCooldown(60); setSuccess('Код отправлен повторно')
        setTimeout(() => setSuccess(null), 3000)
      } else setError(res.error)
    } catch { setError('Ошибка отправки кода') }
    finally { setLoading(false) }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError(null); setLoading(true)
    if (emailCode.length !== 6) { setError('Введите 6-значный код'); setLoading(false); return }

    try {
      const res = await register(loginField, email, password, emailCode, referralCode)
      if (res.ok) {
        if (referralCode) setSuccess('Регистрация успешна! Вы получили бонусный подарок за реферальную ссылку.')
        const l = await login(loginField, password)
        if (l.ok) setTimeout(() => navigate('/dashboard'), 1500)
        else setError('Регистрация успешна, но вход не выполнен')
      } else setError(res.error)
    } catch { setError('Ошибка регистрации') }
    finally { setLoading(false) }
  }

  // Кнопка «Регистрация через Telegram-бот» — открывает QR-модалку
  function handleOpenBotModal() {
    setError(null)
    const v = validateFields()
    if (v) { setError(v); return }
    setShowBotModal(true)
  }

  // Колбек когда бот подтвердил регистрацию
  function handleBotSuccess(data) {
    if (data?.autoLoginToken) {
      navigate(`/tg-login?t=${encodeURIComponent(data.autoLoginToken)}`, { replace: true })
    }
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-sky-50 dark:bg-slate-900 dark:bg-gradient-to-br dark:from-slate-800/40 dark:via-slate-900/50 dark:to-slate-950 border border-sky-200 dark:border-slate-700/50 rounded-2xl p-5 sm:p-8 shadow-2xl">
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">
              Присоединитесь
            </h1>
            <p className="text-sm sm:text-base text-sky-700 dark:text-slate-400">Создайте аккаунт за 30 секунд</p>
          </div>

          {referralCode && (
            <div className="mb-6 p-4 bg-green-500/10 border border-green-500/50 rounded-lg text-green-600 dark:text-green-400 text-sm flex items-center gap-2">
              <Gift className="w-5 h-5 shrink-0" />
              <span>Вы получите бонус за реферальную ссылку!</span>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-600 dark:text-red-400 text-sm">{error}</div>
          )}
          {success && (
            <div className="mb-6 p-4 bg-green-500/10 border border-green-500/50 rounded-lg text-green-600 dark:text-green-400 text-sm">{success}</div>
          )}

          {/* Шаг 1: форма */}
          {step === 1 && (
            <>
              <form onSubmit={requireEmail ? handleSendCode : handleDirectRegister} className="space-y-4 mb-4">
                <div>
                  <label htmlFor="login" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Логин</label>
                  <input id="login" value={loginField}
                    onChange={e => setLoginField(e.target.value.toLowerCase())}
                    type="text" autoCapitalize="none" autoCorrect="off" autoComplete="username" spellCheck="false"
                    className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 placeholder-slate-500"
                    placeholder="your_login" disabled={loading} required />
                  <p className="text-[11px] text-sky-700/60 dark:text-slate-500 mt-1.5">3-30 символов, латиница / цифры / _ / - . Регистр не учитывается.</p>
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Email</label>
                  <input id="email" value={email}
                    onChange={e => setEmail(e.target.value.toLowerCase())}
                    type="email" autoCapitalize="none" autoCorrect="off" autoComplete="email" spellCheck="false"
                    className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 placeholder-slate-500"
                    placeholder="your@email.com" disabled={loading} required />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Пароль</label>
                  <input id="password" value={password} onChange={e => setPassword(e.target.value)} type="password"
                    className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 placeholder-slate-500"
                    placeholder="••••••••" disabled={loading} required />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Подтвердите пароль</label>
                  <input id="confirmPassword" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password"
                    className="w-full px-4 py-3 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 placeholder-slate-500"
                    placeholder="••••••••" disabled={loading} required />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      {requireEmail ? 'Отправка кода...' : 'Регистрация...'}
                    </span>
                  ) : requireEmail ? (
                    <span className="flex items-center justify-center gap-2"><Mail className="w-5 h-5" /> Получить код на email</span>
                  ) : 'Создать аккаунт'}
                </button>
              </form>

              {/* Альтернативный путь — Telegram-бот */}
              {botAvailable && (
                <>
                  <div className="relative mb-4">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sky-200 dark:border-slate-700/50"></div></div>
                    <div className="relative flex justify-center text-sm"><span className="px-2 bg-sky-100 dark:bg-slate-900 text-sky-700 dark:text-slate-400">или быстрая регистрация</span></div>
                  </div>
                  <div className="mb-6">
                    <button type="button" onClick={handleOpenBotModal}
                      className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#229ED9] hover:bg-[#1d8bc1] text-white rounded-lg font-semibold text-sm shadow-lg transition-colors">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
                      </svg>
                      Зарегистрироваться через Telegram-бот
                    </button>
                    <p className="text-[11px] text-sky-700/60 dark:text-slate-500 mt-2 text-center">
                      Заполни форму выше и нажми эту кнопку — откроется QR с deeplink в бота. Бот привяжет твой Telegram к новому аккаунту.
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {/* Шаг 2: ввод кода */}
          {step === 2 && (
            <div className="mb-6">
              <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-700 dark:text-blue-300 text-sm flex items-center gap-2">
                <Mail className="w-5 h-5 shrink-0" />
                <span>Код отправлен на <strong>{email}</strong></span>
              </div>

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label htmlFor="emailCode" className="block text-sm font-medium text-sky-700 dark:text-slate-300 mb-2">Код подтверждения</label>
                  <input id="emailCode" value={emailCode}
                    onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus
                    className="w-full px-4 py-4 bg-sky-100 dark:bg-slate-800/50 border border-sky-200 dark:border-slate-700/50 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors text-sky-900 dark:text-slate-100 text-center text-2xl tracking-[0.5em] font-mono placeholder-slate-500"
                    placeholder="000000" disabled={loading} required maxLength={6} />
                </div>

                <button type="submit" disabled={loading || emailCode.length !== 6}
                  className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Регистрация...
                    </span>
                  ) : 'Подтвердить и создать аккаунт'}
                </button>

                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => { setStep(1); setEmailCode(''); setError(null) }}
                    className="text-sm text-sky-700 dark:text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1">
                    <ArrowLeft className="w-4 h-4" /> Назад
                  </button>
                  <button type="button" onClick={handleResendCode} disabled={cooldown > 0 || loading}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-300 transition-colors disabled:text-slate-600 disabled:cursor-not-allowed">
                    {cooldown > 0 ? `Отправить повторно (${cooldown}с)` : 'Отправить код повторно'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sky-200 dark:border-slate-700/50"></div></div>
            <div className="relative flex justify-center text-sm"><span className="px-2 bg-sky-100 dark:bg-slate-900 text-sky-700 dark:text-slate-400">уже есть аккаунт?</span></div>
          </div>

          <div className="text-center">
            <p className="text-sky-700 dark:text-slate-400 text-sm">
              <Link to="/login" className="text-blue-600 dark:text-blue-400 hover:text-blue-300 font-semibold transition-colors">Войти в аккаунт</Link>
            </p>
          </div>

          <div className="border-t border-sky-200 dark:border-slate-700/50 pt-6 mt-6">
            <p className="text-xs text-sky-700 dark:text-slate-400 text-center">
              Регистрируясь, вы соглашаетесь с нашей{' '}
              <a href="#" className="text-blue-600 dark:text-blue-400 hover:text-blue-300">политикой конфиденциальности</a> и{' '}
              <a href="#" className="text-blue-600 dark:text-blue-400 hover:text-blue-300">условиями использования</a>
            </p>
          </div>
        </div>
      </div>

      {/* QR-модалка для регистрации через бот */}
      <BotQrModal
        open={showBotModal}
        onClose={() => setShowBotModal(false)}
        kind="register"
        startUrl="/auth/register/start"
        pollUrl="/auth/register/poll"
        payload={{ login: loginField, email, password, referralCode: referralCode || undefined }}
        authHeader={false}
        onSuccess={handleBotSuccess}
      />
    </div>
  )
}
