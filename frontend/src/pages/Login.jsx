import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { User, Lock, Eye, EyeOff } from 'lucide-react'
import { login } from '../services/auth'
import {
  AuthBackground, GlassCard, AuthHeader, GlassField, glassInput,
  NeonButton, AuthDivider, FeatureList, AuthError,
} from '../components/auth/AuthUI'

const API = import.meta.env.VITE_API_URL || ''

export default function Login(){
  const [loginField, setLoginField] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [showPass, setShowPass] = useState(false)
  // Фаза перехода: 'launching' — коллапс ядра после успешного входа,
  // 'materialize' — появление формы после выхода из аккаунта.
  const [phase, setPhase] = useState(
    () => sessionStorage.getItem('auth_materialize') ? 'materialize' : null
  )
  useEffect(() => {
    if (phase === 'materialize') sessionStorage.removeItem('auth_materialize')
  }, [phase])
  const [oidcAvailable, setOidcAvailable] = useState(false)
  const navigate = useNavigate()

  // Проверяем доступность OIDC-кнопки (публичный endpoint, без авторизации).
  // Если запрос упал (429/network) — переиспользуем последний успешный ответ
  // из sessionStorage чтобы кнопка не пропадала случайно.
  useEffect(() => {
    const cached = sessionStorage.getItem('oidc_available')
    if (cached === '1') setOidcAvailable(true)

    fetch(`${API}/auth/telegram/oidc/info`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setOidcAvailable(!!d.available)
        sessionStorage.setItem('oidc_available', d.available ? '1' : '0')
      })
      .catch(() => { /* keep cached */ })
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
    if (!res.ok) { setLoading(false); setError(res.error); return }

    // Токен уже получен — анимация играет поверх, ничего не блокируя.
    // 1640 мс: чуть меньше длительности коллапса (1.8 с), чтобы переход
    // случился на пике вспышки, а не после того как панель исчезла.
    setPhase('launching')
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setTimeout(() => navigate('/dashboard'), reduced ? 0 : 1640)
  }

  return (
    <AuthBackground phase={phase}>
      <GlassCard className="px-7 py-8 sm:px-9">
        <AuthHeader title="Добро пожаловать" subtitle="Войдите в свой аккаунт" />

        <AuthError>{error}</AuthError>

        <form onSubmit={handleLogin} className="space-y-4">
          <GlassField icon={User} hint="Регистр не важен — Vasya и vasya это одно и то же">
            <input
              id="login"
              value={loginField}
              onChange={e => setLoginField(e.target.value.toLowerCase())}
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              spellCheck="false"
              disabled={phase === 'launching'}
              className={glassInput()}
              placeholder="Логин или Email"
              required
            />
          </GlassField>

          <GlassField icon={Lock}
            error={capsLockOn ? 'Включён CapsLock — пароль учитывает регистр' : null}
            right={
              <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                className="text-slate-400 hover:text-cyan-400 transition-colors p-1"
                aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'}>
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }>
            <input
              id="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyUp={detectCapsLock}
              onKeyDown={detectCapsLock}
              onBlur={() => setCapsLockOn(false)}
              type={showPass ? 'text' : 'password'}
              autoComplete="current-password"
              disabled={phase === 'launching'}
              className={glassInput(true, true)}
              placeholder="Пароль"
              required
            />
          </GlassField>

          <div className="pt-1">
            <NeonButton type="submit"
              loading={phase === 'launching' ? 'Авторизация…' : (loading ? 'Вход…' : false)}>
              Войти
            </NeonButton>
          </div>
        </form>

        {oidcAvailable && (
          <>
            <AuthDivider />
            <a
              href={`${API}/auth/telegram/oidc/start`}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-semibold text-sm
                         bg-[#229ED9]/90 hover:bg-[#229ED9] text-white transition-all
                         shadow-[0_0_18px_rgba(34,158,217,.35)] hover:shadow-[0_0_28px_rgba(34,158,217,.55)]"
              title="Войти через Telegram OAuth 2.0 / OpenID Connect"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/>
              </svg>
              Войти через Telegram
            </a>
          </>
        )}

        <div className="text-center mt-5 space-y-1.5">
          <p className="text-[12px] text-slate-500 dark:text-slate-400/80">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-cyan-400/90 hover:text-cyan-300 font-medium transition-colors">
              Создайте один
            </Link>
          </p>
          <p>
            <Link to="/forgot-password" className="text-[11px] text-slate-500/80 hover:text-cyan-400/90 transition-colors">
              Забыли пароль?
            </Link>
          </p>
        </div>
      </GlassCard>

      <FeatureList
        title="После входа вы получите доступ к"
        items={['Личному кабинету', 'Истории платежей', 'Управлению подписками']}
      />
    </AuthBackground>
  )
}
