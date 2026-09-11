import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Send, RefreshCw, AlertCircle, CheckCircle2, Users, Clock, Ban,
  TriangleAlert, Eye, ArrowLeft, Image as ImageIcon, History, Info,
  Settings, FileText, Plus, Trash2, X, Ban as Blocked,
  Bot, Play, ThumbsDown, Gauge, Timer, ShieldAlert,
  Copy, CornerUpLeft, Check, SlidersHorizontal, TrendingUp,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/bedolaga'

// ─── Рассылка сообщений через Bedolaga Bot ──────────────────────────────────
//
// Отправка необратима: у API бота нет ни отмены, ни паузы. Поэтому поток
// нарочно в три шага, а для больших сегментов требуется ввести число
// получателей руками — промах мимо кнопки не должен стоить 5000 сообщений.

const fmtInt = n => (n == null ? '—' : Number(n).toLocaleString('ru-RU'))
const fmtDT = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) }

/** Сколько осталось до автоматической отправки. */
function leftLabel(at) {
  const ms = new Date(at).getTime() - Date.now()
  if (isNaN(ms)) return ''
  if (ms <= 0) return 'уходит прямо сейчас'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `до отправки ${min} мин.`
  return `до отправки ${Math.floor(min / 60)} ч ${min % 60} мин.`
}


/** Предпросмотр HTML, который поддерживает Telegram. Всё остальное экранируем. */
function telegramPreview(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/&lt;(\/?)(b|strong|i|em|u|s|code|pre)&gt;/g, '<$1$2>')
    .replace(/&lt;a href=&quot;([^&]*)&quot;&gt;/g, '<a href="$1" target="_blank" rel="noopener">')
    .replace(/&lt;a href="([^"]*)"&gt;/g, '<a href="$1" target="_blank" rel="noopener">')
    .replace(/&lt;\/a&gt;/g, '</a>')
    .replace(/\n/g, '<br/>')
}

/**
 * Сколько человек получит рассылку.
 *
 * Главная цифра — сколько бот РЕАЛЬНО взял в прошлый раз: правила сегментов
 * внутри бота нам неизвестны, и проверка показала, что наша оценка совпадает
 * только для одного сегмента из шести (по trial расхождение было в 55 раз).
 * Оценку показываем лишь там, где она сошлась с фактом.
 */
function audienceOf(seg) {
  if (seg.lastSent) {
    return {
      value: seg.lastSent.count,
      source: `столько ушло ${new Date(seg.lastSent.at).toLocaleDateString('ru-RU')}`,
      solid: true,
    }
  }
  if (seg.estimateReliable) {
    return { value: seg.estimate, source: 'по нашим данным', solid: true }
  }
  return { value: null, source: 'неизвестно — сегмент ещё не отправлялся', solid: false }
}

function SegmentCard({ seg, active, onPick }) {
  const aud = audienceOf(seg)
  return (
    <button
      onClick={() => onPick(seg.id)}
      className={`text-left p-4 rounded-2xl border transition-all ${
        active
          ? 'border-cyan-500 bg-cyan-500/10'
          : 'border-slate-700/60 bg-slate-900/40 hover:border-slate-600'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-white">{seg.label}</span>
        {!seg.verified && (
          <span title="В истории бота этот сегмент не встречался ни разу — поведение не проверено"
            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 flex items-center gap-1">
            <TriangleAlert className="w-3 h-3" /> не проверен
          </span>
        )}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{seg.hint}</div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${aud.solid ? 'text-cyan-300' : 'text-slate-600'}`}>
          {aud.value == null ? '?' : fmtInt(aud.value)}
        </span>
        <span className="text-[11px] text-slate-500">получателей</span>
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5">{aud.source}</div>

      {seg.usedTimes > 0 && (
        <div className="text-[10px] text-slate-600 mt-1">использован {seg.usedTimes} раз</div>
      )}
    </button>
  )
}

