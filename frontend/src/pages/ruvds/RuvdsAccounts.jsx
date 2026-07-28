import React, { useState } from 'react'
import {
  Users2, Plus, Pencil, Trash2, X, RefreshCw, Wifi, Eye, EyeOff,
  ShieldCheck, Check, ExternalLink,
} from 'lucide-react'
import { useRuvds } from './context'
import { Panel, Loading, ErrorBox, Empty, IconBtn, fmtMoney, card } from './ui'

const EMPTY = { name: '', api_token: '', role: 'read', notes: '' }
const ROLES = [
  { key: 'read',   label: 'Только чтение', hint: 'GET-запросы: серверы, баланс, статистика' },
  { key: 'write',  label: 'Запись',        hint: '+ создание и изменение серверов, SSH-ключи' },
  { key: 'remove', label: 'Полный доступ', hint: '+ удаление серверов' },
]

export default function RuvdsAccounts() {
  const { accounts, loading, error, loadAccounts, rootApi, activeId, setActiveId } = useRuvds()
  const [modal, setModal] = useState(null)      // { editId, form }
  const [confirmDel, setConfirmDel] = useState(null)
  const [tests, setTests] = useState({})

  async function test(id) {
    setTests(t => ({ ...t, [id]: { loading: true } }))
    try {
      const d = await rootApi(`/accounts/${id}/test`, { method: 'POST' })
      setTests(t => ({ ...t, [id]: { loading: false, ...d } }))
    } catch (e) {
      setTests(t => ({ ...t, [id]: { loading: false, ok: false, error: e.message } }))
    }
  }

  async function del(id) {
    try { await rootApi(`/accounts/${id}`, { method: 'DELETE' }); setConfirmDel(null); loadAccounts() }
    catch (e) { alert(e.message) }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Аккаунты RUVDS"
        Icon={Users2}
        accent="text-orange-400"
        ring="bg-orange-500/10"
        actions={
          <>
            <button onClick={() => setModal({ editId: null, form: { ...EMPTY } })}
              className="px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg flex items-center gap-1.5 hover:shadow-lg hover:shadow-orange-500/25">
              <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Аккаунт</span>
            </button>
            <IconBtn onClick={loadAccounts} title="Обновить" spinning={loading}><RefreshCw className="w-4 h-4" /></IconBtn>
          </>
        }
      >
        <ErrorBox error={error} onRetry={loadAccounts} />
        {loading && accounts.length === 0 ? <Loading />
          : accounts.length === 0 ? (
            <Empty icon={Users2} title="Аккаунтов нет"
              hint="Добавьте аккаунт RUVDS: нужен API-токен из ruvds.com/my/settings/api. Можно подключить несколько кабинетов и переключаться между ними вверху страницы." />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {accounts.map(a => {
                const t = tests[a.id]
                const role = ROLES.find(r => r.key === a.role) || ROLES[0]
                const isActive = a.id === activeId
                return (
                  <div key={a.id} className={`rounded-xl border p-3.5 transition-colors ${isActive ? 'border-orange-500/40 bg-orange-500/[0.06]' : 'border-slate-800/60 bg-slate-950/40'}`}>
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/30 to-red-500/20 border border-orange-500/30 flex items-center justify-center text-sm font-bold text-orange-200 shrink-0">
                        {a.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white truncate">{a.name}</span>
                          {isActive && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 border border-orange-500/40 text-orange-300">активный</span>}
                          {!a.is_active && <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/60 text-slate-400">выкл</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {role.label}
                        </div>
                        {a.notes && <div className="text-[11px] text-slate-500 mt-1 truncate">{a.notes}</div>}
                      </div>
                    </div>

                    {/* Результат теста связи */}
                    {t && !t.loading && (
                      <div className={`mt-2.5 text-[11px] rounded-lg px-2.5 py-1.5 border ${t.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
                        {t.ok
                          ? <>Связь есть{t.balance ? ` · баланс ${fmtMoney((t.balance.balance ?? t.balance)?.amount, '₽')}` : ''}</>
                          : <>Ошибка: {t.error}</>}
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {!isActive && (
                        <button onClick={() => setActiveId(a.id)}
                          className="px-2.5 py-1.5 text-[11px] rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white flex items-center gap-1">
                          <Check className="w-3 h-3" /> Выбрать
                        </button>
                      )}
                      <button onClick={() => test(a.id)}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white flex items-center gap-1">
                        {t?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />} Тест
                      </button>
                      <button onClick={() => setModal({ editId: a.id, form: { name: a.name, api_token: '', role: a.role, notes: a.notes || '', is_active: a.is_active } })}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-orange-300 hover:bg-slate-800/60"><Pencil className="w-3.5 h-3.5" /></button>
                      {confirmDel === a.id ? (
                        <span className="flex items-center gap-1 ml-auto">
                          <button onClick={() => del(a.id)} className="px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-500/50 text-[11px] font-bold text-rose-300">Да</button>
                          <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300">Нет</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDel(a.id)} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 ml-auto"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </Panel>

      {modal && <AccountModal modal={modal} setModal={setModal} onSaved={() => { setModal(null); loadAccounts() }} />}
    </div>
  )
}

function AccountModal({ modal, setModal, onSaved }) {
  const { rootApi } = useRuvds()
  const f = modal.form
  const set = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [show, setShow] = useState(false)

  const isEdit = !!modal.editId
  const valid = f.name.trim() && (isEdit || f.api_token.trim())

  async function save() {
    setSaving(true); setError(null)
    try {
      const body = { ...f }
      if (isEdit && !body.api_token) delete body.api_token
      await rootApi(`/accounts${isEdit ? '/' + modal.editId : ''}`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const input = 'w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setModal(null)} />
      <div className="relative w-full sm:max-w-lg bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between shrink-0">
          <h3 className="text-white font-bold">{isEdit ? 'Изменить аккаунт' : 'Новый аккаунт RUVDS'}</h3>
          <button onClick={() => setModal(null)} className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto thin-scroll">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Название *</label>
            <input autoComplete="off" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Основной кабинет" className={input} />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">API-токен {isEdit ? '' : '*'}</label>
            <div className="relative">
              <input autoComplete="new-password" type={show ? 'text' : 'password'} value={f.api_token}
                onChange={e => set('api_token', e.target.value)}
                placeholder={isEdit ? 'оставьте пустым чтобы не менять' : 'токен из личного кабинета'}
                className={input + ' pr-9 font-mono'} />
              <button type="button" onClick={() => setShow(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <a href="https://ruvds.com/my/settings/api" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 mt-1.5">
              <ExternalLink className="w-3 h-3" /> Создать токен в кабинете RUVDS
            </a>
            <p className="text-[11px] text-slate-500 mt-1">Токен показывается в RUVDS только один раз при создании — сохраните его сразу.</p>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Права токена</label>
            <div className="space-y-1.5">
              {ROLES.map(r => (
                <button key={r.key} type="button" onClick={() => set('role', r.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    f.role === r.key ? 'bg-orange-500/10 border-orange-500/40' : 'bg-slate-950/40 border-slate-800/60 hover:border-slate-700'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${f.role === r.key ? 'border-orange-400 bg-orange-400' : 'border-slate-600'}`} />
                    <span className="text-xs font-semibold text-slate-100">{r.label}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 pl-5.5">{r.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">Должно совпадать с правами, выбранными при создании токена в RUVDS — от этого зависит, какие кнопки показывать.</p>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={f.is_active !== false} onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 rounded bg-slate-950 border-slate-700" />
              Аккаунт активен
            </label>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Заметки</label>
            <textarea autoComplete="off" value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} className={input} />
          </div>

          <ErrorBox error={error} />
        </div>

        <div className="px-5 py-3 border-t border-slate-800/60 flex justify-end gap-2 shrink-0">
          <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-300">Отмена</button>
          <button onClick={save} disabled={!valid || saving}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-orange-500 to-red-500 text-white disabled:opacity-50 flex items-center gap-1.5">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
