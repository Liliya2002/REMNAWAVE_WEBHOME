import React, { useEffect, useState, useCallback } from 'react'
import {
  MessageCircle, Plug, Bell, Shield, LayoutGrid, FileText,
  RefreshCw, Save, Send, Power, Eye, EyeOff, Info,
  CheckCircle2, AlertCircle, ChevronUp, ChevronDown, X, Plus,
  ExternalLink, Copy
} from 'lucide-react'
import { authFetch } from '../services/api'

// ────────────────────────────────────────────────────────────────────────────
// Метаданные ключей уведомлений — для UI с понятными подписями
// ────────────────────────────────────────────────────────────────────────────

const USER_NOTIFICATION_KEYS = [
  { key: 'user_subscription_expiring', label: 'Подписка скоро истечёт',     hint: 'За 1-3 дня до окончания подписки' },
  { key: 'user_payment_received',      label: 'Платёж получен',             hint: 'После успешной оплаты подписки или пополнения' },
  { key: 'user_referral_bonus',        label: 'Реферальный бонус',          hint: 'При начислении бонуса за приглашённого' },
  { key: 'user_traffic_blocked',       label: 'Заблокирован за трафик',     hint: 'Когда Traffic Guard заблокировал доступ' },
]

const ADMIN_NOTIFICATION_KEYS = [
  { key: 'admin_vps_expiring',         label: 'VPS истекает',               hint: 'Cron 1 раз в день — какие VPS скоро не оплачены' },
  { key: 'admin_payment_received',     label: 'Платёж получен',             hint: 'После любого успешного платежа от юзера' },
  { key: 'admin_user_registered',      label: 'Новый юзер',                 hint: 'Спам-уведомление при каждой регистрации (по умолчанию off)' },
]

const TEXT_KEYS = [
  { key: 'welcome_new',     label: 'Welcome — новому юзеру',     hint: 'Доступны: {name}, {login}',                              rows: 4 },
  { key: 'welcome_back',    label: 'Welcome — вернувшемуся',     hint: 'Доступны: {name}, {login}',                              rows: 3 },
  { key: 'no_subscription', label: 'Сообщение «Нет подписки»',   hint: 'Показывается в личном кабинете если подписки нет',      rows: 2 },
  { key: 'faq',             label: 'FAQ — Вопросы и ответы',     hint: 'Показывается по кнопке «❓ Вопросы и ответы»',            rows: 8 },
  { key: 'support_intro',   label: 'Поддержка — вступление',     hint: 'Текст перед кнопкой «Написать в поддержку»',             rows: 3 },
  { key: 'support_contact', label: 'Поддержка — контакт',        hint: '@username Telegram-аккаунта поддержки. Без @ или с — оба варианта ОК', rows: 1 },
  { key: 'offer',           label: 'Оферта / правила',           hint: 'Показывается по кнопке «📋 Оферта»',                     rows: 10 },
]

const TEMPLATE_HINTS = {
  user_subscription_expiring: '{plan}, {daysLeft}, {expiresAt}',
  user_payment_received:      '{amount}, {plan}',
  user_referral_bonus:        '{amount}, {balance}, {days}',
  user_traffic_blocked:       '{usedGb}, {limitGb}, {node}',
  admin_vps_expiring:         '{lines}, {count}',
  admin_payment_received:     '{login}, {amount}, {plan}',
  admin_user_registered:      '{login}, {source}',
}

const TABS = [
  { id: 'connection', label: 'Подключение', Icon: Plug },
  { id: 'user-notifs', label: 'Юзер-уведомления', Icon: Bell },
  { id: 'admin-notifs', label: 'Админ-уведомления', Icon: Shield },
  { id: 'buttons', label: 'Кнопки меню', Icon: LayoutGrid },
  { id: 'texts', label: 'Тексты', Icon: FileText },
]

// ────────────────────────────────────────────────────────────────────────────
// Главный компонент
// ────────────────────────────────────────────────────────────────────────────

