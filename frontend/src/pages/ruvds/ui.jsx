import React, { useState } from 'react'
import { RefreshCw, AlertCircle, Inbox, Copy, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Общие UI-примитивы раздела RUVDS ─────────────────────────────────────────
// Главный приём для мобилок: одни и те же данные рендерятся таблицей на ≥md
// и стопкой карточек на узких экранах — без горизонтального скролла.

export const card = 'rounded-2xl border border-slate-800/70 bg-slate-900/40'

export function Panel({ title, Icon, accent = 'text-cyan-400', ring = 'bg-cyan-500/10', actions, children, className = '' }) {
  return (
    <div className={`${card} ${className}`}>
      {(title || actions) && (
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800/60">
          {Icon && <div className={`w-8 h-8 rounded-xl ${ring} ${accent} flex items-center justify-center shrink-0`}><Icon className="w-4 h-4" /></div>}
          <span className="text-sm font-semibold text-slate-200 truncate">{title}</span>
          <div className="ml-auto flex items-center gap-2 shrink-0">{actions}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

export function Loading({ text = 'Загрузка…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm">
      <RefreshCw className="w-4 h-4 animate-spin" /> {text}
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-300 text-sm flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0 break-words">{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-200 text-xs hover:text-white">
          Повторить
        </button>
      )}
    </div>
  )
}

export function Empty({ icon: Icon = Inbox, title, hint }) {
  return (
    <div className="text-center py-12">
      <Icon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
      <p className="text-slate-300 font-medium">{title}</p>
      {hint && <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{hint}</p>}
    </div>
  )
}

export function IconBtn({ onClick, title, disabled, spinning, children, className = '' }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={`p-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white disabled:opacity-40 transition-colors ${className}`}>
      {spinning ? <RefreshCw className="w-4 h-4 animate-spin" /> : children}
    </button>
  )
}

// Статус-бейдж с семантикой RUVDS (active / notpaid / blocked / deleted / initializing)
export function Badge({ v, map }) {
  if (v == null || v === '') return <span className="text-slate-600">—</span>
  const s = String(v).toLowerCase()
  const preset = map?.[s]
  const cls = preset || (
    /active|on|running|paid|success|done|completed/.test(s) ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : /init|progress|pending|wait|new/.test(s) ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
    : /notpaid|warn|unpaid|expir/.test(s) ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    : /block|delet|error|fail|off|stopped/.test(s) ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
    : 'bg-slate-700/40 text-slate-300 border-slate-600/40'
  )
  const label = { active: 'активен', notpaid: 'не оплачен', blocked: 'заблокирован', deleted: 'удалён', initializing: 'создаётся' }[s] || v
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${cls}`}>{label}</span>
}

export function CopyText({ value, className = '', children }) {
  const [ok, setOk] = useState(false)
  if (value == null || value === '') return <span className="text-slate-600">—</span>
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(String(value)).then(() => { setOk(true); setTimeout(() => setOk(false), 1200) }).catch(() => {}) }}
      className={`inline-flex items-center gap-1.5 group hover:text-white ${className}`} title="Скопировать">
      <span className="font-mono truncate">{children ?? value}</span>
      {ok ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 shrink-0" />}
    </button>
  )
}

/**
 * Адаптивный список записей.
 *  cols: [{ key, h, render(row), mobile?: 'title'|'sub'|'meta'|'hide' }]
 * ≥md — таблица; <md — карточки (title крупно, sub под ним, meta строкой).
 */
export function DataList({ cols, rows, keyOf, onRowClick, actions }) {
  const mobileTitle = cols.filter(c => c.mobile === 'title')
  const mobileSub   = cols.filter(c => c.mobile === 'sub')
  const mobileMeta  = cols.filter(c => !c.mobile || c.mobile === 'meta')

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto thin-scroll">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 text-left border-b border-slate-800/60">
              {cols.map(c => <th key={c.key} className="py-2.5 px-3 font-semibold uppercase tracking-wider text-[11px] whitespace-nowrap">{c.h}</th>)}
              {actions && <th className="py-2.5 px-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={keyOf ? keyOf(r) : i}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`border-b border-slate-800/30 hover:bg-slate-800/30 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}>
                {cols.map(c => <td key={c.key} className="py-2.5 px-3 align-middle">{c.render(r)}</td>)}
                {actions && <td className="py-2.5 px-3 text-right whitespace-nowrap">{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-2.5">
        {rows.map((r, i) => (
          <div key={keyOf ? keyOf(r) : i}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={`rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 ${onRowClick ? 'active:bg-slate-800/40' : ''}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {mobileTitle.map(c => <div key={c.key} className="text-sm font-semibold text-white truncate">{c.render(r)}</div>)}
                {mobileSub.map(c => <div key={c.key} className="text-[11px] text-slate-400 mt-0.5 truncate">{c.render(r)}</div>)}
              </div>
              {actions && <div className="shrink-0 flex items-center gap-1">{actions(r)}</div>}
            </div>
            {mobileMeta.length > 0 && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2.5 pt-2.5 border-t border-slate-800/50">
                {mobileMeta.map(c => (
                  <div key={c.key} className="min-w-0">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">{c.h}</div>
                    <div className="text-xs text-slate-200 truncate">{c.render(r)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

export function Pager({ page, hasMore, onPage, loading, total }) {
  return (
    <div className="flex items-center justify-between mt-3 text-[11px] text-slate-500">
      <span>Стр. {page + 1}{total ? ` · всего ${total.toLocaleString('ru-RU')}` : ''}</span>
      <div className="flex items-center gap-1">
        <IconBtn onClick={() => onPage(page - 1)} disabled={page <= 0 || loading} title="Назад" className="!p-1.5"><ChevronLeft className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn onClick={() => onPage(page + 1)} disabled={!hasMore || loading} title="Вперёд" className="!p-1.5"><ChevronRight className="w-3.5 h-3.5" /></IconBtn>
      </div>
    </div>
  )
}

// ─── Форматтеры ───────────────────────────────────────────────────────────────
export const fmtNum = n => (n == null || n === '' || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('ru-RU')
export const fmtMoney = (v, cur = '₽') => (v == null || v === '' || isNaN(Number(v)))
  ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + cur
export const fmtDate = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU') }
export const fmtDT = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
export const fmtGB = v => { const n = Number(v); return isFinite(n) ? String(Number(n.toFixed(2))) : '—' }
export function daysLeft(d) {
  if (!d) return null
  const ms = new Date(d).getTime() - Date.now()
  return isNaN(ms) ? null : Math.ceil(ms / 86400000)
}
