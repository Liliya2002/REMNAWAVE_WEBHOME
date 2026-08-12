import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { register, login, sendEmailCode } from '../services/auth'
import { Gift, Mail, ArrowLeft, User, Lock, AtSign, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import {
  AuthBackground, GlassCard, AuthHeader, GlassField, glassInput,
  NeonButton, AuthDivider, FeatureList, AuthError,
} from '../components/auth/AuthUI'
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
  const [showPass, setShowPass] = useState(false)
  const cooldownRef = useRef(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const referralCode = searchParams.get('ref')

  // Проверяем доступность регистрации через бот. Если 429/network — фолбэк
  // на закэшированное значение из sessionStorage, чтобы кнопка не пропадала.
  useEffect(() => {
    const cached = sessionStorage.getItem('bot_available')
    if (cached === '1') setBotAvailable(true)

    fetch(`${API}/auth/telegram/availability`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setBotAvailable(!!d.bot_available)
        sessionStorage.setItem('bot_available', d.bot_available ? '1' : '0')
      })
      .catch(() => { /* keep cached */ })
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
    <AuthBackground>
      <GlassCard className="px-7 py-8 sm:px-9">
        <AuthHeader title="Присоединитесь" subtitle="Создайте аккаунт за 30 секунд" />

        {referralCode && (
          <div className="mb-5 p-3.5 rounded-2xl text-sm flex items-center gap-2.5
                          bg-emerald-500/10 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300
                          shadow-[0_0_20px_rgba(16,185,129,.15)]">
            <Gift className="w-5 h-5 shrink-0" />
            <span>Вы получите бонус за реферальную ссылку!</span>
          </div>
        )}

        <AuthError>{error}</AuthError>
        {success && (
          <div className="mb-5 p-3.5 rounded-2xl text-sm bg-emerald-500/10 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300">
            {success}
          </div>
        )}

        {step === 1 && (
          <>
            <form onSubmit={requireEmail ? handleSendCode : handleDirectRegister} className="space-y-4">
              <GlassField icon={User} hint="3–30 символов, латиница / цифры / _ / -">
                <input id="login" value={loginField}
                  onChange={e => setLoginField(e.target.value.toLowerCase())}
                  type="text" autoCapitalize="none" autoCorrect="off" autoComplete="username" spellCheck="false"
                  className={glassInput()} placeholder="Логин" disabled={loading} required />
              </GlassField>

              <GlassField icon={AtSign}>
                <input id="email" value={email}
                  onChange={e => setEmail(e.target.value.toLowerCase())}
                  type="email" autoCapitalize="none" autoCorrect="off" autoComplete="email" spellCheck="false"
                  className={glassInput()} placeholder="Email" disabled={loading} required />
              </GlassField>

              <GlassField icon={Lock}
                right={
                  <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                    className="text-slate-400 hover:text-cyan-400 transition-colors p-1"
                    aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'}>
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }>
                <input autoComplete="new-password" id="password" value={password}
                  onChange={e => setPassword(e.target.value)} type={showPass ? 'text' : 'password'}
                  className={glassInput(true, true)} placeholder="Пароль" disabled={loading} required />
              </GlassField>

              <GlassField icon={ShieldCheck}
                error={confirmPassword && password !== confirmPassword ? 'Пароли не совпадают' : null}>
                <input autoComplete="new-password" id="confirmPassword" value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)} type={showPass ? 'text' : 'password'}
                  className={glassInput()} placeholder="Подтвердите пароль" disabled={loading} required />
              </GlassField>

              <div className="pt-1">
                <NeonButton type="submit" loading={loading ? (requireEmail ? 'Отправка кода…' : 'Регистрация…') : false}>
                  {requireEmail
                    ? <span className="flex items-center justify-center gap-2"><Mail className="w-4 h-4" /> Получить код на email</span>
                    : 'Создать аккаунт'}
                </NeonButton>
              </div>
            </form>

            {botAvailable && (
              <>
                <AuthDivider label="или быстрая регистрация" />
                <button type="button" onClick={handleOpenBotModal}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-semibold text-sm
                             bg-[#229ED9]/90 hover:bg-[#229ED9] text-white transition-all
                             shadow-[0_0_18px_rgba(34,158,217,.35)] hover:shadow-[0_0_28px_rgba(34,158,217,.55)]">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
                  </svg>
                  Зарегистрироваться через Telegram-бот
                </button>
                <p className="text-[11px] text-slate-500 mt-2 text-center leading-relaxed">
                  Заполните форму выше и нажмите — откроется QR со ссылкой в бота.
                </p>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <div>
            <div className="mb-5 p-3.5 rounded-2xl text-sm flex items-center gap-2.5
                            bg-sky-500/10 border border-sky-500/40 text-sky-700 dark:text-sky-300">
              <Mail className="w-5 h-5 shrink-0" />
              <span>Код отправлен на <strong>{email}</strong></span>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <GlassField label="Код подтверждения">
                <input id="emailCode" value={emailCode}
                  onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus
                  className="glass-input w-full px-4 py-4 rounded-2xl text-center text-2xl tracking-[0.5em] font-mono text-slate-900 dark:text-slate-100"
                  placeholder="000000" disabled={loading} required maxLength={6} />
              </GlassField>

              <NeonButton type="submit" loading={loading ? 'Регистрация…' : false}
                disabled={emailCode.length !== 6}>
                Подтвердить и создать аккаунт
              </NeonButton>

              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={() => { setStep(1); setEmailCode(''); setError(null) }}
                  className="text-sm text-slate-500 dark:text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1">
                  <ArrowLeft className="w-4 h-4" /> Назад
                </button>
                <button type="button" onClick={handleResendCode} disabled={cooldown > 0 || loading}
                  className="text-sm text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 transition-colors disabled:text-slate-600 disabled:cursor-not-allowed">
                  {cooldown > 0 ? `Повторно (${cooldown}с)` : 'Отправить код повторно'}
                </button>
              </div>
            </form>
          </div>
        )}

        <AuthDivider label="уже есть аккаунт?" />
        <div className="text-center">
          <Link to="/login" className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 font-semibold text-sm transition-colors">
            Войти в аккаунт
          </Link>
        </div>

        <p className="text-[11px] text-slate-500 text-center mt-6 leading-relaxed">
          Регистрируясь, вы соглашаетесь с{' '}
          <a href="#" className="text-cyan-600/80 dark:text-cyan-400/80 hover:text-cyan-300">политикой конфиденциальности</a> и{' '}
          <a href="#" className="text-cyan-600/80 dark:text-cyan-400/80 hover:text-cyan-300">условиями использования</a>
        </p>
      </GlassCard>

      <FeatureList
        title="Что вы получите"
        items={['Доступ к личному кабинету', 'Пробный период без оплаты', 'Управление подписками и устройствами']}
      />

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
    </AuthBackground>
  )
}
