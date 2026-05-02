import React, { useState, useEffect, useCallback } from 'react'
import { Mail, Loader2, AlertTriangle, CheckCircle, X, Send } from 'lucide-react'
import { authFetch } from '../services/api'
import { useSiteConfig } from '../contexts/SiteConfigContext'

/**
 * Глобальный баннер «Подтвердите ваш email».
 * Показывается на Dashboard / Connect когда:
 *   - юзер залогинен
 *   - user.email_confirmed === false
 *   - site_config.require_email_confirmation === true
 *
 * Сворачиваемый — закрытие сохраняется в sessionStorage (не показывать до перезагрузки вкладки).
 */
export default function EmailConfirmBanner() {
  const { config } = useSiteConfig()
  const [user, setUser] = useState(null)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [msg, setMsg] = useState(null) // { type: 'success'|'error', text }
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('email_confirm_banner_dismissed') === '1' } catch { return false }
  })

  const loadUser = useCallback(async () => {
    try {
      const res = await authFetch('/api/me')
      if (!res.ok) return
      const data = await res.json()
      setUser(data.user)
    } catch {}
  }, [])

  useEffect(() => { loadUser() }, [loadUser])

  // cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const sendCode = async () => {
    setSending(true); setMsg(null)
    try {
      const res = await authFetch('/auth/send-confirmation-code', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setMsg({ type: 'success', text: 'Код отправлен на ваш email' })
      setCooldown(60)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSending(false)
    }
  }

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) { setMsg({ type: 'error', text: 'Введите 6-значный код' }); return }
    setConfirming(true); setMsg(null)
    try {
      const res = await authFetch('/auth/confirm-email', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setMsg({ type: 'success', text: 'Email подтверждён ✓' })
      // Перезагрузим юзера через 1.5 сек чтобы баннер убрался
      setTimeout(() => loadUser(), 1500)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setConfirming(false)
    }
  }

  const dismiss = () => {
    setDismissed(true)
    try { sessionStorage.setItem('email_confirm_banner_dismissed', '1') } catch {}
  }

  // Не показываем если: фича выключена / юзер не загружен / уже подтверждён / закрыт пользователем
  if (!config?.require_email_confirmation) return null
  if (!user) return null
  if (user.email_confirmed) return null
  if (dismissed) return null

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent overflow-hidden">
      {/* Header — всегда виден */}
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sky-900 dark:text-amber-200 truncate">Подтвердите ваш email</div>
          <div className="text-xs text-sky-700 dark:text-amber-300/80 truncate">
            На <code className="font-mono">{user.email}</code> мы отправим письмо с кодом для подтверждения
          </div>
        </div>
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-200 border border-amber-500/40 transition"
          >
            <Mail className="w-3.5 h-3.5" />
            Подтвердить
          </button>
        ) : null}
        <button onClick={dismiss} title="Скрыть до следующего захода" className="text-amber-700/60 dark:text-amber-300/60 hover:text-amber-700 dark:hover:text-amber-200 p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="sm:hidden w-full py-2 px-4 text-xs font-medium border-t border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200 hover:bg-amber-500/20"
        >
          <Mail className="w-3.5 h-3.5 inline mr-1.5" />
          Открыть форму подтверждения
        </button>
      )}

      {/* Open: form for code */}
      {open && (
        <div className="border-t border-amber-500/30 px-4 sm:px-5 py-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={sendCode}
              disabled={sending || cooldown > 0}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:shadow-lg hover:shadow-amber-500/30 disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {cooldown > 0 ? `Повторить (${cooldown}с)` : 'Отправить код на email'}
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength="6"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-значный код"
              className="flex-1 px-3 py-2 rounded-lg text-center font-mono text-lg tracking-widest bg-white/80 dark:bg-slate-900/60 border border-amber-500/40 text-sky-900 dark:text-amber-100 focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={confirm}
              disabled={confirming || code.length !== 6}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:shadow-lg hover:shadow-emerald-500/30 disabled:opacity-50"
            >
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Подтвердить
            </button>
          </div>
          {msg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${
              msg.type === 'success'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
                : 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/40'
            }`}>
              {msg.text}
            </div>
          )}
          <p className="text-[11px] text-amber-700/70 dark:text-amber-300/60">
            Код действителен 10 минут. Если не получаете — проверьте папку «Спам».
          </p>
        </div>
      )}
    </div>
  )
}
