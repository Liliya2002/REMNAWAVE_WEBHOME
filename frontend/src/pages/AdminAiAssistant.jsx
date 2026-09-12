import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Bot, Plug, ShieldCheck, MessageSquareText, ScrollText, RefreshCw, Save,
  AlertCircle, AlertTriangle, CheckCircle2, Plus, Trash2, Pencil, X, Send,
  Zap, Eye, EyeOff, Play, GraduationCap, Power, Search,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/ai'

/**
 * ИИ-ассистент поддержки. Четыре раздела: подключение к провайдеру, правила
 * поведения, база примерных ответов и журнал того, что ассистент сделал.
 */

const SECTIONS = [
  { id: 'connection', label: 'Подключение', Icon: Plug },
  { id: 'rules',      label: 'Правила',     Icon: ShieldCheck },
  { id: 'templates',  label: 'Шаблоны',     Icon: MessageSquareText },
  { id: 'knowledge',  label: 'База знаний', Icon: GraduationCap },
  { id: 'log',        label: 'Журнал',      Icon: ScrollText },
]

const SOURCE_LABEL = {
  history:  'из истории',
  operator: 'оператор поправил',
  manual:   'добавлено руками',
}
const SOURCE_TONE = {
  history:  'text-slate-400 border-slate-600',
  operator: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  manual:   'text-sky-400 border-sky-500/40 bg-sky-500/10',
}

function Chip({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-300 border-slate-700 bg-slate-800/40',
    emerald: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    amber: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
    sky: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  }
  return (
    <span className={`px-2 py-1 rounded-lg border ${tones[tone]}`}>
      {label}: <b>{value}</b>
    </span>
  )
}