export default function AdminTelegram() {
  const [tab, setTab] = useState('connection')
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState({ running: false, mode: null, error: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [dirty, setDirty] = useState(false)

  // ──────── load
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [r1, r2] = await Promise.all([
        authFetch('/api/admin/telegram/settings'),
        authFetch('/api/admin/telegram/status'),
      ])
      const d1 = await r1.json()
      const d2 = await r2.json()
      if (!r1.ok) throw new Error(d1.error || 'Ошибка загрузки')
      setSettings(d1.settings)
      setStatus(d2.status || {})
      setDirty(false)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function setField(key, value) {
    setSettings(s => ({ ...s, [key]: value }))
    setDirty(true)
  }

  // Patch внутри nested объекта (например, notifications_enabled.foo = true)
  function setNested(parent, key, value) {
    setSettings(s => ({ ...s, [parent]: { ...(s[parent] || {}), [key]: value } }))
    setDirty(true)
  }

  async function save(extraPatch = {}) {
    if (!settings && !Object.keys(extraPatch).length) return
    setSaving(true); setError(null); setSuccess(null)
    try {
      const body = {
        is_enabled: settings.is_enabled,
        bot_username: settings.bot_username,
        mode: settings.mode,
        webhook_url: settings.webhook_url,
        admin_chat_id: settings.admin_chat_id,
        notifications_enabled: settings.notifications_enabled,
        texts: settings.texts,
        menu_buttons: settings.menu_buttons,
        ...extraPatch,
      }
      const r = await authFetch('/api/admin/telegram/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка сохранения')
      setSettings(d.settings)
      setDirty(false)
      let msg = 'Сохранено'
      if (d.restart) {
        msg += d.restart.ok ? ` · Бот перезапущен (${d.restart.mode})` : ` · Перезапуск не удался: ${d.restart.error}`
      }
      setSuccess(msg)
      // Обновим статус
      const sr = await authFetch('/api/admin/telegram/status')
      const sd = await sr.json()
      if (sr.ok) setStatus(sd.status || {})
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function restart() {
    setSaving(true); setError(null); setSuccess(null)
    try {
      const r = await authFetch('/api/admin/telegram/restart', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        setSuccess(`Бот перезапущен (${d.mode})`)
        const sr = await authFetch('/api/admin/telegram/status')
        const sd = await sr.json()
        if (sr.ok) setStatus(sd.status || {})
      } else {
        setError(d.error || 'Перезапуск не удался')
      }
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
        <span className="ml-3 text-slate-400 text-sm">Загрузка настроек бота...</span>
      </div>
    )
  }
  if (!settings) return <div className="text-red-400 text-sm">Не удалось загрузить настройки</div>

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/25">
          <MessageCircle className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Telegram-бот</h1>
          <p className="text-xs text-slate-400">Подключение, уведомления, меню и тексты</p>
        </div>
        <BotStatusBadge status={status} settings={settings} />
        <button onClick={load} className="px-3 py-2 text-xs bg-slate-800/60 border border-slate-700/60 rounded-lg text-slate-300 hover:bg-slate-700/60 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-900/50 border border-slate-800/60 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              tab === t.id
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}>
            <t.Icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'connection'   && <ConnectionTab settings={settings} status={status} setField={setField} save={save} restart={restart} saving={saving} />}
      {tab === 'user-notifs'  && <NotifsTab settings={settings} setField={setField} setNested={setNested} keys={USER_NOTIFICATION_KEYS} kind="user" />}
      {tab === 'admin-notifs' && <NotifsTab settings={settings} setField={setField} setNested={setNested} keys={ADMIN_NOTIFICATION_KEYS} kind="admin" />}
      {tab === 'buttons'      && <ButtonsTab settings={settings} setField={setField} />}
      {tab === 'texts'        && <TextsTab settings={settings} setNested={setNested} />}

      {/* Sticky save bar */}
      {dirty && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-auto z-40">
          <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/60 rounded-2xl shadow-2xl p-3 flex items-center gap-3">
            <span className="text-sm text-slate-300 px-2">Несохранённые изменения</span>
            <button onClick={() => save()} disabled={saving}
              className="ml-auto px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-lg text-xs hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 flex items-center gap-2">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Сохранить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Bot status badge (в header)
// ────────────────────────────────────────────────────────────────────────────

function BotStatusBadge({ status, settings }) {
  if (!settings.is_enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-700/40 border border-slate-600/40 text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Выключен
      </span>
    )
  }
  if (status.running) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Online ({status.mode})
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-red-500/15 border border-red-500/30 text-red-300" title={status.error || ''}>
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Offline
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Подключение
// ────────────────────────────────────────────────────────────────────────────

function ConnectionTab({ settings, status, setField, save, restart, saving }) {
  const [showToken, setShowToken] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [testChatId, setTestChatId] = useState('')
  const [testText, setTestText] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  async function saveToken() {
    if (!tokenInput.trim()) return
    await save({ bot_token: tokenInput.trim() })
    setTokenInput('')
  }

  async function saveSecret() {
    await save({ webhook_secret: secretInput.trim() || null })
    setSecretInput('')
  }

  async function sendTest() {
    setTesting(true); setTestResult(null)
    try {
      const r = await authFetch('/api/admin/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: testChatId.trim() || undefined,
          text: testText.trim() || undefined,
        }),
      })
      const d = await r.json()
      if (r.ok) setTestResult({ ok: true, msg: `✓ Отправлено в ${d.sent_to}` })
      else setTestResult({ ok: false, msg: d.error || 'Ошибка' })
    } catch (e) { setTestResult({ ok: false, msg: e.message }) }
    finally { setTesting(false) }
  }

  return (
    <div className="space-y-4">
      {/* Master toggle + статус */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={!!settings.is_enabled}
            onChange={e => setField('is_enabled', e.target.checked)}
            className="w-5 h-5 mt-0.5 accent-blue-500" />
          <div className="flex-1">
            <div className="text-base font-bold text-white">Бот включён</div>
            <div className="text-xs text-slate-400">При выключении бот останавливается, новые сообщения юзерам не уходят. Эта же настройка применяется автоматически при старте бэкенда.</div>
          </div>
          <button onClick={restart} disabled={saving} title="Применить настройки сейчас (рестарт бота)"
            className="px-3 py-2 text-xs bg-amber-500/15 border border-amber-500/40 text-amber-300 rounded-lg hover:bg-amber-500/25 flex items-center gap-1.5 disabled:opacity-50 shrink-0">
            <Power className="w-3.5 h-3.5" /> Рестарт
          </button>
        </label>
      </div>

      {/* Token */}
      <Card icon={<Plug className="w-4 h-4 text-blue-300" />} title="Bot Token" subtitle={settings.has_bot_token ? 'Сохранён (в БД, шифр.)' : 'Не задан — бот не запустится'}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showToken ? 'text' : 'password'}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder={settings.has_bot_token ? 'Оставь пустым чтобы не менять' : '1234567890:AAA...'}
              className="w-full px-3 py-2 pr-10 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
            />
            <button type="button" onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white">
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={saveToken} disabled={!tokenInput.trim() || saving}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> Сохранить токен
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Получи токен у <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">@BotFather</a> командой <code className="text-cyan-300 font-mono px-1 bg-slate-800 rounded">/newbot</code>. Токен будет сохранён зашифрованным.
        </p>
      </Card>

      {/* Bot username */}
      <Card icon={<MessageCircle className="w-4 h-4 text-cyan-300" />} title="Bot Username" subtitle="Для построения ссылок t.me/<bot>?start=ref_...">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-mono">@</span>
          <input value={settings.bot_username || ''} onChange={e => setField('bot_username', e.target.value.replace(/^@/, '').trim())}
            placeholder="MyVpnBot"
            className="flex-1 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none" />
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">Заполняется автоматически после первого запуска (берётся из getMe). Можно поменять вручную.</p>
      </Card>

      {/* Web App (Mini App) — самый красивый формат кнопок */}
      <Card
        icon={<ExternalLink className="w-4 h-4 text-purple-300" />}
        title="Web App (Mini App) URL"
        subtitle="Кнопки главного меню откроют веб-кабинет прямо в Telegram"
      >
        <input
          value={settings.web_app_url || ''}
          onChange={e => setField('web_app_url', e.target.value.trim())}
          placeholder="https://your-domain.com"
          className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-purple-500 focus:outline-none"
        />
        <div className="text-[11px] text-slate-500 mt-2 space-y-1.5">
          <div className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0 text-purple-300" />
            <span>
              Если задан — кнопки <span className="text-cyan-300">«Личный кабинет»</span>, <span className="text-cyan-300">«Веб-Панель»</span>, <span className="text-cyan-300">«Купить»</span>, <span className="text-cyan-300">«Пригласить»</span> станут{' '}
              <b className="text-purple-300">WebApp-кнопками</b> — тап откроет мини-приложение прямо в Telegram (без перехода в браузер). Визуально кнопка с иконкой запуска.
            </span>
          </div>
          <div className="flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-amber-300" />
            <span>
              <b>Требования Telegram:</b> только HTTPS, валидный TLS-сертификат. На <code className="text-cyan-300 font-mono">localhost</code> и <code className="text-cyan-300 font-mono">http://</code> не работает — Telegram отвергает.
            </span>
          </div>
          <div className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              Если поле пустое — кнопки остаются обычными callback-кнопками (как сейчас). Можно использовать как fallback пока нет HTTPS-домена.
            </span>
          </div>
        </div>

        <details className="mt-3">
          <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">📖 Как настроить Mini App у @BotFather</summary>
          <div className="mt-2 p-3 bg-slate-950/40 border border-slate-700/40 rounded-lg text-[11px] text-slate-400 space-y-1.5">
            <p>1. Введи <code className="text-cyan-300">/setdomain</code> у <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">@BotFather</a> → выбери своего бота → введи свой HTTPS-домен (например <code className="text-cyan-300">vpn.example.com</code>)</p>
            <p>2. (Опционально) <code className="text-cyan-300">/newapp</code> — создаст полноценное Mini App с иконкой/описанием в каталоге Telegram'а</p>
            <p>3. Заполни это поле URL'ом → сохрани → <code className="text-cyan-300">/start</code> в боте</p>
            <p className="text-emerald-400 mt-2">✓ Кнопки в меню окрасятся «launch-иконкой» — тап откроет твой веб-кабинет прямо в Telegram'е</p>
          </div>
        </details>
      </Card>

      {/* Mode + webhook */}
      <Card icon={<Power className="w-4 h-4 text-amber-300" />} title="Режим работы" subtitle="polling — для разработки · webhook — для прода">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <ModeButton active={settings.mode === 'polling'} onClick={() => setField('mode', 'polling')}
            label="Long-polling" hint="Бот сам опрашивает Telegram. Работает за NAT, локально" />
          <ModeButton active={settings.mode === 'webhook'} onClick={() => setField('mode', 'webhook')}
            label="Webhook" hint="Telegram POST'ит обновления на наш URL. Нужен HTTPS" />
        </div>

        {settings.mode === 'webhook' && (
          <div className="space-y-3 p-3 bg-slate-950/40 border border-slate-700/40 rounded-lg">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Webhook URL</label>
              <input value={settings.webhook_url || ''} onChange={e => setField('webhook_url', e.target.value.trim())}
                placeholder="https://your-domain.com/api/tg/webhook"
                className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none" />
              <p className="text-[11px] text-slate-500 mt-1">
                Должен оканчиваться на <code className="text-cyan-300 font-mono">/api/tg/webhook</code>. Telegram требует валидный TLS-сертификат.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Webhook Secret <span className="text-slate-500 font-normal">(рекомендуется)</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={secretInput}
                    onChange={e => setSecretInput(e.target.value)}
                    placeholder={settings.has_webhook_secret ? 'Сохранён · оставь пустым чтобы не менять' : 'Случайная строка для проверки источника'}
                    className="w-full px-3 py-2 pr-10 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none"
                  />
                  <button type="button" onClick={() => setShowSecret(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white">
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={saveSecret}
                  className="px-3 py-2 bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-lg flex items-center gap-1">
                  <Save className="w-3.5 h-3.5" /> Сохранить
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5 flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                Telegram передаёт его в заголовке <code className="text-cyan-300 font-mono">X-Telegram-Bot-Api-Secret-Token</code>. Защищает от чужих POST'ов на наш webhook.
              </p>
            </div>
          </div>
        )}

        <details className="mt-3">
          <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">📖 Как настроить webhook на проде</summary>
          <div className="mt-2 p-3 bg-slate-950/40 border border-slate-700/40 rounded-lg text-[11px] text-slate-400 space-y-1.5">
            <p>1. На проде нужен HTTPS-домен (есть, на нём фронт и API)</p>
            <p>2. Установи режим <code className="text-cyan-300">webhook</code></p>
            <p>3. Заполни URL: <code className="text-cyan-300">https://your-domain.com/api/tg/webhook</code></p>
            <p>4. Сгенерируй secret: <code className="text-cyan-300">openssl rand -hex 32</code></p>
            <p>5. Сохрани → бэкенд автоматически вызовет setWebhook к Telegram API</p>
            <p>6. Проверь: <code className="text-cyan-300">curl https://api.telegram.org/bot&lt;TOKEN&gt;/getWebhookInfo</code></p>
            <p className="text-amber-400 mt-2">⚠️ Polling и webhook взаимоисключающие — Telegram сам снимает webhook при переходе на polling</p>
          </div>
        </details>
      </Card>

      {/* Тест-сообщение */}
      <Card icon={<Send className="w-4 h-4 text-emerald-300" />} title="Тест-сообщение" subtitle="Проверка что бот может писать">
        <div className="space-y-2">
          <input value={testChatId} onChange={e => setTestChatId(e.target.value)}
            placeholder={settings.admin_chat_id ? `chat_id (по умолчанию admin: ${settings.admin_chat_id})` : 'chat_id'}
            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-emerald-500 focus:outline-none" />
          <textarea value={testText} onChange={e => setTestText(e.target.value)}
            placeholder="Текст сообщения (по умолчанию: тест от админ-панели)" rows={2}
            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-emerald-500 focus:outline-none resize-none" />
          <div className="flex items-center gap-2">
            <button onClick={sendTest} disabled={testing}
              className="px-4 py-2 bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold rounded-lg hover:bg-emerald-500/25 disabled:opacity-50 flex items-center gap-1.5">
              {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Отправить
            </button>
            {testResult && (
              <span className={`text-xs ${testResult.ok ? 'text-emerald-300' : 'text-red-400'}`}>{testResult.msg}</span>
            )}
          </div>
        </div>
      </Card>

      {/* Ошибки бота */}
      {status.error && (
        <Card icon={<AlertCircle className="w-4 h-4 text-red-300" />} title="Ошибка запуска" subtitle="Последняя ошибка при старте">
          <pre className="text-xs font-mono text-red-300/80 whitespace-pre-wrap break-all bg-slate-950/40 border border-red-500/20 rounded p-3">{status.error}</pre>
        </Card>
      )}
    </div>
  )
}

function ModeButton({ active, onClick, label, hint }) {
  return (
    <button onClick={onClick} type="button"
      className={`px-3 py-2.5 rounded-lg border text-left transition ${
        active ? 'bg-amber-500/15 border-amber-500/40' : 'bg-slate-900/40 border-slate-700/40 hover:border-slate-600'
      }`}>
      <div className={`text-sm font-bold ${active ? 'text-amber-200' : 'text-slate-200'}`}>{label}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 2&3. Уведомления — общий компонент для user / admin
// ────────────────────────────────────────────────────────────────────────────

function NotifsTab({ settings, setField, setNested, keys, kind }) {
  const enabled = settings.notifications_enabled || {}
  const texts = settings.texts || {}

  return (
    <div className="space-y-4">
      {kind === 'admin' && (
        <Card icon={<Shield className="w-4 h-4 text-amber-300" />} title="Admin Chat ID" subtitle="Куда слать админские уведомления">
          <input value={settings.admin_chat_id || ''} onChange={e => setField('admin_chat_id', e.target.value.trim())}
            placeholder="123456789 или -1001234567890 (для группы)"
            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none" />
          <p className="text-[11px] text-slate-500 mt-1.5 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            Чтобы узнать свой chat_id: напиши боту /start, открой <code className="text-cyan-300 font-mono">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>. Для группы — добавь бота в группу и тоже посмотри getUpdates.
          </p>
        </Card>
      )}

      {keys.map(({ key, label, hint }) => (
        <Card key={key} icon={<Bell className="w-4 h-4 text-cyan-300" />} title={label} subtitle={hint}>
          <div className="space-y-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enabled[key] !== false}
                onChange={e => setNested('notifications_enabled', key, e.target.checked)}
                className="w-4 h-4 accent-emerald-500" />
              <span className="text-sm text-slate-200">Отправлять</span>
            </label>
            <details>
              <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">
                Шаблон сообщения {TEMPLATE_HINTS[key] && <span className="text-cyan-400">· плейсхолдеры: {TEMPLATE_HINTS[key]}</span>}
              </summary>
              <textarea value={texts[key] || ''} onChange={e => setNested('texts', key, e.target.value)}
                rows={5}
                placeholder={`(по умолчанию из DEFAULT_TEXTS — переопредели если нужно)`}
                className="mt-2 w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-xs font-mono focus:border-blue-500 focus:outline-none resize-y" />
              <p className="text-[10px] text-slate-500 mt-1">HTML-разметка: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;, &lt;a href&gt;</p>
            </details>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Кнопки меню
// ────────────────────────────────────────────────────────────────────────────

function ButtonsTab({ settings, setField }) {
  const buttons = settings.menu_buttons || []
  const sorted = [...buttons].sort((a, b) => (a.order || 0) - (b.order || 0))

  function update(idx, patch) {
    const next = sorted.map((b, i) => i === idx ? { ...b, ...patch } : b)
    setField('menu_buttons', next.map((b, i) => ({ ...b, order: i + 1 })))
  }

  function move(idx, delta) {
    const ni = idx + delta
    if (ni < 0 || ni >= sorted.length) return
    const next = [...sorted]
    ;[next[idx], next[ni]] = [next[ni], next[idx]]
    setField('menu_buttons', next.map((b, i) => ({ ...b, order: i + 1 })))
  }

  return (
    <div className="space-y-3">
      <Card icon={<LayoutGrid className="w-4 h-4 text-blue-300" />} title="Главное меню бота" subtitle="ReplyKeyboard внизу чата при /start">
        <p className="text-[11px] text-slate-500 mb-3 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Действие определяется по первому emoji. Оставляй emoji в начале лейбла:{' '}
          <span className="text-cyan-300 font-mono">🌐</span> — веб-панель,{' '}
          <span className="text-cyan-300 font-mono">👤</span> — кабинет,{' '}
          <span className="text-cyan-300 font-mono">🛒</span> — покупка,{' '}
          <span className="text-cyan-300 font-mono">👥</span> — рефералы,{' '}
          <span className="text-cyan-300 font-mono">📋</span> — оферта.
        </p>

        <div className="space-y-2">
          {sorted.map((b, i) => (
            <div key={i} className="flex items-center gap-2 p-2.5 bg-slate-950/40 border border-slate-700/40 rounded-lg">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === sorted.length - 1}
                  className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="checkbox"
                checked={b.enabled !== false}
                onChange={e => update(i, { enabled: e.target.checked })}
                className="w-4 h-4 accent-emerald-500"
                title="Показывать в меню"
              />
              <input value={b.label || ''} onChange={e => update(i, { label: e.target.value })}
                placeholder="🌐 Лейбл кнопки"
                className="flex-1 px-3 py-1.5 bg-slate-900/60 border border-slate-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none" />
              <span className="text-[10px] text-slate-500 font-mono w-12 text-right">{b.action || '—'}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Тексты
// ────────────────────────────────────────────────────────────────────────────

function TextsTab({ settings, setNested }) {
  const texts = settings.texts || {}

  return (
    <div className="space-y-4">
      {TEXT_KEYS.map(({ key, label, hint, rows }) => (
        <Card key={key} icon={<FileText className="w-4 h-4 text-cyan-300" />} title={label} subtitle={hint}>
          <textarea value={texts[key] || ''} onChange={e => setNested('texts', key, e.target.value)}
            rows={rows}
            placeholder={`(оставь пустым чтобы использовать дефолт)`}
            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none resize-y" />
          <p className="text-[10px] text-slate-500 mt-1">HTML-разметка: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;, &lt;a href&gt;</p>
        </Card>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable Card
// ────────────────────────────────────────────────────────────────────────────

function Card({ icon, title, subtitle, children }) {
  return (
    <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-slate-800/60 border border-slate-700/40 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}
