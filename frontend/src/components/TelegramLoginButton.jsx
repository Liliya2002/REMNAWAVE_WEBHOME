import React, { useEffect, useRef } from 'react'

export default function TelegramLoginButton({ botName, onAuth, buttonSize = 'large', cornerRadius = 8 }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!botName || !containerRef.current) return

    // Очищаем предыдущий виджет
    containerRef.current.innerHTML = ''

    // Создаём глобальный callback
    const callbackName = `__tg_auth_${Date.now()}`
    window[callbackName] = (user) => {
      if (onAuth) onAuth(user)
      delete window[callbackName]
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', botName)
    script.setAttribute('data-size', buttonSize)
    script.setAttribute('data-radius', String(cornerRadius))
    script.setAttribute('data-onauth', `${callbackName}(user)`)
    script.setAttribute('data-request-access', 'write')
    script.async = true

    containerRef.current.appendChild(script)

    return () => {
      delete window[callbackName]
    }
  }, [botName, buttonSize, cornerRadius, onAuth])

  if (!botName) {
    return null
  }

  return <div ref={containerRef} className="flex justify-center" />
}
