import React, { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

/**
 * Авто-авторизация внутри Telegram Mini App.
 *
 * Мини-апп открывается в изолированном WebView с пустым localStorage, поэтому
 * JWT там нет и юзера выкидывало на страницу логина. Telegram отдаёт подписанную
 * initData — меняем её на JWT через POST /auth/telegram/webapp ещё до того, как
 * отрендерится приложение (иначе на миг мелькнёт гостевой интерфейс).
 *
 * Вне Telegram (обычный браузер) initData пустая — гейт сразу пропускает детей.
 */
export default function TelegramAuthGate({ children }) {
  // 'checking' — короткая синхронная проверка, 'authing' — идёт запрос, 'done' — рендерим
  const [status, setStatus] = useState('checking')
  const [error, setError] = useState(null)

  useEffect(() => {
    const tg = window.Telegram?.WebApp

    // Сообщаем Telegram, что приложение готово, и разворачиваем на всю высоту.
    if (tg) {
      try { tg.ready(); tg.expand() } catch { /* не критично */ }
    }

    const initData = tg?.initData
    // Не в Telegram, либо уже авторизованы — ничего не делаем.
    if (!initData || localStorage.getItem('token')) {
      setStatus('done')
      return
    }

    let cancelled = false
    setStatus('authing')

    fetch(`${API}/auth/telegram/webapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!data.token) throw new Error('Сервер не вернул токен')
        if (cancelled) return
        localStorage.setItem('token', data.token)
        setStatus('done')
      })
      .catch(err => {
        if (cancelled) return
        // Не блокируем приложение: показываем обычный (гостевой) интерфейс,
        // юзер сможет войти вручную. Ошибку выводим ненавязчиво.
        console.warn('[TG WebApp auth]', err.message)
        setError(err.message)
        setStatus('done')
      })

    return () => { cancelled = true }
  }, [])

  if (status !== 'done') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#020617', color: '#94a3b8', fontFamily: 'system-ui, sans-serif', gap: 10,
      }}>
        <span style={{
          width: 18, height: 18, border: '2px solid #334155', borderTopColor: '#06b6d4',
          borderRadius: '50%', display: 'inline-block', animation: 'tgSpin .7s linear infinite',
        }} />
        <span style={{ fontSize: 14 }}>Вход через Telegram…</span>
        <style>{'@keyframes tgSpin{to{transform:rotate(360deg)}}'}</style>
      </div>
    )
  }

  return (
    <>
      {error && window.Telegram?.WebApp?.initData && (
        <div style={{
          background: '#7f1d1d', color: '#fecaca', padding: '8px 12px',
          fontSize: 13, textAlign: 'center',
        }}>
          Не удалось войти автоматически: {error}
        </div>
      )}
      {children}
    </>
  )
}
