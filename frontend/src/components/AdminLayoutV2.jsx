import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, Link, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutGrid, ExternalLink, Menu, X, LayoutDashboard, Search, LogOut,
  ChevronDown, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { lockDarkTheme } from '../contexts/ThemeContext'
import { GROUPS, FLAT_ITEMS } from '../config/adminNav'
import CursorGlow from './CursorGlow'
import { BgToggle, CursorToggle } from './EffectsToggles'

// ─── Новый дизайн админки (v2) ────────────────────────────────────────────────
// Слева — сайдбар со всеми разделами: группы-аккордеоны + кнопка сворачивания
// в режим «только иконки». Сверху — топ-бар с текущим разделом, единым
// глобальным поиском (Ctrl+K), переключателем вида и выходом. Всегда тёмная тема.

const LS_COLLAPSED = 'admin_sidebar_collapsed'
const LS_GROUPS = 'admin_sidebar_groups'

function readCollapsed() {
  try { return localStorage.getItem(LS_COLLAPSED) === '1' } catch { return false }
}

export default function AdminLayoutV2({ onSwitchToClassic }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem(LS_COLLAPSED, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/')
  }

  // Форсируем тёмную тему пока юзер в админке (как в классическом layout).
  useEffect(() => lockDarkTheme(), [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const current = useMemo(() => {
    const exact = FLAT_ITEMS.find(i => i.to === location.pathname)
    if (exact) return exact
    return FLAT_ITEMS
      .filter(i => location.pathname.startsWith(i.to))
      .sort((a, b) => b.to.length - a.to.length)[0] || null
  }, [location.pathname])

  const isOverview = location.pathname === '/admin' || location.pathname === '/admin/'
  const title = isOverview ? 'Обзор' : (current?.label || 'Админ-панель')

  return (
    <div className="min-h-screen text-slate-200">
      <CursorGlow />
      <div className="flex">
        <Sidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />

        <div className={`flex-1 min-w-0 transition-[padding] duration-300 ${collapsed ? 'lg:pl-16' : 'lg:pl-72'}`}>
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex items-center gap-3 h-14 px-3 sm:px-5 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur-xl">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-800/60 text-slate-300 shrink-0"
              aria-label="Открыть меню"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="hidden md:flex items-center gap-2 min-w-0 shrink-0">
              <LayoutDashboard className="w-4 h-4 text-slate-500 shrink-0" />
              <h1 className="text-sm font-semibold text-white truncate max-w-[220px]">{title}</h1>
            </div>

            <CommandSearch />

            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden sm:flex items-center">
                <BgToggle />
                <CursorToggle />
              </div>
              <button
                onClick={onSwitchToClassic}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300 hover:text-white text-xs transition-all"
                title="Вернуться к классическому виду"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Классический вид</span>
              </button>
              <a
                href="/"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300 hover:text-white text-xs transition-all"
                title="На сайт"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">На сайт</span>
              </a>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-rose-500/20 border border-slate-700/60 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs transition-all"
                title="Выйти"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Выйти</span>
              </button>
            </div>
          </header>

          {/* Content */}
          <main className="p-3 sm:p-5 lg:p-6">
            <div className="w-full rounded-2xl border border-slate-800/60 bg-slate-950/30 px-4 sm:px-6 lg:px-7 py-5 sm:py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

// ─── Глобальный поиск-палитра (единственный поиск в интерфейсе) ────────────────
function CommandSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const boxRef = useRef(null)

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return FLAT_ITEMS
      .filter(i => i.label.toLowerCase().includes(s) || (i.groupTitle || '').toLowerCase().includes(s))
      .slice(0, 8)
  }, [q])

  useEffect(() => { setActive(0) }, [q])

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onClick(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function go(item) {
    navigate(item.to)
    setQ(''); setOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) go(results[active]) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div ref={boxRef} className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
      <input autoComplete="off"
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => { if (q) setOpen(true) }}
        onKeyDown={onKeyDown}
        placeholder="Поиск раздела…"
        className="w-full pl-9 pr-14 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-all"
      />
      <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700 rounded pointer-events-none">
        Ctrl K
      </kbd>

      {open && q && (
        <div className="absolute left-0 right-0 mt-1.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/50 z-50 max-h-80 overflow-y-auto thin-scroll">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-500">Ничего не найдено</div>
          ) : results.map((it, idx) => (
            <button
              key={it.to}
              onMouseEnter={() => setActive(idx)}
              onClick={() => go(it)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                active === idx ? 'bg-slate-800' : 'hover:bg-slate-800/60'
              }`}
            >
              <it.Icon className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-sm text-slate-200 flex-1 truncate">{it.label}</span>
              <span className="text-[11px] text-slate-500 shrink-0">{it.groupTitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ mobileOpen, onClose, collapsed, onToggleCollapsed }) {
  const location = useLocation()

  // Аккордеоны групп. По умолчанию все раскрыты; выбор сохраняется в localStorage.
  const [openGroups, setOpenGroups] = useState(() => {
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(LS_GROUPS) || 'null') } catch { /* ignore */ }
    const base = {}
    GROUPS.forEach(g => { base[g.id] = saved ? saved[g.id] !== false : true })
    return base
  })

  useEffect(() => {
    try { localStorage.setItem(LS_GROUPS, JSON.stringify(openGroups)) } catch { /* ignore */ }
  }, [openGroups])

  function toggleGroup(id) {
    setOpenGroups(s => ({ ...s, [id]: !s[id] }))
  }

  // На мобиле (drawer открыт) всегда показываем полный вид с подписями,
  // даже если на десктопе сайдбар свёрнут в иконки.
  const showLabels = mobileOpen || !collapsed

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-screen flex flex-col border-r border-slate-800/70 bg-slate-950/95 backdrop-blur-xl transition-[transform,width] duration-300 w-72 ${
          collapsed ? 'lg:w-16' : 'lg:w-72'
        } lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between h-14 px-3 border-b border-slate-800/70 shrink-0">
          <Link to="/admin" className="flex items-center gap-2 text-white font-bold overflow-hidden">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-sm shrink-0">⚙️</span>
            {showLabels && <span className="truncate">Админ-панель</span>}
          </Link>
          <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-800/60 text-slate-400" aria-label="Закрыть меню">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto thin-scroll px-2 py-3 space-y-3">
          {showLabels ? (
            // Развёрнутый режим: группы-аккордеоны
            GROUPS.map(group => {
              const isOpen = openGroups[group.id]
              return (
                <div key={group.id}>
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-900/60 transition-colors group/hdr"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full bg-gradient-to-br ${group.color} shrink-0`} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover/hdr:text-slate-400 flex-1 text-left">{group.title}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-600 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  </button>
                  {isOpen && (
                    <div className="mt-0.5 space-y-0.5">
                      {group.items.map(({ to, Icon, label }) => (
                        <NavLink
                          key={to}
                          to={to}
                          end={to === '/admin'}
                          className={({ isActive }) =>
                            `flex items-center gap-3 pl-3.5 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                              isActive
                                ? 'bg-blue-500/15 text-white border border-blue-500/30'
                                : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                            }`
                          }
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            // Свёрнутый режим: только иконки, всё плоским списком, tooltip по hover
            GROUPS.map((group, gi) => (
              <div key={group.id} className={gi > 0 ? 'pt-3 border-t border-slate-800/50' : ''}>
                <div className="flex flex-col items-center gap-1">
                  {group.items.map(({ to, Icon, label }) => {
                    const active = location.pathname === to || (to !== '/admin' && location.pathname.startsWith(to))
                    return (
                      <NavLink
                        key={to}
                        to={to}
                        end={to === '/admin'}
                        title={label}
                        className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                          active
                            ? 'bg-blue-500/15 text-white border border-blue-500/30'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </NavLink>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* Кнопка сворачивания — только на десктопе */}
        <div className="hidden lg:block border-t border-slate-800/70 p-2 shrink-0">
          <button
            onClick={onToggleCollapsed}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 text-sm transition-colors ${collapsed ? 'justify-center' : ''}`}
            title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4 shrink-0" /> : <PanelLeftClose className="w-4 h-4 shrink-0" />}
            {showLabels && <span>Свернуть</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
