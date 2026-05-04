import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Eye, EyeOff, Edit2, Trash2, ExternalLink, RefreshCw, Home as HomeIcon, Download } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

function authHeaders() {
  return {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }
}

async function apiFetch(url, opts = {}) {
  return fetch(`${API}${url}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } })
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AdminLandings() {
  const navigate = useNavigate()
  const [landings, setLandings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all') // all / published / draft

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const qs = statusFilter === 'all' ? '' : `?status=${statusFilter}`
      const res = await apiFetch(`/api/admin/landings${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      setLandings(data.landings || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter])

  async function togglePublish(id) {
    try {
      const res = await apiFetch(`/api/admin/landings/${id}/toggle-publish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function importDefaultHome() {
    if (!confirm('Создать новый лендинг с копией текущей главной страницы? Лендинг будет в черновике — после редактирования вы сможете назначить его главной.')) return
    try {
      const res = await apiFetch('/api/admin/landings/import-default-home', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не удалось создать')
      navigate(`/admin/landings/${data.landing.id}`)
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(id) {
    if (!confirm('Удалить лендинг? Это необратимо.')) return
    try {
      const res = await apiFetch(`/api/admin/landings/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-400" /> Лендинг-страницы
          </h2>
          <p className="text-sm text-slate-400 mt-1">Создавайте и редактируйте публичные страницы сайта</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={load}
            className="px-3 py-2 text-xs bg-slate-700/60 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-600 transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
          </button>
          <button
            onClick={importDefaultHome}
            title="Создать лендинг-черновик с готовой копией текущей главной страницы. Дальше можно отредактировать тексты и назначить его главной."
            className="px-3 py-2 text-xs bg-amber-500/15 border border-amber-500/40 text-amber-300 rounded-lg hover:bg-amber-500/25 transition flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Импорт текущей главной
          </button>
          <button
            onClick={() => navigate('/admin/landings/new')}
            className="px-4 py-2 text-sm bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Создать
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {[
          { id: 'all', label: 'Все' },
          { id: 'published', label: 'Опубликованные' },
          { id: 'draft', label: 'Черновики' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === f.id
                ? 'bg-blue-500/20 border border-blue-500/50 text-blue-300'
                : 'bg-slate-800/40 border border-slate-700/40 text-slate-400 hover:text-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm">{error}</div>
      )}

      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
        ) : landings.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            Лендингов пока нет. Создайте первый.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-900/30">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Название</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">URL</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Статус</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Просмотры&nbsp;30д</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Обновлён</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Действия</th>
                </tr>
              </thead>
              <tbody>
                {landings.map(l => (
                  <tr key={l.id} className="border-b border-slate-800/40 hover:bg-slate-800/30 transition">
                    <td className="py-3 px-4">
                      <div className="text-white font-medium">{l.title}</div>
                      <div className="text-xs text-slate-500">#{l.id}</div>
                    </td>
                    <td className="py-3 px-4">
                      <a
                        href={`/p/${l.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-mono text-sm flex items-center gap-1"
                      >
                        /p/{l.slug} <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold ${
                          l.is_published
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-700/60 text-slate-300 border border-slate-600/50'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${l.is_published ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                          {l.is_published ? 'Опубликован' : 'Черновик'}
                        </span>
                        {l.show_in_menu && l.is_published && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            В меню {l.menu_order != null ? `· ${l.menu_order}` : ''}
                          </span>
                        )}
                        {l.is_home && (
                          <span
                            title="Эта страница — главная сайта (открывается по «/»)"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          >
                            <HomeIcon className="w-3 h-3" /> Главная
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={`text-sm font-mono ${l.views_30d > 0 ? 'text-cyan-300' : 'text-slate-600'}`}>
                        {l.views_30d ?? 0}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">{formatDate(l.updated_at)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => togglePublish(l.id)}
                          title={l.is_published ? 'Снять с публикации' : 'Опубликовать'}
                          className="p-2 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition"
                        >
                          {l.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => navigate(`/admin/landings/${l.id}`)}
                          title="Редактировать"
                          className="p-2 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-blue-300 transition"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => remove(l.id)}
                          title="Удалить"
                          className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