export default function AdminBroadcasts() {
  const [accounts, setAccounts] = useState([])
  const [accId, setAccId] = useState(null)

  const [segments, setSegments] = useState([])
  const [segLoading, setSegLoading] = useState(true)
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  // Составление
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [stage, setStage] = useState('edit')      // edit | confirm | sending | done
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState(null)

  const [tab, setTab] = useState('send')          // send | settings | templates
  const [settings, setSettings] = useState(null)
  const [templates, setTemplates] = useState([])
  const [gate, setGate] = useState(null)          // можно ли отправлять прямо сейчас
  const [proposals, setProposals] = useState([])
  const [aiRuns, setAiRuns] = useState([])
  const [aiBusy, setAiBusy] = useState(false)
  const [openBc, setOpenBc] = useState(null)      // рассылка, открытая на просмотр
  const [rules, setRules] = useState({})
  const [promoPerf, setPromoPerf] = useState(null)
  const [revenue, setRevenue] = useState(null)
  const [neglect, setNeglect] = useState({})
  const [dup, setDup] = useState(null)            // похожая недавняя рассылка

  useEffect(() => {
    authFetch(`${API}/accounts`).then(r => r.json()).then(d => {
      const list = d.items || d.accounts || []
      setAccounts(list)
      const first = list.find(x => x.is_active) || list[0]
      if (first) setAccId(first.id)
    }).catch(() => {})
  }, [])

  const loadAll = useCallback(async (force = false) => {
    if (!accId) return
    setSegLoading(true); setError(null)
    try {
      const q = force ? '?force=1' : ''
      const [s, h, st, tpl, g, pr, rl, pp] = await Promise.all([
        authFetch(`${API}/accounts/${accId}/segments${q}`).then(r => r.json()),
        authFetch(`${API}/accounts/${accId}/broadcasts${q}`).then(r => r.json()),
        authFetch(`${API}/broadcast-settings`).then(r => r.json()),
        authFetch(`${API}/broadcast-templates`).then(r => r.json()),
        authFetch(`${API}/accounts/${accId}/broadcast-gate`).then(r => r.json()),
        authFetch(`${API}/accounts/${accId}/proposals`).then(r => r.json()),
        authFetch(`${API}/segment-rules`).then(r => r.json()),
        authFetch(`${API}/accounts/${accId}/promo-performance`).then(r => r.json()),
      ])
      if (s.error) throw new Error(s.error)
      setSegments(s.segments || [])
      setHistory(h.items || [])
      setSettings(st.settings || null)
      setTemplates(tpl.items || [])
      setGate(g && typeof g.ok === 'boolean' ? g : null)
      setProposals(pr.items || [])
      setAiRuns(pr.runs || [])
      setRules(rl.rules || {})
      setPromoPerf(pp && pp.ok ? pp : null)
    } catch (e) {
      if (e.message !== 'Unauthorized' && e.message !== 'No token') setError(e.message)
    } finally { setSegLoading(false) }
  }, [accId])

  useEffect(() => { loadAll() }, [loadAll])

  // Выручку и простой сегментов грузим только при открытии вкладки настроек:
  // revenueLift перебирает все пополнения бота, и тянуть это на каждый вход
  // на страницу незачем.
  useEffect(() => {
    if (tab !== 'settings' || !accId || revenue !== null) return
    Promise.all([
      authFetch(`${API}/accounts/${accId}/revenue-lift`).then(r => r.json()).catch(() => ({})),
      authFetch(`${API}/accounts/${accId}/segment-neglect`).then(r => r.json()).catch(() => ({})),
    ]).then(([rv, ng]) => {
      setRevenue(rv && rv.ok ? rv : { ok: false })
      setNeglect((ng && ng.neglect) || {})
    })
  }, [tab, accId, revenue])

  const seg = useMemo(() => segments.find(s => s.id === target) || null, [segments, target])
  const aud = seg ? audienceOf(seg) : null
  const pendingCount = proposals.filter(p => p.status === 'pending').length
  const threshold = Number(settings?.confirm_typing_threshold ?? 1000)
  const needTyping = aud?.value != null && threshold > 0 && aud.value >= threshold
  const typingOk = !needTyping || typed.trim() === String(aud.value)

  // Повтор человеку не запрещаем — только показываем. Причина отправить то же
  // самое ещё раз бывает, и знает её человек, а не мы.
  async function checkDuplicate() {
    setDup(null)
    try {
      const r = await authFetch(`${API}/accounts/${accId}/broadcast-duplicate-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, message_text: text }),
      })
      const d = await r.json()
      if (r.ok && d.duplicate) setDup(d)
    } catch { /* проверка необязательна — молчим */ }
  }

  async function send() {
    setStage('sending'); setError(null)
    try {
      const r = await authFetch(`${API}/accounts/${accId}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, message_text: text }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Не удалось отправить')
      setResult(d.broadcast || {})
      setStage('done')
      loadAll(true)
    } catch (e) {
      setError(e.message)
      setStage('confirm')
    }
  }

  async function saveSettings(patch) {
    const r = await authFetch(`${API}/broadcast-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    const d = await r.json()
    if (!r.ok) { setError(d.error || 'Не удалось сохранить'); return }
    setSettings(d.settings)
    loadAll()          // ограничения изменились — перечитываем и состояние гейта
  }

  const tplOp = async (method, path, body) => {
    const r = await authFetch(`${API}/broadcast-templates${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error || 'Ошибка'); return }
    const list = await authFetch(`${API}/broadcast-templates`).then(x => x.json())
    setTemplates(list.items || [])
  }

  async function aiRun() {
    setAiBusy(true); setError(null)
    try {
      const r = await authFetch(`${API}/accounts/${accId}/proposals/run`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) { setError(d.error || 'Ошибка анализа'); return }
      const label = {
        proposed: 'Предложение готово',
        skipped: 'Повода для рассылки нет',
        dry_run: 'Холостой режим: решение записано в журнал, карточка не создана',
        blocked: 'Заблокировано проверками',
        error: 'Ошибка',
      }[d.outcome] || d.outcome
      setNotice(`${label}${d.detail ? ' — ' + d.detail : ''}`)
      setTimeout(() => setNotice(null), 8000)
      loadAll()
    } finally { setAiBusy(false) }
  }

  async function decide(pid, action, reason) {
    setError(null)
    const r = await authFetch(`${API}/accounts/${accId}/proposals/${pid}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || null }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error || 'Не удалось'); return }
    setNotice(action === 'approve' ? 'Рассылка запущена' : 'Предложение отклонено')
    setTimeout(() => setNotice(null), 5000)
    loadAll(true)
  }

  async function saveRule(segment, patch) {
    const r = await authFetch(`${API}/segment-rules/${segment}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error || 'Не удалось сохранить правило'); return }
    setRules(p => ({ ...p, [segment]: { ...p[segment], ...d.rule } }))
    loadAll()
  }

  async function emergencyStop() {
    if (!confirm('Выключить автопилот и снять все запланированные рассылки?')) return
    const r = await authFetch(`${API}/broadcast-ai/stop`, { method: 'POST' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error || 'Не удалось'); return }
    setNotice(`Автопилот выключен, снято из очереди: ${d.cancelled}`)
    setTimeout(() => setNotice(null), 6000)
    loadAll()
  }

  function reset() {
    setStage('edit'); setText(''); setTarget(''); setTyped(''); setResult(null)
  }

  // ── Средние показатели для шапки истории ──
  const summary = useMemo(() => {
    const withRate = history.filter(b => b.blocked_per_day != null)
    const withDeliv = history.filter(b => b.delivery_pct != null)
    return {
      total: history.length,
      avgDelivery: withDeliv.length
        ? (withDeliv.reduce((s, b) => s + b.delivery_pct, 0) / withDeliv.length).toFixed(1)
        : null,
      avgBlockRate: withRate.length
        ? (withRate.reduce((s, b) => s + b.blocked_per_day, 0) / withRate.length).toFixed(1)
        : null,
    }
  }, [history])

  const chars = text.length
  const overLimit = chars > 4096

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-cyan-400" /> Рассылка сообщений
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Сообщения уходят в Telegram пользователям бота. Отменить отправку нельзя.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 1 && (
            <select value={accId || ''} onChange={e => setAccId(Number(e.target.value))}
              className="px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-slate-200 text-sm">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={() => loadAll(true)}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${segLoading ? 'animate-spin' : ''}`} /> Обновить
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm">{notice}</div>
      )}

      {/* Полоса вкладок прокручивается вбок. На экране 393px четыре вкладки
          занимают 478px, а корневая обёртка админки — overflow-x: hidden:
          «Шаблоны» и «ИИ» просто обрезались, без полосы прокрутки и без
          возможности до них добраться. Счётчики в подписях растут, так что
          ужать padding недостаточно — нужна именно прокрутка. */}
      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto thin-scroll">
        {[
          { id: 'send', label: 'Отправка', Icon: Send },
          { id: 'settings', label: 'Настройки', Icon: Settings },
          { id: 'templates', label: 'Шаблоны' + (templates.length ? ' · ' + templates.length : ''), Icon: FileText },
          { id: 'ai', label: 'ИИ' + (pendingCount ? ' · ' + pendingCount : ''), Icon: Bot },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 sm:px-4 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px transition shrink-0 whitespace-nowrap ${
              tab === t.id ? 'border-cyan-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}>
            <t.Icon className="w-4 h-4 shrink-0" /> {t.label}
          </button>
        ))}
      </div>

      {/* Отправка запрещена настройками — говорим заранее, а не в момент нажатия */}
      {tab === 'send' && gate && !gate.ok && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm flex items-center gap-2">
          <Blocked className="w-4 h-4 shrink-0" /> Отправка заблокирована настройками: {gate.message}
        </div>
      )}

      {/* ── Готово ── */}
      {tab === 'send' && stage === 'done' && (
        <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <div className="text-lg font-semibold text-white">Рассылка запущена</div>
          <div className="text-sm text-slate-400 mt-1">
            №{result?.id} · сегмент {target} · получателей {fmtInt(result?.total_count)}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Доставка идёт в фоне. Итог появится в истории ниже — обновите через пару минут.
          </div>
          <button onClick={reset}
            className="mt-4 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm">
            Составить ещё одну
          </button>
        </div>
      )}

      {/* ── Составление ── */}
      {tab === 'send' && stage === 'edit' && (
        <>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Кому</div>
            {segLoading && !segments.length ? (
              <div className="text-sm text-slate-500 py-6">Считаем аудиторию…</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {segments.map(s => (
                  <SegmentCard key={s.id} seg={s} active={target === s.id} onPick={setTarget} />
                ))}
              </div>
            )}
            <div className="mt-2 text-[11px] text-slate-600 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Число получателей — это сколько бот взял в прошлую рассылку по тому же сегменту.
              Правила сегментов задаёт сам бот, наш подсчёт по его базе совпадает не везде,
              поэтому показываем факт, а не оценку.
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Текст</div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={12}
                placeholder="Поддерживается разметка Telegram: <b>жирный</b>, <i>курсив</i>, <u>подчёркнутый</u>, <code>моноширинный</code>, ссылки."
                className={`w-full px-3 py-2 bg-slate-950/60 border rounded-xl text-slate-100 text-sm font-mono leading-relaxed focus:outline-none ${
                  overLimit ? 'border-red-500' : 'border-slate-700 focus:border-cyan-500'
                }`}
              />
              <div className={`text-[11px] mt-1 ${overLimit ? 'text-red-400' : 'text-slate-600'}`}>
                {fmtInt(chars)} / 4096 символов{overLimit ? ' — Telegram не примет' : ''}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Как увидит пользователь
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-[#17212b] p-4 min-h-[200px]">
                {text.trim() ? (
                  <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[14px] leading-snug text-slate-100 break-words"
                    dangerouslySetInnerHTML={{ __html: telegramPreview(text) }} />
                ) : (
                  <div className="text-sm text-slate-600">Здесь появится предпросмотр</div>
                )}
              </div>
              <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" /> Вложения пока не поддерживаются — только текст
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => { setTyped(''); setStage('confirm'); checkDuplicate() }}
              disabled={!target || !text.trim() || overLimit}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-semibold text-sm"
            >
              Дальше
            </button>
          </div>
        </>
      )}

      {/* ── Подтверждение ── */}
      {tab === 'send' && (stage === 'confirm' || stage === 'sending') && seg && (
        <div className="max-w-2xl mx-auto p-6 rounded-2xl border border-amber-500/40 bg-amber-500/5 space-y-4">
          <div className="flex items-center gap-2 text-amber-300 font-semibold">
            <TriangleAlert className="w-5 h-5" /> Подтвердите отправку
          </div>

          <div className="text-center py-3">
            <div className="text-4xl font-bold text-white">{aud.value == null ? '?' : fmtInt(aud.value)}</div>
            <div className="text-sm text-slate-400 mt-1">
              человек получат это сообщение · сегмент «{seg.label}»
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/60 bg-[#17212b] p-4">
            <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[14px] leading-snug text-slate-100 break-words"
              dangerouslySetInnerHTML={{ __html: telegramPreview(text) }} />
          </div>

          {dup && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-sm text-amber-200">
              <div className="font-semibold flex items-center gap-1.5">
                <Copy className="w-4 h-4" /> Похоже на повтор
              </div>
              <div className="mt-1 text-amber-200/90">{dup.message}</div>
              <div className="mt-1 text-[11px] text-amber-200/60">
                Отправить всё равно можно — это предупреждение, а не запрет.
              </div>
            </div>
          )}

          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            Отменить, приостановить или отозвать рассылку после запуска <b>нельзя</b> —
            у API бота нет такой возможности.
          </div>

          {needTyping && (
            <div>
              <label className="text-xs text-slate-400">
                Введите число получателей — <b className="text-slate-200">{aud.value}</b> — чтобы подтвердить
              </label>
              <input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                disabled={stage === 'sending'}
                placeholder={String(aud.value)}
                className="w-full mt-1 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}

          <div className="flex justify-between gap-2">
            <button onClick={() => setStage('edit')} disabled={stage === 'sending'}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2 disabled:opacity-40">
              <ArrowLeft className="w-4 h-4" /> Назад
            </button>
            <button onClick={send} disabled={stage === 'sending' || !typingOk}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-semibold text-sm">
              {stage === 'sending' ? 'Отправляем…' : 'Отправить'}
            </button>
          </div>
        </div>
      )}

      {/* ── История ── */}
      {tab === 'send' && <div className="pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" /> История · {summary.total}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {summary.avgDelivery && <span>средняя доставляемость <b className="text-slate-300">{summary.avgDelivery} %</b></span>}
            {summary.avgBlockRate && <span>блокировок в сутки <b className="text-slate-300">{summary.avgBlockRate}</b></span>}
          </div>
        </div>

        <div className="space-y-1.5 max-h-[560px] overflow-y-auto thin-scroll pr-1">
          {history.map(b => (
            <div key={b.id} onClick={() => setOpenBc(b)}
              className="p-3 rounded-xl bg-slate-900/40 border border-slate-700/50 cursor-pointer hover:border-slate-600 hover:bg-slate-900/60 transition">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-slate-500">#{b.id}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">{b.target_type}</span>
                <span className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDT(b.created_at)}</span>
                {b.admin_name && <span className="text-slate-600">{b.admin_name}</span>}
                {b.has_media && <span className="text-violet-400 flex items-center gap-1"><ImageIcon className="w-3 h-3" />{b.media_type}</span>}
              </div>

              <div className="text-[13px] text-slate-300 mt-1.5 line-clamp-2 whitespace-pre-wrap break-words">
                {String(b.message_text || '').replace(/<[^>]+>/g, '')}
              </div>
              <div className="text-[10px] text-slate-600 mt-1">нажмите, чтобы открыть полностью</div>

              <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" /> {fmtInt(b.sent_count)} из {fmtInt(b.total_count)}
                  {b.delivery_pct != null && <span className="text-slate-400">({b.delivery_pct} %)</span>}
                </span>
                <span className="flex items-center gap-1">
                  <Ban className="w-3 h-3" /> заблокировали {fmtInt(b.blocked_count)}
                </span>
                {b.blocked_per_day != null && (
                  <span title={`+${b.blocked_delta} новых за ${b.gap_days} дн. с прошлой рассылки этого сегмента`}>
                    +{b.blocked_per_day} блок./сутки
                  </span>
                )}
              </div>
            </div>
          ))}
          {!history.length && !segLoading && (
            <div className="text-sm text-slate-600 py-6 text-center">История пуста</div>
          )}
        </div>
      </div>}

      {openBc && (
        <BroadcastModal
          b={openBc}
          onClose={() => setOpenBc(null)}
          onReuse={() => {
            // Берём текст КАК ЕСТЬ, с разметкой: в строке истории теги
            // вырезаны для читаемости, но повторять надо оригинал.
            setText(openBc.message_text || '')
            setTarget(openBc.target_type)
            setStage('edit')
            setTab('send')
            setOpenBc(null)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}

      {tab === 'settings' && settings && (
        <div className="space-y-8">
          <SettingsTab settings={settings} segments={segments} onSave={saveSettings} />
          <SegmentRulesTab rules={rules} segments={segments} neglect={neglect} onSave={saveRule} />
          <RevenueBlock data={revenue} />
          <PromoPerfBlock perf={promoPerf} />
        </div>
      )}

      {tab === 'ai' && settings && (
        <AiTab
          settings={settings} segments={segments} proposals={proposals} runs={aiRuns}
          busy={aiBusy} onRun={aiRun} onDecide={decide} onSave={saveSettings}
          onStop={emergencyStop}
        />
      )}

      {tab === 'templates' && (
        <TemplatesTab
          items={templates}
          segments={segments}
          onCreate={t => tplOp('POST', '', t)}
          onUpdate={(id, patch) => tplOp('PUT', '/' + id, patch)}
          onDelete={id => tplOp('DELETE', '/' + id)}
        />
      )}
    </div>
  )
}

/**
 * Настройки рассылки. Всё, что тут есть, существует только на нашей стороне:
 * у API бота нет ни лимитов частоты, ни тихих часов, ни отмены.
 */
function SettingsTab({ settings, onSave, segments }) {
  const [f, setF] = useState(settings || {})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setF(settings || {}) }, [settings])

  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setSaved(false) }

  async function save() {
    setSaving(true)
    try { await onSave(f); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    finally { setSaving(false) }
  }

  const allowed = f.allowed_targets || []
  const toggleTarget = id => set('allowed_targets',
    allowed.includes(id) ? allowed.filter(x => x !== id) : [...allowed, id])

  const quietOn = f.quiet_from_hour != null && f.quiet_to_hour != null

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Минимум между рассылками, минут"
          hint="0 — без ограничения. Считается по нашему журналу отправок, не по истории бота">
          <input type="number" min="0" value={f.min_interval_minutes ?? ''}
            onChange={e => set('min_interval_minutes', e.target.value)} className={inputCls} />
        </Field>

        <Field label="Максимум рассылок в неделю" hint="0 — без ограничения">
          <input type="number" min="0" value={f.max_per_week ?? ''}
            onChange={e => set('max_per_week', e.target.value)} className={inputCls} />
        </Field>

        <Field label="Подтверждение вводом числа, от скольких получателей"
          hint="Для крупных сегментов придётся набрать число вручную">
          <input type="number" min="0" value={f.confirm_typing_threshold ?? ''}
            onChange={e => set('confirm_typing_threshold', e.target.value)} className={inputCls} />
        </Field>

        <Field label="Часовой пояс аудитории, минут от UTC" hint="180 — Москва">
          <input type="number" value={f.timezone_offset_minutes ?? 180}
            onChange={e => set('timezone_offset_minutes', e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1">Тихие часы</div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="accent-cyan-500 w-4 h-4" checked={quietOn}
              onChange={e => {
                if (e.target.checked) { set('quiet_from_hour', 22); set('quiet_to_hour', 9) }
                else { set('quiet_from_hour', null); set('quiet_to_hour', null) }
              }} />
            включить
          </label>
          {quietOn && (
            <>
              <span className="text-sm text-slate-400">с</span>
              <input type="number" min="0" max="23" value={f.quiet_from_hour ?? 22}
                onChange={e => set('quiet_from_hour', e.target.value)}
                className="w-20 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm" />
              <span className="text-sm text-slate-400">до</span>
              <input type="number" min="0" max="23" value={f.quiet_to_hour ?? 9}
                onChange={e => set('quiet_to_hour', e.target.value)}
                className="w-20 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm" />
              <span className="text-xs text-slate-500">часов по поясу аудитории</span>
            </>
          )}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          Окно может переходить через полночь: «с 22 до 9» — это ночь.
          В прошлом рассылки уходили и в 03:33.
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1">Разрешённые сегменты</div>
        <div className="flex gap-2 flex-wrap">
          {segments.map(s => (
            <label key={s.id} className="flex items-center gap-1.5 text-xs text-slate-300 px-2 py-1 rounded-lg border border-slate-700/60">
              <input type="checkbox" className="accent-cyan-500" checked={allowed.includes(s.id)}
                onChange={() => toggleTarget(s.id)} />
              {s.label}
            </label>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          Ничего не отмечено — разрешены все. Отметьте, чтобы ограничить список.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-semibold">
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        {saved && <span className="text-sm text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Сохранено</span>}
      </div>
    </div>
  )
}

/** Шаблоны: образцы для человека и основа, под которую подстраивается ИИ. */
function TemplatesTab({ items, segments, onCreate, onUpdate, onDelete }) {
  const [draft, setDraft] = useState(null)

  const empty = { name: '', occasion: '', body: '', target_default: '', sort_order: 0 }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          Образцы текстов. Человек берёт готовый, ИИ подбирает подходящий и подстраивает под повод.
        </div>
        <button onClick={() => setDraft({ ...empty })}
          className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" /> Добавить
        </button>
      </div>

      {!items.length && (
        <div className="p-8 text-center text-slate-600 text-sm border border-dashed border-slate-700 rounded-xl">
          Шаблонов пока нет
        </div>
      )}

      <div className="space-y-2">
        {items.map(t => (
          <div key={t.id} className={`p-3 rounded-xl border ${t.is_active ? 'border-slate-700/60 bg-slate-900/40' : 'border-slate-800 bg-slate-900/20 opacity-60'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white">{t.name}</span>
              {t.target_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">{t.target_default}</span>}
              {!t.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">отключён</span>}
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => setDraft({ ...t })}
                  className="px-2 py-1 rounded hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 text-xs">Изменить</button>
                <button onClick={() => onUpdate(t.id, { is_active: !t.is_active })}
                  className="px-2 py-1 rounded hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 text-xs">
                  {t.is_active ? 'Отключить' : 'Включить'}
                </button>
                <button onClick={() => { if (confirm(`Удалить шаблон «${t.name}»?`)) onDelete(t.id) }}
                  className="p-1.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-300">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {t.occasion && <div className="text-[11px] text-slate-500 mt-0.5">Повод: {t.occasion}</div>}
            <div className="text-[13px] text-slate-400 mt-1.5 line-clamp-3 whitespace-pre-wrap break-words">{t.body}</div>
          </div>
        ))}
      </div>

      {draft && (
        <Modal title={draft.id ? `Шаблон «${draft.name}»` : 'Новый шаблон'} onClose={() => setDraft(null)}>
          <div className="space-y-3">
            <Field label="Название" hint="Для себя и для ИИ: «Новый сервер», «Возврат ушедших»">
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Когда уместен" hint="Текстом. Именно по этому описанию ИИ выбирает шаблон под ситуацию">
              <input value={draft.occasion || ''} onChange={e => setDraft({ ...draft, occasion: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Сегмент по умолчанию">
              <select value={draft.target_default || ''} onChange={e => setDraft({ ...draft, target_default: e.target.value })} className={inputCls}>
                <option value="">не задан</option>
                {segments.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Текст" hint="Разметка Telegram поддерживается">
              <textarea rows={10} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })}
                className={inputCls + ' font-mono leading-relaxed'} />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm">Отмена</button>
            <button
              onClick={async () => {
                if (!draft.name.trim() || !draft.body.trim()) return
                if (draft.id) await onUpdate(draft.id, draft); else await onCreate(draft)
                setDraft(null)
              }}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold">
              Сохранить
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full mt-1 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 focus:outline-none'

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl my-8 bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * ИИ: настройки, очередь предложений и журнал решений.
 *
 * Принять предложение — значит отправить его. Поэтому кнопка ведёт через
 * подтверждение с числом получателей, как и ручная отправка: карточка могла
 * пролежать сутки, и условия за это время изменились.
 */
function AiTab({ settings, segments, proposals, runs, busy, onRun, onDecide, onSave, onStop }) {
  const [f, setF] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [rejectId, setRejectId] = useState(null)
  const [rejectText, setRejectText] = useState('')
  const [typed, setTyped] = useState('')

  useEffect(() => { setF(settings) }, [settings])
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const pending = proposals.filter(p => p.status === 'pending')
  const scheduled = proposals.filter(p => p.status === 'scheduled')
  const decided = proposals.filter(p => p.status !== 'pending').slice(0, 10)
  const aiAllowed = f.ai_allowed_targets || []

  const MODES = [
    { id: 'off', label: 'Выключен', hint: 'Ничего не делает' },
    { id: 'prepare', label: 'Подготовка', hint: 'Готовит карточки, отправляете вы' },
    { id: 'auto', label: 'Автопилот', hint: 'Отправляет сам после окна отмены' },
  ]

  const confirmProposal = proposals.find(p => p.id === confirmId)
  const typingOk = !confirmProposal || !confirmProposal.recipients ||
    confirmProposal.recipients < Number(settings.confirm_typing_threshold || 1000) ||
    typed.trim() === String(confirmProposal.recipients)

  return (
    <div className="space-y-6">
      {/* ── Очередь автопилота ── */}
      {scheduled.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            <Timer className="w-4 h-4 text-amber-400" /> Уйдёт автоматически
          </div>
          {scheduled.map(p => (
            <div key={p.id} className="p-4 rounded-2xl border border-amber-500/50 bg-amber-500/5 space-y-3">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">{p.target}</span>
                <span className="text-slate-300">{fmtInt(p.recipients)} получателей</span>
                <span className="text-amber-300 font-semibold">{leftLabel(p.scheduled_at)}</span>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-[#17212b] p-3">
                <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[14px] leading-snug text-slate-100 break-words"
                  dangerouslySetInnerHTML={{ __html: telegramPreview(p.message_text) }} />
              </div>
              {p.reason && <div className="text-xs text-slate-400"><b className="text-slate-300">Почему:</b> {p.reason}</div>}
              <div className="flex justify-end">
                <button onClick={() => onDecide(p.id, 'cancel')}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold">
                  Снять с отправки
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Очередь предложений ── */}
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-violet-400" /> Предложения
            {pending.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">{pending.length}</span>}
          </div>
          <button onClick={onRun} disabled={busy}
            className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm flex items-center gap-2">
            <Play className="w-4 h-4" /> {busy ? 'Анализируем…' : 'Проанализировать сейчас'}
          </button>
        </div>

        {!pending.length && (
          <div className="p-6 text-center text-slate-600 text-sm border border-dashed border-slate-700 rounded-xl">
            Необработанных предложений нет
          </div>
        )}

        {pending.map(p => (
          <div key={p.id} className="p-4 rounded-2xl border border-violet-500/40 bg-violet-500/5 space-y-3">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">{p.target}</span>
              <span className="text-slate-400">{fmtInt(p.recipients)} получателей</span>
              <span className="text-slate-500 flex items-center gap-1">
                <Gauge className="w-3 h-3" /> уверенность {Number(p.confidence).toFixed(2)}
              </span>
              {p.template_name && <span className="text-slate-500">шаблон: {p.template_name}</span>}
              <span className="text-slate-600 ml-auto">{fmtDT(p.created_at)}</span>
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-[#17212b] p-3">
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[14px] leading-snug text-slate-100 break-words"
                dangerouslySetInnerHTML={{ __html: telegramPreview(p.message_text) }} />
            </div>

            {p.reason && <div className="text-xs text-slate-400"><b className="text-slate-300">Почему:</b> {p.reason}</div>}
            {p.risks && <div className="text-xs text-amber-400/80"><b>Риски:</b> {p.risks}</div>}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setRejectId(p.id); setRejectText('') }}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2">
                <ThumbsDown className="w-4 h-4" /> Отклонить
              </button>
              <button onClick={() => { setConfirmId(p.id); setTyped('') }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold">
                Отправить
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Настройки ── */}
      <div className="pt-4 border-t border-slate-800 space-y-4">
        <div className="text-sm font-semibold text-white">Настройки ИИ</div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MODES.map(m => (
            <button key={m.id} onClick={() => set('ai_mode', m.id)}
              className={`text-left p-3 rounded-xl border transition ${
                f.ai_mode === m.id ? 'border-violet-500 bg-violet-500/10' : 'border-slate-700/60 bg-slate-900/40'
              }`}>
              <div className="text-sm font-semibold text-white">{m.label}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{m.hint}</div>
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-violet-500 w-4 h-4" checked={!!f.ai_dry_run}
            onChange={e => set('ai_dry_run', e.target.checked)} />
          Холостой режим — решения пишутся в журнал, карточки не создаются
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Как часто анализировать, часов">
            <input type="number" min="1" value={f.ai_interval_hours ?? 24}
              onChange={e => set('ai_interval_hours', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Минимальная уверенность" hint="Ниже этого порога предложение не создаётся">
            <input type="number" min="0" max="1" step="0.05" value={f.ai_min_confidence ?? 0.7}
              onChange={e => set('ai_min_confidence', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Окно отмены автопилота, минут"
            hint="Сколько ждать перед отправкой. 0 — отправлять сразу, без возможности снять">
            <input type="number" min="0" value={f.ai_auto_delay_minutes ?? 30}
              onChange={e => set('ai_auto_delay_minutes', e.target.value)} className={inputCls} />
          </Field>
        </div>

        {f.ai_mode === 'auto' && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            Автопилот отправляет рассылки <b>сам</b>, без вашего участия.
            {Number(f.ai_auto_delay_minutes) > 0
              ? ` Уведомление придёт в Telegram за ${f.ai_auto_delay_minutes} мин. до отправки — это единственное окно, чтобы снять её.`
              : ' Окно отмены равно нулю: снять рассылку будет невозможно.'}
          </div>
        )}

        <div>
          <div className="text-xs text-slate-400 mb-1">Сегменты, доступные ИИ</div>
          <div className="flex gap-2 flex-wrap">
            {segments.map(sg => (
              <label key={sg.id} className="flex items-center gap-1.5 text-xs text-slate-300 px-2 py-1 rounded-lg border border-slate-700/60">
                <input type="checkbox" className="accent-violet-500" checked={aiAllowed.includes(sg.id)}
                  onChange={() => set('ai_allowed_targets',
                    aiAllowed.includes(sg.id) ? aiAllowed.filter(x => x !== sg.id) : [...aiAllowed, sg.id])} />
                {sg.label}
              </label>
            ))}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Ничего не отмечено — те же, что разрешены на вкладке «Настройки».
          </div>
        </div>

        <Field label="Дополнительные указания" hint="Подмешиваются к промпту: тон, что можно обещать, чего избегать">
          <textarea rows={4} value={f.ai_prompt || ''} onChange={e => set('ai_prompt', e.target.value)}
            className={inputCls} />
        </Field>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button onClick={async () => { setSaving(true); try { await onSave(f) } finally { setSaving(false) } }}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold">
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>

          {/* Одна кнопка гасит автопилот и снимает всю очередь — на случай,
              когда разбираться в настройках уже некогда. */}
          <button onClick={onStop}
            className="px-4 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Аварийный стоп
          </button>
        </div>
      </div>

      {/* ── Журнал решений ── */}
      <div className="pt-4 border-t border-slate-800">
        <div className="text-sm font-semibold text-white mb-2">Журнал решений</div>
        <div className="space-y-1 max-h-80 overflow-y-auto thin-scroll pr-1">
          {runs.map(r => (
            <div key={r.id} className="p-2 rounded-lg bg-slate-900/40 border border-slate-800 text-xs flex items-start gap-2">
              <span className={`px-1.5 py-0.5 rounded shrink-0 ${
                r.outcome === 'proposed' ? 'bg-emerald-500/20 text-emerald-300'
                : r.outcome === 'blocked' ? 'bg-red-500/20 text-red-300'
                : r.outcome === 'error' ? 'bg-amber-500/20 text-amber-300'
                : 'bg-slate-700 text-slate-400'}`}>{r.outcome}</span>
              <span className="text-slate-400 min-w-0 flex-1">{r.detail || r.reason || '—'}</span>
              <span className="text-slate-600 shrink-0">{fmtDT(r.created_at)}</span>
            </div>
          ))}
          {!runs.length && <div className="text-sm text-slate-600 py-4 text-center">Пока пусто</div>}
        </div>
      </div>

      {/* Отклонение с причиной */}
      {rejectId && (
        <Modal title="Отклонить предложение" onClose={() => setRejectId(null)}>
          <Field label="Причина" hint="Уйдёт в промпт антипримером — иначе ИИ предложит то же самое снова">
            <textarea rows={3} value={rejectText} onChange={e => setRejectText(e.target.value)}
              className={inputCls} placeholder="Слишком навязчиво / не тот сегмент / рано" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setRejectId(null)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm">Отмена</button>
            <button onClick={() => { onDecide(rejectId, 'reject', rejectText); setRejectId(null) }}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold">Отклонить</button>
          </div>
        </Modal>
      )}

      {/* Подтверждение отправки */}
      {confirmProposal && (
        <Modal title="Отправить предложение" onClose={() => setConfirmId(null)}>
          <div className="text-center py-3">
            <div className="text-4xl font-bold text-white">{fmtInt(confirmProposal.recipients)}</div>
            <div className="text-sm text-slate-400 mt-1">человек получат это сообщение · сегмент «{confirmProposal.target}»</div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-[#17212b] p-3 mb-3">
            <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[14px] leading-snug text-slate-100 break-words"
              dangerouslySetInnerHTML={{ __html: telegramPreview(confirmProposal.message_text) }} />
          </div>
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            Отменить рассылку после запуска нельзя.
          </div>
          {confirmProposal.recipients >= Number(settings.confirm_typing_threshold || 1000) && (
            <div className="mt-3">
              <label className="text-xs text-slate-400">
                Введите число получателей — <b className="text-slate-200">{confirmProposal.recipients}</b>
              </label>
              <input value={typed} onChange={e => setTyped(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm font-mono" />
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirmId(null)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm">Отмена</button>
            <button onClick={() => { onDecide(confirmProposal.id, 'approve'); setConfirmId(null) }}
              disabled={!typingOk}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold">
              Отправить
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * Полный просмотр отправленной рассылки.
 *
 * В строке истории текст обрезан и лишён разметки — читать так неудобно, а
 * скопировать для повтора невозможно. Здесь показываем и то, как сообщение
 * выглядело у получателя, и исходник с тегами.
 */
function BroadcastModal({ b, onClose, onReuse }) {
  const [copied, setCopied] = useState(false)
  const [raw, setRaw] = useState(false)

  const copy = () => {
    navigator.clipboard?.writeText(b.message_text || '')
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  const stat = (label, value, tone = 'text-slate-200') => (
    <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-700/50">
      <div className={`text-base font-semibold ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )

  return (
    <Modal title={`Рассылка №${b.id}`} onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap text-xs mb-3">
        <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">{b.target_type}</span>
        <span className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDT(b.created_at)}</span>
        {b.admin_name && <span className="text-slate-600">{b.admin_name}</span>}
        {b.has_media && (
          <span className="text-violet-400 flex items-center gap-1">
            <ImageIcon className="w-3 h-3" /> {b.media_type}
          </span>
        )}
        <span className="text-slate-600">{b.status}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {stat('получателей', fmtInt(b.total_count))}
        {stat('доставлено', fmtInt(b.sent_count), 'text-emerald-300')}
        {stat('заблокировали', fmtInt(b.blocked_count), 'text-amber-300')}
        {stat('доставляемость', b.delivery_pct != null ? b.delivery_pct + ' %' : '—', 'text-cyan-300')}
      </div>

      {b.blocked_per_day != null && (
        <div className="mb-4 text-[11px] text-slate-500">
          +{b.blocked_delta} новых блокировок за {b.gap_days} дн. с прошлой рассылки этого
          сегмента — <b className="text-slate-400">{b.blocked_per_day} в сутки</b>.
          Цифра считается внутри сегмента и делится на дни: только так её можно
          сравнивать между рассылками.
        </div>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
          {raw ? 'Исходник с разметкой' : 'Как увидел получатель'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setRaw(v => !v)}
            className="px-2 py-1 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800">
            {raw ? 'предпросмотр' : 'исходник'}
          </button>
          <button onClick={copy} title="Скопировать текст"
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {raw ? (
        <pre className="max-h-[45vh] overflow-y-auto thin-scroll p-3 rounded-xl bg-slate-950/60 border border-slate-700 text-[12px] text-slate-300 whitespace-pre-wrap break-words font-mono">
          {b.message_text}
        </pre>
      ) : (
        <div className="max-h-[45vh] overflow-y-auto thin-scroll rounded-xl border border-slate-700/60 bg-[#17212b] p-4">
          <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[14px] leading-snug text-slate-100 break-words"
            dangerouslySetInnerHTML={{ __html: telegramPreview(b.message_text) }} />
        </div>
      )}

      <div className="mt-4 flex justify-between gap-2">
        <button onClick={onReuse}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-2">
          <CornerUpLeft className="w-4 h-4" /> Взять за основу
        </button>
        <button onClick={onClose}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm">Закрыть</button>
      </div>
    </Modal>
  )
}

/**
 * Правила по сегментам: кому что можно и как часто.
 *
 * Раньше это выражалось только словами в свободном поле промпта, а промпт
 * соблюдается ненадёжно. Здесь — проверки, которые выполняет код.
 */
function SegmentRulesTab({ rules, segments, neglect, onSave }) {
  const PURPOSES = [
    { id: 'any', label: 'Любые' },
    { id: 'sales', label: 'Только продающие' },
    { id: 'service', label: 'Только сервисные' },
  ]

  return (
    <div>
      <div className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-4 h-4 text-cyan-400" /> Правила по сегментам
      </div>
      <div className="text-[11px] text-slate-500 mb-3">
        Проверяются кодом до отправки — и для ИИ, и для человека. Назначение и
        пояснение вдобавок попадают в промпт, чтобы ИИ понимал смысл сегмента.
      </div>

      <div className="space-y-2">
        {segments.map(sg => {
          const r = rules[sg.id] || {}
          const idle = neglect ? neglect[sg.id] : null
          const set = patch => onSave(sg.id, { ...r, ...patch })
          return (
            <div key={sg.id} className="p-3 rounded-xl bg-slate-900/40 border border-slate-700/50">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-semibold text-white min-w-[120px]">{sg.label}</span>
                {idle != null && (
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                    idle >= 30 ? 'bg-amber-500/15 text-amber-300' : 'text-slate-500'
                  }`} title="Дней с последней рассылки в этот сегмент">
                    {idle} дн. молчим
                  </span>
                )}

                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input type="checkbox" className="accent-cyan-500" checked={r.manual_allowed !== false}
                    onChange={e => set({ manual_allowed: e.target.checked })} />
                  человеку
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input type="checkbox" className="accent-violet-500" checked={r.ai_allowed !== false}
                    onChange={e => set({ ai_allowed: e.target.checked })} />
                  ИИ
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-300"
                  title="ИИ узнает, что здесь можно пробовать непривычные формулировки">
                  <input type="checkbox" className="accent-emerald-500" checked={!!r.is_sandbox}
                    onChange={e => set({ is_sandbox: e.target.checked })} />
                  полигон
                </label>

                <select value={r.purpose || 'any'} onChange={e => set({ purpose: e.target.value })}
                  className="px-2 py-1 bg-slate-950/60 border border-slate-700 rounded-lg text-slate-200 text-xs">
                  {PURPOSES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>

                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  не чаще раза в
                  <input type="number" min="0" placeholder="—"
                    defaultValue={r.min_interval_hours ?? ''}
                    onBlur={e => set({ min_interval_hours: e.target.value })}
                    className="w-16 px-2 py-1 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-xs" />
                  ч
                </div>
              </div>

              <input
                defaultValue={r.note || ''}
                onBlur={e => set({ note: e.target.value })}
                placeholder="Пояснение для ИИ: когда этому сегменту уместно писать"
                className="w-full mt-2 px-3 py-1.5 bg-slate-950/60 border border-slate-700 rounded-lg text-slate-200 text-xs" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Что рассылки дают в деньгах.
 *
 * База — тот же день недели за три предыдущие недели, а не «вчера»: выручка
 * сильно зависит от дня, и сравнение с соседним днём давало бы шум. Рассылки,
 * у которых база меньше 500 ₽, в расчёт не идут — при базе в 60 ₽ одна
 * случайная покупка рисует «рост в тридцать раз».
 */
function RevenueBlock({ data }) {
  if (!data) return <div className="text-xs text-slate-600">Считаем отдачу…</div>
  if (!data.ok || !data.measured) return null

  const color = v => (v == null ? 'text-slate-500'
    : v >= 1.3 ? 'text-emerald-400' : v <= 0.9 ? 'text-red-400' : 'text-slate-300')

  return (
    <div>
      <div className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4 text-emerald-400" /> Отдача в деньгах
      </div>
      <div className="text-[11px] text-slate-500 mb-3">
        Выручка за сутки после отправки к обычному такому же дню недели.
        1.0 — рассылка ничего не изменила. Посчитано по {data.measured} рассылкам
        из {data.total}: у остальных слишком маленькая база для сравнения.
      </div>

      <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-700/50 mb-2 flex items-baseline gap-3">
        <span className={`text-2xl font-bold ${color(data.overall)}`}>×{data.overall}</span>
        <span className="text-xs text-slate-500">медиана по всем сегментам</span>
      </div>

      <div className="space-y-1.5">
        {data.by_segment.map(x => (
          <div key={x.target} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/30 border border-slate-800 text-xs">
            <span className="text-slate-300 font-medium min-w-[110px]">{x.target}</span>
            <span className={`font-semibold ${color(x.median)}`}>×{x.median}</span>
            <span className="text-slate-600">по {x.n} рассылкам</span>
            <span className="ml-auto text-slate-500">
              заметный рост в {x.share_positive} % случаев
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Отдача рассылок по промокодам.
 *
 * Считается только по рассылкам, отправленным ПОСЛЕ включения синхронизации
 * активаций: API бота отдаёт лишь последние 10 активаций каждого кода, и для
 * более ранних рассылок в базе лежит хвост, а не то, что было после отправки.
 */
function PromoPerfBlock({ perf }) {
  if (!perf) return null
  const { coverage, byCode } = perf
  const hasSignal = byCode.some(c => c.uses > 0)

  return (
    <div>
      <div className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4 text-emerald-400" /> Отдача промокодов
      </div>
      <div className="text-[11px] text-slate-500 mb-3">
        Активаций на 1000 доставленных за 7 дней после рассылки. Учитываются
        только рассылки с {coverage.since ? new Date(coverage.since).toLocaleDateString('ru-RU') : '—'} —
        раньше активации не накапливались.
      </div>

      {!hasSignal ? (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm">
          Данных нет: подходящих рассылок {coverage.reliable} из {coverage.with_codes} с промокодами,
          и ни по одной нет активаций. Скорее всего выключена синхронизация активаций
          (Bedolaga Bot → Промокоды бота). Пока она не включена, ИИ этот показатель не видит —
          нули научили бы его, что промокоды не работают.
        </div>
      ) : (
        <div className="space-y-1.5">
          {byCode.map(c => (
            <div key={c.code} className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-700/50 flex items-center gap-3 text-sm">
              <span className="font-mono text-slate-200 min-w-[110px]">{c.code}</span>
              <span className="text-emerald-300 font-semibold">{c.avg_per_thousand}</span>
              <span className="text-xs text-slate-500">на 1000 доставленных</span>
              <span className="text-xs text-slate-600 ml-auto">
                рассылок {c.broadcasts}, активаций {c.uses}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
