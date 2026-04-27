import React, { useEffect, useState } from 'react'
import { History, RefreshCw, Plus, Edit2, Trash2, Eye, EyeOff } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

const ACTION_META = {
  create:    { label: 'Создан',         badge: 'bg-emerald-500/20 border-emerald-500/40', icon: 'text-emerald-300', Icon: Plus },
  update:    { label: 'Изменён',        badge: 'bg-blue-500/20 border-blue-500/40',       icon: 'text-blue-300',    Icon: Edit2 },
  delete:    { label: 'Удалён',         badge: 'bg-red-500/20 border-red-500/40',         icon: 'text-red-300',     Icon: Trash2 },
  publish:   { label: 'Опубликован',    badge: 'bg-emerald-500/20 border-emerald-500/40', icon: 'text-emerald-300', Icon: Eye },
  unpublish: { label: 'Снят с публ.',   badge: 'bg-amber-500/20 border-amber-500/40',     icon: 'text-amber-300',   Icon: EyeOff },
}

const FIELD_LABELS = {
  slug: 'Slug',
  title: 'Название',
  content: 'Контент',
  is_published: 'Публикация',
  show_in_menu: 'В меню',
  menu_order: 'Порядок',
  meta_title: 'Meta Title',
  meta_description: 'Meta Description',
  meta_keywords: 'Keywords',
  og_image: 'OG Image',
  canonical_url: 'Canonical',
  schema_type: 'Schema.org type',
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  return String(v)
}

export default function LandingAuditPanel({ landingId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${API}/api/admin/landings/${landingId}/audit`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка загрузки')
      setEntries(d.entries || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [landingId])

  return (
    <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5 gap-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <History className="w-5 h-5 text-purple-400" /> История изменений
        </h3>
        <button
          onClick={load}
          className="p-1.5 rounded-md hover:bg-slate-700/60 text-slate-400 hover:text-white transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-red-400 text-sm mb-3">{error}</div>}

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-8">Изменений пока нет</div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(e => {
            const meta = ACTION_META[e.action] || { label: e.action, badge: 'bg-slate-700/40 border-slate-600/40', icon: 'text-slate-300', Icon: Edit2 }
            const Icon = meta.Icon
            return (
              <div key={e.id} className="p-3 rounded-xl border border-slate-700/40 bg-slate-900/40">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${meta.badge}`}>
                    <Icon className={`w-3.5 h-3.5 ${meta.icon}`} />
                  </span>
                  <span className="text-sm text-white font-medium">{meta.label}</span>
                  <span className="text-xs text-slate-400 ml-auto">{formatDate(e.created_at)}</span>
                </div>
                <div className="text-xs text-slate-400 ml-9 mb-2">
                  {e.user_login ? <>👤 {e.user_login} <span className="text-slate-600">({e.user_email || '—'})</span></> : 'Система'}
                </div>
                {e.changes && Object.keys(e.changes).length > 0 && (
                  <div className="ml-9 space-y-1">
                    {Object.entries(e.changes).map(([field, vals]) => (
                      <div key={field} className="text-xs flex flex-wrap items-baseline gap-1.5">
                        <span className="text-slate-500 min-w-[100px]">{FIELD_LABELS[field] || field}:</span>
                        <span className="text-rose-300 line-through font-mono break-all">{fmtVal(Array.isArray(vals) ? vals[0] : vals?.from)}</span>
                        <span className="text-slate-500">→</span>
                        <span className="text-emerald-300 font-mono break-all">{fmtVal(Array.isArray(vals) ? vals[1] : vals?.to)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
