import React, { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  Server, BarChart3, Wallet, KeyRound, Bell, Users2,
  ChevronDown, Check, Plus, ShieldCheck, Eye, Pencil,
} from 'lucide-react'
import { RuvdsProvider, useRuvds } from './context'
import { Loading, ErrorBox, Empty } from './ui'

const SECTIONS = [
  { to: 'servers',       label: 'Серверы',      Icon: Server },
  { to: 'statistics',    label: 'Статистика',   Icon: BarChart3 },
  { to: 'balance',       label: 'Баланс',       Icon: Wallet },
  { to: 'ssh-keys',      label: 'SSH-ключи',    Icon: KeyRound },
  { to: 'notifications', label: 'Уведомления',  Icon: Bell },
  { to: 'accounts',      label: 'Аккаунты',     Icon: Users2 },
]

const ROLE_META = {
  read:   { label: 'только чтение', Icon: Eye,         cls: 'text-slate-400' },
  write:  { label: 'запись',        Icon: Pencil,      cls: 'text-amber-400' },
  remove: { label: 'полный доступ', Icon: ShieldCheck, cls: 'text-emerald-400' },
}

export default function RuvdsLayout() {
  return (
    <RuvdsProvider>
      <Shell />
    </RuvdsProvider>
  )
}

function Shell() {
  const { accounts, account, loading, error, loadAccounts } = useRuvds()
  const location = useLocation()
  const onAccountsPage = location.pathname.endsWith('/accounts')

  return (
    <div className="space-y-5">
      {/* Заголовок + переключатель аккаунта */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/25 shrink-0">
          <Server className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">RUVDS</h1>
          <p className="text-xs text-slate-400 hidden sm:block">Управление серверами и аккаунтами (api.ruvds.com)</p>
        </div>
        {accounts.length > 0 && <AccountSwitcher />}
      </div>

      {/* Подменю разделов: скроллится горизонтально на мобилках */}
      <div className="-mx-1 px-1 overflow-x-auto thin-scroll">
        <nav className="flex items-center gap-1.5 min-w-max pb-1">
          {SECTIONS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => `px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-orange-500/15 border-orange-500/40 text-orange-200'
                  : 'bg-slate-900/40 border-slate-800/60 text-slate-400 hover:text-white hover:border-slate-700'
              }`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </NavLink>
          ))}
        </nav>
      </div>

      <ErrorBox error={error} onRetry={loadAccounts} />

      {loading && accounts.length === 0 ? (
        <Loading text="Загрузка аккаунтов…" />
      ) : accounts.length === 0 && !onAccountsPage ? (
        <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30">
          <Empty
            icon={Users2}
            title="Аккаунтов RUVDS пока нет"
            hint="Добавьте первый аккаунт: понадобится API-токен из личного кабинета RUVDS (ruvds.com/my/settings/api). Токен показывается один раз при создании."
          />
          <div className="pb-8 text-center">
            <NavLink to="accounts"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:shadow-lg hover:shadow-orange-500/30">
              <Plus className="w-4 h-4" /> Добавить аккаунт
            </NavLink>
          </div>
        </div>
      ) : (
        <>
          {!account && !onAccountsPage && <Empty icon={Users2} title="Аккаунт не выбран" hint="Выберите аккаунт в переключателе вверху." />}
          <Outlet />
        </>
      )}
    </div>
  )
}

// Компактный дропдаун выбора аккаунта — общий для всех подстраниц.
function AccountSwitcher() {
  const { accounts, account, setActiveId } = useRuvds()
  const [open, setOpen] = useState(false)
  const role = ROLE_META[account?.role] || ROLE_META.read

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800/70 hover:border-slate-700 text-left max-w-[70vw] sm:max-w-xs">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500/30 to-red-500/20 border border-orange-500/30 flex items-center justify-center text-[11px] font-bold text-orange-200 shrink-0">
          {(account?.name || 'R').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-white truncate">{account?.name || 'Выберите аккаунт'}</div>
          <div className={`text-[10px] flex items-center gap-1 ${role.cls}`}>
            <role.Icon className="w-2.5 h-2.5" /> {role.label}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1.5 w-64 max-w-[85vw] z-50 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/50 py-1.5 max-h-80 overflow-y-auto thin-scroll">
            {accounts.map(a => {
              const r = ROLE_META[a.role] || ROLE_META.read
              return (
                <button key={a.id} onClick={() => { setActiveId(a.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-800/70 ${a.id === account?.id ? 'bg-slate-800/40' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-100 truncate flex items-center gap-1.5">
                      {a.name}
                      {!a.is_active && <span className="px-1 rounded text-[9px] bg-slate-700/60 text-slate-400">выкл</span>}
                    </div>
                    <div className={`text-[10px] flex items-center gap-1 ${r.cls}`}><r.Icon className="w-2.5 h-2.5" /> {r.label}</div>
                  </div>
                  {a.id === account?.id && <Check className="w-4 h-4 text-orange-400 shrink-0" />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
