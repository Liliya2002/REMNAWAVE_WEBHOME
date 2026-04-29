import React, { useEffect, useMemo, useState } from 'react'
import { useSiteConfig } from '../contexts/SiteConfigContext'
import {
  Settings, Palette, Shield, Globe2, Save, RefreshCw, History,
  CheckCircle2, AlertTriangle, SlidersHorizontal, Eye, EyeOff, Wifi
} from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''

const tabs = [
  { id: 'project', label: 'Проект', Icon: Settings },
  { id: 'remnwave', label: 'RemnaWave API', Icon: Wifi },
  { id: 'design', label: 'Дизайн', Icon: Palette },
  { id: 'security', label: 'Безопасность', Icon: Shield },
  { id: 'integrations', label: 'Интеграции', Icon: Globe2 },
  { id: 'history', label: 'История', Icon: History }
]

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

function inputClass(extra = '') {
  return `w-full px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-100 focus:border-cyan-500 focus:outline-none transition ${extra}`
}

export default function TemplateBuilder() {
  const { refreshConfig: refreshGlobalConfig } = useSiteConfig()

  const [tab, setTab] = useState('project')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [showSecrets, setShowSecrets] = useState({
    remnwave_api_token: false,
    remnwave_secret_key: false,
    webhook_secret: false
  })

  const [form, setForm] = useState({
    site_title: '',
    project_tagline: '',
    site_description: '',
    site_logo_url: '',
    site_favicon_url: '',
    support_email: '',
    support_telegram: '',
    default_currency: 'RUB',
    timezone: 'Europe/Moscow',

    color_primary: '#3b82f6',
    color_secondary: '#06b6d4',
    color_accent: '#f59e0b',
    color_danger: '#ef4444',
    color_success: '#10b981',
    font_family: 'Inter, sans-serif',
    font_size_base: '16px',
    layout_width: '1280px',
    navbar_fixed: true,
    custom_css: '',

    enable_registration: true,
    enable_payments: true,
    enable_referrals: true,
    enable_notifications: true,
    allow_trial_plan: true,
    maintenance_mode: false,
    maintenance_message: 'Ведутся технические работы',
    require_email_confirmation: false,
    session_timeout_minutes: 1440,
    max_login_attempts: 5,

    social_twitter: '',
    social_github: '',
    social_discord: '',
    social_telegram: '',
    google_analytics_id: '',

    remnwave_api_url: '',
    remnwave_api_token: '',
    remnwave_secret_key: '',
    webhook_secret: '',
    verify_webhooks: false
  })

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  async function loadConfig() {
    const token = localStorage.getItem('token')
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${API_URL}/api/admin/config`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки настроек')
      setForm(prev => ({ ...prev, ...(data.config || {}) }))
    } catch (err) {
      setError(err.message || 'Ошибка загрузки настроек')
    } finally {
      setLoading(false)
    }
  }

  async function loadHistory() {
    const token = localStorage.getItem('token')
    try {
      setHistoryLoading(true)
      const res = await fetch(`${API_URL}/api/admin/settings/history`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки истории')
      setHistory(Array.isArray(data.history) ? data.history : [])
    } catch (err) {
      setError(err.message || 'Ошибка загрузки истории')
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    if (tab === 'history' && history.length === 0 && !historyLoading) {
      loadHistory()
    }
  }, [tab])

  async function syncSettings() {
    try {
      setSyncing(true)
      await loadConfig()
      await refreshGlobalConfig()
    } finally {
      setSyncing(false)
    }
  }

  async function testRemnwaveConnection() {
    const token = localStorage.getItem('token')
    try {
      setTestingConnection(true)
      setTestResult(null)
      const res = await fetch(`${API_URL}/api/admin/test-remnwave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          api_url: form.remnwave_api_url,
          api_token: form.remnwave_api_token
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setTestResult({ ok: false, message: data.error || 'Ошибка подключения' })
      } else {
        setTestResult({ ok: true, message: `Подключено! Найдено нод: ${data.nodesCount}` })
      }
    } catch (err) {
      setTestResult({ ok: false, message: err.message || 'Ошибка сети' })
    } finally {
      setTestingConnection(false)
    }
  }

  async function saveSettings() {
    const token = localStorage.getItem('token')
    try {
      setSaving(true)
      setError(null)
      setMessage(null)

      const payload = {
        ...form,
        session_timeout_minutes: Number(form.session_timeout_minutes),
        max_login_attempts: Number(form.max_login_attempts)
      }

      const res = await fetch(`${API_URL}/api/admin/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить настройки')

      setMessage('Настройки сохранены и применены')
      await syncSettings()
    } catch (err) {
      setError(err.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const livePreviewStyle = useMemo(() => ({
    '--p': form.color_primary,
    '--s': form.color_secondary,
    '--a': form.color_accent,
    '--f': form.font_family,
    '--fs': form.font_size_base
  }), [form.color_primary, form.color_secondary, form.color_accent, form.font_family, form.font_size_base])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Загрузка настроек...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.15),transparent_35%),rgba(2,6,23,0.85)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2">
              <SlidersHorizontal className="w-7 h-7 text-cyan-300" />
              Настройки проекта
            </h3>
            <p className="text-slate-400 mt-1 text-sm">Единый центр управления проектом: бренд, дизайн, безопасность, интеграции и режимы работы.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={syncSettings}
              disabled={syncing || saving}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> Синхронизировать
            </button>
            <button
              onClick={saveSettings}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold hover:shadow-lg hover:shadow-cyan-500/25 transition text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>

      {message && (
        <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {message}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5 ${
              tab === t.id
                ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300'
                : 'bg-slate-800/40 border border-slate-700/40 text-slate-400 hover:text-slate-200'
            }`}
          >
            <t.Icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-5">
          {tab === 'project' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Название проекта"><input value={form.site_title || ''} onChange={(e) => setField('site_title', e.target.value)} className={inputClass()} /></Field>
                <Field label="Короткий слоган"><input value={form.project_tagline || ''} onChange={(e) => setField('project_tagline', e.target.value)} className={inputClass()} /></Field>
              </div>
              <Field label="Описание проекта"><textarea value={form.site_description || ''} onChange={(e) => setField('site_description', e.target.value)} rows={3} className={inputClass()} /></Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  label="Логотип (URL)"
                  hint="По умолчанию используется логотип проекта (/logo.svg). Чтобы заменить — укажи URL. Рекомендуемые размеры: SVG 64×64 (любой квадрат) или PNG 32×32 / 64×64. В шапке отображается 24×24 (mobile) или 32×32 (desktop)."
                >
                  <input
                    value={form.site_logo_url || ''}
                    onChange={(e) => setField('site_logo_url', e.target.value)}
                    placeholder="/logo.svg"
                    className={inputClass()}
                  />
                </Field>
                <Field
                  label="Favicon (URL)"
                  hint="По умолчанию используется иконка проекта (/favicon.svg). Чтобы заменить — укажи URL. Рекомендуемые размеры: SVG 64×64 (любой квадрат) или PNG 32×32 / 48×48. Для iOS home-screen — 180×180."
                >
                  <input
                    value={form.site_favicon_url || ''}
                    onChange={(e) => setField('site_favicon_url', e.target.value)}
                    placeholder="/favicon.svg"
                    className={inputClass()}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Email поддержки"><input value={form.support_email || ''} onChange={(e) => setField('support_email', e.target.value)} className={inputClass()} /></Field>
                <Field label="Telegram поддержки"><input value={form.support_telegram || ''} onChange={(e) => setField('support_telegram', e.target.value)} className={inputClass()} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Валюта проекта">
                  <select value={form.default_currency || 'RUB'} onChange={(e) => setField('default_currency', e.target.value)} className={inputClass()}>
                    <option value="RUB">RUB</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
                <Field label="Часовой пояс"><input value={form.timezone || ''} onChange={(e) => setField('timezone', e.target.value)} className={inputClass()} /></Field>
              </div>
            </>
          )}

          {tab === 'design' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Primary"><input type="color" value={form.color_primary || '#3b82f6'} onChange={(e) => setField('color_primary', e.target.value)} className={inputClass('h-10')} /></Field>
                <Field label="Secondary"><input type="color" value={form.color_secondary || '#06b6d4'} onChange={(e) => setField('color_secondary', e.target.value)} className={inputClass('h-10')} /></Field>
                <Field label="Accent"><input type="color" value={form.color_accent || '#f59e0b'} onChange={(e) => setField('color_accent', e.target.value)} className={inputClass('h-10')} /></Field>
                <Field label="Danger"><input type="color" value={form.color_danger || '#ef4444'} onChange={(e) => setField('color_danger', e.target.value)} className={inputClass('h-10')} /></Field>
                <Field label="Success"><input type="color" value={form.color_success || '#10b981'} onChange={(e) => setField('color_success', e.target.value)} className={inputClass('h-10')} /></Field>
                <Field label="Ширина макета"><input value={form.layout_width || ''} onChange={(e) => setField('layout_width', e.target.value)} placeholder="1280px" className={inputClass()} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Шрифт" hint="Например: Inter, sans-serif"><input value={form.font_family || ''} onChange={(e) => setField('font_family', e.target.value)} className={inputClass()} /></Field>
                <Field label="Базовый размер" hint="Например: 16px"><input value={form.font_size_base || ''} onChange={(e) => setField('font_size_base', e.target.value)} className={inputClass()} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={!!form.navbar_fixed} onChange={(e) => setField('navbar_fixed', e.target.checked)} className="accent-cyan-500" />
                Закрепить navbar
              </label>
              <Field label="Custom CSS" hint="Применяется глобально на сайте после сохранения"><textarea value={form.custom_css || ''} onChange={(e) => setField('custom_css', e.target.value)} rows={8} className={`${inputClass()} font-mono text-xs`} /></Field>
            </>
          )}

          {tab === 'security' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/40 text-sm text-slate-200"><input type="checkbox" checked={!!form.enable_registration} onChange={(e) => setField('enable_registration', e.target.checked)} className="accent-emerald-500 mt-0.5" />Разрешить регистрацию</label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/40 text-sm text-slate-200"><input type="checkbox" checked={!!form.require_email_confirmation} onChange={(e) => setField('require_email_confirmation', e.target.checked)} className="accent-emerald-500 mt-0.5" />Требовать подтверждение email</label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/40 text-sm text-slate-200"><input type="checkbox" checked={!!form.maintenance_mode} onChange={(e) => setField('maintenance_mode', e.target.checked)} className="accent-amber-500 mt-0.5" />Режим техработ</label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/40 text-sm text-slate-200"><input type="checkbox" checked={!!form.allow_trial_plan} onChange={(e) => setField('allow_trial_plan', e.target.checked)} className="accent-emerald-500 mt-0.5" />Разрешить пробный тариф</label>
              </div>
              <Field label="Сообщение при техработах"><textarea value={form.maintenance_message || ''} onChange={(e) => setField('maintenance_message', e.target.value)} rows={3} className={inputClass()} /></Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Таймаут сессии (минуты)"><input type="number" min="10" value={form.session_timeout_minutes || 1440} onChange={(e) => setField('session_timeout_minutes', e.target.value)} className={inputClass()} /></Field>
                <Field label="Макс. попыток входа"><input type="number" min="1" value={form.max_login_attempts || 5} onChange={(e) => setField('max_login_attempts', e.target.value)} className={inputClass()} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/40 text-sm text-slate-200"><input type="checkbox" checked={!!form.enable_payments} onChange={(e) => setField('enable_payments', e.target.checked)} className="accent-emerald-500 mt-0.5" />Включить платежи</label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/40 text-sm text-slate-200"><input type="checkbox" checked={!!form.enable_referrals} onChange={(e) => setField('enable_referrals', e.target.checked)} className="accent-emerald-500 mt-0.5" />Включить рефералку</label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/40 text-sm text-slate-200 md:col-span-2"><input type="checkbox" checked={!!form.enable_notifications} onChange={(e) => setField('enable_notifications', e.target.checked)} className="accent-emerald-500 mt-0.5" />Включить уведомления</label>
              </div>
            </>
          )}

          {tab === 'integrations' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Twitter URL"><input value={form.social_twitter || ''} onChange={(e) => setField('social_twitter', e.target.value)} className={inputClass()} /></Field>
                <Field label="GitHub URL"><input value={form.social_github || ''} onChange={(e) => setField('social_github', e.target.value)} className={inputClass()} /></Field>
                <Field label="Discord URL"><input value={form.social_discord || ''} onChange={(e) => setField('social_discord', e.target.value)} className={inputClass()} /></Field>
                <Field label="Telegram URL"><input value={form.social_telegram || ''} onChange={(e) => setField('social_telegram', e.target.value)} className={inputClass()} /></Field>
              </div>
              <Field label="Google Analytics ID" hint="Например: G-XXXXXXXXXX"><input value={form.google_analytics_id || ''} onChange={(e) => setField('google_analytics_id', e.target.value)} className={inputClass()} /></Field>
            </>
          )}

          {tab === 'remnwave' && (
            <>
              <Field label="API URL" hint="Адрес панели Remnwave, например https://panel.example.com">
                <input value={form.remnwave_api_url || ''} onChange={(e) => setField('remnwave_api_url', e.target.value)} placeholder="https://panel.example.com" className={inputClass()} />
              </Field>
              <Field label="API Token">
                <div className="relative">
                  <input type={showSecrets.remnwave_api_token ? 'text' : 'password'} value={form.remnwave_api_token || ''} onChange={(e) => setField('remnwave_api_token', e.target.value)} className={inputClass('pr-10')} />
                  <button type="button" onClick={() => setShowSecrets(p => ({ ...p, remnwave_api_token: !p.remnwave_api_token }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showSecrets.remnwave_api_token ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Secret Key">
                <div className="relative">
                  <input type={showSecrets.remnwave_secret_key ? 'text' : 'password'} value={form.remnwave_secret_key || ''} onChange={(e) => setField('remnwave_secret_key', e.target.value)} className={inputClass('pr-10')} />
                  <button type="button" onClick={() => setShowSecrets(p => ({ ...p, remnwave_secret_key: !p.remnwave_secret_key }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showSecrets.remnwave_secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Webhook Secret" hint="Ключ для проверки HMAC-подписи входящих webhook. Обязателен — без него webhook отклоняются.">
                <div className="relative">
                  <input type={showSecrets.webhook_secret ? 'text' : 'password'} value={form.webhook_secret || ''} onChange={(e) => setField('webhook_secret', e.target.value)} className={inputClass('pr-10')} />
                  <button type="button" onClick={() => setShowSecrets(p => ({ ...p, webhook_secret: !p.webhook_secret }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showSecrets.webhook_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              <button
                type="button"
                onClick={testRemnwaveConnection}
                disabled={testingConnection || !form.remnwave_api_url || !form.remnwave_api_token}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Wifi className="w-4 h-4" />
                {testingConnection ? 'Проверка...' : 'Проверить подключение'}
              </button>
              {testResult && (
                <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${testResult.ok ? 'border-emerald-600/50 bg-emerald-950/30 text-emerald-300' : 'border-red-600/50 bg-red-950/30 text-red-300'}`}>
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {testResult.message}
                </div>
              )}
            </>
          )}

          {tab === 'history' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">История изменений</h4>
                <button onClick={loadHistory} className="px-3 py-1.5 text-xs rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition">Обновить</button>
              </div>
              {historyLoading ? <div className="text-slate-400 text-sm">Загрузка...</div> : history.length === 0 ? <div className="text-slate-500 text-sm">Записей пока нет</div> : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {history.map(item => (
                    <div key={item.id} className="p-3 rounded-lg border border-slate-700/50 bg-slate-900/50">
                      <div className="text-xs text-slate-500 mb-1">{new Date(item.created_at).toLocaleString('ru-RU')}</div>
                      <div className="text-sm text-white">Действие: {item.action}</div>
                      <div className="text-xs text-slate-400 mt-1">Изменил: {item.changed_by_login || 'system'}</div>
                      {item.changes && <pre className="mt-2 text-[11px] text-cyan-200/90 bg-slate-950/70 border border-slate-700/40 rounded p-2 overflow-x-auto">{JSON.stringify(item.changes, null, 2)}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-4">
          <h4 className="text-sm font-semibold text-white">Live preview</h4>
          <div style={livePreviewStyle} className="rounded-xl border border-slate-700/40 overflow-hidden bg-slate-950">
            <div className="p-4" style={{ fontFamily: 'var(--f)', fontSize: 'var(--fs)' }}>
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--s)' }}>Project</div>
              <div className="text-xl font-extrabold text-white">{form.site_title || 'VPN Webhome'}</div>
              <div className="text-sm mt-1" style={{ color: 'var(--a)' }}>{form.project_tagline || 'Secure network access'}</div>
              <button className="mt-4 px-3 py-1.5 rounded-md text-white text-sm" style={{ background: 'linear-gradient(90deg,var(--p),var(--s))' }}>CTA Button</button>
            </div>
          </div>
          <div className="text-xs text-slate-500">Быстрый предпросмотр помогает сразу увидеть результат по цветам, шрифтам и общему тону интерфейса.</div>
        </div>
      </div>
    </div>
  )
}
