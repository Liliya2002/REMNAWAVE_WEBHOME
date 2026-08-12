import React, { useEffect, useState } from 'react'
import {
  Server, Plus, Trash2, Pencil, Check, X, RefreshCw, AlertCircle,
  ExternalLink, Globe, LayoutDashboard, EyeOff, Eye, GripVertical,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/vps-providers'

/**
 * Справочник провайдеров VPS (Настройки → VPS → Провайдеры).
 * Раньше список был захардкожен в AdminVps.jsx — теперь редактируется здесь,
 * вместе со ссылками на сайт и личный кабинет (для быстрого перехода к оплате).
 */
export default function VpsProvidersSettings() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await authFetch(API)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось загрузить провайдеров')
      setItems(d.providers || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const blank = { name: '', website_url: '', panel_url: '', notes: '', sort_order: 100 }

  function startAdd() { setAdding(true); setEditId(null); setForm({ ...blank }) }
  function startEdit(p) {
    setEditId(p.id); setAdding(false)
    setForm({
      name: p.name || '', website_url: p.website_url || '', panel_url: p.panel_url || '',
      notes: p.notes || '', sort_order: p.sort_order ?? 100,
    })
  }
  function cancel() { setEditId(null); setAdding(false); setForm(null) }

  async function save() {
    if (!form?.name.trim()) return
    setSaving(true); setError(null)
    try {
      const r = await authFetch(adding ? API : `${API}/${editId}`, {
        method: adding ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка сохранения')
      if (d.movedServers > 0) {
        setError(null)
        alert(`Провайдер переименован. Обновлено серверов: ${d.movedServers}`)
      }
      cancel(); load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function toggleActive(p) {
    try {
      const r = await authFetch(`${API}/${p.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !p.is_active }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Ошибка') }
      load()
    } catch (e) { setError(e.message) }
  }

  async function remove(p, force) {
    try {
      const r = await authFetch(`${API}/${p.id}${force ? '?force=1' : ''}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409) {
        // Есть привязанные серверы — предлагаем деактивацию как более мягкий путь.
        const ok = confirm(
          `${d.error}.\n\nСерверы не удалятся и сохранят название провайдера, но он пропадёт из справочника.\n\n` +
          `ОК — всё равно удалить\nОтмена — оставить (лучше просто отключить его)`
        )
        if (ok) return remove(p, true)
        setConfirmDel(null)
        return
      }
      if (!r.ok) throw new Error(d.error || 'Ошибка удаления')
      setConfirmDel(null); load()
    } catch (e) { setError(e.message); setConfirmDel(null) }
  }

  // Перемещение в списке: пересчитываем sort_order соседей.
  async function move(p, dir) {
    const idx = items.findIndex(x => x.id === p.id)
    const swap = items[idx + dir]
    if (!swap) return
    try {
      await Promise.all([
        authFetch(`${API}/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: swap.sort_order }) }),
        authFetch(`${API}/${swap.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: p.sort_order }) }),
      ])
      load()
    } catch (e) { setError(e.message) }
  }

  const input = 'w-full px-2.5 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-400" /> Провайдеры VPS
          </h4>
          <p className="text-xs text-slate-400 mt-1">
            Список для выпадающего меню при добавлении сервера. Ссылки на сайт и кабинет
            доступны прямо из карточки VPS — удобно при продлении.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} title="Обновить"
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={startAdd} disabled={adding}
            className="px-3 py-2 text-xs font-bold bg-gradient-to-r from-cyan-500 to-sky-500 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Добавить
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span className="min-w-0">{error}</span>
        </div>
      )}

      {/* Форма добавления */}
      {adding && (
        <ProviderForm form={form} setForm={setForm} onSave={save} onCancel={cancel} saving={saving} input={input} isNew />
      )}

      {loading && items.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Загрузка…
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-slate-500 text-sm">Провайдеров пока нет</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((p, i) => editId === p.id ? (
            <ProviderForm key={p.id} form={form} setForm={setForm} onSave={save} onCancel={cancel} saving={saving} input={input} />
          ) : (
            <div key={p.id}
              className={`rounded-xl border p-3 transition-colors ${p.is_active
                ? 'border-slate-800/60 bg-slate-950/40'
                : 'border-slate-800/40 bg-slate-950/20 opacity-60'}`}>
              <div className="flex items-center gap-2.5">
                {/* Порядок */}
                <div className="flex flex-col shrink-0">
                  <button onClick={() => move(p, -1)} disabled={i === 0}
                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 leading-none text-[10px]">▲</button>
                  <button onClick={() => move(p, 1)} disabled={i === items.length - 1}
                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 leading-none text-[10px]">▼</button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-100 truncate">{p.name}</span>
                    {p.servers_count > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800/70 text-slate-300">
                        {p.servers_count} {p.servers_count === 1 ? 'сервер' : 'серв.'}
                      </span>
                    )}
                    {!p.is_active && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/60 text-slate-400">скрыт</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {p.website_url && (
                      <a href={p.website_url} target="_blank" rel="noreferrer"
                        className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1">
                        <Globe className="w-3 h-3" /> сайт <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {p.panel_url && (
                      <a href={p.panel_url} target="_blank" rel="noreferrer"
                        className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1">
                        <LayoutDashboard className="w-3 h-3" /> кабинет <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {p.notes && <span className="text-[11px] text-slate-500 truncate max-w-[240px]">{p.notes}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleActive(p)} title={p.is_active ? 'Скрыть из списка' : 'Показывать в списке'}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60">
                    {p.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => startEdit(p)} title="Изменить"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {confirmDel === p.id ? (
                    <span className="flex items-center gap-1">
                      <button onClick={() => remove(p)} className="px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-500/50 text-[11px] font-bold text-rose-300">Да</button>
                      <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300">Нет</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDel(p.id)} title="Удалить"
                      className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderForm({ form, setForm, onSave, onCancel, saving, input, isNew }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-3 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Название *</label>
          <input autoFocus autoComplete="off" value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="Например: Hetzner" className={input} />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Официальный сайт</label>
          <input autoComplete="off" value={form.website_url} onChange={e => set('website_url', e.target.value)}
            placeholder="hetzner.com" className={input} />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Личный кабинет</label>
          <input autoComplete="off" value={form.panel_url} onChange={e => set('panel_url', e.target.value)}
            placeholder="console.hetzner.cloud" className={input} />
        </div>
      </div>
      <div>
        <label className="block text-[11px] text-slate-400 mb-1">Заметки</label>
        <input autoComplete="off" value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Условия оплаты, реквизиты, особенности" className={input} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">Протокол в ссылках подставится сам</span>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> Отмена
          </button>
          <button onClick={onSave} disabled={saving || !form.name.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-cyan-500 to-sky-500 text-white disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {isNew ? 'Добавить' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
