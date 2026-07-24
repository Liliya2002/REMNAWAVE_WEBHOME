import React, { useRef, useState } from 'react'
import { X, Tag } from 'lucide-react'

/**
 * Pill-style ввод тегов.
 *
 * Юзер пишет текст и жмёт Enter (или запятую) → тег появляется как pill.
 * Backspace на пустом инпуте удаляет последний тег. Дубликаты игнорируются.
 *
 * Валидация в момент добавления (не при submit) — если ввод не подходит,
 * показывается inline-сообщение и тег не добавляется. Авто-uppercase для
 * удобства (паттерн Remnawave требует только заглавные).
 *
 * Props:
 *   value     — массив тегов (контролируемый компонент)
 *   onChange  — вызывается с новым массивом
 *   maxTags   — макс. кол-во тегов (default 10, как у Remnawave)
 *   maxLength — макс. длина одного тега (default 36)
 *   pattern   — RegExp для валидации (default /^[A-Z0-9_:]+$/)
 *   disabled  — disable весь инпут
 */
const DEFAULT_PATTERN = /^[A-Z0-9_:]+$/

export default function TagInput({
  value = [],
  onChange,
  maxTags = 10,
  maxLength = 36,
  pattern = DEFAULT_PATTERN,
  disabled = false,
  placeholder = 'Введите тег и Enter…',
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  function tryAdd(raw) {
    const candidate = raw.trim().toUpperCase()
    if (!candidate) return false

    if (value.length >= maxTags) {
      setError(`Максимум ${maxTags} тегов`)
      return false
    }
    if (candidate.length > maxLength) {
      setError(`Тег до ${maxLength} символов`)
      return false
    }
    if (!pattern.test(candidate)) {
      setError('Только A-Z, 0-9, _, :')
      return false
    }
    if (value.includes(candidate)) {
      setError('Этот тег уже добавлен')
      return false
    }

    onChange?.([...value, candidate])
    setDraft('')
    setError(null)
    return true
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      tryAdd(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      // Удаляем последний тег
      onChange?.(value.slice(0, -1))
      setError(null)
    }
  }

  function removeTag(idx) {
    const next = value.filter((_, i) => i !== idx)
    onChange?.(next)
    setError(null)
    inputRef.current?.focus()
  }

  function handleChange(e) {
    setDraft(e.target.value.toUpperCase())
    if (error) setError(null)
  }

  function handlePaste(e) {
    // Если вставляют через запятую/пробел — разбиваем и добавляем все
    const txt = (e.clipboardData?.getData('text') || '').trim()
    if (!txt || (!txt.includes(',') && !txt.includes(' '))) return  // обычная вставка
    e.preventDefault()
    const parts = txt.split(/[,\s]+/).filter(Boolean)
    let next = [...value]
    for (const p of parts) {
      if (next.length >= maxTags) break
      const norm = p.trim().toUpperCase()
      if (norm && norm.length <= maxLength && pattern.test(norm) && !next.includes(norm)) {
        next.push(norm)
      }
    }
    onChange?.(next)
    setDraft('')
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-slate-950/60 border rounded-lg min-h-[40px] cursor-text transition ${
          error ? 'border-red-500/60' : 'border-slate-700 focus-within:border-violet-500/60'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {value.length === 0 && draft === '' && (
          <Tag className="w-4 h-4 text-slate-600 ml-1" />
        )}

        {value.map((tag, idx) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-violet-500/15 border border-violet-500/40 rounded text-xs font-mono text-violet-200"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(idx) }}
              disabled={disabled}
              className="w-4 h-4 inline-flex items-center justify-center rounded hover:bg-violet-500/30"
              aria-label={`Удалить тег ${tag}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        <input autoComplete="off"
          ref={inputRef}
          type="text"
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => { if (draft.trim()) tryAdd(draft) }}
          disabled={disabled || value.length >= maxTags}
          placeholder={value.length === 0 ? placeholder : ''}
          maxLength={maxLength}
          className="flex-1 min-w-[80px] px-1 py-0.5 bg-transparent border-0 outline-none text-sm text-slate-100 placeholder-slate-500 font-mono uppercase"
        />
      </div>
      <div className="flex items-center justify-between mt-1">
        <p className="text-[11px] text-red-400">{error || ''}</p>
        <p className="text-[11px] text-slate-500">{value.length} / {maxTags}</p>
      </div>
    </div>
  )
}
