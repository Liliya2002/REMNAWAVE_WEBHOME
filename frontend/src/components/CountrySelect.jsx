import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Globe, Search, Check, ChevronDown } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''
const CACHE_KEY = 'countries_v1'

/**
 * Селектор страны ISO 3166-1.
 *
 * Грузит список с GET /api/countries при первом mount. Кэширует в sessionStorage —
 * список редко меняется, и при повторном открытии модалки нет смысла снова бить
 * по сети.
 *
 * Раскладка списка:
 *   - 🌍 Не указано (XX) — всегда первой
 *   - Популярные (топ-30) — выделены в группу
 *   - Все остальные — алфавит по name_en
 *
 * Поиск работает по `name_ru`, `name_en` и `code` (case-insensitive).
 *
 * Props:
 *   value      — двухбуквенный код или 'XX' / null
 *   onChange   — вызывается с новым кодом ('RU', 'XX', и т.д.)
 *   disabled   — disable весь селектор
 */
export default function CountrySelect({ value = 'XX', onChange, disabled = false }) {
  const [countries, setCountries] = useState(null)  // { popular, all } | null=loading
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef(null)

  // Загрузка списка
  useEffect(() => {
    // Сначала из кэша — если есть, рендерим мгновенно
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed?.popular && parsed?.all) setCountries(parsed)
      }
    } catch {}

    // Параллельно запрашиваем актуальный — обновим если изменилось
    fetch(`${API}/api/countries`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        setCountries(data)
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)) } catch {}
      })
      .catch(err => setError(err.message))
  }, [])

  // Click outside для закрытия dropdown
  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [open])

  const selected = useMemo(() => {
    if (!countries) return null
    return countries.all.find(c => c.code === value) || countries.all.find(c => c.code === 'XX')
  }, [countries, value])

  const filtered = useMemo(() => {
    if (!countries) return { popular: [], rest: [] }
    const q = search.trim().toLowerCase()
    if (!q) {
      // Без поиска: популярные сверху, остальное — алфавит, без пересечений
      const popularCodes = new Set(countries.popular.map(c => c.code))
      return {
        popular: countries.popular,
        rest: countries.all.filter(c => !popularCodes.has(c.code)),
      }
    }
    // С поиском: фильтруем весь список по name_ru / name_en / code
    const match = (c) =>
      c.name_ru.toLowerCase().includes(q) ||
      c.name_en.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q)
    const all = countries.all.filter(match)
    return { popular: [], rest: all }
  }, [countries, search])

  function pick(code) {
    onChange?.(code)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled || !countries}
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 bg-slate-950/60 border rounded-lg text-sm focus:outline-none transition ${
          open ? 'border-violet-500/60' : 'border-slate-700 hover:border-slate-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {selected ? (
          <>
            <span className="text-base">{selected.flag}</span>
            <span className="text-slate-100 truncate">{selected.name_ru}</span>
            <span className="text-slate-500 text-xs ml-auto">{selected.code}</span>
          </>
        ) : (
          <>
            <Globe className="w-4 h-4 text-slate-500" />
            <span className="text-slate-500">{error ? 'Ошибка загрузки' : 'Загрузка...'}</span>
          </>
        )}
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && countries && (
        <div className="absolute z-50 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-h-96 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input autoComplete="off"
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск страны…"
                className="w-full pl-8 pr-2 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>

          <div className="overflow-y-auto flex-1 py-1">
            {filtered.popular.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
                  Популярные
                </div>
                {filtered.popular.map(c => (
                  <CountryRow key={c.code} country={c} selected={c.code === value} onClick={() => pick(c.code)} />
                ))}
                <div className="border-t border-slate-800 my-1" />
              </>
            )}
            {filtered.rest.length > 0 ? (
              <>
                {!search && (
                  <div className="px-3 py-1 text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
                    Все страны
                  </div>
                )}
                {filtered.rest.map(c => (
                  <CountryRow key={c.code} country={c} selected={c.code === value} onClick={() => pick(c.code)} />
                ))}
              </>
            ) : (
              filtered.popular.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-500">Не найдено</div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CountryRow({ country, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition ${
        selected ? 'bg-violet-500/15 text-violet-200' : 'text-slate-200 hover:bg-slate-800/60'
      }`}
    >
      <span className="text-base">{country.flag}</span>
      <span className="flex-1 truncate">{country.name_ru}</span>
      <span className="text-xs text-slate-500">{country.code}</span>
      {selected && <Check className="w-3.5 h-3.5 text-violet-400" />}
    </button>
  )
}
