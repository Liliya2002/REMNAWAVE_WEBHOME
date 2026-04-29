import React, { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen, Cog, Server, CreditCard, ShieldAlert,
  RefreshCw, ExternalLink, AlertCircle, Loader2,
} from 'lucide-react'
import { authFetch } from '../services/api'

const TABS = [
  { slug: 'remnawave-xray',     label: 'Конфиги RemnaWave (Xray)', Icon: ShieldAlert },
  { slug: 'remnawave-settings', label: 'Настройки RemnaWave',      Icon: Cog },
  { slug: 'vps-setup',          label: 'Настройки VPS',            Icon: Server },
  { slug: 'payments',           label: 'Платёжные системы',        Icon: CreditCard },
]

export default function AdminInstructions() {
  const [activeSlug, setActiveSlug] = useState(TABS[0].slug)
  const [docs, setDocs] = useState({})  // slug -> { content, fetchedAt, source, stale, error, loading }

  const loadDoc = useCallback(async (slug, force = false) => {
    setDocs(prev => ({ ...prev, [slug]: { ...(prev[slug] || {}), loading: true, error: null } }))
    try {
      const url = force ? `/api/admin/docs/${slug}?_=${Date.now()}` : `/api/admin/docs/${slug}`
      const res = await authFetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`)
      setDocs(prev => ({ ...prev, [slug]: { ...data, loading: false } }))
    } catch (err) {
      setDocs(prev => ({ ...prev, [slug]: { ...(prev[slug] || {}), loading: false, error: err.message } }))
    }
  }, [])

  useEffect(() => {
    if (!docs[activeSlug] || (!docs[activeSlug].content && !docs[activeSlug].loading)) {
      loadDoc(activeSlug)
    }
  }, [activeSlug, loadDoc])

  const current = docs[activeSlug] || {}
  const repoUrl = current.source
    ? `https://github.com/${current.source.repo}/blob/${current.source.branch}/docs/admin/${current.source.filename}`
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/25">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">Инструкции</h1>
            <p className="text-xs text-slate-400">Подгружается из GitHub в реальном времени</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-300 hover:text-white bg-slate-900/60 hover:bg-slate-800/80 border border-slate-700/60 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="hidden sm:inline">Открыть в GitHub</span>
            </a>
          )}
          <button
            onClick={() => loadDoc(activeSlug, true)}
            disabled={current.loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-300 hover:text-white bg-slate-900/60 hover:bg-slate-800/80 border border-slate-700/60 transition-all disabled:opacity-50"
            title="Перечитать с GitHub"
          >
            <RefreshCw className={`w-4 h-4 ${current.loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-900/50 border border-slate-800/60 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.slug}
            onClick={() => setActiveSlug(t.slug)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center whitespace-nowrap ${
              activeSlug === t.slug
                ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <t.Icon className="w-4 h-4 shrink-0" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Stale / error banners */}
      {current.stale && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Показана сохранённая версия</div>
            <div className="text-xs text-amber-300/80 mt-0.5">
              Не удалось обновить с GitHub: <code className="font-mono">{current.error}</code>
            </div>
          </div>
        </div>
      )}

      {current.error && !current.content && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium">Не удалось загрузить инструкцию</div>
            <div className="text-xs text-red-300/80 mt-0.5 font-mono break-all">{current.error}</div>
            <button
              onClick={() => loadDoc(activeSlug, true)}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-200 hover:text-white bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Повторить
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="bg-gradient-to-br from-slate-900/60 to-slate-950/60 border border-slate-800/70 rounded-2xl overflow-hidden">
        {current.loading && !current.content ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-3" />
            Загружаю с GitHub…
          </div>
        ) : current.content ? (
          <article className="prose-admin px-5 sm:px-8 py-6 sm:py-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {current.content}
            </ReactMarkdown>
          </article>
        ) : !current.error ? (
          <div className="py-24 text-center text-slate-500 text-sm">Нет данных</div>
        ) : null}
      </div>

      {/* Footer meta */}
      {current.fetchedAt && current.source && (
        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            Источник:{' '}
            <code className="font-mono text-slate-400">
              {current.source.repo}@{current.source.branch}/docs/admin/{current.source.filename}
            </code>
          </span>
          <span>
            Обновлено: {new Date(current.fetchedAt).toLocaleString('ru-RU')}
            {current.cached && !current.stale ? ' (из кеша)' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
