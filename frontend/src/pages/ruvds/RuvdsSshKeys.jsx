import React, { useState } from 'react'
import { KeyRound, RefreshCw, Plus, Trash2, X, Lock } from 'lucide-react'
import { useRuvds, useRuvdsData } from './context'
import { Panel, Loading, ErrorBox, Empty, DataList, IconBtn, CopyText } from './ui'

export default function RuvdsSshKeys() {
  const { account, canWrite, api } = useRuvds()
  const { data, loading, error, reload } = useRuvdsData('/ssh-keys')
  const [modal, setModal] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!account) return null
  const keys = data?.ssh_keys || []

  async function del(id) {
    setBusy(true)
    try { await api(`/ssh-keys/${id}`, { method: 'DELETE' }); setConfirmId(null); reload() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  // Отпечаток ключа не приходит от API — показываем хвост, по нему ключ и узнают.
  const shortKey = k => {
    const s = String(k.public_key || '')
    const parts = s.split(/\s+/)
    const body = parts[1] || s
    return body.length > 24 ? `…${body.slice(-24)}` : body
  }

  const cols = [
    { key: 'name', h: 'Название', mobile: 'title', render: k => (
      <span className="text-slate-100 font-medium truncate flex items-center gap-2">
        <KeyRound className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> {k.name || `Ключ #${k.ssh_key_id}`}
      </span>
    ) },
    { key: 'key', h: 'Публичный ключ', mobile: 'sub', render: k => (
      <CopyText value={k.public_key} className="text-slate-400 text-[11px] max-w-[280px]">{shortKey(k)}</CopyText>
    ) },
    { key: 'id', h: 'ID', render: k => <span className="font-mono text-slate-500">{k.ssh_key_id}</span> },
  ]

  const actions = k => canWrite ? (
    confirmId === k.ssh_key_id ? (
      <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <button onClick={() => del(k.ssh_key_id)} disabled={busy}
          className="px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-500/50 text-[11px] font-bold text-rose-300 disabled:opacity-50">Да</button>
        <button onClick={() => setConfirmId(null)}
          className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300">Нет</button>
      </span>
    ) : (
      <IconBtn onClick={e => { e?.stopPropagation?.(); setConfirmId(k.ssh_key_id) }} title="Удалить ключ"
        className="!p-1.5 hover:!text-rose-300"><Trash2 className="w-3.5 h-3.5" /></IconBtn>
    )
  ) : null

  return (
    <div className="space-y-4">
      <Panel
        title="SSH-ключи"
        Icon={KeyRound}
        accent="text-cyan-400"
        ring="bg-cyan-500/10"
        actions={
          <>
            {canWrite && (
              <button onClick={() => setModal(true)}
                className="px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-cyan-500 to-sky-500 text-white rounded-lg flex items-center gap-1.5 hover:shadow-lg hover:shadow-cyan-500/25">
                <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Добавить</span>
              </button>
            )}
            <IconBtn onClick={reload} title="Обновить" spinning={loading}><RefreshCw className="w-4 h-4" /></IconBtn>
          </>
        }
      >
        {!canWrite && (
          <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500 bg-slate-950/40 border border-slate-800/60 rounded-lg px-3 py-2">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            Токен аккаунта имеет права «только чтение» — добавление и удаление ключей недоступно.
          </div>
        )}
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading />
          : keys.length === 0 ? <Empty icon={KeyRound} title="SSH-ключей нет" hint="Добавьте публичный ключ, чтобы использовать его при создании серверов RUVDS." />
          : <DataList cols={cols} rows={keys} keyOf={k => k.ssh_key_id} actions={actions} />}
      </Panel>

      {modal && <AddKeyModal onClose={() => setModal(false)} onSaved={() => { setModal(false); reload() }} />}
    </div>
  )
}

function AddKeyModal({ onClose, onSaved }) {
  const { api } = useRuvds()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const valid = name.trim() && /^(ssh-(rsa|ed25519|dss)|ecdsa-)/.test(key.trim())

  async function save() {
    setSaving(true); setError(null)
    try {
      await api('/ssh-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), public_key: key.trim() }),
      })
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const input = 'w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between shrink-0">
          <h3 className="text-white font-bold flex items-center gap-2"><KeyRound className="w-4 h-4 text-cyan-400" /> Новый SSH-ключ</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto thin-scroll">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Название *</label>
            <input autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="например: рабочий ноутбук" className={input} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Публичный ключ *</label>
            <textarea autoComplete="off" value={key} onChange={e => setKey(e.target.value)} rows={4}
              placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5..." className={input + ' font-mono text-xs'} />
            <p className="text-[11px] text-slate-500 mt-1">Содержимое <code className="text-slate-400">~/.ssh/id_ed25519.pub</code>. Приватный ключ никуда не передаётся.</p>
          </div>
          <ErrorBox error={error} />
        </div>
        <div className="px-5 py-3 border-t border-slate-800/60 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300">Отмена</button>
          <button onClick={save} disabled={!valid || saving}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-cyan-500 to-sky-500 text-white disabled:opacity-50 flex items-center gap-1.5">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Добавить
          </button>
        </div>
      </div>
    </div>
  )
}