const fmtDT = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) }
const fmtNum = n => (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('ru-RU')

/* Причины, по которым ассистент не ответил. Формулируем по-человечески —
   в журнал смотрят, чтобы понять, почему тикет остался без ответа. */
const REASONS = {
  stop_word:         { label: 'Стоп-слово (деньги назад)', tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  model_refund_flag: { label: 'Модель: просят возврат',     tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  needs_human:       { label: 'Нужен человек',              tone: 'text-sky-400 border-sky-500/40 bg-sky-500/10' },
  low_confidence:    { label: 'Мало уверенности',           tone: 'text-slate-400 border-slate-600 bg-slate-700/30' },
  empty_reply:       { label: 'Пустой ответ',               tone: 'text-slate-400 border-slate-600 bg-slate-700/30' },
  classify_failed:   { label: 'Ответ не разобрался',        tone: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
  model_refusal:     { label: 'Модель отклонила запрос',    tone: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
  api_error:         { label: 'Ошибка API',                 tone: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
  send_failed:       { label: 'Не удалось отправить',       tone: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
  close_failed:      { label: 'Не удалось закрыть',         tone: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
  stale_but_refund:  { label: 'Старый, но про возврат',     tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  stale_unanswered:  { label: 'Старый, клиент без ответа',  tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  closed_unanswered: { label: 'Закрыт без ответа',          tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
}
const ACTIONS = {
  replied:   { label: 'Отвечено',        tone: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  closed:    { label: 'Отвечено и закрыто', tone: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  dry_run:   { label: 'Черновик',        tone: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10' },
  escalated: { label: 'Передано людям',  tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  error:     { label: 'Ошибка',          tone: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
}

const input = 'w-full px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-100 text-sm focus:border-cyan-500 focus:outline-none transition'
const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
  </div>
)

export default function AdminAiAssistant() {
  const { section = 'connection' } = useParams()
  const navigate = useNavigate()

  const [cfg, setCfg] = useState(null)
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [templates, setTemplates] = useState([])
  const [log, setLog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [editTpl, setEditTpl] = useState(null)
  const [kb, setKb] = useState(null)
  const [kbBusy, setKbBusy] = useState(false)
  const [kbProbe, setKbProbe] = useState('')
  const [kbProbeResult, setKbProbeResult] = useState(null)

  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await authFetch(`${API}/settings`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки')
      setCfg({ ...d.settings, api_key: '' })
      setDefaultPrompt(d.default_prompt || '')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (section === 'templates') {
      authFetch(`${API}/templates`).then(r => r.json()).then(d => setTemplates(d.templates || [])).catch(() => {})
    }
    if (section === 'log') {
      authFetch(`${API}/log?limit=100`).then(r => r.json()).then(setLog).catch(() => {})
    }
    if (section === 'knowledge') loadKb()
  }, [section])

  async function loadKb() {
    try {
      const r = await authFetch(`${API}/knowledge?limit=200`)
      setKb(await r.json())
    } catch { /* показывать нечего — останется «загружаем» */ }
  }

  /** Разобрать тикеты прямо сейчас. Только чтение на стороне бота. */
  async function harvestNow() {
    setKbBusy(true); setMsg(null); setError(null)
    try {
      const r = await authFetch(`${API}/knowledge/harvest`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось разобрать тикеты')
      const t = (d.results || []).reduce((a, x) => ({
        scanned: a.scanned + (x.scanned || 0),
        added: a.added + (x.added || 0),
        disabled: a.disabled + (x.disabled || 0),
      }), { scanned: 0, added: 0, disabled: 0 })
      setMsg(`Разобрано тикетов: ${t.scanned}, новых примеров: ${t.added}` +
        (t.disabled ? `, отключено устаревших: ${t.disabled}` : ''))
      await loadKb()
    } catch (e) { setError(e.message) } finally { setKbBusy(false) }
  }

  async function toggleKb(item) {
    try {
      await authFetch(`${API}/knowledge/${item.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !item.is_active }),
      })
      await loadKb()
    } catch { /* молча: список перечитается при следующем действии */ }
  }

  async function removeKb(item) {
    if (!confirm('Удалить пример? Ассистент перестанет на него опираться.')) return
    try {
      await authFetch(`${API}/knowledge/${item.id}`, { method: 'DELETE' })
      await loadKb()
    } catch { /* см. выше */ }
  }

  /** Показать, что подберётся под конкретный вопрос. */
  async function probeKb() {
    if (!kbProbe.trim()) return
    setKbProbeResult(null)
    try {
      const r = await authFetch(`${API}/knowledge/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: kbProbe }),
      })
      setKbProbeResult(await r.json())
    } catch (e) { setError(e.message) }
  }

  async function save() {
    setSaving(true); setError(null); setMsg(null)
    try {
      const r = await authFetch(`${API}/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось сохранить')
      setCfg({ ...d.settings, api_key: '' })
      setMsg('Настройки сохранены')
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function testKey() {
    setTesting(true); setTestResult(null)
    try {
      const r = await authFetch(`${API}/test`, { method: 'POST' })
      setTestResult(await r.json())
    } catch (e) { setTestResult({ ok: false, error: e.message }) } finally { setTesting(false) }
  }

  async function runNow() {
    setMsg(null); setError(null)
    try {
      const r = await authFetch(`${API}/run-now`, { method: 'POST' })
      if (!r.ok) throw new Error((await r.json()).error || 'Ошибка')
      setMsg('Прогон запущен — результат смотрите в журнале')
    } catch (e) { setError(e.message) }
  }

  async function saveTemplate(t) {
    const isNew = !t.id
    const r = await authFetch(`${API}/templates${isNew ? '' : '/' + t.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t),
    })
    if (r.ok) {
      setEditTpl(null)
      authFetch(`${API}/templates`).then(x => x.json()).then(d => setTemplates(d.templates || []))
    } else setError((await r.json()).error)
  }

  async function delTemplate(id) {
    if (!confirm('Удалить шаблон?')) return
    await authFetch(`${API}/templates/${id}`, { method: 'DELETE' })
    setTemplates(t => t.filter(x => x.id !== id))
  }

  async function sendDraft(row) {
    if (!confirm(`Отправить этот ответ клиенту в тикет #${row.ticket_id}?\n\nОтозвать сообщение будет нельзя.`)) return
    const r = await authFetch(`${API}/log/${row.id}/send`, { method: 'POST' })
    if (r.ok) { setMsg(`Ответ отправлен в тикет #${row.ticket_id}`); authFetch(`${API}/log?limit=100`).then(x => x.json()).then(setLog) }
    else setError((await r.json()).error)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-slate-400">
      <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Загрузка…
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Шапка */}
      <div className="rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.15),transparent_35%),rgba(2,6,23,0.85)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <Bot className="w-7 h-7 text-cyan-300" /> ИИ-ассистент поддержки
            </h2>
            <p className="text-slate-400 mt-1 text-sm">
              Отвечает на новые тикеты Bedolaga. Обращения про возврат денег и старые тикеты не трогает.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runNow}
              className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 text-sm inline-flex items-center gap-1.5">
              <Play className="w-4 h-4" /> Прогнать сейчас
            </button>
            <button onClick={save} disabled={saving}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold hover:shadow-lg hover:shadow-cyan-500/25 text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>

        {/* Состояние — самое важное видно сразу */}
        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs">
          <span className={`px-2 py-1 rounded border ${cfg?.enabled ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' : 'text-slate-400 border-slate-600 bg-slate-700/30'}`}>
            {cfg?.enabled ? 'Включён' : 'Выключен'}
          </span>
          <span className={`px-2 py-1 rounded border ${cfg?.dry_run ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10' : 'text-amber-400 border-amber-500/40 bg-amber-500/10'}`}>
            {cfg?.dry_run ? 'Холостой режим — ничего не отправляется' : 'БОЕВОЙ РЕЖИМ — отвечает клиентам'}
          </span>
          <span className={`px-2 py-1 rounded border ${cfg?.has_key ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' : 'text-rose-400 border-rose-500/40 bg-rose-500/10'}`}>
            {cfg?.has_key ? 'Ключ задан' : 'Ключ не задан'}
          </span>
          {cfg?.started_at && (
            <span className="text-slate-500">Отвечает на тикеты созданные после {fmtDT(cfg.started_at)}</span>
          )}
        </div>
      </div>

      {msg && <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {msg}</div>}
      {error && <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}

      {/* Разделы */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => navigate(`/admin/ai/${s.id}`)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5 ${
              section === s.id ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300'
                               : 'bg-slate-800/40 border border-slate-700/40 text-slate-400 hover:text-slate-200'}`}>
            <s.Icon className="w-4 h-4" /> {s.label}
          </button>
        ))}
      </div>

      {/* ─── Подключение ─── */}
      {section === 'connection' && cfg && (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-4">
          <Field label="API-ключ провайдера" hint={cfg.has_key ? 'Ключ сохранён. Оставьте поле пустым, чтобы не менять его.' : 'Ключ Customix вида cx-… Хранится в базе в зашифрованном виде.'}>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} autoComplete="off" value={cfg.api_key || ''}
                onChange={e => set('api_key', e.target.value)} placeholder={cfg.has_key ? '•••••••• (не менять)' : 'cx-...'}
                className={`${input} pr-10`} />
              <button type="button" onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Базовый URL" hint="Провайдер должен быть Anthropic-совместимым">
              <input value={cfg.base_url || ''} onChange={e => set('base_url', e.target.value)} className={input} />
            </Field>
            <Field label="Модель">
              <input value={cfg.model || ''} onChange={e => set('model', e.target.value)} className={input} />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Глубина рассуждений" hint="Для поддержки хватает низкой — выше только жжёт токены">
              <select value={cfg.effort || 'low'} onChange={e => set('effort', e.target.value)} className={input}>
                {['low', 'medium', 'high', 'xhigh', 'max'].map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Лимит токенов" hint="Считает размышления и текст вместе — нужен запас">
              <input type="number" min="1000" max="64000" value={cfg.max_tokens || 8000}
                onChange={e => set('max_tokens', e.target.value)} className={input} />
            </Field>
            <Field label="Длина ответа, символов" hint="Предел API Bedolaga — 4000">
              <input type="number" min="200" max="4000" value={cfg.reply_char_limit || 1200}
                onChange={e => set('reply_char_limit', e.target.value)} className={input} />
            </Field>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={testKey} disabled={testing}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Zap className={`w-4 h-4 ${testing ? 'animate-pulse' : ''}`} /> Проверить связь
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {testResult.ok ? `Связь есть — ответила модель ${testResult.model || ''}` : `Не удалось: ${testResult.error}`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ─── Правила ─── */}
      {section === 'rules' && cfg && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-4">
            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input type="checkbox" checked={!!cfg.enabled} onChange={e => set('enabled', e.target.checked)} className="accent-cyan-500 mt-0.5" />
              <span>
                Включить ассистента
                <span className="block text-xs text-slate-500 mt-0.5">
                  При первом включении запоминается текущий момент. Ассистент отвечает только на тикеты,
                  созданные после него — накопленный бэклог не будет тронут никогда.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input type="checkbox" checked={!!cfg.dry_run} onChange={e => set('dry_run', e.target.checked)} className="accent-cyan-500 mt-0.5" />
              <span>
                Холостой режим
                <span className="block text-xs text-slate-500 mt-0.5">
                  Ассистент делает всё, кроме отправки: ответ попадает в журнал, откуда его можно отправить вручную.
                  Снимайте галочку, только посмотрев, что он пишет.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input type="checkbox" checked={!!cfg.can_close_tickets} onChange={e => set('can_close_tickets', e.target.checked)} className="accent-cyan-500 mt-0.5" />
              <span>
                Разрешить закрывать решённые тикеты
                <span className="block text-xs text-slate-500 mt-0.5">
                  Закроет, только если сам считает вопрос решённым и диалог завершённым.
                </span>
              </span>
            </label>
          </div>

          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Не старше, часов" hint="Тикеты старше — людям">
              <input type="number" min="1" max="720" value={cfg.max_ticket_age_hours || 48}
                onChange={e => set('max_ticket_age_hours', e.target.value)} className={input} />
            </Field>
            <Field label="Порог уверенности" hint="Ниже — передаёт человеку. От 0 до 1">
              <input type="number" step="0.05" min="0" max="1" value={cfg.confidence_threshold ?? 0.75}
                onChange={e => set('confidence_threshold', e.target.value)} className={input} />
            </Field>
            <Field label="Интервал опроса, минут">
              <input type="number" min="2" max="120" value={cfg.poll_interval_min || 10}
                onChange={e => set('poll_interval_min', e.target.value)} className={input} />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-4">
            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input type="checkbox" checked={!!cfg.close_stale_enabled}
                onChange={e => set('close_stale_enabled', e.target.checked)} className="accent-cyan-500 mt-0.5" />
              <span>
                Закрывать заброшенные тикеты
                <span className="block text-xs text-slate-500 mt-0.5">
                  Единственный режим, который <b>намеренно заходит в накопленный бэклог</b> — отсечка по дате
                  включения на него не действует. Отвечать на старые тикеты ассистент по-прежнему не будет.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Считать заброшенным через, дней">
                <input type="number" min="7" max="3650" value={cfg.close_stale_days || 30}
                  onChange={e => set('close_stale_days', e.target.value)} className={input} />
              </Field>
              <Field label="Сообщение перед закрытием" hint="Пусто — закрывать молча">
                <textarea rows={3} value={cfg.close_stale_message ?? ''}
                  onChange={e => set('close_stale_message', e.target.value)} className={input} />
              </Field>
            </div>

            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input type="checkbox" checked={cfg.close_stale_unanswered !== false}
                onChange={e => set('close_stale_unanswered', e.target.checked)} className="accent-cyan-500 mt-0.5" />
              <span>
                Закрывать и те, где клиент остался без ответа
                <span className="block text-xs text-slate-500 mt-0.5">
                  Включено: закрываются все старые тикеты подряд. Выключено: те, где последним написал клиент
                  и ответа не последовало, уходят человеку — забыли мы, а не он. В журнале закрытые без ответа
                  помечаются отдельно.
                </span>
              </span>
            </label>

            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200/90">
              <b>Тема возврата денег не закрывается никогда</b>, независимо от возраста и этих галочек.
              Закрыть денежную претензию молча — значит убрать её из очереди так, что о ней уже не вспомнят.
              Такие тикеты всегда уходят человеку.
            </div>
          </div>

          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3">
            <div className="text-sm font-semibold text-amber-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Дополнительные стоп-слова
            </div>
            <p className="text-xs text-amber-200/70">
              Тема «верните деньги» распознаётся <b>всегда</b> — правила зашиты в код и ищут корни слов рядом друг
              с другом, поэтому ловят и «верните мне деньги», и подмену букв латиницей. Отключить их нельзя.
              Здесь можно добавить свои темы сверх этого — по одной на строку.
            </p>
            <textarea rows={5} value={(cfg.stop_words || []).join('\n')}
              onChange={e => set('stop_words', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
              className={`${input} font-mono text-xs`} />
          </div>

          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 space-y-3">
            <div className="text-sm font-semibold text-slate-200">Системный промпт</div>
            <textarea rows={12} value={cfg.system_prompt ?? ''} placeholder={defaultPrompt}
              onChange={e => set('system_prompt', e.target.value)} className={`${input} text-xs`} />
            <button onClick={() => set('system_prompt', defaultPrompt)} className="text-xs text-cyan-400 hover:underline">
              Подставить промпт по умолчанию
            </button>
          </div>
        </div>
      )}

      {/* ─── Шаблоны ─── */}
      {section === 'templates' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">
              Примеры того, как отвечать. Подмешиваются в промпт как образцы тона — ассистент подстраивает их под вопрос,
              а не копирует дословно.
            </p>
            <button onClick={() => setEditTpl({ category: '', question: '', answer: '', priority: 100, is_active: true })}
              className="shrink-0 px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Добавить
            </button>
          </div>

          {templates.length === 0 && (
            <p className="text-center text-slate-500 py-10 text-sm">
              Шаблонов пока нет. Без них ассистент отвечает своими словами — добавьте несколько типовых,
              чтобы задать тон.
            </p>
          )}

          {templates.map(t => (
            <div key={t.id} className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    {t.category && <span className="px-2 py-0.5 rounded text-[11px] bg-slate-700/50 text-slate-300">{t.category}</span>}
                    {!t.is_active && <span className="px-2 py-0.5 rounded text-[11px] bg-slate-700/40 text-slate-500">выключен</span>}
                    <span className="text-[11px] text-slate-600">приоритет {t.priority}</span>
                  </div>
                  <p className="text-sm text-slate-300"><span className="text-slate-500">Вопрос:</span> {t.question}</p>
                  <p className="text-sm text-slate-400 mt-1"><span className="text-slate-500">Ответ:</span> {t.answer}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditTpl(t)} className="p-2 rounded-lg hover:bg-slate-700/60 text-slate-400"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => delTemplate(t.id)} className="p-2 rounded-lg hover:bg-rose-500/20 text-rose-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Журнал ─── */}
      {section === 'knowledge' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-700/60 bg-slate-900/40">
            <div className="text-sm text-slate-300 leading-relaxed">
              Здесь ассистент держит примеры: <b className="text-white">вопрос клиента → ответ живого оператора</b>.
              Перед каждым тикетом он подбирает несколько самых близких и опирается на них.
            </div>
            <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">
              Это не дообучение модели — её веса не наши. Работает подбором примеров, поэтому
              действует сразу, откатывается выключением строки, и всегда видно, на чём построен ответ.
              Ответы самого ассистента в базу не идут: учиться на себе — верный способ закрепить свою же ошибку.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={harvestNow} disabled={kbBusy}
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${kbBusy ? 'animate-spin' : ''}`} />
              {kbBusy ? 'Разбираем тикеты…' : 'Разобрать тикеты сейчас'}
            </button>
            {kb?.stats && (
              <div className="flex flex-wrap gap-3 text-xs">
                <Chip label="всего" value={kb.stats.total} />
                <Chip label="в работе" value={kb.stats.active} tone="emerald" />
                <Chip label="из истории" value={kb.stats.by_source?.history?.total || 0} />
                <Chip label="правки оператора" value={kb.stats.by_source?.operator?.total || 0} tone="amber" />
                <Chip label="добавлено руками" value={kb.stats.by_source?.manual?.total || 0} tone="sky" />
                <Chip label="раз пригодились" value={kb.stats.used} />
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl border border-slate-700/60 bg-slate-900/40">
            <div className="text-xs text-slate-400 mb-2">Проверить, что подберётся под вопрос:</div>
            <div className="flex gap-2 flex-wrap">
              <input value={kbProbe} onChange={e => setKbProbe(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && probeKb()}
                placeholder="не подключается впн на телефоне, выдаёт ошибку"
                className="flex-1 min-w-[240px] px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm" />
              <button onClick={probeKb}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-2">
                <Search className="w-4 h-4" /> Подобрать
              </button>
            </div>
            {kbProbeResult && (
              <div className="mt-3 space-y-2">
                {!kbProbeResult.items?.length && (
                  <div className="text-xs text-slate-500">Ничего не подобралось — ассистент ответит без примеров.</div>
                )}
                {(kbProbeResult.items || []).map(i => (
                  <div key={i.id} className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800 text-xs">
                    <div className="text-slate-500 mb-1">{SOURCE_LABEL[i.source] || i.source} · ранг {Number(i.score).toFixed(3)}</div>
                    <div className="text-slate-300">{i.question}</div>
                    <div className="text-emerald-300/80 mt-1">{i.answer}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!kb ? <div className="text-sm text-slate-500">Загружаем…</div> : (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">Примеров: {kb.total}</div>
              {kb.items.map(i => (
                <div key={i.id} className={`p-3 rounded-xl border ${i.is_active ? 'border-slate-700/60 bg-slate-900/40' : 'border-slate-800 bg-slate-950/40 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className={`px-1.5 py-0.5 rounded border ${SOURCE_TONE[i.source] || 'text-slate-400 border-slate-600'}`}>
                        {SOURCE_LABEL[i.source] || i.source}
                      </span>
                      <span className="text-slate-500">вес {i.weight}</span>
                      {i.ticket_id && <span className="text-slate-600">тикет #{i.ticket_id}</span>}
                      {i.used_count > 0 && <span className="text-emerald-400/70">пригодился {i.used_count} раз</span>}
                      {!i.is_active && <span className="text-slate-500">выключен</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => toggleKb(i)} title={i.is_active ? 'Выключить' : 'Включить'}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200">
                        <Power className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeKb(i)} title="Удалить"
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-[13px] text-slate-300 whitespace-pre-wrap break-words">{i.question}</div>
                  <div className="mt-1.5 text-[13px] text-emerald-300/80 whitespace-pre-wrap break-words">{i.answer}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {section === 'log' && (
        <div className="space-y-3">
          {log?.by_action?.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {log.by_action.map(a => (
                <div key={a.action} className="p-3 rounded-xl border border-slate-700/50 bg-slate-900/35">
                  <div className={`inline-block px-2 py-0.5 rounded text-[11px] border ${ACTIONS[a.action]?.tone || 'text-slate-400 border-slate-600'}`}>
                    {ACTIONS[a.action]?.label || a.action}
                  </div>
                  <div className="text-xl font-bold text-white mt-1.5">{fmtNum(a.n)}</div>
                  <div className="text-[11px] text-slate-500">{fmtNum(a.input_tokens + a.output_tokens)} токенов</div>
                </div>
              ))}
            </div>
          )}

          {(log?.items || []).length === 0 && (
            <p className="text-center text-slate-500 py-10 text-sm">Журнал пуст — ассистент ещё ничего не обрабатывал.</p>
          )}

          {(log?.items || []).map(r => {
            const act = ACTIONS[r.action] || { label: r.action, tone: 'text-slate-400 border-slate-600' }
            const rs = r.escalation_reason ? REASONS[r.escalation_reason] : null
            return (
              <div key={r.id} className="rounded-2xl border border-slate-700/50 bg-slate-900/35 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${act.tone}`}>{act.label}</span>
                  {rs && <span className={`px-2 py-0.5 rounded text-[11px] border ${rs.tone}`}>{rs.label}</span>}
                  <span className="text-xs text-slate-500">тикет #{r.ticket_id}</span>
                  {r.category && <span className="text-xs text-slate-500">· {r.category}</span>}
                  {r.confidence != null && <span className="text-xs text-slate-500">· уверенность {Number(r.confidence).toFixed(2)}</span>}
                  <span className="text-xs text-slate-600 ml-auto">{fmtDT(r.created_at)}</span>
                </div>

                {r.reply_text ? (
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-700/40 text-sm text-slate-300 whitespace-pre-wrap">
                    {r.reply_text}
                  </div>
                ) : (r.action === 'closed' || r.action === 'dry_run') && (
                  /* Рамка означает «текст, который увидит клиент». Когда сообщения
                     нет, показываем это словами, а не пустой рамкой — иначе кажется,
                     что ассистент что-то отправил. */
                  <p className="text-xs text-slate-500 italic">Без сообщения — тикет просто закрывается</p>
                )}
                {r.error && <p className="text-xs text-rose-400 mt-2">{r.error}</p>}

                {r.action === 'dry_run' && (
                  <button onClick={() => sendDraft(r)}
                    className="mt-3 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 text-xs inline-flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5" /> Отправить клиенту
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Модалка шаблона */}
      {editTpl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setEditTpl(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{editTpl.id ? 'Изменить шаблон' : 'Новый шаблон'}</h3>
              <button onClick={() => setEditTpl(null)} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Категория"><input value={editTpl.category || ''} onChange={e => setEditTpl(t => ({ ...t, category: e.target.value }))} placeholder="подключение" className={input} /></Field>
              <Field label="Приоритет" hint="Меньше — выше в промпте"><input type="number" value={editTpl.priority ?? 100} onChange={e => setEditTpl(t => ({ ...t, priority: e.target.value }))} className={input} /></Field>
            </div>
            <Field label="Типичный вопрос клиента">
              <textarea rows={2} value={editTpl.question} onChange={e => setEditTpl(t => ({ ...t, question: e.target.value }))} className={input} />
            </Field>
            <Field label="Как отвечать">
              <textarea rows={5} value={editTpl.answer} onChange={e => setEditTpl(t => ({ ...t, answer: e.target.value }))} className={input} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={editTpl.is_active !== false} onChange={e => setEditTpl(t => ({ ...t, is_active: e.target.checked }))} className="accent-cyan-500" />
              Активен
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditTpl(null)} className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm">Отмена</button>
              <button onClick={() => saveTemplate(editTpl)} className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold text-sm">Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
