import React, { useEffect, useRef, useState } from 'react'
import { X, AlertTriangle, Loader2 } from 'lucide-react'

/**
 * Универсальная модалка подтверждения с типизацией.
 *
 * Юзер должен ввести строку точно совпадающую с `confirmText`, иначе кнопка
 * подтверждения остаётся disabled. Защищает от случайного удаления:
 * обычный confirm можно тыкнуть мышкой не глядя, а здесь нужно точно набрать
 * имя ноды или слово RESTART.
 *
 * Props:
 *   open          — bool
 *   onClose       — закрыть
 *   onConfirm     — вызвать действие. Если возвращает Promise — модалка покажет
 *                    loading state и закроется после resolve. Если throw —
 *                    оставит модалку открытой и покажет сообщение.
 *   title         — заголовок
 *   description   — JSX или строка (контекст: что произойдёт)
 *   confirmText   — точная строка которую нужно ввести
 *   confirmLabel  — текст кнопки подтверждения (default 'Удалить')
 *   confirmTone   — 'danger' | 'warning' | 'primary' (default 'danger')
 *   inputLabel    — подпись над input (default 'Введите для подтверждения:')
 */
export default function ConfirmByTypeModal({
  open,
  onClose,
  onConfirm,
  title = 'Подтверждение',
  description,
  confirmText,
  confirmLabel = 'Удалить',
  confirmTone = 'danger',
  inputLabel = 'Чтобы подтвердить, введи',
}) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  // Сброс состояния при открытии/закрытии
  useEffect(() => {
    if (open) {
      setValue('')
      setError(null)
      setLoading(false)
      // autofocus на input после короткой задержки (модалка должна успеть отрендериться)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // ESC закрывает (если не loading)
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape' && !loading) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, loading, onClose])

  if (!open) return null

  const matched = value === confirmText
  const tones = {
    danger:  'bg-red-500 hover:bg-red-600 text-white',
    warning: 'bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold',
    primary: 'bg-violet-500 hover:bg-violet-600 text-white',
  }
  const accent = {
    danger:  'text-red-400',
    warning: 'text-amber-400',
    primary: 'text-violet-400',
  }[confirmTone]

  async function handleConfirm() {
    if (!matched || loading) return
    setLoading(true); setError(null)
    try {
      await onConfirm?.()
      // Если onConfirm не бросил — закрываем
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Ошибка')
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !loading && onClose?.()}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`w-5 h-5 ${accent}`} />
            <h3 className="text-lg font-bold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => !loading && onClose?.()}
            disabled={loading}
            className="text-slate-400 hover:text-white disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {description && (
          <div className="text-sm text-slate-300 mb-4">
            {description}
          </div>
        )}

        <label className="block text-xs text-slate-400 mb-1.5">
          {inputLabel}{' '}
          <code className="text-cyan-300 font-mono px-1 py-0.5 bg-slate-950/80 rounded text-[11px]">
            {confirmText}
          </code>
        </label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && matched) handleConfirm() }}
          disabled={loading}
          spellCheck={false}
          autoComplete="off"
          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-100 focus:outline-none focus:border-violet-500/60"
        />

        {error && (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        )}

        <div className="flex gap-2 mt-4 justify-end">
          <button
            type="button"
            onClick={() => onClose?.()}
            disabled={loading}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!matched || loading}
            className={`px-4 py-2 rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${tones[confirmTone]}`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
