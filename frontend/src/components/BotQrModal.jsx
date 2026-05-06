import React, { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { X, Smartphone, ExternalLink, Copy, Check, Loader2, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'

/**
 * Модалка для bot-flow:
 *   - регистрация (kind='register')
 *   - привязка существующего аккаунта (kind='link')
 *
 * Props:
 *   open       — bool
 *   onClose    — функция закрытия
 *   kind       — 'register' | 'link'
 *   startUrl   — endpoint POST для создания токена (например /auth/register/start)
 *   pollUrl    — GET endpoint для polling (например /auth/register/poll)
 *   payload    — body для POST на startUrl (для register: {login,email,password,referralCode})
 *   authHeader — нужен ли Authorization header (true для link, false для register)
 *   onSuccess  — колбек при confirmed: получает поле data из poll-ответа
 *
 * Polling каждые 2 сек до 15 мин или пока не статус !== 'pending'.
 */
const API = import.meta.env.VITE_API_URL || ''

export default function BotQrModal({ open, onClose, kind, startUrl, pollUrl, payload, authHeader, onSuccess }) {
  const [phase, setPhase] = useState('starting')   // starting | waiting | confirmed | expired | error
  const [error, setError] = useState(null)
  const [deeplink, setDeeplink] = useState('')
  const [token, setToken] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [copied, setCopied] = useState(false)
  const pollTimerRef = useRef(null)
  const tickTimerRef = useRef(null)

  // 1. Старт: создаём токен
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhase('starting'); setError(null); setDeeplink(''); setToken(''); setCopied(false)

    const headers = { 'Content-Type': 'application/json' }
    if (authHeader) {
      const t = localStorage.getItem('token')
      if (t) headers['Authorization'] = `Bearer ${t}`
    }

    fetch(`${API}${startUrl}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload || {}),
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
        if (cancelled) return
        setDeeplink(d.deeplink)
        setToken(d.token)
        setSecondsLeft(Math.max(0, Math.floor((d.ttl_ms || 900_000) / 1000)))
        setPhase('waiting')
      })
      .catch(err => {
        if (!cancelled) {
          setPhase('error')
          setError(err.message || 'Ошибка запроса')
        }
      })

    return () => { cancelled = true }
  }, [open, startUrl, JSON.stringify(payload), authHeader])

  // 2. Polling статуса
  useEffect(() => {
    if (phase !== 'waiting' || !token) return
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 450  // 2 сек × 450 = 15 мин

    async function tick() {
      if (cancelled) return
      attempts += 1
      try {
        const r = await fetch(`${API}${pollUrl}?token=${encodeURIComponent(token)}`)
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (d.status === 'confirmed') {
          setPhase('confirmed')
          onSuccess?.(d)
          return
        }
        if (d.status === 'expired' || attempts > MAX_ATTEMPTS) {
          setPhase('expired')
          return
        }
        pollTimerRef.current = setTimeout(tick, 2000)
      } catch {
        pollTimerRef.current = setTimeout(tick, 4000)  // на ошибке — реже
      }
    }
    tick()

    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [phase, token, pollUrl, onSuccess])

  // 3. Тикалка таймера обратного отсчёта
  useEffect(() => {
    if (phase !== 'waiting') return
    tickTimerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(tickTimerRef.current); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(tickTimerRef.current)
  }, [phase])

  function copyLink() {
    navigator.clipboard?.writeText(deeplink).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!open) return null

  const titles = {
    register: 'Регистрация через Telegram',
    link:     'Привязка Telegram',
  }
  const subtitles = {
    register: 'Отсканируй QR-код или открой ссылку в Telegram. После /start в боте — вернёшься на сайт уже залогиненным.',
    link:     'Отсканируй QR-код или открой ссылку в Telegram. Бот привяжет твой Telegram к текущему сайту-аккаунту.',
  }

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-sky-50 dark:bg-slate-900 border border-sky-200 dark:border-slate-700 rounded-2xl p-5 sm:p-7 w-full max-w-md shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-sky-900 dark:text-white mb-1">{titles[kind] || 'Telegram'}</h2>
          <p className="text-xs text-sky-700 dark:text-slate-400">{subtitles[kind]}</p>
        </div>

        {phase === 'starting' && (
          <div className="py-12 flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <p className="text-sm text-sky-700 dark:text-slate-400">Готовим ссылку...</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-10 h-10 text-red-500" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button onClick={onClose} className="mt-2 px-4 py-2 bg-slate-700 text-white rounded-lg text-sm">Закрыть</button>
          </div>
        )}

        {phase === 'expired' && (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-10 h-10 text-amber-500" />
            <p className="text-sm text-amber-600 dark:text-amber-400">Ссылка истекла. Закрой окно и попробуй снова.</p>
            <button onClick={onClose} className="mt-2 px-4 py-2 bg-slate-700 text-white rounded-lg text-sm">Закрыть</button>
          </div>
        )}

        {phase === 'confirmed' && (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="text-sm text-emerald-700 dark:text-emerald-400 font-bold">Подтверждено в боте!</p>
            <p className="text-xs text-sky-700 dark:text-slate-400">Готовим вход на сайт...</p>
          </div>
        )}

        {phase === 'waiting' && deeplink && (
          <>
            <div className="bg-white p-4 rounded-xl flex items-center justify-center mb-4">
              <QRCodeSVG value={deeplink} size={220} level="M" includeMargin={false} />
            </div>

            <div className="flex items-center justify-center gap-2 mb-3">
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              <span className="text-xs text-sky-700 dark:text-slate-400">
                Жду подтверждения от бота · ⏱ {mins}:{String(secs).padStart(2, '0')}
              </span>
            </div>

            <a
              href={deeplink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#229ED9] hover:bg-[#1d8bc1] text-white rounded-lg font-semibold text-sm shadow transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Открыть в Telegram
            </a>

            <button
              onClick={copyLink}
              className="flex items-center justify-center gap-2 w-full mt-2 px-4 py-2.5 bg-sky-100 dark:bg-slate-800 hover:bg-sky-200 dark:hover:bg-slate-700 border border-sky-200 dark:border-slate-700 text-sky-900 dark:text-slate-200 rounded-lg text-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </button>

            <p className="text-[11px] text-sky-700/70 dark:text-slate-500 mt-3 flex items-start gap-1.5">
              <Smartphone className="w-3 h-3 mt-0.5 shrink-0" />
              На телефоне — отсканируй QR камерой или открой ссылку. Бот сам всё сделает.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
