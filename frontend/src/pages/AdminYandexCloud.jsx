import React, { useEffect, useMemo, useState, useRef } from 'react'
import {
  Cloud, Plus, Pencil, Trash2, Power, X, Save, RefreshCw, Eye, EyeOff,
  CheckCircle2, AlertCircle, KeyRound, Globe, Wallet, Search, Activity,
  Wifi, ShieldOff, Lock, Info, ExternalLink, Copy,
  Play, Square, RotateCw, Cpu, MemoryStick, Network, Server,
  Pin, PinOff, Coins, CreditCard, ArrowUpRight,
  Target, History, Ban, Hourglass, ChevronDown, Upload, FileText,
  Bookmark, Folder, Gift
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

function authHeaders() {
  return {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  }
}

const TABS = [
  { id: 'accounts',  label: 'Аккаунты',     Icon: KeyRound,  ready: true },
  { id: 'instances', label: 'VM',           Icon: Activity,  ready: true },
  { id: 'addresses', label: 'IP-адреса',    Icon: Globe,     ready: true },
  { id: 'ip-search', label: 'Поиск IP',     Icon: Search,    ready: true },
  { id: 'billing',   label: 'Биллинг',      Icon: Wallet,    ready: true },
]

export default function AdminYandexCloud() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeAccountId, setActiveAccountId] = useState(null)
  const [tab, setTab] = useState('accounts')
  const [privacyMode, setPrivacyMode] = useState(() => {
    try { return localStorage.getItem('yc-privacy-mode') === '1' } catch { return false }
  })

  function togglePrivacy() {
    const next = !privacyMode
    setPrivacyMode(next)
    try { localStorage.setItem('yc-privacy-mode', next ? '1' : '0') } catch {}
  }

  // Form modal
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState('create') // 'create' | 'edit'
  const [editingId, setEditingId] = useState(null)

  // Test result modal
  const [testResult, setTestResult] = useState(null) // { accountId, name, result }

  useEffect(() => { loadAccounts() }, [])

  async function loadAccounts() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts`, { headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      const list = data.accounts || []
      setAccounts(list)
      // Если активный аккаунт удалили — переключаемся на первый
      if (list.length && !list.find(a => a.id === activeAccountId)) {
        setActiveAccountId(list.find(a => a.is_active)?.id || list[0].id)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const activeAccount = useMemo(
    () => accounts.find(a => a.id === activeAccountId) || null,
    [accounts, activeAccountId]
  )

  function openCreateForm() {
    setFormMode('create')
    setEditingId(null)
    setFormOpen(true)
  }

  function openEditForm(acc) {
    setFormMode('edit')
    setEditingId(acc.id)
    setFormOpen(true)
  }

  async function handleDelete(acc) {
    if (!confirm(`Удалить аккаунт «${acc.name}»? Все его данные (включая SOCKS5 и закэшированный IAM-токен) будут удалены.`)) return
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${acc.id}`, {
        method: 'DELETE', headers: authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      loadAccounts()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleToggleActive(acc) {
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${acc.id}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ is_active: !acc.is_active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      loadAccounts()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleTest(acc) {
    setTestResult({ accountId: acc.id, name: acc.name, loading: true })
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${acc.id}/test`, {
        method: 'POST', headers: authHeaders(),
      })
      const data = await res.json()
      setTestResult({ accountId: acc.id, name: acc.name, result: data })
    } catch (e) {
      setTestResult({ accountId: acc.id, name: acc.name, result: { ok: false, error: e.message } })
    }
  }

  return (
    <div className={`space-y-5 ${privacyMode ? 'yc-privacy-on' : ''}`}>
      {/* CSS режима приватности — блюрит все элементы с font-mono или классом sensitive.
          На hover прозрачность возвращается, чтобы можно было быстро скопировать значение. */}
      <style>{`
        .yc-privacy-on .font-mono,
        .yc-privacy-on .sensitive,
        .yc-privacy-on textarea.font-mono {
          filter: blur(6px);
          transition: filter 120ms ease;
          user-select: none;
        }
        .yc-privacy-on .font-mono:hover,
        .yc-privacy-on .sensitive:hover,
        .yc-privacy-on textarea.font-mono:hover,
        .yc-privacy-on textarea.font-mono:focus {
          filter: blur(0);
          user-select: auto;
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/25">
          <Cloud className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">Yandex Cloud</h1>
          <p className="text-xs text-slate-400">Управление аккаунтами, VM, публичными IP, балансом</p>
        </div>
        <button
          onClick={togglePrivacy}
          title={privacyMode ? 'Выключить режим приватности — IP/ID будут видны' : 'Скрыть IP, ID, CIDR и другие чувствительные данные (для записи видео)'}
          className={`px-3 py-2 text-xs border rounded-lg transition flex items-center gap-1.5 ${
            privacyMode
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
              : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-700/60'
          }`}
        >
          {privacyMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{privacyMode ? 'Скрыто' : 'Скрыть данные'}</span>
        </button>
        <button
          onClick={loadAccounts}
          className="px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/60 transition flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {/* Privacy banner */}
      {privacyMode && (
        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex items-center gap-2">
          <EyeOff className="w-3.5 h-3.5 shrink-0" />
          <span>Режим приватности включён — IP, ID, CIDR и другие чувствительные значения замазаны. Наведи курсор чтобы быстро увидеть значение.</span>
          <button onClick={togglePrivacy} className="ml-auto text-amber-300 hover:text-white underline text-[11px] shrink-0">отключить</button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Account selector — показываем только если есть аккаунты */}
      {accounts.length > 0 && (
        <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-xs text-slate-400 shrink-0">Активный аккаунт:</div>
          <select
            value={activeAccountId || ''}
            onChange={e => setActiveAccountId(parseInt(e.target.value))}
            className="sensitive flex-1 max-w-md px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-white text-sm font-semibold focus:border-blue-500 focus:outline-none"
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} {a.is_active ? '' : '(выключен)'}
              </option>
            ))}
          </select>
          {activeAccount && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Badge ok={activeAccount.is_active} okText="Активен" failText="Выключен" />
              {activeAccount.has_socks5_url ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-semibold">
                  <Wifi className="w-3 h-3" /> via SOCKS5
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-700/40 border border-slate-700/50 text-slate-400">
                  <ShieldOff className="w-3 h-3" /> direct
                </span>
              )}
              {activeAccount.is_readonly && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold">
                  <Lock className="w-3 h-3" /> read-only
                </span>
              )}
              <span className="text-slate-500 font-mono">
                {activeAccount.auth_type === 'oauth' ? 'OAuth' : 'SA-key'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-900/50 border border-slate-800/60 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => t.ready && setTab(t.id)}
            disabled={!t.ready}
            title={t.ready ? '' : 'Скоро — раздел в разработке'}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              tab === t.id
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25'
                : t.ready
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  : 'text-slate-600 cursor-not-allowed opacity-60'
            }`}
          >
            <t.Icon className="w-4 h-4" />
            <span>{t.label}</span>
            {!t.ready && <span className="text-[9px] uppercase font-bold ml-1 opacity-70">скоро</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'accounts' && (
        <AccountsTab
          loading={loading}
          accounts={accounts}
          onCreate={openCreateForm}
          onEdit={openEditForm}
          onDelete={handleDelete}
          onTest={handleTest}
          onToggleActive={handleToggleActive}
        />
      )}
      {tab === 'instances' && activeAccount && <InstancesTab account={activeAccount} />}
      {tab === 'addresses' && activeAccount && <AddressesTab account={activeAccount} />}
      {tab === 'billing'   && activeAccount && <BillingTab   account={activeAccount} />}
      {tab === 'ip-search' && activeAccount && <IpSearchTab account={activeAccount} />}
      {(tab === 'instances' || tab === 'addresses' || tab === 'billing' || tab === 'ip-search') && !activeAccount && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">
          <div className="text-sm">Сначала добавь аккаунт во вкладке «Аккаунты»</div>
        </div>
      )}

      {/* Form modal */}
      {formOpen && (
        <AccountFormModal
          mode={formMode}
          accountId={editingId}
          existingAccount={editingId ? accounts.find(a => a.id === editingId) : null}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); loadAccounts() }}
        />
      )}

      {/* Test result modal */}
      {testResult && (
        <TestResultModal
          name={testResult.name}
          loading={testResult.loading}
          result={testResult.result}
          onClose={() => setTestResult(null)}
        />
      )}
    </div>
  )
}

// ─── AccountsTab ────────────────────────────────────────────────────────────

function AccountsTab({ loading, accounts, onCreate, onEdit, onDelete, onTest, onToggleActive }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {accounts.length} {accounts.length === 1 ? 'аккаунт' : accounts.length > 1 && accounts.length < 5 ? 'аккаунта' : 'аккаунтов'}
        </div>
        <button
          onClick={onCreate}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-sm font-bold hover:shadow-lg hover:shadow-blue-500/30 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Добавить аккаунт
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
      )}

      {!loading && accounts.length === 0 && (
        <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-10 text-center">
          <Cloud className="w-10 h-10 text-blue-400 mx-auto mb-3 opacity-60" />
          <div className="text-white font-semibold mb-1">Аккаунтов пока нет</div>
          <div className="text-xs text-slate-400 mb-4">Добавь первый Yandex.Cloud аккаунт через OAuth-токен или SA-ключ</div>
          <button
            onClick={onCreate}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-sm font-bold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Добавить первый
          </button>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map(a => (
            <AccountCard
              key={a.id}
              account={a}
              onEdit={() => onEdit(a)}
              onDelete={() => onDelete(a)}
              onTest={() => onTest(a)}
              onToggleActive={() => onToggleActive(a)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AccountCard({ account, onEdit, onDelete, onTest, onToggleActive }) {
  const isOauth = account.auth_type === 'oauth'
  const created = account.created_at ? new Date(account.created_at).toLocaleDateString('ru-RU') : '—'
  const iamExpiresIn = account.iam_expires_at
    ? Math.max(0, Math.round((new Date(account.iam_expires_at) - Date.now()) / 60000))
    : null

  return (
    <div className={`relative rounded-2xl border ${
      account.is_active
        ? 'bg-gradient-to-br from-slate-800/50 to-slate-900/60 border-slate-700/50'
        : 'bg-slate-900/30 border-slate-800/40 opacity-70'
    } p-4 sm:p-5 hover:border-blue-500/40 transition-all`}>
      {/* Top row */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          isOauth ? 'bg-purple-500/20 border border-purple-500/30' : 'bg-emerald-500/20 border border-emerald-500/30'
        }`}>
          <KeyRound className={`w-5 h-5 ${isOauth ? 'text-purple-300' : 'text-emerald-300'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="sensitive text-base font-bold text-white truncate">{account.name}</div>
            {!account.is_active && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-slate-700/60 text-slate-400 rounded">off</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {isOauth ? 'OAuth-токен' : 'Service Account JSON-ключ'}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {account.has_socks5_url ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-semibold">
            <Wifi className="w-3 h-3" /> SOCKS5
          </span>
        ) : null}
        {account.is_readonly && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold">
            <Lock className="w-3 h-3" /> read-only
          </span>
        )}
        {account.default_folder_id && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-slate-800 border border-slate-700/50 text-slate-300 font-mono" title="Default folder">
            📁 {account.default_folder_id.slice(0, 12)}…
          </span>
        )}
        {iamExpiresIn !== null && iamExpiresIn > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold" title="IAM токен в кэше">
            ✓ IAM ~{iamExpiresIn}мин
          </span>
        )}
      </div>

      {account.notes && (
        <div className="text-xs text-slate-400 mb-3 line-clamp-2 italic">{account.notes}</div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>создан: {created}</span>
        {account.created_by_login && <span>{account.created_by_login}</span>}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-slate-700/40">
        <button
          onClick={onTest}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 rounded-lg font-semibold transition"
        >
          <Activity className="w-3.5 h-3.5" /> Тест
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white rounded-lg font-semibold transition"
        >
          <Pencil className="w-3.5 h-3.5" /> Редактировать
        </button>
        <button
          onClick={onToggleActive}
          title={account.is_active ? 'Выключить' : 'Включить'}
          className="flex items-center justify-center w-8 h-8 text-xs bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white rounded-lg transition"
        >
          <Power className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          title="Удалить"
          className="flex items-center justify-center w-8 h-8 text-xs bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-red-300 hover:border-red-500/40 rounded-lg transition ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── AccountFormModal ───────────────────────────────────────────────────────

function AccountFormModal({ mode, accountId, existingAccount, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: existingAccount?.name || '',
    auth_type: existingAccount?.auth_type || 'sa_key',
    oauth_token: '',
    sa_key_json: '',
    default_cloud_id: existingAccount?.default_cloud_id || '',
    default_folder_id: existingAccount?.default_folder_id || '',
    billing_account_id: existingAccount?.billing_account_id || '',
    socks5_url: '',
    notes: existingAccount?.notes || '',
    is_readonly: !!existingAccount?.is_readonly,
  })
  const [showOauth, setShowOauth] = useState(false)
  const [showSocks, setShowSocks] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function setField(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Sensitive поля не отправляем если они пустые в режиме edit (= "не менять")
      const body = { ...form }
      if (mode === 'edit') {
        if (!body.oauth_token) delete body.oauth_token
        if (!body.sa_key_json) delete body.sa_key_json
        if (!body.socks5_url)  delete body.socks5_url
      } else {
        if (body.auth_type === 'oauth') delete body.sa_key_json
        if (body.auth_type === 'sa_key') delete body.oauth_token
      }

      const url = mode === 'create'
        ? `${API}/api/admin/yandex-cloud/accounts`
        : `${API}/api/admin/yandex-cloud/accounts/${accountId}`
      const method = mode === 'create' ? 'POST' : 'PUT'

      const res = await fetch(url, {
        method, headers: authHeaders(), body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800 px-6 py-4 flex items-center gap-3 z-10">
          <Cloud className="w-5 h-5 text-blue-400" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">
              {mode === 'create' ? 'Новый Yandex Cloud аккаунт' : `Редактировать «${existingAccount?.name}»`}
            </div>
            <div className="text-[11px] text-slate-500">
              {mode === 'edit' && 'Поля с креденшалами оставляй пустыми чтобы не менять'}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* Имя */}
          <Field label="Название аккаунта" required>
            <input
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="Например: «Прод» или «Маркетинг»"
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </Field>

          {/* Auth type */}
          <Field label="Способ аутентификации">
            <div className="flex gap-1 p-1 bg-slate-950/60 border border-slate-700 rounded-lg">
              <AuthTypeButton
                active={form.auth_type === 'sa_key'}
                onClick={() => setField('auth_type', 'sa_key')}
                title="Service Account JSON"
                subtitle="Рекомендуется для прода"
              />
              <AuthTypeButton
                active={form.auth_type === 'oauth'}
                onClick={() => setField('auth_type', 'oauth')}
                title="OAuth-токен"
                subtitle="Быстрый способ"
              />
            </div>
          </Field>

          {/* SA key */}
          {form.auth_type === 'sa_key' && (
            <Field
              label="Service Account JSON-ключ"
              hint={
                <>
                  Создай SA в YC-консоли → Service Accounts → выбери SA → «Создать ключ» → «JSON». Вставь ВЕСЬ файл сюда.{' '}
                  <a href="https://yandex.cloud/ru/docs/iam/operations/authorized-key/create" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">
                    Документация <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              }
            >
              <textarea
                value={form.sa_key_json}
                onChange={e => setField('sa_key_json', e.target.value)}
                placeholder={mode === 'edit' ? 'Оставь пустым чтобы не менять' : '{ "id": "ajeb...", "service_account_id": "...", "private_key": "-----BEGIN PRIVATE KEY-----..." }'}
                rows={6}
                className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-xs font-mono focus:border-emerald-500 focus:outline-none resize-y"
              />
            </Field>
          )}

          {/* OAuth */}
          {form.auth_type === 'oauth' && (
            <Field
              label="OAuth-токен"
              hint={
                <>
                  Получи на{' '}
                  <a href="https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec2fb" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">
                    oauth.yandex.ru <ExternalLink className="w-3 h-3" />
                  </a>{' '}
                  (приложение «Yandex Cloud CLI»). Действителен 1 год.
                </>
              }
            >
              <div className="relative">
                <input
                  type={showOauth ? 'text' : 'password'}
                  value={form.oauth_token}
                  onChange={e => setField('oauth_token', e.target.value)}
                  placeholder={mode === 'edit' ? 'Оставь пустым чтобы не менять' : 'y0_AgAAAA...'}
                  className="w-full px-3 py-2.5 pr-10 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-purple-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowOauth(!showOauth)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white"
                >
                  {showOauth ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
          )}

          {/* IDs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Default Cloud ID" hint="ID облака, для запросов биллинга и т.п. Опционально.">
              <input
                value={form.default_cloud_id}
                onChange={e => setField('default_cloud_id', e.target.value)}
                placeholder="b1g..."
                className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
              />
            </Field>
            <Field label="Default Folder ID" hint="Папка по умолчанию для VM/IP-адресов.">
              <input
                value={form.default_folder_id}
                onChange={e => setField('default_folder_id', e.target.value)}
                placeholder="b1g..."
                className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
              />
            </Field>
          </div>

          <Field label="Billing Account ID" hint="ID платёжного аккаунта — для запроса баланса и пополнения.">
            <input
              value={form.billing_account_id}
              onChange={e => setField('billing_account_id', e.target.value)}
              placeholder="dn2..."
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
            />
          </Field>

          {/* SOCKS5 */}
          <Field label="SOCKS5 (опционально)" hint="Все запросы к Yandex.Cloud API для этого аккаунта пойдут через этот прокси.">
            <div className="relative">
              <input
                type={showSocks ? 'text' : 'password'}
                value={form.socks5_url}
                onChange={e => setField('socks5_url', e.target.value)}
                placeholder={
                  mode === 'edit' && existingAccount?.has_socks5_url
                    ? 'Оставь пустым чтобы не менять, введи "null" чтобы удалить'
                    : 'socks5://user:password@proxy.example.com:1080'
                }
                className="w-full px-3 py-2.5 pr-10 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-cyan-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowSocks(!showSocks)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white"
              >
                {showSocks ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          {/* Read-only flag */}
          <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-xl border border-slate-700/40 hover:border-amber-500/40 bg-slate-950/40 transition">
            <input
              type="checkbox"
              checked={form.is_readonly}
              onChange={e => setField('is_readonly', e.target.checked)}
              className="w-4 h-4 accent-amber-500"
            />
            <Lock className="w-4 h-4 text-amber-400" />
            <div className="flex-1">
              <div className="text-sm text-white font-medium">Read-only режим</div>
              <div className="text-[11px] text-slate-500">Запретит destructive-операции (удаление VM, освобождение IP)</div>
            </div>
          </label>

          <Field label="Заметки (опционально)">
            <textarea
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              rows={2}
              placeholder="Кому принадлежит, для чего используется"
              className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none resize-none"
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg">
            Отмена
          </button>
          <button
            onClick={save}
            disabled={saving || !form.name.trim()}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 hover:shadow-lg hover:shadow-blue-500/30 flex items-center gap-1.5"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TestResultModal ────────────────────────────────────────────────────────

function TestResultModal({ name, loading, result, onClose }) {
  const [copied, setCopied] = useState(null)
  function copy(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800 px-6 py-4 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
            loading ? 'bg-slate-800 border-slate-700 text-slate-400'
            : result?.ok ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            : 'bg-red-500/15 border-red-500/40 text-red-300'
          }`}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" />
              : result?.ok ? <CheckCircle2 className="w-4 h-4" />
              : <AlertCircle className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">Тест соединения • {name}</div>
            <div className="text-[11px] text-slate-500">
              {loading ? 'Подключаемся...'
                : result?.ok ? `Успех${result.durationMs ? ` за ${(result.durationMs / 1000).toFixed(1)}s` : ''}`
                : 'Не удалось'}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {loading && (
            <div className="text-center py-10">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
              <div className="text-sm text-slate-400">Получаем IAM-токен и список облаков...</div>
            </div>
          )}

          {!loading && result?.error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/40">
              <div className="flex items-center gap-2 text-red-300 text-sm font-semibold mb-1">
                <AlertCircle className="w-4 h-4" /> Ошибка
                {result.errorCode && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-red-500/15 rounded">{result.errorCode}</span>}
              </div>
              <div className="text-xs text-red-200/90 font-mono break-all">{result.error}</div>
              {result.errorHint && (
                <div className="mt-2 pt-2 border-t border-red-500/20 text-xs text-red-100/90 leading-relaxed flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{result.errorHint}</span>
                </div>
              )}
            </div>
          )}

          {!loading && result?.steps && (
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">Шаги</div>
              <div className="space-y-1.5">
                {result.steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {s.ok
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className={s.ok ? 'text-slate-200' : 'text-red-200'}>{s.label}</span>
                      {s.detail && <div className="text-slate-500 text-[11px] mt-0.5">{s.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && result?.diagnostics?.hosts?.length > 0 && (
            <details className="bg-slate-950/40 border border-slate-800 rounded-xl">
              <summary className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase cursor-pointer hover:text-slate-200">
                Сетевая диагностика ({result.diagnostics.hosts.length} хостов)
              </summary>
              <div className="border-t border-slate-800 p-3 space-y-2">
                {result.diagnostics.hosts.map(h => (
                  <div key={h.host} className="text-xs">
                    <div className="font-mono text-slate-300">{h.host}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3">
                      <span className={h.dnsOk ? 'text-emerald-400' : 'text-red-400'}>
                        DNS {h.dnsOk ? `✓ ${h.dnsMs}мс` : '✗'}
                      </span>
                      <span className={h.tcpOk ? 'text-emerald-400' : 'text-red-400'}>
                        TCP/443 {h.tcpOk ? `✓ ${h.tcpMs}мс` : '✗'}
                      </span>
                      {h.addresses?.length > 0 && (
                        <span className="font-mono text-slate-600">{h.addresses[0]}</span>
                      )}
                    </div>
                    {h.error && <div className="text-[10px] text-red-400 mt-0.5 font-mono">{h.error}</div>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {!loading && result?.clouds?.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">Доступные облака ({result.clouds.length})</div>
              <div className="space-y-1.5">
                {result.clouds.map(c => (
                  <div key={c.id} className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
                    <Cloud className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="sensitive text-sm text-white font-semibold truncate">{c.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{c.id}</div>
                    </div>
                    <button
                      onClick={() => copy(c.id, c.id)}
                      title="Скопировать ID"
                      className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white"
                    >
                      {copied === c.id ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && result?.hasSocks5 && (
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-2">
              <Wifi className="w-3.5 h-3.5" /> Запросы шли через настроенный SOCKS5-прокси
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-bold hover:bg-slate-700">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] text-slate-500 mt-1.5 leading-relaxed flex items-start gap-1"><Info className="w-3 h-3 mt-0.5 shrink-0" /><span>{hint}</span></div>}
    </div>
  )
}

function AuthTypeButton({ active, onClick, title, subtitle }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 rounded-md text-left transition ${
        active ? 'bg-gradient-to-br from-blue-500/30 to-cyan-500/20 border border-blue-500/50' : 'border border-transparent hover:bg-slate-800/40'
      }`}
    >
      <div className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-300'}`}>{title}</div>
      <div className="text-[10px] text-slate-500">{subtitle}</div>
    </button>
  )
}

function Badge({ ok, okText, failText }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-semibold ${
      ok
        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
        : 'bg-slate-700/40 border border-slate-700/50 text-slate-400'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      {ok ? okText : failText}
    </span>
  )
}

// ─── InstancesTab (этап 2: VM) ──────────────────────────────────────────────

const VM_STATUS_META = {
  RUNNING:      { color: 'emerald', label: 'Работает',    pulse: true },
  STOPPED:      { color: 'slate',   label: 'Остановлена', pulse: false },
  STARTING:     { color: 'cyan',    label: 'Запуск...',   pulse: true },
  STOPPING:     { color: 'amber',   label: 'Остановка...',pulse: true },
  RESTARTING:   { color: 'cyan',    label: 'Рестарт...',  pulse: true },
  PROVISIONING: { color: 'cyan',    label: 'Создаётся...', pulse: true },
  DELETING:     { color: 'red',     label: 'Удаляется...', pulse: true },
  ERROR:        { color: 'red',     label: 'Ошибка',      pulse: false },
  CRASHED:      { color: 'red',     label: 'Упала',       pulse: false },
}

function fmtBytes(bytes) {
  const n = Number(bytes) || 0
  if (n === 0) return '—'
  const gb = n / (1024 ** 3)
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(n / (1024 ** 2)).toFixed(0)} MB`
}

function InstancesTab({ account }) {
  const [folderId, setFolderId] = useState(account.default_folder_id || '')
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionState, setActionState] = useState({})  // { vmId: { loading, action } }
  const [createOpen, setCreateOpen] = useState(false)
  const [genKeyShown, setGenKeyShown] = useState(null)  // { algo, publicKey, privateKey } — показ ОДИН раз
  const [vpsLinks, setVpsLinks] = useState({})  // { yc_instance_id → { vpsId, vpsName } }

  useEffect(() => { setFolderId(account.default_folder_id || '') }, [account.id])

  async function load() {
    if (!folderId) { setError('Укажи folderId — либо в карточке аккаунта (default_folder_id), либо здесь'); return }
    setLoading(true); setError(null)
    try {
      const [resInst, resLinks] = await Promise.all([
        fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/instances?folderId=${encodeURIComponent(folderId)}`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/instances/linked-vps`, { headers: authHeaders() }),
      ])
      const data = await resInst.json()
      if (!resInst.ok) throw new Error(data.error || 'Ошибка')
      setInstances(data.instances || [])
      if (resLinks.ok) {
        const ld = await resLinks.json()
        setVpsLinks(ld.links || {})
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (folderId) load() }, [account.id, folderId])

  async function action(vm, name) {
    if (name === 'delete') {
      const link = vpsLinks[vm.id]
      const linkText = link ? `\n\nЭта VM привязана к VPS-записи «${link.vpsName}» (#${link.vpsId}). Она тоже будет удалена.` : ''
      if (!confirm(`Удалить VM «${vm.name}»?${linkText}\n\nЭто необратимо.`)) return
    }
    setActionState(p => ({ ...p, [vm.id]: { loading: true, action: name } }))
    try {
      const url = `${API}/api/admin/yandex-cloud/accounts/${account.id}/instances/${vm.id}${name === 'delete' ? '' : '/' + name}`
      const method = name === 'delete' ? 'DELETE' : 'POST'
      const res = await fetch(url, { method, headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      // Подождём пару секунд и обновим — статус успеет поменяться
      setTimeout(load, 1500)
    } catch (e) {
      setError(e.message)
    } finally {
      setActionState(p => { const n = { ...p }; delete n[vm.id]; return n })
    }
  }

  return (
    <div className="space-y-3">
      {/* Folder picker + actions */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Folder ID</label>
          <input
            value={folderId}
            onChange={e => setFolderId(e.target.value)}
            placeholder="b1g..."
            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          onClick={load}
          disabled={loading || !folderId}
          className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
        {!account.is_readonly && (
          <button
            onClick={() => setCreateOpen(true)}
            disabled={!folderId}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Создать VM
          </button>
        )}
      </div>

      {createOpen && (
        <CreateVmModal
          account={account}
          folderId={folderId}
          onClose={() => setCreateOpen(false)}
          onCreated={(generatedKey) => {
            setCreateOpen(false)
            setTimeout(load, 1500)
            // Если был auto-gen — открываем модалку скачивания приватника
            if (generatedKey?.privateKey) setGenKeyShown(generatedKey)
          }}
        />
      )}

      {genKeyShown && (
        <GeneratedKeyModal data={genKeyShown} onClose={() => setGenKeyShown(null)} />
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}

      {loading && instances.length === 0 && (
        <div className="flex items-center justify-center py-16"><RefreshCw className="w-6 h-6 text-blue-400 animate-spin" /></div>
      )}

      {!loading && instances.length === 0 && folderId && !error && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 text-center text-slate-500 text-sm">
          В этой папке нет виртуальных машин
        </div>
      )}

      {instances.length > 0 && (
        <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/60 bg-slate-900/40 text-[10px] uppercase font-bold text-slate-400">
                  <th className="text-left px-4 py-2.5">Имя / ID</th>
                  <th className="text-left px-2 py-2.5">Статус</th>
                  <th className="text-left px-2 py-2.5">Зона</th>
                  <th className="text-right px-2 py-2.5">vCPU</th>
                  <th className="text-right px-2 py-2.5">RAM</th>
                  <th className="text-left px-2 py-2.5">Public IP</th>
                  <th className="text-right px-3 py-2.5">Действия</th>
                </tr>
              </thead>
              <tbody>
                {instances.map(vm => {
                  const meta = VM_STATUS_META[vm.status] || { color: 'slate', label: vm.status }
                  const colorMap = {
                    emerald: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
                    slate:   'bg-slate-700/40 border-slate-600/40 text-slate-300',
                    cyan:    'bg-cyan-500/15 border-cyan-500/30 text-cyan-300',
                    amber:   'bg-amber-500/15 border-amber-500/30 text-amber-300',
                    red:     'bg-red-500/15 border-red-500/30 text-red-300',
                  }[meta.color]
                  const dotColor = {
                    emerald: 'bg-emerald-400', slate: 'bg-slate-500', cyan: 'bg-cyan-400',
                    amber: 'bg-amber-400', red: 'bg-red-400'
                  }[meta.color]
                  const a = actionState[vm.id]
                  const running = vm.status === 'RUNNING'
                  const stopped = vm.status === 'STOPPED'

                  const vpsLink = vpsLinks[vm.id]
                  return (
                    <tr key={vm.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="sensitive text-white font-semibold text-sm truncate max-w-[200px]">{vm.name}</div>
                          {vpsLink && (
                            <a href={`/admin/vps`} target="_blank" rel="noopener noreferrer"
                              title={`Связана с VPS «${vpsLink.vpsName}» (#${vpsLink.vpsId}). Открыть в /admin/vps`}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 shrink-0">
                              🔗 VPS
                            </a>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 truncate max-w-[200px]">{vm.id}</div>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded border ${colorMap}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${meta.pulse ? 'animate-pulse' : ''}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-[11px] text-slate-400 font-mono">{vm.zoneId}</td>
                      <td className="px-2 py-2.5 text-right text-sm text-slate-200 font-mono">
                        {vm.cores != null ? vm.cores : '—'}
                        {vm.coreFraction && vm.coreFraction !== 100 && <span className="text-[10px] text-slate-500 ml-1">{vm.coreFraction}%</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right text-sm text-slate-200 font-mono">{fmtBytes(vm.memory)}</td>
                      <td className="px-2 py-2.5 text-[11px] text-slate-300 font-mono">{vm.publicIp || <span className="text-slate-600">—</span>}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <VmActionBtn
                            Icon={Play}
                            label="Запуск"
                            color="emerald"
                            disabled={!stopped}
                            disabledReason={running ? 'Уже работает' : `Действие недоступно в статусе ${vm.status}`}
                            loading={a?.loading && a.action === 'start'}
                            onClick={() => action(vm, 'start')}
                          />
                          <VmActionBtn
                            Icon={RotateCw}
                            label="Рестарт"
                            color="cyan"
                            disabled={!running}
                            disabledReason={stopped ? 'Сначала запусти машину' : `Действие недоступно в статусе ${vm.status}`}
                            loading={a?.loading && a.action === 'restart'}
                            onClick={() => action(vm, 'restart')}
                          />
                          <VmActionBtn
                            Icon={Square}
                            label="Стоп"
                            color="amber"
                            disabled={!running}
                            disabledReason={stopped ? 'Уже остановлена' : `Действие недоступно в статусе ${vm.status}`}
                            loading={a?.loading && a.action === 'stop'}
                            onClick={() => action(vm, 'stop')}
                          />
                          {!account.is_readonly && (
                            <button
                              onClick={() => action(vm, 'delete')}
                              disabled={a?.loading}
                              title="Удалить машину"
                              className="ml-1 flex items-center justify-center w-8 h-8 rounded-lg border bg-slate-800/40 border-slate-700/40 text-slate-400 hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/40 transition disabled:opacity-50"
                            >
                              {a?.loading && a.action === 'delete' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Кнопка действия для VM — иконка + подпись + disabled-состояние с tooltip.
 * Всегда видна, чтобы юзер сразу видел все доступные действия.
 */
function VmActionBtn({ Icon, label, color, disabled, disabledReason, loading, onClick }) {
  const baseClass = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition select-none'
  const enabledColors = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/50',
    cyan:    'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500/50',
    amber:   'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50',
  }[color]
  const disabledClass = 'bg-slate-900/40 border-slate-800 text-slate-600 cursor-not-allowed'
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled || loading}
      title={disabled ? disabledReason : label}
      className={`${baseClass} ${disabled ? disabledClass : enabledColors} ${loading ? 'opacity-70' : ''}`}
    >
      {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
      <span>{label}</span>
    </button>
  )
}

function ActionBtn({ Icon, loading, onClick, title, color = 'slate' }) {
  const colorMap = {
    emerald: 'hover:bg-emerald-500/15 hover:text-emerald-300 hover:border-emerald-500/40',
    cyan:    'hover:bg-cyan-500/15 hover:text-cyan-300 hover:border-cyan-500/40',
    amber:   'hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-500/40',
    red:     'hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/40',
    slate:   'hover:bg-slate-700/40',
  }[color]
  return (
    <button onClick={onClick} disabled={loading} title={title}
      className={`flex items-center justify-center w-7 h-7 rounded-lg border bg-slate-800/40 border-slate-700/40 text-slate-400 transition ${colorMap} disabled:opacity-50`}>
      {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── AddressesTab (этап 3: публичные IP) ────────────────────────────────────

function AddressesTab({ account }) {
  const [folderId, setFolderId] = useState(account.default_folder_id || '')
  const [addresses, setAddresses] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionState, setActionState] = useState({})
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', zoneId: 'ru-central1-a', reserved: false, ipv6: false, ddosProtection: '' })
  const [creating, setCreating] = useState(false)

  useEffect(() => { setFolderId(account.default_folder_id || '') }, [account.id])

  async function load() {
    if (!folderId) { setError('Укажи folderId'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/addresses?folderId=${encodeURIComponent(folderId)}`, {
        headers: authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setAddresses(data.addresses || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (folderId) load() }, [account.id, folderId])

  async function toggleReserved(addr) {
    const newReserved = !addr.reserved
    setActionState(p => ({ ...p, [addr.id]: { loading: true } }))
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/addresses/${addr.id}`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ reserved: newReserved }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setTimeout(load, 1000)
    } catch (e) { setError(e.message) }
    finally { setActionState(p => { const n = { ...p }; delete n[addr.id]; return n }) }
  }

  async function release(addr) {
    if (addr.used) { setError('Адрес используется — отвяжи его от ресурса перед удалением'); return }
    if (!confirm(`Освободить IP ${addr.externalIp}? ${addr.reserved ? 'Это статический IP, возврат невозможен.' : ''}`)) return
    setActionState(p => ({ ...p, [addr.id]: { loading: true } }))
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/addresses/${addr.id}`, {
        method: 'DELETE', headers: authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      load()
    } catch (e) { setError(e.message) }
    finally { setActionState(p => { const n = { ...p }; delete n[addr.id]; return n }) }
  }

  async function create() {
    if (!folderId) { setError('Укажи folderId'); return }
    setCreating(true); setError(null)
    try {
      const body = { ...createForm, folderId }
      if (!body.ddosProtection) delete body.ddosProtection
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/addresses`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setCreateOpen(false)
      setCreateForm({ name: '', zoneId: 'ru-central1-a', reserved: false, ipv6: false, ddosProtection: '' })
      setTimeout(load, 1500)
    } catch (e) { setError(e.message) }
    finally { setCreating(false) }
  }

  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Folder ID</label>
          <input
            value={folderId}
            onChange={e => setFolderId(e.target.value)}
            placeholder="b1g..."
            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button onClick={load} disabled={loading || !folderId}
          className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
        </button>
        {!account.is_readonly && (
          <button onClick={() => setCreateOpen(true)} disabled={!folderId}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Аллоцировать IP
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}

      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>Статический IP стоит ~0.18 ₽/час когда не привязан к ресурсу. Ephemeral IP бесплатен пока используется, но меняется при перезагрузке VM.</span>
      </div>

      {!loading && addresses.length === 0 && folderId && !error && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 text-center text-slate-500 text-sm">
          В этой папке нет публичных IP
        </div>
      )}

      {addresses.length > 0 && (
        <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/60 bg-slate-900/40 text-[10px] uppercase font-bold text-slate-400">
                  <th className="text-left px-4 py-2.5">IP</th>
                  <th className="text-left px-2 py-2.5">Имя</th>
                  <th className="text-left px-2 py-2.5">Зона</th>
                  <th className="text-left px-2 py-2.5">Тип</th>
                  <th className="text-left px-2 py-2.5">Статус</th>
                  <th className="text-right px-3 py-2.5">Действия</th>
                </tr>
              </thead>
              <tbody>
                {addresses.map(a => {
                  const s = actionState[a.id]
                  return (
                    <tr key={a.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition">
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-sm text-white">{a.externalIp || '—'}</div>
                        <div className="text-[10px] text-slate-500 font-mono truncate max-w-[180px]">{a.id}</div>
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-300"><span className="sensitive">{a.name || <span className="text-slate-600">—</span>}</span></td>
                      <td className="px-2 py-2.5 text-[11px] text-slate-400 font-mono">{a.zoneId}</td>
                      <td className="px-2 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-semibold ${
                          a.reserved ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300' : 'bg-slate-700/40 border border-slate-700/50 text-slate-400'
                        }`}>
                          {a.reserved ? <><Pin className="w-3 h-3" /> static</> : <>ephemeral</>}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-semibold ${
                          a.used ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' : 'bg-slate-700/40 border border-slate-700/50 text-slate-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${a.used ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                          {a.used ? 'привязан' : 'свободен'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <ActionBtn
                            Icon={a.reserved ? PinOff : Pin}
                            loading={s?.loading}
                            onClick={() => toggleReserved(a)}
                            title={a.reserved ? 'Снять резервацию (станет ephemeral)' : 'Зарезервировать (сделать static)'}
                            color="amber"
                          />
                          {!account.is_readonly && (
                            <ActionBtn Icon={Trash2} loading={s?.loading} onClick={() => release(a)} title="Освободить" color="red" />
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create address modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
              <Globe className="w-5 h-5 text-blue-400" />
              <div className="flex-1 text-sm font-bold text-white">Аллоцировать публичный IP</div>
              <button onClick={() => setCreateOpen(false)} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Имя (опц.)">
                <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none" />
              </Field>
              <Field label="Зона">
                <select value={createForm.zoneId} onChange={e => setCreateForm({ ...createForm, zoneId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
                  <option value="ru-central1-a">ru-central1-a</option>
                  <option value="ru-central1-b">ru-central1-b</option>
                  <option value="ru-central1-d">ru-central1-d</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={createForm.reserved} onChange={e => setCreateForm({ ...createForm, reserved: e.target.checked })} className="w-4 h-4 accent-amber-500" />
                <span className="text-sm text-slate-200">Сразу зарезервировать (static)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={createForm.ipv6} onChange={e => setCreateForm({ ...createForm, ipv6: e.target.checked })} className="w-4 h-4 accent-blue-500" />
                <span className="text-sm text-slate-200">IPv6 (вместо IPv4)</span>
              </label>
              <Field label="DDoS-защита (опц.)" hint="Только для IPv4. Стоит дополнительных денег.">
                <select value={createForm.ddosProtection} onChange={e => setCreateForm({ ...createForm, ddosProtection: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">— нет —</option>
                  <option value="qrator">qrator</option>
                </select>
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
              <button onClick={() => setCreateOpen(false)} className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg">Отмена</button>
              <button onClick={create} disabled={creating}
                className="px-5 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {creating ? 'Аллокация...' : 'Аллоцировать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── BillingTab (этап 4: баланс + пополнение) ───────────────────────────────

function BillingTab({ account }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [topUpAmount, setTopUpAmount] = useState(1000)
  const [billingAccountsList, setBillingAccountsList] = useState(null)
  const [grantDialog, setGrantDialog] = useState(null) // { amount, used, expiresAt, currency, notes }

  async function load() {
    if (!account.billing_account_id) {
      // Подгрузим список доступных billing-аккаунтов чтобы юзер мог выбрать
      try {
        const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/billing-accounts`, { headers: authHeaders() })
        const d = await res.json()
        if (res.ok) setBillingAccountsList(d.accounts || [])
      } catch {}
      return
    }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/balance`, { headers: authHeaders() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setData(d)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [account.id])

  // Открыть диалог редактирования гранта (с предзаполненными значениями если уже задано)
  function openGrantDialog() {
    const g = data?.grant
    setGrantDialog({
      amount:    g?.total != null ? String(g.total) : '',
      used:      g?.used != null ? String(g.used) : '',
      expiresAt: g?.expiresAt ? new Date(g.expiresAt).toISOString().slice(0, 10) : '',
      currency:  g?.currency || data?.billing?.currency || 'RUB',
      notes:     g?.notes || '',
    })
  }

  async function saveGrant() {
    if (!grantDialog) return
    try {
      const body = {
        amount:    grantDialog.amount === '' ? null : Number(grantDialog.amount),
        used:      grantDialog.used === '' ? 0 : Number(grantDialog.used),
        expiresAt: grantDialog.expiresAt || null,
        currency:  grantDialog.currency || null,
        notes:     grantDialog.notes || null,
      }
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/grant`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      setGrantDialog(null)
      load()
    } catch (e) { setError(e.message) }
  }

  async function clearGrant() {
    if (!confirm('Удалить данные о гранте? Сумма и срок будут стёрты.')) return
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/grant`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ amount: null, used: null, expiresAt: null, currency: null, notes: null }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      load()
    } catch (e) { setError(e.message) }
  }

  function buildTopUpUrl() {
    if (!data?.billing?.id) return null
    const params = new URLSearchParams()
    if (topUpAmount) params.set('amount', String(topUpAmount))
    if (data.billing.currency) params.set('currency', data.billing.currency)
    return `https://console.cloud.yandex.ru/billing/accounts/${data.billing.id}/payments?${params.toString()}`
  }

  // Если billing_account_id не задан — показываем список с кнопкой «выбрать»
  if (!account.billing_account_id) {
    return (
      <div className="space-y-3">
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-sm text-amber-200 flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Billing Account ID не задан</div>
            <div className="text-[11px] mt-1 text-amber-100/90">Выбери из списка ниже либо открой «Редактировать» аккаунт и впиши вручную.</div>
          </div>
        </div>
        {billingAccountsList === null ? (
          <div className="flex items-center justify-center py-12"><RefreshCw className="w-6 h-6 text-blue-400 animate-spin" /></div>
        ) : billingAccountsList.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 text-center text-slate-500 text-sm">
            У SA/OAuth нет доступа ни к одному billing-аккаунту.
          </div>
        ) : (
          <div className="space-y-2">
            {billingAccountsList.map(b => (
              <div key={b.id} className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3">
                <Wallet className="w-5 h-5 text-blue-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{b.name}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">{b.id}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono text-emerald-300">{b.balance} {b.currency}</div>
                  <div className="text-[10px] text-slate-500">{b.usageStatus}</div>
                </div>
              </div>
            ))}
            <div className="text-[11px] text-slate-500 italic px-1">Скопируй нужный ID и вставь в «Редактировать аккаунт» → Billing Account ID</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16"><RefreshCw className="w-6 h-6 text-blue-400 animate-spin" /></div>
      )}

      {data?.billing && (
        <>
          {/* Balance card */}
          <div className="bg-gradient-to-br from-blue-900/30 via-slate-900/60 to-cyan-900/20 border border-blue-500/30 rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-xl shadow-blue-500/30">
                <Coins className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase font-bold text-slate-400 mb-1">Текущий баланс</div>
                <div className="text-3xl sm:text-4xl font-bold text-white font-mono mb-1">
                  {data.billing.balance != null ? Number(data.billing.balance).toLocaleString('ru-RU') : '—'}
                  <span className="text-lg ml-2 text-slate-400">{data.billing.currency}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge ok={data.billing.active} okText="Аккаунт активен" failText="Деактивирован" />
                  {data.billing.hasPaymentMethod ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                      <CreditCard className="w-3 h-3" /> Способ оплаты привязан
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300" title="Включи автоплатёж в консоли YC чтобы баланс пополнялся сам">
                      <AlertCircle className="w-3 h-3" /> Автоплатёж не настроен
                    </span>
                  )}
                  {data.billing.contractType && (
                    <span className="inline-flex px-2 py-0.5 text-[11px] rounded bg-slate-700/40 border border-slate-700/50 text-slate-300 font-semibold">
                      {data.billing.contractType}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={load} disabled={loading} className="w-9 h-9 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="mt-5 pt-5 border-t border-blue-500/20">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">Пополнить баланс</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-slate-950/60 border border-slate-700 rounded-lg overflow-hidden">
                  {[500, 1000, 5000, 10000].map(v => (
                    <button key={v} onClick={() => setTopUpAmount(v)}
                      className={`px-3 py-2 text-xs font-bold transition ${topUpAmount === v ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-white'}`}>
                      {v.toLocaleString('ru-RU')}
                    </button>
                  ))}
                </div>
                <input type="number" value={topUpAmount} onChange={e => setTopUpAmount(parseInt(e.target.value) || 0)} min="0" step="100"
                  className="w-32 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none" />
                <span className="text-sm text-slate-400 font-mono">{data.billing.currency}</span>
                <a href={buildTopUpUrl()} target="_blank" rel="noopener noreferrer"
                  className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold rounded-lg hover:shadow-lg hover:shadow-emerald-500/30 flex items-center gap-1.5 ml-auto">
                  <CreditCard className="w-3.5 h-3.5" /> Пополнить <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">
                Откроется консоль Yandex.Cloud в новой вкладке с предзаполненной суммой. Пополнение картой / yoo / счётом — на стороне YC.
              </div>
            </div>
          </div>

          {/* Grant card */}
          <GrantCard grant={data.grant} onEdit={openGrantDialog} onClear={clearGrant} />

          {/* Details */}
          <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 space-y-2 text-sm">
            <Row label="Имя">{data.billing.name}</Row>
            <Row label="ID">{data.billing.id}</Row>
            <Row label="Страна">{data.billing.countryCode}</Row>
            <Row label="Статус">{data.billing.usageStatus}</Row>
            {data.billing.billingThreshold && <Row label="Порог биллинга">{data.billing.billingThreshold} {data.billing.currency}</Row>}
            {data.billing.masterAccountId && <Row label="Master account">{data.billing.masterAccountId}</Row>}
            {data.billing.createdAt && <Row label="Создан">{new Date(data.billing.createdAt).toLocaleDateString('ru-RU')}</Row>}
          </div>
        </>
      )}

      {/* Grant edit dialog */}
      {grantDialog && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
              <Gift className="w-5 h-5 text-amber-400" />
              <div className="flex-1 text-sm font-bold text-white">Грант от Yandex Cloud</div>
              <button onClick={() => setGrantDialog(null)} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-[11px] text-slate-400 leading-relaxed">
                YC не отдаёт сумму гранта в публичном API — введи вручную из консоли (раздел «Биллинг» → «Бонусы»). Поле <span className="text-slate-200">«Использовано»</span> можно периодически обновлять для отслеживания.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Грант (всего)">
                  <input type="number" min="0" step="0.01"
                    value={grantDialog.amount}
                    onChange={e => setGrantDialog({ ...grantDialog, amount: e.target.value })}
                    placeholder="4000"
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none" />
                </Field>
                <Field label="Использовано">
                  <input type="number" min="0" step="0.01"
                    value={grantDialog.used}
                    onChange={e => setGrantDialog({ ...grantDialog, used: e.target.value })}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Истекает">
                  <input type="date"
                    value={grantDialog.expiresAt}
                    onChange={e => setGrantDialog({ ...grantDialog, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none" />
                </Field>
                <Field label="Валюта">
                  <select value={grantDialog.currency}
                    onChange={e => setGrantDialog({ ...grantDialog, currency: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none">
                    <option value="RUB">RUB</option>
                    <option value="USD">USD</option>
                    <option value="KZT">KZT</option>
                    <option value="BYN">BYN</option>
                  </select>
                </Field>
              </div>
              <Field label="Заметка (опц.)">
                <input value={grantDialog.notes}
                  onChange={e => setGrantDialog({ ...grantDialog, notes: e.target.value })}
                  placeholder="Стартовый грант 60 дней"
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none" />
              </Field>
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2">
              <button onClick={() => setGrantDialog(null)} className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg">
                Отмена
              </button>
              <button onClick={saveGrant}
                className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-lg hover:shadow-lg hover:shadow-amber-500/30 flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5" /> Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GrantCard({ grant, onEdit, onClear }) {
  // Если данные не введены — компактный empty-state с кнопкой
  if (!grant) {
    return (
      <button onClick={onEdit}
        className="w-full p-4 rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/50 transition flex items-center gap-3 text-left">
        <Gift className="w-5 h-5 text-amber-400 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-200">Указать данные гранта</div>
          <div className="text-[11px] text-amber-200/70">YC не отдаёт сумму гранта в API. Можешь вписать вручную для отображения остатка и срока.</div>
        </div>
        <Plus className="w-4 h-4 text-amber-300" />
      </button>
    )
  }

  const pct = grant.total > 0 ? Math.min(100, Math.round((grant.used / grant.total) * 100)) : 0
  const expired = grant.expired
  const soonExpiring = grant.daysLeft != null && grant.daysLeft >= 0 && grant.daysLeft <= 7

  return (
    <div className={`rounded-2xl p-5 border ${
      expired
        ? 'bg-red-500/5 border-red-500/30'
        : soonExpiring
          ? 'bg-amber-500/10 border-amber-500/40'
          : 'bg-gradient-to-br from-amber-900/20 via-slate-900/60 to-orange-900/10 border-amber-500/30'
    }`}>
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${
          expired ? 'bg-red-500/20 shadow-red-500/20' : 'bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/30'
        }`}>
          <Gift className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <div className="text-[11px] uppercase font-bold text-amber-300/80 tracking-wider">Грант от YC</div>
            {expired && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 border border-red-500/40 text-red-300">истёк</span>
            )}
            {!expired && soonExpiring && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 border border-amber-500/40 text-amber-300">скоро истечёт</span>
            )}
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className={`text-2xl sm:text-3xl font-bold font-mono ${expired ? 'text-red-300/60 line-through' : 'text-white'}`}>
              {Number(grant.remaining).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
            </div>
            <span className="text-sm text-slate-400">{grant.currency}</span>
            <span className="text-[11px] text-slate-500">из {Number(grant.total).toLocaleString('ru-RU')}</span>
          </div>
          {grant.daysLeft != null && (
            <div className="text-[11px] text-slate-400 mt-1">
              {expired
                ? <>Истёк {new Date(grant.expiresAt).toLocaleDateString('ru-RU')}</>
                : <>Осталось <span className={`font-bold ${soonExpiring ? 'text-amber-300' : 'text-slate-200'}`}>{grant.daysLeft}</span> {grant.daysLeft === 1 ? 'день' : grant.daysLeft < 5 ? 'дня' : 'дней'} (до {new Date(grant.expiresAt).toLocaleDateString('ru-RU')})</>}
            </div>
          )}
          {grant.notes && (
            <div className="text-[11px] text-slate-500 mt-1 italic truncate">{grant.notes}</div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={onEdit} title="Изменить" className="w-8 h-8 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClear} title="Удалить данные о гранте" className="w-8 h-8 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-red-300 flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>Использовано: <span className="text-slate-300 font-mono">{Number(grant.used).toLocaleString('ru-RU')} {grant.currency}</span></span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-slate-900/60 border border-slate-800 rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-300 ${
            expired ? 'bg-red-500/40'
            : pct >= 90 ? 'bg-gradient-to-r from-red-500 to-orange-500'
            : pct >= 60 ? 'bg-gradient-to-r from-amber-500 to-orange-500'
            : 'bg-gradient-to-r from-emerald-500 to-amber-500'
          }`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-slate-800/40 last:border-0">
      <div className="text-[11px] font-semibold text-slate-500 uppercase">{label}</div>
      <div className="text-sm text-slate-200 font-mono truncate">{children}</div>
    </div>
  )
}

// ─── IpSearchTab (этап 5: поиск IP в CIDR) ─────────────────────────────────

const HARD_CAP = 50

function IpSearchTab({ account }) {
  const [folderId, setFolderId] = useState(account.default_folder_id || '')
  const [form, setForm] = useState({ cidrsText: '', zoneId: 'ru-central1-a', maxAttempts: 30, namePrefix: '' })
  const [activeJob, setActiveJob] = useState(null)   // полный объект job из БД
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [fileError, setFileError] = useState(null)
  const fileInputRef = useRef(null)
  const pollRef = useRef(null)

  // CIDR-списки
  const [savedLists, setSavedLists] = useState([])
  const [activeListId, setActiveListId] = useState(null)
  const [listsLoading, setListsLoading] = useState(false)
  const [saveDialog, setSaveDialog] = useState(null) // { mode: 'create'|'update', name, description, listId? }

  // Парсер ввода CIDR — поддерживает: новые строки, запятые, пробелы, # комментарии
  const parsedCidrs = useMemo(() => {
    const all = form.cidrsText
      .split(/[\n,;]+/)
      .map(s => s.replace(/#.*$/, '').trim())
      .filter(s => s.length > 0)
    return [...new Set(all)] // dedupe
  }, [form.cidrsText])

  const cidrValidation = useMemo(() => {
    if (parsedCidrs.length === 0) return { ok: false, error: null }
    const re = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/
    const invalid = parsedCidrs.find(c => !re.test(c))
    if (invalid) return { ok: false, error: `Невалидный CIDR: ${invalid}` }
    if (parsedCidrs.length > 100) return { ok: false, error: 'Максимум 100 CIDR за раз' }
    return { ok: true, count: parsedCidrs.length }
  }, [parsedCidrs])

  useEffect(() => { setFolderId(account.default_folder_id || '') }, [account.id])
  useEffect(() => { loadHistory(); loadSavedLists(); setActiveListId(null) }, [account.id])

  async function loadSavedLists() {
    setListsLoading(true)
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/cidr-lists`, { headers: authHeaders() })
      const d = await res.json()
      if (res.ok) setSavedLists(d.lists || [])
    } catch {}
    finally { setListsLoading(false) }
  }

  function applyList(list) {
    setActiveListId(list.id)
    const text = (list.cidrs || []).join('\n')
    setForm(f => ({ ...f, cidrsText: text }))
  }

  async function saveCurrentAsList() {
    if (parsedCidrs.length === 0) { setError('Сначала добавь хотя бы один CIDR'); return }
    if (!cidrValidation.ok) { setError(cidrValidation.error); return }
    setSaveDialog({ mode: 'create', name: '', description: '' })
  }

  async function commitSave() {
    if (!saveDialog) return
    const { mode, name, description, listId } = saveDialog
    if (mode === 'create' && !name.trim()) { setError('Имя списка обязательно'); return }
    try {
      const url = mode === 'create'
        ? `${API}/api/admin/yandex-cloud/accounts/${account.id}/cidr-lists`
        : `${API}/api/admin/yandex-cloud/accounts/${account.id}/cidr-lists/${listId}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const body = mode === 'create'
        ? { name: name.trim(), description: description || null, cidrs: parsedCidrs }
        : { cidrs: parsedCidrs }
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      await loadSavedLists()
      setActiveListId(d.list?.id || listId)
      setSaveDialog(null)
    } catch (e) { setError(e.message) }
  }

  async function deleteList(list) {
    if (!confirm(`Удалить список «${list.name}» (${list.cidrs_count || (list.cidrs || []).length} CIDR)?`)) return
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/cidr-lists/${list.id}`, {
        method: 'DELETE', headers: authHeaders(),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      if (activeListId === list.id) setActiveListId(null)
      loadSavedLists()
    } catch (e) { setError(e.message) }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/jobs?limit=20`, { headers: authHeaders() })
      const d = await res.json()
      if (res.ok) setHistory(d.jobs || [])
    } catch {}
  }

  async function startSearch() {
    setError(null)
    if (!folderId) { setError('Укажи folderId'); return }
    if (parsedCidrs.length === 0) { setError('Добавь хотя бы один CIDR'); return }
    if (!cidrValidation.ok) { setError(cidrValidation.error); return }

    const cap = Math.min(parseInt(form.maxAttempts) || 30, HARD_CAP)
    const estCost = (cap * 0.005).toFixed(2)
    const cidrSummary = parsedCidrs.length === 1
      ? parsedCidrs[0]
      : `${parsedCidrs.length} диапазонов: ${parsedCidrs.slice(0, 3).join(', ')}${parsedCidrs.length > 3 ? '...' : ''}`
    if (!confirm(
      `Запустить поиск IP в ${cidrSummary}?\n\n` +
      `До ${cap} попыток alloc/release. Каждая стоит ~0.005₽ — итого до ${estCost}₽ если ничего не найдём.\n\n` +
      `Продолжить?`
    )) return

    setStarting(true)
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/ip-search`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          cidrs: parsedCidrs,
          zoneId: form.zoneId,
          maxAttempts: cap,
          namePrefix: form.namePrefix,
          folderId,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      startPolling(d.jobId)
    } catch (e) { setError(e.message) }
    finally { setStarting(false) }
  }

  function onFilePicked(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // чтобы можно было выбрать тот же файл повторно
    if (!file) return
    setFileError(null)
    if (file.size > 1024 * 100) { setFileError('Файл больше 100 KB'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      // Просто добавим текст в textarea — парсер ниже сам всё нормализует
      setForm(f => ({
        ...f,
        cidrsText: f.cidrsText.trim()
          ? `${f.cidrsText.trim()}\n${text}`
          : text,
      }))
    }
    reader.onerror = () => setFileError('Не удалось прочитать файл')
    reader.readAsText(file, 'utf-8')
  }

  function startPolling(jobId) {
    stopPolling()
    const tick = async () => {
      try {
        const res = await fetch(`${API}/api/admin/yandex-cloud/jobs/${jobId}`, { headers: authHeaders() })
        const d = await res.json()
        if (res.ok && d.job) {
          setActiveJob(d.job)
          // Завершён? — стопаем поллинг и обновляем историю
          if (['done', 'failed', 'cancelled'].includes(d.job.status)) {
            stopPolling()
            loadHistory()
          }
        }
      } catch {}
    }
    tick()
    pollRef.current = setInterval(tick, 2000)
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => () => stopPolling(), [])

  async function cancelActive() {
    if (!activeJob) return
    if (!confirm('Отменить поиск? Текущая аллокация всё равно освободится.')) return
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/jobs/${activeJob.id}/cancel`, {
        method: 'POST', headers: authHeaders(),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
    } catch (e) { setError(e.message) }
  }

  const isRunning = activeJob && ['pending', 'running'].includes(activeJob.status)
  const progress = activeJob?.progress || {}
  const cap = progress.cap || activeJob?.params?.maxAttempts || 30
  const tried = progress.tried || 0
  const found = progress.found || 0
  const pct = cap > 0 ? Math.min(100, Math.round((tried / cap) * 100)) : 0

  return (
    <div className="space-y-3">
      {/* Cost warning */}
      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>Каждая попытка alloc/release реально тратит деньги</strong> (~0.005₽). Hard-cap {HARD_CAP} попыток.
          Yandex.Cloud не позволяет выбрать конкретный IP — поэтому это «брутфорс» из общего пула.
        </span>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Form */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Target className="w-5 h-5 text-blue-400" />
          <div className="text-base font-bold text-white">Параметры поиска</div>
        </div>

        {/* Сохранённые списки CIDR (per account) */}
        <div className="bg-slate-950/40 border border-slate-700/40 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-300 uppercase">
              <Bookmark className="w-3.5 h-3.5 text-blue-400" />
              Сохранённые списки CIDR
              {savedLists.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-400">{savedLists.length}</span>
              )}
            </div>
            <div className="flex gap-1.5">
              {parsedCidrs.length > 0 && cidrValidation.ok && (
                <button
                  type="button"
                  onClick={activeListId
                    ? () => setSaveDialog({
                        mode: 'update',
                        listId: activeListId,
                        name: savedLists.find(l => l.id === activeListId)?.name || '',
                        description: savedLists.find(l => l.id === activeListId)?.description || '',
                      })
                    : saveCurrentAsList
                  }
                  disabled={isRunning}
                  className="px-2.5 py-1 text-[11px] font-bold bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 rounded-lg hover:bg-emerald-500/25 transition flex items-center gap-1 disabled:opacity-50"
                  title={activeListId ? 'Перезаписать выбранный список текущим содержимым' : 'Сохранить текущие CIDR как новый список'}
                >
                  <Save className="w-3 h-3" /> {activeListId ? 'Обновить' : 'Сохранить'}
                </button>
              )}
              {parsedCidrs.length > 0 && cidrValidation.ok && activeListId && (
                <button
                  type="button"
                  onClick={() => setSaveDialog({ mode: 'create', name: '', description: '' })}
                  disabled={isRunning}
                  className="px-2.5 py-1 text-[11px] font-bold bg-slate-800 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-700 transition flex items-center gap-1 disabled:opacity-50"
                  title="Сохранить как новый список (не перезаписывая выбранный)"
                >
                  <Plus className="w-3 h-3" /> Новый
                </button>
              )}
            </div>
          </div>
          {listsLoading && savedLists.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic px-1 py-2 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" /> Загрузка...
            </div>
          ) : savedLists.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic px-1 py-1">
              Списков нет. Заполни textarea ниже и нажми «Сохранить» чтобы оставить на потом — будет видно для аккаунта <span className="font-mono text-slate-400">{account.name}</span>.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {savedLists.map(l => {
                const active = activeListId === l.id
                return (
                  <div key={l.id} className={`group flex items-center gap-1 rounded-lg border transition ${
                    active
                      ? 'bg-blue-500/15 border-blue-500/40'
                      : 'bg-slate-900/40 border-slate-700/40 hover:border-slate-600'
                  }`}>
                    <button
                      type="button"
                      onClick={() => applyList(l)}
                      disabled={isRunning}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] disabled:opacity-50"
                      title={l.description || `${l.cidrs_count || (l.cidrs || []).length} CIDR`}
                    >
                      <Folder className={`w-3 h-3 ${active ? 'text-blue-300' : 'text-slate-500'}`} />
                      <span className={`sensitive ${active ? 'text-blue-200 font-bold' : 'text-slate-300'}`}>{l.name}</span>
                      <span className="text-[9px] font-mono text-slate-500">{l.cidrs_count || (l.cidrs || []).length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteList(l)}
                      disabled={isRunning}
                      title="Удалить список"
                      className="px-1.5 py-1 text-slate-500 hover:text-red-300 opacity-0 group-hover:opacity-100 transition disabled:hidden"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* CIDR — textarea + file upload, на всю ширину */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-300">
              CIDR диапазоны <span className="text-red-400">*</span>
              {cidrValidation.count > 0 && (
                <span className="ml-2 text-[11px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300">
                  {cidrValidation.count} {cidrValidation.count === 1 ? 'диапазон' : cidrValidation.count < 5 ? 'диапазона' : 'диапазонов'}
                </span>
              )}
              {activeListId && (
                <span className="ml-2 text-[10px] font-medium text-blue-300 inline-flex items-center gap-1">
                  <Folder className="w-3 h-3" /> {savedLists.find(l => l.id === activeListId)?.name}
                </span>
              )}
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRunning}
                className="px-2.5 py-1 text-[11px] font-bold bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-lg hover:bg-cyan-500/25 transition flex items-center gap-1 disabled:opacity-50"
                title="Загрузить из .txt — по одному CIDR на строку"
              >
                <Upload className="w-3 h-3" /> Из .txt
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv,.list,text/plain"
                onChange={onFilePicked}
                className="hidden"
              />
              {form.cidrsText && !isRunning && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, cidrsText: '' }))}
                  className="px-2.5 py-1 text-[11px] font-bold bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 rounded-lg transition flex items-center gap-1"
                  title="Очистить"
                >
                  <X className="w-3 h-3" /> Очистить
                </button>
              )}
            </div>
          </div>
          <textarea
            value={form.cidrsText}
            onChange={e => setForm({ ...form, cidrsText: e.target.value })}
            disabled={isRunning}
            rows={5}
            placeholder={'5.45.64.0/20\n89.169.0.0/16   # коммент после #\n178.154.0.0/16'}
            className={`w-full px-3 py-2.5 bg-slate-950/60 border rounded-lg text-white text-xs font-mono focus:outline-none disabled:opacity-50 resize-y ${
              cidrValidation.error
                ? 'border-red-500/40 focus:border-red-500'
                : cidrValidation.ok
                  ? 'border-emerald-500/30 focus:border-emerald-500'
                  : 'border-slate-700 focus:border-blue-500'
            }`}
          />
          <div className="flex items-start justify-between gap-2 mt-1.5">
            <div className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Один CIDR на строку (или через запятую). Поддерживаются комментарии после <span className="text-slate-400 font-mono">#</span>.
                Маска 8-32. Дубли убираются автоматически. Макс 100 диапазонов.
              </span>
            </div>
          </div>
          {(cidrValidation.error || fileError) && (
            <div className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {cidrValidation.error || fileError}
            </div>
          )}
          {cidrValidation.ok && parsedCidrs.length > 1 && (
            <details className="mt-2">
              <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300 inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Распознано {parsedCidrs.length} диапазонов
              </summary>
              <div className="mt-1.5 max-h-32 overflow-y-auto bg-slate-950/40 border border-slate-800 rounded-lg p-2 flex flex-wrap gap-1">
                {parsedCidrs.map((c, i) => (
                  <span key={i} className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700/50 text-slate-300 rounded">
                    {c}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Folder ID" required>
            <input value={folderId} onChange={e => setFolderId(e.target.value)}
              disabled={isRunning}
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none disabled:opacity-50" />
          </Field>
          <Field label="Зона">
            <select value={form.zoneId} onChange={e => setForm({ ...form, zoneId: e.target.value })} disabled={isRunning}
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50">
              <option value="ru-central1-a">ru-central1-a</option>
              <option value="ru-central1-b">ru-central1-b</option>
              <option value="ru-central1-d">ru-central1-d</option>
            </select>
          </Field>
          <Field label={`Max попыток (1–${HARD_CAP})`} hint={`До ${(form.maxAttempts * 0.005).toFixed(2)}₽ если ничего не найдём`}>
            <input type="number" min="1" max={HARD_CAP} value={form.maxAttempts}
              onChange={e => setForm({ ...form, maxAttempts: Math.min(HARD_CAP, parseInt(e.target.value) || 1) })}
              disabled={isRunning}
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none disabled:opacity-50" />
          </Field>
          <Field label="Префикс имени найденного IP (опц.)" hint="Если задан — найденный адрес будет назван prefix-IP. Например prefix=ru-cdn → ru-cdn-5-45-71-42">
            <input value={form.namePrefix} onChange={e => setForm({ ...form, namePrefix: e.target.value })}
              placeholder="ru-cdn"
              disabled={isRunning}
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {isRunning ? (
            <button onClick={cancelActive}
              className="px-5 py-2 bg-red-500/15 border border-red-500/40 text-red-300 rounded-lg text-xs font-bold hover:bg-red-500/25 flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" /> Отменить поиск
            </button>
          ) : (
            <button onClick={startSearch} disabled={starting || account.is_readonly}
              className="px-5 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 flex items-center gap-1.5"
              title={account.is_readonly ? 'Аккаунт в read-only — поиск IP создаёт ресурсы' : ''}>
              <Search className="w-3.5 h-3.5" /> Начать поиск
            </button>
          )}
        </div>
      </div>

      {/* Active job progress */}
      {activeJob && <JobCard job={activeJob} cap={cap} tried={tried} found={found} pct={pct} />}

      {/* Save list dialog */}
      {saveDialog && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
              <Bookmark className="w-5 h-5 text-blue-400" />
              <div className="flex-1 text-sm font-bold text-white">
                {saveDialog.mode === 'create' ? 'Сохранить список CIDR' : 'Перезаписать список'}
              </div>
              <button onClick={() => setSaveDialog(null)} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-[11px] text-slate-400">
                Будет сохранено <span className="font-bold text-white">{parsedCidrs.length}</span>{' '}
                {parsedCidrs.length === 1 ? 'CIDR' : parsedCidrs.length < 5 ? 'CIDR' : 'CIDR'} для аккаунта{' '}
                <span className="font-mono text-slate-300">{account.name}</span>
              </div>
              <Field label="Имя списка" required>
                <input
                  value={saveDialog.name}
                  onChange={e => setSaveDialog({ ...saveDialog, name: e.target.value.slice(0, 128) })}
                  disabled={saveDialog.mode === 'update'}
                  placeholder="Yandex DC ranges"
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60"
                />
              </Field>
              <Field label="Описание (опц.)">
                <textarea
                  value={saveDialog.description}
                  onChange={e => setSaveDialog({ ...saveDialog, description: e.target.value })}
                  rows={2}
                  disabled={saveDialog.mode === 'update'}
                  placeholder="Откуда взят список, для чего нужен..."
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60 resize-none"
                />
              </Field>
              {saveDialog.mode === 'update' && (
                <div className="text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-start gap-1.5">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  CIDR-список будет полностью заменён. Имя и описание не изменятся.
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2">
              <button onClick={() => setSaveDialog(null)} className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg">
                Отмена
              </button>
              <button onClick={commitSave}
                className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold rounded-lg hover:shadow-lg hover:shadow-emerald-500/30 flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5" /> {saveDialog.mode === 'create' ? 'Сохранить' : 'Обновить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <details className="bg-slate-900/40 border border-slate-800 rounded-2xl">
          <summary className="px-5 py-3 cursor-pointer text-sm font-bold text-slate-300 hover:text-white flex items-center gap-2">
            <History className="w-4 h-4" /> История поисков ({history.length})
          </summary>
          <div className="border-t border-slate-800 p-3 space-y-2">
            {history.map(j => <HistoryRow key={j.id} job={j} onSelect={() => setActiveJob(j)} />)}
          </div>
        </details>
      )}
    </div>
  )
}

function JobCard({ job, cap, tried, found, pct }) {
  const meta = {
    pending:   { color: 'cyan',    label: 'Ожидание...',  Icon: Hourglass, pulse: true },
    running:   { color: 'cyan',    label: 'Идёт поиск',   Icon: RefreshCw, pulse: true, spin: true },
    done:      { color: 'emerald', label: 'Завершено',    Icon: CheckCircle2 },
    cancelled: { color: 'amber',   label: 'Отменено',     Icon: Ban },
    failed:    { color: 'red',     label: 'Ошибка',       Icon: AlertCircle },
  }[job.status] || { color: 'slate', label: job.status, Icon: AlertCircle }

  const colorMap = {
    cyan:    'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    amber:   'bg-amber-500/10 border-amber-500/30 text-amber-300',
    red:     'bg-red-500/10 border-red-500/30 text-red-300',
    slate:   'bg-slate-700/40 border-slate-700/50 text-slate-300',
  }[meta.color]
  const StatusIcon = meta.Icon
  const found_addr = job.result?.foundAddress
  const attempts = (job.progress?.attempts || []).slice(-30).reverse()

  return (
    <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${colorMap}`}>
          <StatusIcon className={`w-4 h-4 ${meta.spin ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white">
            {meta.label} •{' '}
            {(() => {
              const cs = Array.isArray(job.params?.cidrs) ? job.params.cidrs
                       : job.params?.cidr ? [job.params.cidr]
                       : []
              if (cs.length === 0) return '—'
              if (cs.length === 1) return <span className="font-mono">{cs[0]}</span>
              return <span title={cs.join('\n')}><span className="font-mono">{cs.length} CIDR</span></span>
            })()}
          </div>
          <div className="text-[11px] text-slate-500">
            Job #{job.id} • {job.params?.zoneId}
            {job.started_at && ` • запуск ${new Date(job.started_at).toLocaleTimeString('ru-RU')}`}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-[11px] text-slate-400 mb-1.5">
          <span>Попыток: <span className="text-white font-semibold font-mono">{tried}</span> / {cap}</span>
          <span>Найдено: <span className={`font-semibold font-mono ${found > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>{found}</span></span>
        </div>
        <div className="h-2 bg-slate-900/60 border border-slate-800 rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-300 ${
            job.status === 'done' && found > 0 ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
            : job.status === 'failed' ? 'bg-gradient-to-r from-red-500 to-orange-500'
            : 'bg-gradient-to-r from-blue-500 to-cyan-500'
          }`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Found address */}
      {found_addr && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <div className="text-sm font-bold text-white">Найден IP в диапазоне!</div>
          </div>
          <div className="font-mono text-xl text-emerald-300 mb-1">{found_addr.ip}</div>
          <div className="text-[11px] text-slate-400 space-y-0.5">
            <div>
              ID: <span className="font-mono">{found_addr.id}</span>
              {found_addr.name && <span> • Имя: <span className="font-mono">{found_addr.name}</span></span>}
              <span> • <span className={found_addr.reserved ? 'text-amber-300' : 'text-slate-400'}>{found_addr.reserved ? '📌 static (зарезервирован)' : 'ephemeral'}</span></span>
            </div>
            {found_addr.matchedCidr && (
              <div>
                Совпал с диапазоном: <span className="font-mono text-emerald-200 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30">{found_addr.matchedCidr}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {job.error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
          <div className="font-semibold mb-1">Ошибка</div>
          <div className="font-mono break-all">{job.error}</div>
        </div>
      )}

      {/* Attempts log — последние 30 */}
      {attempts.length > 0 && (
        <details className="bg-slate-950/40 border border-slate-800 rounded-xl">
          <summary className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase cursor-pointer hover:text-slate-200">
            Лог попыток ({attempts.length})
          </summary>
          <div className="border-t border-slate-800 max-h-72 overflow-y-auto">
            {attempts.map(a => (
              <div key={a.n} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-slate-800/40 last:border-0">
                <span className="text-slate-600 font-mono w-8 text-right">#{a.n}</span>
                {a.error ? <AlertCircle className="w-3 h-3 text-red-400" />
                  : a.matched ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  : <span className="w-3 h-3 rounded-full bg-slate-600" />}
                <span className="font-mono text-slate-300 flex-1 truncate">
                  {a.ip || (a.error ? '—' : '...')}
                </span>
                {a.matched && (
                  <span className="text-[10px] text-emerald-300 font-semibold flex items-center gap-1">
                    ✓ MATCH
                    {a.matchedCidr && (
                      <span className="font-mono text-emerald-200/80 px-1 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30">{a.matchedCidr}</span>
                    )}
                  </span>
                )}
                {a.error && <span className="text-[10px] text-red-400 font-mono truncate max-w-[200px]" title={a.error}>{a.error}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ─── CreateVmModal ──────────────────────────────────────────────────────────

const CPU_PRESETS = [
  { cores: 2,  memoryGb: 2,  label: '2 vCPU / 2 GB',  hint: 'минимум для Linux' },
  { cores: 2,  memoryGb: 4,  label: '2 vCPU / 4 GB',  hint: 'базовый сервер' },
  { cores: 4,  memoryGb: 8,  label: '4 vCPU / 8 GB',  hint: 'app server' },
  { cores: 8,  memoryGb: 16, label: '8 vCPU / 16 GB', hint: 'нагруженный' },
]

function CreateVmModal({ account, folderId, onClose, onCreated }) {
  const [catalog, setCatalog] = useState(null)
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    zoneId: 'ru-central1-a',
    platformId: 'standard-v3',
    cores: 2,
    memoryGb: 2,
    coreFraction: 100,
    subnetId: '',
    publicIp: true,
    ipSource: 'new',           // 'new' | 'existing'
    staticIpAddress: '',       // выбранный existing IP
    imageFamily: 'ubuntu-2204-lts',
    diskType: 'network-ssd',
    diskSizeGb: 20,
    sshKeySource: 'paste',     // 'paste' | 'saved' | 'generate'
    sshKeyId: null,            // id выбранного сохранённого ключа
    sshKey: '',
    sshUser: 'ubuntu',
    sshGenerateAlgo: 'ed25519', // 'ed25519' | 'rsa-4096' — для sshKeySource='generate'
    preemptible: false,
    addToVps: true,             // авто-создать запись в /admin/vps для управления
    vpsServiceType: 'other',    // 'node' | 'panel' | 'other'
  })

  function setField(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  const sshFileInputRef = useRef(null)
  const [saveSshDialog, setSaveSshDialog] = useState(null) // { name, default_user, notes }
  const [sshFileError, setSshFileError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Загружаем каталог (subnets / images / platforms / zones / disk types)
  useEffect(() => {
    setLoadingCatalog(true)
    fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/catalog?folderId=${encodeURIComponent(folderId)}`, {
      headers: authHeaders(),
    })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d })
      .then(d => {
        setCatalog(d)
        // Автовыбор: subnet под выбранной зоной
        const sub = (d.subnets || []).find(s => s.zoneId === form.zoneId)
        if (sub) setField('subnetId', sub.id)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingCatalog(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, folderId])

  // Когда меняется зона — переключаем subnet на тот, что в этой зоне (если есть)
  useEffect(() => {
    if (!catalog?.subnets) return
    const sub = catalog.subnets.find(s => s.zoneId === form.zoneId)
    if (sub && sub.id !== form.subnetId) setField('subnetId', sub.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.zoneId])

  // Когда меняется imageFamily — обновляем sshUser на дефолтный
  useEffect(() => {
    if (!catalog?.images) return
    const fam = catalog.images.find(i => i.family === form.imageFamily)
    if (fam?.defaultUser) setField('sshUser', fam.defaultUser)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.imageFamily])

  async function submit() {
    setError(null)
    if (!form.subnetId) { setError('Выбери подсеть'); return }
    if (!form.imageFamily) { setError('Выбери образ ОС'); return }
    if (!form.cores || !form.memoryGb) { setError('Укажи CPU и RAM'); return }
    if (form.diskSizeGb < 10) { setError('Минимальный размер диска — 10 GB'); return }

    // SSH-ключ: либо sshKeyId (сохранённый), либо raw в form.sshKey
    if (form.sshKeySource === 'saved' && !form.sshKeyId) {
      setError('Выбери SSH-ключ из списка или переключись на «Вставить ключ»')
      return
    }
    if (form.sshKeySource === 'paste' && form.sshKey && !/^(ssh-rsa|ssh-ed25519|ecdsa-sha2)/.test(form.sshKey.trim())) {
      setError('SSH-ключ должен начинаться с ssh-rsa / ssh-ed25519 / ecdsa-sha2')
      return
    }
    if (form.publicIp && form.ipSource === 'existing' && !form.staticIpAddress) {
      setError('Выбери существующий static IP или переключись на «Новый ephemeral»')
      return
    }

    const ipDescr = !form.publicIp ? 'нет'
      : form.ipSource === 'existing' ? `закрепить ${form.staticIpAddress}`
      : 'новый ephemeral'

    if (!confirm(
      `Создать VM «${form.name || '(без имени)'}»?\n\n` +
      `${form.cores} vCPU / ${form.memoryGb} GB RAM / ${form.diskSizeGb} GB ${form.diskType}\n` +
      `Зона: ${form.zoneId}\n` +
      `ОС: ${form.imageFamily}\n` +
      `Публичный IP: ${ipDescr}\n` +
      `${form.preemptible ? '⚠️ Прерываемая (preemptible) — YC может остановить в любой момент\n' : ''}` +
      `\nVM начнёт тарифицироваться сразу после создания. Продолжить?`
    )) return

    setCreating(true)
    try {
      // Готовим payload — отправляем только нужные поля
      const payload = {
        name: form.name, description: form.description,
        zoneId: form.zoneId, platformId: form.platformId,
        cores: form.cores, memoryGb: form.memoryGb, coreFraction: form.coreFraction,
        subnetId: form.subnetId,
        publicIp: form.publicIp,
        imageFamily: form.imageFamily,
        diskType: form.diskType, diskSizeGb: form.diskSizeGb,
        preemptible: form.preemptible,
        folderId,
      }
      if (form.publicIp && form.ipSource === 'existing' && form.staticIpAddress) {
        payload.staticIpAddress = form.staticIpAddress
      }
      if (form.sshKeySource === 'saved' && form.sshKeyId) {
        payload.sshKeyId = form.sshKeyId
      } else if (form.sshKeySource === 'generate') {
        payload.generateKey = { algo: form.sshGenerateAlgo }
        payload.sshUser = form.sshUser
      } else if (form.sshKey) {
        payload.sshKey = form.sshKey
        payload.sshUser = form.sshUser
      }

      // Этап 3: автосоздание VPS-записи для управления через /admin/vps
      if (form.addToVps) {
        payload.addToVps = true
        payload.vpsServiceType = form.vpsServiceType
      }

      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/instances`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      // Если был auto-gen — передаём приватник наверх через onCreated(generatedKey),
      // там покажется модалка скачивания
      onCreated(d.generatedKey || null)
    } catch (e) { setError(e.message) }
    finally { setCreating(false) }
  }

  function onSshFilePicked(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSshFileError(null)
    if (file.size > 10 * 1024) { setSshFileError('Файл слишком большой (>10 KB)'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '').trim()
      if (!/^(ssh-rsa|ssh-ed25519|ecdsa-sha2)/.test(text)) {
        setSshFileError('Файл не содержит публичного SSH-ключа (нет префикса ssh-rsa/ssh-ed25519/ecdsa-sha2)')
        return
      }
      setField('sshKey', text)
      setField('sshKeySource', 'paste')
    }
    reader.onerror = () => setSshFileError('Не удалось прочитать файл')
    reader.readAsText(file, 'utf-8')
  }

  async function saveSshKey() {
    if (!form.sshKey.trim()) { setError('Сначала вставь или загрузи ключ'); return }
    setSaveSshDialog({
      name: '',
      default_user: form.sshUser || 'ubuntu',
      notes: '',
      private_key: '',  // опционально — нужен для управления VM через /admin/vps
    })
  }

  async function commitSaveSshKey() {
    if (!saveSshDialog?.name?.trim()) { setError('Имя обязательно'); return }
    setBusy(true)
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/ssh-keys`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          name: saveSshDialog.name.trim(),
          public_key: form.sshKey,
          private_key: saveSshDialog.private_key?.trim() || undefined,
          default_user: saveSshDialog.default_user,
          notes: saveSshDialog.notes || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      // Перезагрузим catalog чтоб обновился список ключей
      const catRes = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/catalog?folderId=${encodeURIComponent(folderId)}`, { headers: authHeaders() })
      const catData = await catRes.json()
      if (catRes.ok) setCatalog(catData)
      // Переключаемся на сохранённый ключ
      setField('sshKeySource', 'saved')
      setField('sshKeyId', d.key.id)
      setSaveSshDialog(null)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function deleteSshKey(key) {
    if (!confirm(`Удалить ключ «${key.name}» из сохранённых? Сам ключ на сервере не удалится.`)) return
    try {
      const res = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/ssh-keys/${key.id}`, {
        method: 'DELETE', headers: authHeaders(),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка')
      // Перезагружаем catalog
      const catRes = await fetch(`${API}/api/admin/yandex-cloud/accounts/${account.id}/catalog?folderId=${encodeURIComponent(folderId)}`, { headers: authHeaders() })
      const catData = await catRes.json()
      if (catRes.ok) setCatalog(catData)
      if (form.sshKeyId === key.id) setField('sshKeyId', null)
    } catch (e) { setError(e.message) }
  }

  const subnetsInZone = (catalog?.subnets || []).filter(s => s.zoneId === form.zoneId)
  const selectedFamily = catalog?.images?.find(i => i.family === form.imageFamily)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800 px-6 py-4 flex items-center gap-3 z-10">
          <Server className="w-5 h-5 text-blue-400" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Создание виртуальной машины</div>
            <div className="text-[11px] text-slate-500">Folder: <span className="font-mono">{folderId}</span></div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {loadingCatalog ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
              <span className="ml-3 text-slate-400 text-sm">Загрузка каталога подсетей и образов...</span>
            </div>
          ) : (
            <>
              {/* Базовые поля */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Имя VM" hint="Латиница, цифры, дефис. До 63 символов.">
                  <input value={form.name} onChange={e => setField('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63))}
                    placeholder="vm-prod-01"
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none" />
                </Field>
                <Field label="Описание (опц.)">
                  <input value={form.description} onChange={e => setField('description', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none" />
                </Field>
              </div>

              {/* Зона + платформа */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Зона" required>
                  <select value={form.zoneId} onChange={e => setField('zoneId', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
                    {(catalog?.zones || []).map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                  </select>
                </Field>
                <Field label="Платформа CPU" required>
                  <select value={form.platformId} onChange={e => setField('platformId', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
                    {(catalog?.platforms || []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </Field>
              </div>

              {/* CPU/RAM пресеты */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Конфигурация (пресеты)</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                  {CPU_PRESETS.map((p, i) => {
                    const active = form.cores === p.cores && form.memoryGb === p.memoryGb
                    return (
                      <button key={i} type="button"
                        onClick={() => { setField('cores', p.cores); setField('memoryGb', p.memoryGb) }}
                        className={`px-3 py-2 rounded-lg border text-left transition ${
                          active ? 'bg-blue-500/20 border-blue-500/50' : 'bg-slate-950/60 border-slate-700 hover:border-slate-600'
                        }`}>
                        <div className="text-sm font-bold text-white">{p.label}</div>
                        <div className="text-[10px] text-slate-500">{p.hint}</div>
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="vCPU">
                    <input type="number" min="2" max="64" value={form.cores}
                      onChange={e => setField('cores', parseInt(e.target.value) || 2)}
                      className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none" />
                  </Field>
                  <Field label="RAM (GB)">
                    <input type="number" min="1" max="256" value={form.memoryGb}
                      onChange={e => setField('memoryGb', parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none" />
                  </Field>
                  <Field label="Core fraction (%)" hint="100 = full, 50/20/5 = burstable (дешевле)">
                    <select value={form.coreFraction} onChange={e => setField('coreFraction', parseInt(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
                      <option value="100">100% (full)</option>
                      <option value="50">50%</option>
                      <option value="20">20% (cheap)</option>
                      <option value="5">5% (cheapest)</option>
                    </select>
                  </Field>
                </div>
              </div>

              {/* OS image */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Операционная система <span className="text-red-400">*</span></label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {(catalog?.images || []).map(i => {
                    const active = form.imageFamily === i.family
                    const broken = !!i.error
                    return (
                      <button key={i.family} type="button"
                        onClick={() => !broken && setField('imageFamily', i.family)}
                        disabled={broken}
                        title={broken ? i.error : i.imageName}
                        className={`px-3 py-2 rounded-lg border text-left transition ${
                          active ? 'bg-blue-500/20 border-blue-500/50' :
                          broken ? 'bg-slate-900/30 border-slate-800 opacity-50 cursor-not-allowed' :
                          'bg-slate-950/60 border-slate-700 hover:border-slate-600'
                        }`}>
                        <div className="text-sm font-bold text-white">{i.label}</div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">{i.family}</div>
                      </button>
                    )
                  })}
                </div>
                {selectedFamily?.imageId && (
                  <div className="text-[10px] text-slate-500 mt-1.5 font-mono">
                    Image: {selectedFamily.imageName} ({selectedFamily.imageId})
                  </div>
                )}
              </div>

              {/* Disk */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Тип диска">
                  <select value={form.diskType} onChange={e => setField('diskType', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
                    {(catalog?.diskTypes || []).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </Field>
                <Field label="Размер диска (GB)">
                  <input type="number" min="10" max="1024" value={form.diskSizeGb}
                    onChange={e => setField('diskSizeGb', parseInt(e.target.value) || 10)}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none" />
                </Field>
              </div>

              {/* Network */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  label="Подсеть"
                  required
                  hint={subnetsInZone.length === 0 ? 'В выбранной зоне нет подсетей. Создай в YC-консоли.' : undefined}
                >
                  <select
                    value={form.subnetId}
                    onChange={e => setField('subnetId', e.target.value)}
                    disabled={subnetsInZone.length === 0}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
                  >
                    {subnetsInZone.length === 0 && <option value="">— нет подсетей в зоне —</option>}
                    {subnetsInZone.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.v4CidrBlocks?.[0] || s.id})
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-slate-700/40 bg-slate-950/40 cursor-pointer hover:border-blue-500/40 mt-6">
                  <input type="checkbox" checked={form.publicIp} onChange={e => setField('publicIp', e.target.checked)} className="w-4 h-4 mt-0.5 accent-blue-500" />
                  <div>
                    <div className="text-sm text-white font-medium">Публичный IPv4</div>
                    <div className="text-[11px] text-slate-500">Для SSH-доступа извне</div>
                  </div>
                </label>
              </div>

              {/* IP source — показываем только если включён публичный IP */}
              {form.publicIp && (
                <div className="bg-slate-950/30 border border-slate-700/40 rounded-xl p-4 space-y-3">
                  <div className="text-[11px] font-bold text-slate-300 uppercase">Источник публичного IP</div>
                  <div className="flex gap-1 p-1 bg-slate-950/60 border border-slate-700 rounded-lg">
                    <button type="button"
                      onClick={() => { setField('ipSource', 'new'); setField('staticIpAddress', '') }}
                      className={`flex-1 px-3 py-2 rounded-md text-xs font-bold transition ${
                        form.ipSource === 'new' ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-white'
                      }`}>
                      🆕 Новый ephemeral
                    </button>
                    <button type="button"
                      onClick={() => setField('ipSource', 'existing')}
                      disabled={(catalog?.freeStaticIps || []).length === 0}
                      title={(catalog?.freeStaticIps || []).length === 0 ? 'Нет свободных static IP в этой папке' : ''}
                      className={`flex-1 px-3 py-2 rounded-md text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        form.ipSource === 'existing' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white'
                      }`}>
                      📌 Существующий static
                      {(catalog?.freeStaticIps || []).length > 0 && (
                        <span className="ml-1 text-[10px] font-mono opacity-70">{catalog.freeStaticIps.length}</span>
                      )}
                    </button>
                  </div>
                  {form.ipSource === 'existing' && (
                    <Field label="Выбери static IP" hint="Только зарезервированные и не привязанные к ресурсам адреса">
                      <select value={form.staticIpAddress} onChange={e => setField('staticIpAddress', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none">
                        <option value="">— выбери —</option>
                        {(catalog?.freeStaticIps || []).map(a => (
                          <option key={a.id} value={a.externalIp}>
                            {a.externalIp} {a.name ? `(${a.name})` : ''} • {a.zoneId}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
              )}

              {/* SSH source — switcher: paste / saved */}
              <div className="bg-slate-950/30 border border-slate-700/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold text-slate-300 uppercase">SSH ключ</div>
                  <div className="flex gap-1 p-0.5 bg-slate-950/60 border border-slate-700 rounded-md">
                    <button type="button"
                      onClick={() => setField('sshKeySource', 'paste')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                        form.sshKeySource === 'paste' ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-white'
                      }`}>
                      Вставить
                    </button>
                    <button type="button"
                      onClick={() => setField('sshKeySource', 'saved')}
                      disabled={(catalog?.sshKeys || []).length === 0}
                      title={(catalog?.sshKeys || []).length === 0 ? 'Сохранённых ключей нет — сначала добавь через "Сохранить"' : ''}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        form.sshKeySource === 'saved' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'
                      }`}>
                      Из сохранённых
                      {(catalog?.sshKeys || []).length > 0 && (
                        <span className="ml-1 text-[10px] font-mono opacity-70">{catalog.sshKeys.length}</span>
                      )}
                    </button>
                    <button type="button"
                      onClick={() => setField('sshKeySource', 'generate')}
                      title="Сгенерировать новый pair: public кладётся в VM, private отдадим тебе один раз для скачивания"
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                        form.sshKeySource === 'generate' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white'
                      }`}>
                      🆕 Сгенерировать
                    </button>
                  </div>
                </div>

                {form.sshKeySource === 'saved' ? (
                  <div className="space-y-2">
                    {(catalog?.sshKeys || []).length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic px-1 py-2">Сохранённых ключей нет.</div>
                    ) : (
                      (catalog?.sshKeys || []).map(k => {
                        const active = form.sshKeyId === k.id
                        return (
                          <div key={k.id} className={`group rounded-lg border transition cursor-pointer ${
                            active ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-slate-900/40 border-slate-700/40 hover:border-slate-600'
                          }`}>
                            <button type="button"
                              onClick={() => { setField('sshKeyId', k.id); setField('sshUser', k.default_user) }}
                              className="w-full text-left px-3 py-2 flex items-center gap-2"
                            >
                              <KeyRound className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-emerald-300' : 'text-slate-500'}`} />
                              <div className="flex-1 min-w-0">
                                <div className={`text-sm font-bold truncate flex items-center gap-1.5 ${active ? 'text-emerald-200' : 'text-white'}`}>
                                  <span className="truncate">{k.name}</span>
                                  {k.has_private_key && (
                                    <span title="Есть приватник — система может SSH-ить от твоего имени"
                                      className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 shrink-0">
                                      🔒 priv
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono truncate">
                                  user: {k.default_user} • {k.public_key.split(' ')[0]} • {k.fingerprint?.slice(0, 16)}…
                                </div>
                                {k.notes && <div className="text-[10px] text-slate-500 italic truncate">{k.notes}</div>}
                              </div>
                              <button type="button"
                                onClick={(e) => { e.stopPropagation(); deleteSshKey(k) }}
                                title="Удалить из сохранённых"
                                className="ml-1 px-1.5 py-1 text-slate-500 hover:text-red-300 opacity-0 group-hover:opacity-100 transition"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                ) : form.sshKeySource === 'generate' ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-100 text-xs flex items-start gap-2">
                      <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
                      <div>
                        <div className="font-semibold text-amber-200 mb-0.5">Новый ключ будет сгенерирован сервером</div>
                        <div className="text-[11px] text-amber-100/90">Public-часть положим в VM через cloud-init. Private отдадим тебе <strong>один раз после создания</strong> — в модалке для скачивания. После закрытия модалки приватник нельзя будет восстановить.</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="Алгоритм" hint="ed25519 — короткий, быстрый, рекомендуется. RSA-4096 — универсально совместим, но 50× длиннее.">
                        <select value={form.sshGenerateAlgo}
                          onChange={e => setField('sshGenerateAlgo', e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none">
                          <option value="ed25519">ed25519 (рекомендуется)</option>
                          <option value="rsa-4096">RSA-4096</option>
                        </select>
                      </Field>
                      <Field label="SSH user" hint="Юзер, под которого будет положен ключ (cloud-init создаст если нет)">
                        <input value={form.sshUser}
                          onChange={e => setField('sshUser', e.target.value.replace(/[^a-z0-9_-]/gi, ''))}
                          className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none" />
                      </Field>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <textarea value={form.sshKey}
                          onChange={e => { setField('sshKey', e.target.value); setField('sshKeyId', null) }}
                          rows={3}
                          placeholder="ssh-ed25519 AAAA... user@host"
                          className="sensitive w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-xs font-mono focus:border-blue-500 focus:outline-none resize-y" />
                      </div>
                      <div>
                        <Field label="SSH user" hint="Имя юзера, на которого будет добавлен ключ">
                          <input value={form.sshUser}
                            onChange={e => setField('sshUser', e.target.value.replace(/[^a-z0-9_-]/gi, ''))}
                            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none" />
                        </Field>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <button type="button"
                        onClick={() => sshFileInputRef.current?.click()}
                        className="px-2.5 py-1 text-[11px] font-bold bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-lg hover:bg-cyan-500/25 transition flex items-center gap-1"
                        title="Загрузить из .pub-файла"
                      >
                        <Upload className="w-3 h-3" /> Из файла
                      </button>
                      <input ref={sshFileInputRef} type="file" accept=".pub,.txt,text/plain"
                        onChange={onSshFilePicked} className="hidden" />
                      {form.sshKey.trim() && (
                        <button type="button"
                          onClick={saveSshKey}
                          disabled={busy}
                          className="px-2.5 py-1 text-[11px] font-bold bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 rounded-lg hover:bg-emerald-500/25 transition flex items-center gap-1 disabled:opacity-50"
                          title="Сохранить этот ключ под именем для последующего выбора"
                        >
                          <Save className="w-3 h-3" /> Сохранить под именем
                        </button>
                      )}
                      {form.sshKey.trim() && (
                        <button type="button"
                          onClick={() => setField('sshKey', '')}
                          className="px-2.5 py-1 text-[11px] font-bold bg-slate-800 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-700 transition flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> Очистить
                        </button>
                      )}
                      {sshFileError && (
                        <div className="text-[11px] text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {sshFileError}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Подсказка как подключаться после создания */}
                {((form.sshKeySource === 'paste' && form.sshKey.trim()) ||
                  (form.sshKeySource === 'saved' && form.sshKeyId)) && (() => {
                  const effectiveUser = form.sshKeySource === 'saved'
                    ? ((catalog?.sshKeys || []).find(k => k.id === form.sshKeyId)?.default_user || 'ubuntu')
                    : (form.sshUser || 'ubuntu')
                  return (
                    <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-100 text-xs flex items-start gap-2">
                      <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-300" />
                      <div className="flex-1">
                        <div className="font-semibold text-blue-200 mb-1">Подключение после создания</div>
                        <div>Ключ будет положен пользователю <span className="font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-200">{effectiveUser}</span>, не root.</div>
                        <div className="mt-1 font-mono text-[11px] text-blue-200/90">ssh {effectiveUser}@&lt;публичный-IP&gt;</div>
                        <div className="mt-1 text-[10px] text-blue-200/60">Cloud-init разворачивает ключ ~30-60 сек после первого старта. Если SSH не пустит сразу — подожди минуту.</div>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Preemptible */}
              <label className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 cursor-pointer hover:border-amber-500/50">
                <input type="checkbox" checked={form.preemptible} onChange={e => setField('preemptible', e.target.checked)} className="w-4 h-4 mt-0.5 accent-amber-500" />
                <div>
                  <div className="text-sm text-amber-200 font-medium">Прерываемая (preemptible) VM</div>
                  <div className="text-[11px] text-amber-200/70">Дешевле на ~30%, но YC может остановить в любой момент. Только для не-критичных задач.</div>
                </div>
              </label>

              {/* Добавить в VPS-управление (этап 3) */}
              {(() => {
                const willHavePrivate = form.sshKeySource === 'generate' ||
                  (form.sshKeySource === 'saved' && form.sshKeyId &&
                    (catalog?.sshKeys || []).find(k => k.id === form.sshKeyId)?.has_private_key)
                return (
                  <label className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                    form.addToVps ? 'bg-blue-500/10 border-blue-500/40' : 'bg-slate-900/40 border-slate-700/40 hover:border-blue-500/30'
                  }`}>
                    <input type="checkbox" checked={form.addToVps}
                      onChange={e => setField('addToVps', e.target.checked)}
                      className="w-4 h-4 mt-0.5 accent-blue-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium flex items-center gap-2">
                        Добавить в управление /admin/vps
                        {willHavePrivate ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">с приватником</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">без SSH-доступа</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {willHavePrivate
                          ? 'VPS-запись создастся с приватным ключом — система сможет SSH-ить (Traffic Agent, прочие операции).'
                          : 'VPS-запись создастся, но без приватника — управление через /admin/vps не сработает пока не добавишь ключ вручную.'}
                      </div>
                      {form.addToVps && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">Тип:</span>
                          <select value={form.vpsServiceType}
                            onChange={e => { e.stopPropagation(); setField('vpsServiceType', e.target.value) }}
                            onClick={e => e.stopPropagation()}
                            className="px-2 py-1 bg-slate-950/60 border border-slate-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none">
                            <option value="other">other (любой)</option>
                            <option value="node">node (RemnaWave-нода)</option>
                            <option value="panel">panel (RemnaWave-панель)</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </label>
                )
              })()}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-6 py-4 flex items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">
            VM начнёт тарифицироваться сразу после создания
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg">
              Отмена
            </button>
            <button onClick={submit} disabled={creating || loadingCatalog}
              className="px-5 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 hover:shadow-lg hover:shadow-blue-500/30 flex items-center gap-1.5">
              {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {creating ? 'Создание...' : 'Создать VM'}
            </button>
          </div>
        </div>
      </div>

      {/* Save SSH key dialog */}
      {saveSshDialog && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-emerald-400" />
              <div className="flex-1 text-sm font-bold text-white">Сохранить SSH-ключ</div>
              <button onClick={() => setSaveSshDialog(null)} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-[11px] text-slate-500 font-mono break-all bg-slate-950/60 border border-slate-800 rounded-lg p-2">
                {form.sshKey.split(' ').slice(0, 1)[0]} ...{form.sshKey.split(' ').slice(1, 2)[0]?.slice(-30)}
              </div>
              <Field label="Имя ключа" required>
                <input
                  value={saveSshDialog.name}
                  onChange={e => setSaveSshDialog({ ...saveSshDialog, name: e.target.value.slice(0, 128) })}
                  placeholder="Мой основной"
                  autoFocus
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>
              <Field label="Default SSH user" hint="Будет подставляться при выборе этого ключа в форме создания VM">
                <input
                  value={saveSshDialog.default_user}
                  onChange={e => setSaveSshDialog({ ...saveSshDialog, default_user: e.target.value.replace(/[^a-z0-9_-]/gi, '') })}
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
                />
              </Field>
              <Field label="Заметка (опц.)">
                <input
                  value={saveSshDialog.notes}
                  onChange={e => setSaveSshDialog({ ...saveSshDialog, notes: e.target.value })}
                  placeholder="С какого ноутбука / для какой задачи"
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              {/* Приватный ключ — опционально, для управления через нашу систему */}
              <div className="border-t border-slate-800 pt-4">
                <Field
                  label={<span className="flex items-center gap-1.5">🔒 Приватный ключ <span className="text-[10px] text-slate-500 font-normal">опционально</span></span>}
                  hint="Нужен только если хочешь чтобы система могла SSH-ить от твоего имени (управление VM в /admin/vps, установка traffic-agent). Хранится зашифрованным, наружу не отдаётся."
                >
                  <textarea
                    value={saveSshDialog.private_key}
                    onChange={e => setSaveSshDialog({ ...saveSshDialog, private_key: e.target.value })}
                    rows={4}
                    placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                    className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-[11px] font-mono focus:border-amber-500 focus:outline-none resize-y"
                  />
                </Field>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2">
              <button onClick={() => setSaveSshDialog(null)} className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg">
                Отмена
              </button>
              <button onClick={commitSaveSshKey} disabled={busy}
                className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 hover:shadow-lg hover:shadow-emerald-500/30 flex items-center gap-1.5">
                {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryRow({ job, onSelect }) {
  const found_addr = job.result?.foundAddress
  const meta = {
    pending:   { color: 'text-cyan-400',    label: 'Ожидание' },
    running:   { color: 'text-cyan-400',    label: 'Идёт' },
    done:      { color: found_addr ? 'text-emerald-400' : 'text-slate-400', label: found_addr ? 'Найдено' : 'Не найдено' },
    cancelled: { color: 'text-amber-400',   label: 'Отменено' },
    failed:    { color: 'text-red-400',     label: 'Ошибка' },
  }[job.status] || { color: 'text-slate-400', label: job.status }

  // Поддержка как нового формата cidrs[], так и старого cidr (string)
  const cidrs = Array.isArray(job.params?.cidrs) ? job.params.cidrs
              : job.params?.cidr ? [job.params.cidr]
              : []
  const cidrSummary = cidrs.length === 0 ? '—'
    : cidrs.length === 1 ? cidrs[0]
    : `${cidrs.length} диапазонов: ${cidrs[0]}${cidrs.length > 1 ? '...' : ''}`

  return (
    <button onClick={onSelect}
      className="w-full text-left bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2.5 hover:border-blue-500/40 transition flex items-center gap-3">
      <div className={`text-[11px] font-bold uppercase ${meta.color} w-20 shrink-0`}>{meta.label}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-mono truncate" title={cidrs.join(', ')}>{cidrSummary}</div>
        <div className="text-[10px] text-slate-500 truncate">
          {job.params?.zoneId} • попыток {job.progress?.tried || 0}/{job.params?.maxAttempts || 0}
          {found_addr && ` • найден ${found_addr.ip}${found_addr.matchedCidr ? ` (в ${found_addr.matchedCidr})` : ''}`}
        </div>
      </div>
      <div className="text-[10px] text-slate-500 shrink-0">{new Date(job.created_at).toLocaleString('ru-RU')}</div>
    </button>
  )
}



// ─── GeneratedKeyModal — показ приватника ОДИН РАЗ после создания VM с auto-gen ──

function GeneratedKeyModal({ data, onClose }) {
  const [copied, setCopied] = useState(null)

  function copy(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(null), 1500)
  }

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'application/x-pem-file' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-amber-500/40 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-amber-500/30 px-6 py-4 flex items-center gap-3 z-10">
          <KeyRound className="w-5 h-5 text-amber-400" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Сохрани приватный ключ — это единственный шанс</div>
            <div className="text-[11px] text-amber-300/80">Алгоритм: <span className="font-mono">{data.algo}</span> · Закрытие модалки = ключ потерян навсегда</div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-red-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
            <div>
              <div className="font-semibold mb-0.5">Это твой единственный шанс получить приватник</div>
              <div className="text-[11px] text-red-100/90">Backend нигде не сохраняет приватный ключ в открытом виде. Скачай файл или скопируй текст — иначе придётся пересоздавать VM с новым ключом.</div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-bold text-slate-400 uppercase">Приватный ключ (PEM)</div>
              <div className="flex gap-1.5">
                <button onClick={() => copy(data.privateKey, 'priv')}
                  className="px-2.5 py-1 text-[11px] font-bold bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 rounded-lg transition flex items-center gap-1">
                  {copied === 'priv' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied === 'priv' ? 'Скопировано' : 'Скопировать'}
                </button>
                <button onClick={() => downloadFile(`yc-${data.algo}-${Date.now()}.pem`, data.privateKey)}
                  className="px-2.5 py-1 text-[11px] font-bold bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 rounded-lg transition flex items-center gap-1">
                  <Upload className="w-3 h-3 rotate-180" /> Скачать .pem
                </button>
              </div>
            </div>
            <pre className="text-[10px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-60 overflow-y-auto whitespace-pre">{data.privateKey}</pre>
            <div className="text-[11px] text-slate-500 mt-1.5">
              Подключение: <span className="font-mono text-slate-300">chmod 600 yc-*.pem && ssh -i yc-*.pem &lt;user&gt;@&lt;public-IP&gt;</span>
            </div>
          </div>

          <details className="bg-slate-950/40 border border-slate-800 rounded-xl">
            <summary className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase cursor-pointer hover:text-slate-200">
              Публичная часть (положена в VM)
            </summary>
            <div className="border-t border-slate-800 p-3">
              <div className="flex items-start gap-2">
                <pre className="flex-1 text-[10px] font-mono text-slate-300 break-all whitespace-pre-wrap">{data.publicKey}</pre>
                <button onClick={() => copy(data.publicKey, 'pub')}
                  className="px-2 py-1 text-[11px] font-bold bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 rounded-lg transition shrink-0">
                  {copied === 'pub' ? '✓' : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </details>
        </div>

        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-xl border-t border-amber-500/30 px-6 py-4 flex justify-end">
          <button onClick={onClose}
            className="px-5 py-2 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 rounded-lg text-xs font-bold">
            Я сохранил, закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
