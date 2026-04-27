import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, User, Mail, Shield, ShieldOff, Calendar, Wallet,
  Clock, CreditCard, Save, Plus, RefreshCw, Trash2, Crown, Ban, CheckCircle,
  Info, Database, Server, AlertTriangle
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

function authHeaders() {
  return {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(`${API}${url}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } })
  return res
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatShortDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU')
}

function daysLeft(d) {
  if (!d) return null
  const diff = Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24))
  return diff
}

export default function AdminUserCard() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // User data
  const [userData, setUserData] = useState(null)
  const [subscriptions, setSubscriptions] = useState([])
  const [balance, setBalance] = useState(0)
  const [payments, setPayments] = useState([])
  const [walletTx, setWalletTx] = useState([])

  // Edit state
  const [editLogin, setEditLogin] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editIsAdmin, setEditIsAdmin] = useState(false)
  const [editIsActive, setEditIsActive] = useState(true)
  const [editBalance, setEditBalance] = useState('')
  const [balanceReason, setBalanceReason] = useState('')

  // Extend subscription
  const [extendDays, setExtendDays] = useState(30)
  const [extendSubId, setExtendSubId] = useState(null)
  const [extending, setExtending] = useState(false)

  // Create subscription
  const [plans, setPlans] = useState([])
  const [newPlanId, setNewPlanId] = useState('')
  const [newPeriod, setNewPeriod] = useState('monthly')
  const [creating, setCreating] = useState(false)

  // Sync Remnwave
  const [syncingSubId, setSyncingSubId] = useState(null)

  // Remnwave info tab
  const [remnwaveInfo, setRemnwaveInfo] = useState(null)
  const [remnwaveLoading, setRemnwaveLoading] = useState(false)
  const [remnwaveError, setRemnwaveError] = useState(null)

  // Active tab
  const [tab, setTab] = useState('info')

  async function loadUser() {
    try {
      setLoading(true)
      setError(null)
      const res = await apiFetch(`/api/admin/users/${id}`)
      if (!res.ok) throw new Error('Пользователь не найден')
      const data = await res.json()

      setUserData(data.user)
      setSubscriptions(data.subscriptions || [])
      setBalance(Number(data.balance || 0))
      setPayments(data.payments || [])
      setWalletTx(data.walletTransactions || [])

      setEditLogin(data.user.login)
      setEditEmail(data.user.email)
      setEditIsAdmin(data.user.is_admin)
      setEditIsActive(data.user.is_active)
      setEditBalance(String(data.balance || 0))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPlans() {
    try {
      const res = await apiFetch('/api/admin/users/plans/list')
      if (res.ok) {
        const data = await res.json()
        setPlans(data.plans || [])
      }
    } catch (_) {}
  }

  useEffect(() => {
    loadUser()
    loadPlans()
  }, [id])

  function showSuccess(msg) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  // Save user info
  async function handleSaveUser() {
    try {
      setSaving(true)
      setError(null)
      const res = await apiFetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          login: editLogin,
          email: editEmail,
          is_admin: editIsAdmin,
          is_active: editIsActive
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      showSuccess('Данные пользователя сохранены')
      loadUser()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Save balance
  async function handleSaveBalance() {
    try {
      setSaving(true)
      setError(null)
      const res = await apiFetch(`/api/admin/users/${id}/balance`, {
        method: 'PUT',
        body: JSON.stringify({ amount: editBalance, reason: balanceReason })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления баланса')
      showSuccess(`Баланс обновлен: ${data.balance} ₽`)
      setBalanceReason('')
      loadUser()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Extend subscription
  async function handleExtend(subId) {
    try {
      setExtending(true)
      setError(null)
      const res = await apiFetch(`/api/admin/users/${id}/subscription/extend`, {
        method: 'PUT',
        body: JSON.stringify({ days: extendDays, subscriptionId: subId })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка продления')
      showSuccess(`Подписка продлена до ${formatShortDate(data.newExpiresAt)}`)
      loadUser()
    } catch (err) {
      setError(err.message)
    } finally {
      setExtending(false)
    }
  }

  // Load Remnwave info (for comparison tab)
  async function loadRemnwaveInfo() {
    try {
      setRemnwaveLoading(true)
      setRemnwaveError(null)
      const res = await apiFetch(`/api/admin/users/${id}/remnwave-info`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки Remnwave')
      setRemnwaveInfo(data)
    } catch (err) {
      setRemnwaveError(err.message)
      setRemnwaveInfo(null)
    } finally {
      setRemnwaveLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'remnwave' && !remnwaveInfo && !remnwaveLoading) {
      loadRemnwaveInfo()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Sync Remnwave with DB (repair tool)
  async function handleSyncRemnwave(subId) {
    try {
      setSyncingSubId(subId)
      setError(null)
      const res = await apiFetch(`/api/admin/users/${id}/subscription/sync-remnwave`, {
        method: 'POST',
        body: JSON.stringify({ subscriptionId: subId })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка синхронизации')
      showSuccess('Remnwave синхронизирован с данными БД')
      loadUser()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncingSubId(null)
    }
  }

  // Create subscription
  async function handleCreateSub() {
    if (!newPlanId) { setError('Выберите тариф'); return }
    try {
      setCreating(true)
      setError(null)
      const res = await apiFetch(`/api/admin/users/${id}/subscription/create`, {
        method: 'POST',
        body: JSON.stringify({ planId: Number(newPlanId), period: newPeriod })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка создания подписки')
      showSuccess('Подписка активирована!')
      loadUser()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    )
  }

  if (!userData) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate('/admin/users')} className="flex items-center gap-2 text-slate-400 hover:text-white transition">
          <ArrowLeft className="w-5 h-5" /> Назад к списку
        </button>
        <div className="text-center py-20 text-red-400 text-lg">{error || 'Пользователь не найден'}</div>
      </div>
    )
  }

  const activeSub = subscriptions.find(s => s.is_active)
  const days = activeSub ? daysLeft(activeSub.expires_at) : null

  const tabs = [
    { id: 'info', label: 'Профиль', icon: User },
    { id: 'subscription', label: 'Подписка', icon: Shield },
    { id: 'balance', label: 'Баланс', icon: Wallet },
    { id: 'history', label: 'История', icon: Clock },
    { id: 'remnwave', label: 'Информация', icon: Info },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <button onClick={() => navigate('/admin/users')} className="flex items-center gap-2 text-slate-400 hover:text-white transition text-sm">
          <ArrowLeft className="w-4 h-4" /> Назад к списку
        </button>
        <button
          onClick={loadUser}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700/60 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-600 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Обновить
        </button>
      </div>

      {/* Alerts */}
      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/40 rounded-xl text-green-400 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" /> {success}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <Ban className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}

      {/* User header card */}
      <div className="bg-gradient-to-r from-slate-800/60 to-slate-900/60 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shrink-0">
            <User className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-bold text-white">{userData.login}</h2>
              <span className="text-xs text-slate-500">ID: {userData.id}</span>
              {userData.is_admin && (
                <span className="px-2 py-0.5 bg-purple-500/20 border border-purple-500/50 rounded text-[10px] text-purple-400 font-bold flex items-center gap-1"><Crown className="w-3 h-3" /> ADMIN</span>
              )}
              {!userData.is_active && (
                <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/50 rounded text-[10px] text-red-400 font-bold">ЗАБЛОКИРОВАН</span>
              )}
            </div>
            <p className="text-slate-400 text-sm mt-1">{userData.email}</p>
            <p className="text-slate-500 text-xs mt-1">Зарегистрирован: {formatDate(userData.created_at)}</p>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3 shrink-0">
            <div className="text-center p-3 rounded-xl bg-slate-900/50 border border-slate-700/40">
              <div className="text-lg font-bold text-cyan-400">{balance.toFixed(0)} ₽</div>
              <div className="text-[10px] text-slate-500 uppercase">Баланс</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-900/50 border border-slate-700/40">
              <div className={`text-lg font-bold ${activeSub ? 'text-green-400' : 'text-red-400'}`}>{activeSub ? 'Да' : 'Нет'}</div>
              <div className="text-[10px] text-slate-500 uppercase">Подписка</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-900/50 border border-slate-700/40">
              <div className={`text-lg font-bold ${days !== null && days > 0 ? 'text-white' : 'text-slate-600'}`}>{days !== null ? (days > 0 ? days : 0) : '—'}</div>
              <div className="text-[10px] text-slate-500 uppercase">Дней</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5 ${
              tab === t.id
                ? 'bg-blue-500/20 border border-blue-500/50 text-blue-300'
                : 'bg-slate-800/40 border border-slate-700/40 text-slate-400 hover:text-slate-300'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-6">

        {/* === TAB: Профиль === */}
        {tab === 'info' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><User className="w-5 h-5 text-blue-400" /> Редактирование профиля</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Логин</label>
                <input
                  value={editLogin}
                  onChange={e => setEditLogin(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-white focus:border-blue-500 focus:outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-white focus:border-blue-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 p-4 rounded-xl bg-slate-900/40 border border-slate-700/40 cursor-pointer hover:border-purple-500/40 transition">
                <input
                  type="checkbox"
                  checked={editIsAdmin}
                  onChange={e => setEditIsAdmin(e.target.checked)}
                  className="w-4 h-4 rounded accent-purple-500"
                />
                <div>
                  <div className="text-sm text-white font-medium flex items-center gap-1.5"><Crown className="w-4 h-4 text-purple-400" /> Администратор</div>
                  <div className="text-xs text-slate-500">Доступ к админ-панели</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-4 rounded-xl bg-slate-900/40 border border-slate-700/40 cursor-pointer hover:border-green-500/40 transition">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={e => setEditIsActive(e.target.checked)}
                  className="w-4 h-4 rounded accent-green-500"
                />
                <div>
                  <div className="text-sm text-white font-medium flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-400" /> Активен</div>
                  <div className="text-xs text-slate-500">Разрешить вход в систему</div>
                </div>
              </label>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveUser}
                disabled={saving}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить профиль'}
              </button>
            </div>
          </div>
        )}

        {/* === TAB: Подписка === */}
        {tab === 'subscription' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Shield className="w-5 h-5 text-green-400" /> Управление подпиской</h3>

            {/* Existing subscriptions */}
            {subscriptions.length === 0 ? (
              <div className="text-slate-400 text-sm p-4 bg-slate-900/40 rounded-xl border border-slate-700/40 text-center">
                У пользователя нет подписок
              </div>
            ) : (
              <div className="space-y-3">
                {subscriptions.map(sub => {
                  const d = daysLeft(sub.expires_at)
                  const isExpired = d !== null && d <= 0
                  return (
                    <div key={sub.id} className={`p-4 rounded-xl border ${sub.is_active && !isExpired ? 'border-green-500/30 bg-green-500/5' : 'border-slate-700/40 bg-slate-900/40'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${sub.is_active && !isExpired ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></span>
                            <span className="text-white font-semibold">{sub.plan_name}</span>
                            <span className="text-xs text-slate-500">#{sub.id}</span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            Истекает: <span className={isExpired ? 'text-red-400' : 'text-slate-300'}>{formatDate(sub.expires_at)}</span>
                            {d !== null && <span className="ml-2">({isExpired ? 'Истекла' : `${d} дн.`})</span>}
                          </div>
                          {sub.traffic_limit_gb > 0 && (
                            <div className="text-xs text-slate-500 mt-0.5">Трафик: {sub.traffic_used_gb || 0} / {sub.traffic_limit_gb} ГБ</div>
                          )}
                          <div className="text-[11px] mt-1 flex items-center gap-1.5">
                            {sub.remnwave_user_uuid ? (
                              <span className="text-slate-500">Remnwave: <span className="text-slate-400 font-mono">{String(sub.remnwave_user_uuid).slice(0, 8)}…</span></span>
                            ) : (
                              <span className="text-amber-400">Remnwave не привязан — синхронизируйте</span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              max="3650"
                              value={extendSubId === sub.id ? extendDays : 30}
                              onChange={e => { setExtendDays(Number(e.target.value)); setExtendSubId(sub.id) }}
                              onFocus={() => setExtendSubId(sub.id)}
                              className="w-20 px-2 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white text-center"
                              placeholder="Дни"
                            />
                            <button
                              onClick={() => handleExtend(sub.id)}
                              disabled={extending}
                              className="px-3 py-1.5 text-sm bg-green-500/20 border border-green-500/40 text-green-400 rounded-lg hover:bg-green-500/30 transition disabled:opacity-50 flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> {extending ? '...' : 'Продлить'}
                            </button>
                          </div>
                          <button
                            onClick={() => handleSyncRemnwave(sub.id)}
                            disabled={syncingSubId === sub.id}
                            title="Привести Remnwave в соответствие с нашей БД (без изменения сроков)"
                            className="px-3 py-1.5 text-sm bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-lg hover:bg-cyan-500/25 transition disabled:opacity-50 flex items-center gap-1"
                          >
                            <RefreshCw className={`w-3 h-3 ${syncingSubId === sub.id ? 'animate-spin' : ''}`} />
                            {syncingSubId === sub.id ? '...' : 'Синхронизировать с Remnwave'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Create new subscription */}
            <div className="border-t border-slate-700/40 pt-6">
              <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-400" /> Создать подписку</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Тариф</label>
                  <select
                    value={newPlanId}
                    onChange={e => setNewPlanId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                  >
                    <option value="">Выберите тариф...</option>
                    {plans.filter(p => !p.is_trial).map(p => (
                      <option key={p.id} value={p.id}>{p.name} — {Number(p.price_monthly || 0)}₽/мес</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Период</label>
                  <select
                    value={newPeriod}
                    onChange={e => setNewPeriod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                  >
                    <option value="monthly">Месяц</option>
                    <option value="quarterly">3 месяца</option>
                    <option value="yearly">Год</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleCreateSub}
                    disabled={creating || !newPlanId}
                    className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-semibold text-sm disabled:opacity-50 hover:shadow-lg hover:shadow-blue-500/30 transition flex items-center justify-center gap-1.5"
                  >
                    <CreditCard className="w-4 h-4" /> {creating ? 'Создание...' : 'Активировать'}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Подписка будет создана бесплатно (от имени админа). Пользователь сразу получит доступ.</p>
            </div>
          </div>
        )}

        {/* === TAB: Баланс === */}
        {tab === 'balance' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Wallet className="w-5 h-5 text-cyan-400" /> Управление балансом</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-cyan-500/25 bg-[radial-gradient(circle_at_20%_15%,rgba(34,211,238,0.15),transparent_40%),rgba(2,6,23,0.85)] p-6">
                <div className="text-xs text-cyan-300 uppercase tracking-widest mb-2">Текущий баланс</div>
                <div className="text-4xl font-extrabold text-white">{balance.toFixed(2)} ₽</div>
              </div>

              <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 p-6">
                <div className="text-sm text-slate-300 mb-3">Изменить баланс</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Новый баланс (₽)</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={editBalance}
                      onChange={e => setEditBalance(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Причина (необязательно)</label>
                    <input
                      value={balanceReason}
                      onChange={e => setBalanceReason(e.target.value)}
                      placeholder="Например: начисление бонуса"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-600"
                    />
                  </div>
                  <button
                    onClick={handleSaveBalance}
                    disabled={saving}
                    className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-lg font-semibold text-sm disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить баланс'}
                  </button>
                </div>
              </div>
            </div>

            {/* Wallet transactions */}
            {walletTx.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-3">Транзакции кошелька</h4>
                <div className="space-y-1.5">
                  {walletTx.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-900/40 border border-slate-700/30">
                      <div>
                        <div className="text-sm text-slate-200">{tx.description || tx.type}</div>
                        <div className="text-[10px] text-slate-500">{formatDate(tx.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold text-sm ${tx.direction === 'in' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {tx.direction === 'in' ? '+' : '-'}{Number(tx.amount).toFixed(2)} ₽
                        </div>
                        <div className="text-[10px] text-slate-500">{Number(tx.balance_before).toFixed(0)} → {Number(tx.balance_after).toFixed(0)} ₽</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* === TAB: Информация (сравнение БД vs Remnwave) === */}
        {tab === 'remnwave' && (() => {
          const activeSubForCompare = subscriptions.find(s => s.is_active) || subscriptions[0] || null
          const rw = remnwaveInfo?.remnwave || null

          const bytesToGB = b => (b != null ? (Number(b) / (1024 ** 3)) : null)
          const fmtGB = g => (g == null ? '—' : `${Number(g).toFixed(g >= 10 ? 0 : 2)} ГБ`)
          const fmtBool = b => (b == null ? '—' : (b ? 'Да' : 'Нет'))

          const dbExpireMs = activeSubForCompare?.expires_at ? new Date(activeSubForCompare.expires_at).getTime() : null
          const rwExpireMs = rw?.expireAt ? new Date(rw.expireAt).getTime() : null
          const expireDiffMin = (dbExpireMs && rwExpireMs) ? Math.abs(dbExpireMs - rwExpireMs) / 60000 : null
          const expireMismatch = expireDiffMin != null && expireDiffMin > 60 // больше часа

          const rwLimitGb = bytesToGB(rw?.trafficLimitBytes)
          const trafficMismatch = (activeSubForCompare && rw) && Math.abs((activeSubForCompare.traffic_limit_gb || 0) - (rwLimitGb || 0)) > 0.5

          const rwSquadUuids = (rw?.activeInternalSquads || []).map(s => s.uuid)
          const squadMismatch = (activeSubForCompare && rw) && activeSubForCompare.squad_uuid && !rwSquadUuids.includes(activeSubForCompare.squad_uuid)

          const rwIsActive = rw?.status === 'ACTIVE'
          const isExpiredNow = dbExpireMs && dbExpireMs < Date.now()
          const dbIsActive = !!activeSubForCompare?.is_active && !isExpiredNow
          const statusMismatch = activeSubForCompare && rw && (dbIsActive !== rwIsActive)

          const uuidMismatch = activeSubForCompare && rw && activeSubForCompare.remnwave_user_uuid && activeSubForCompare.remnwave_user_uuid !== rw.uuid
          const uuidMissing = activeSubForCompare && rw && !activeSubForCompare.remnwave_user_uuid

          const mismatches = []
          if (uuidMissing) mismatches.push('В БД не сохранён Remnwave UUID')
          if (uuidMismatch) mismatches.push('UUID в БД и Remnwave не совпадают')
          if (expireMismatch) mismatches.push(`Дата истечения расходится на ${Math.round(expireDiffMin / 60)} ч.`)
          if (trafficMismatch) mismatches.push(`Лимит трафика расходится: БД ${activeSubForCompare?.traffic_limit_gb} ГБ vs Remnwave ${fmtGB(rwLimitGb)}`)
          if (squadMismatch) mismatches.push('Squad в БД не входит в активные squads Remnwave')
          if (statusMismatch) mismatches.push(`Статус расходится: БД ${dbIsActive ? 'активна' : 'неактивна'} vs Remnwave ${rw?.status}`)

          const Row = ({ label, value, mono = false, mismatch = false }) => (
            <div className={`flex items-start justify-between gap-3 py-2 px-3 rounded-lg ${mismatch ? 'bg-red-500/10 border border-red-500/30' : 'bg-slate-900/40 border border-slate-800/60'}`}>
              <span className="text-xs text-slate-400 shrink-0 pt-0.5">{label}</span>
              <span className={`text-sm text-right break-all ${mismatch ? 'text-red-300' : 'text-slate-100'} ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</span>
            </div>
          )

          return (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-400" /> Сравнение БД ↔ Remnwave
                </h3>
                <button
                  onClick={loadRemnwaveInfo}
                  disabled={remnwaveLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700/60 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-600 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${remnwaveLoading ? 'animate-spin' : ''}`} /> Обновить
                </button>
              </div>

              {remnwaveLoading && !remnwaveInfo && (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
                </div>
              )}

              {remnwaveError && (
                <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm">
                  {remnwaveError}
                </div>
              )}

              {!remnwaveLoading && !activeSubForCompare && (
                <div className="p-4 bg-slate-900/40 border border-slate-700/40 rounded-xl text-slate-400 text-sm text-center">
                  У пользователя нет подписок — нечего сравнивать
                </div>
              )}

              {remnwaveInfo && !remnwaveInfo.found && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-xl text-amber-300 text-sm flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  {remnwaveInfo.message || 'В Remnwave нет пользователя с username userweb_' + id}
                </div>
              )}

              {mismatches.length > 0 && (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
                  <div className="flex items-center gap-2 text-red-300 font-semibold text-sm mb-2">
                    <AlertTriangle className="w-4 h-4" /> Найдены расхождения ({mismatches.length})
                  </div>
                  <ul className="space-y-1 text-xs text-red-200 list-disc list-inside">
                    {mismatches.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                  {activeSubForCompare && (
                    <button
                      onClick={() => handleSyncRemnwave(activeSubForCompare.id)}
                      disabled={syncingSubId === activeSubForCompare.id}
                      className="mt-3 px-3 py-1.5 text-sm bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-lg hover:bg-cyan-500/25 transition disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${syncingSubId === activeSubForCompare.id ? 'animate-spin' : ''}`} />
                      {syncingSubId === activeSubForCompare.id ? 'Синхронизация...' : 'Привести Remnwave к БД'}
                    </button>
                  )}
                </div>
              )}

              {mismatches.length === 0 && remnwaveInfo?.found && activeSubForCompare && (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-emerald-300 text-sm flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 shrink-0" /> БД и Remnwave синхронизированы
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* БД колонка */}
                <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-slate-900/40 p-5">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700/40">
                    <Database className="w-5 h-5 text-blue-400" />
                    <h4 className="text-white font-bold">Наша БД</h4>
                    <span className="ml-auto text-[10px] text-slate-500 uppercase">subscriptions</span>
                  </div>

                  {activeSubForCompare ? (
                    <div className="space-y-1.5">
                      <Row label="ID записи" value={`#${activeSubForCompare.id}`} />
                      <Row label="Тариф" value={activeSubForCompare.plan_name} />
                      <Row label="Активна" value={fmtBool(dbIsActive)} mismatch={statusMismatch} />
                      <Row label="Истекает" value={formatDate(activeSubForCompare.expires_at)} mismatch={expireMismatch} />
                      <Row label="Лимит трафика" value={`${activeSubForCompare.traffic_limit_gb || 0} ГБ`} mismatch={trafficMismatch} />
                      <Row label="Использовано" value={`${activeSubForCompare.traffic_used_gb || 0} ГБ`} />
                      <Row label="Squad UUID" value={activeSubForCompare.squad_uuid} mono mismatch={squadMismatch} />
                      <Row label="Remnwave UUID" value={activeSubForCompare.remnwave_user_uuid} mono mismatch={uuidMismatch || uuidMissing} />
                      <Row label="Username" value={activeSubForCompare.remnwave_username} mono />
                      <Row label="Subscription URL" value={activeSubForCompare.subscription_url} mono />
                      <Row label="Создана" value={formatDate(activeSubForCompare.created_at)} />
                      <Row label="Обновлена" value={formatDate(activeSubForCompare.updated_at)} />
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-sm">Подписок нет</div>
                  )}
                </div>

                {/* Remnwave колонка */}
                <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-slate-900/40 p-5">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700/40">
                    <Server className="w-5 h-5 text-cyan-400" />
                    <h4 className="text-white font-bold">Remnwave Panel</h4>
                    <span className="ml-auto text-[10px] text-slate-500 uppercase">live</span>
                  </div>

                  {rw ? (
                    <div className="space-y-1.5">
                      <Row label="Remnwave ID" value={`#${rw.id}`} />
                      <Row label="Username" value={rw.username} mono />
                      <Row label="Статус" value={rw.status} mismatch={statusMismatch} />
                      <Row label="Истекает" value={formatDate(rw.expireAt)} mismatch={expireMismatch} />
                      <Row label="Лимит трафика" value={fmtGB(rwLimitGb)} mismatch={trafficMismatch} />
                      <Row
                        label="Использовано"
                        value={fmtGB(bytesToGB(rw.userTraffic?.usedTrafficBytes))}
                      />
                      <Row label="Traffic Strategy" value={rw.trafficLimitStrategy} />
                      <Row
                        label="Squads"
                        value={
                          (rw.activeInternalSquads || []).length === 0
                            ? '—'
                            : rw.activeInternalSquads.map(s => s.name || s.uuid).join(', ')
                        }
                        mismatch={squadMismatch}
                      />
                      <Row label="UUID" value={rw.uuid} mono mismatch={uuidMismatch} />
                      <Row label="Short UUID" value={rw.shortUuid} mono />
                      <Row label="Subscription URL" value={rw.subscriptionUrl} mono />
                      <Row label="Последнее подключение" value={formatDate(rw.userTraffic?.onlineAt)} />
                      <Row label="Создан" value={formatDate(rw.createdAt)} />
                      <Row label="Обновлён" value={formatDate(rw.updatedAt)} />
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-sm">
                      {remnwaveLoading ? 'Загрузка...' : 'Нет данных из Remnwave'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {/* === TAB: История === */}
        {tab === 'history' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Clock className="w-5 h-5 text-yellow-400" /> История платежей</h3>

            {payments.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-8">Платежей нет</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">ID</th>
                      <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Тариф</th>
                      <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Сумма</th>
                      <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Тип</th>
                      <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Статус</th>
                      <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="py-2 px-3 text-slate-500">#{p.id}</td>
                        <td className="py-2 px-3 text-white">{p.plan_name || '—'}</td>
                        <td className="py-2 px-3 text-slate-200 font-medium">{Number(p.amount).toFixed(0)} ₽</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            p.payment_source === 'admin' ? 'bg-purple-500/20 text-purple-400' :
                            p.payment_type === 'topup' ? 'bg-cyan-500/20 text-cyan-400' :
                            p.payment_source === 'balance' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {p.payment_source === 'admin' ? 'Админ' :
                             p.payment_type === 'topup' ? 'Пополнение' :
                             p.payment_source === 'balance' ? 'С баланса' : 'Картой'}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            p.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                            p.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>{p.status}</span>
                        </td>
                        <td className="py-2 px-3 text-slate-500 text-xs">{formatDate(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
