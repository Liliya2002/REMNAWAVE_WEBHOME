import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authFetch } from '../../services/api'

const API = '/api/admin/ruvds'
const LS_ACCOUNT = 'ruvds_active_account'

const Ctx = createContext(null)
export const useRuvds = () => useContext(Ctx)

/**
 * Общее состояние раздела RUVDS: список аккаунтов и активный аккаунт.
 * Выбор аккаунта переживает перезагрузку (localStorage) и общий для всех
 * подстраниц — переключил вверху, и Серверы/Баланс/Ключи показывают его данные.
 */
export function RuvdsProvider({ children }) {
  const [accounts, setAccounts] = useState([])
  const [activeId, setActiveId] = useState(() => {
    const v = localStorage.getItem(LS_ACCOUNT)
    return v ? Number(v) : null
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await authFetch(`${API}/accounts`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось загрузить аккаунты')
      const list = d.accounts || []
      setAccounts(list)
      // Активный аккаунт: сохранённый (если ещё существует) → первый активный → первый
      setActiveId(prev => {
        if (prev && list.some(a => a.id === prev)) return prev
        return (list.find(a => a.is_active) || list[0])?.id ?? null
      })
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  useEffect(() => {
    if (activeId) localStorage.setItem(LS_ACCOUNT, String(activeId))
  }, [activeId])

  const account = accounts.find(a => a.id === activeId) || null

  // Запрос к API активного аккаунта. path — часть после /accounts/:id
  const api = useCallback(async (path, opts = {}) => {
    if (!activeId) throw new Error('Аккаунт RUVDS не выбран')
    const r = await authFetch(`${API}/accounts/${activeId}${path}`, opts)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || `Ошибка ${r.status}`)
    return d
  }, [activeId])

  // Запрос к корню раздела (управление самими аккаунтами)
  const rootApi = useCallback(async (path, opts = {}) => {
    const r = await authFetch(`${API}${path}`, opts)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || `Ошибка ${r.status}`)
    return d
  }, [])

  const canWrite = !!account && (account.role === 'write' || account.role === 'remove')
  const canRemove = !!account && account.role === 'remove'

  return (
    <Ctx.Provider value={{
      accounts, account, activeId, setActiveId,
      loading, error, loadAccounts, api, rootApi,
      canWrite, canRemove,
    }}>
      {children}
    </Ctx.Provider>
  )
}

/**
 * Хук загрузки данных активного аккаунта: сам перезапрашивает при смене
 * аккаунта и даёт reload() для кнопки «Обновить».
 */
export function useRuvdsData(path, { enabled = true, deps = [] } = {}) {
  const { api, activeId } = useRuvds()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!activeId || !enabled || !path) return
    setLoading(true); setError(null)
    try { setData(await api(path)) }
    catch (e) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }, [api, activeId, enabled, path])

  useEffect(() => { reload() }, [reload, ...deps]) // eslint-disable-line

  return { data, loading, error, reload, setData }
}
