import React, { useEffect, useState, useRef } from 'react'
import {
  Flame, Send, ShieldCheck, ShieldAlert, Database, FileCode, Wrench,
  Trash2, History, Loader2, ChevronDown, ChevronRight, AlertCircle,
  Brain, ClipboardList, Check, X, MessageSquare, Plug, RefreshCw,
} from 'lucide-react'
import { authFetch } from '../services/api'

const API = '/api/admin/prometheus'

/**
 * PROMETHEUS — аналитический центр проекта.
 *
 * Раздел устроен как разговор: вопрос → модель сама ходит за данными → ответ.
 * Ход разбора показывается целиком, а не прячется: вывод без видимых
 * оснований проверить невозможно, и доверять ему не стоит.
 *
 * Отдельно и заметно показано состояние защиты «только чтение». Это главное
 * обещание раздела, и если оно перестало выполняться, человек должен увидеть
 * это раньше, чем задаст вопрос.
 */

const TOOL_LABEL = {
  db_schema: 'структура базы',
  db_query: 'запрос к базе',
  list_files: 'список файлов',
  read_file: 'чтение файла',
  project_facts: 'сводка по проекту',
  remnawave_read: 'панель RemnaWave',
  bedolaga_read: 'бот Bedolaga',
}

const SUGGESTIONS = [
  'Что сейчас в проекте самое слабое место? Посмотри данные, не гадай.',
  'Где мы теряем деньги? Проверь платежи, подписки и выдачу доступа.',
  'Разбери воронку: сколько доходит от регистрации до оплаты и где отваливаются.',
  'Посмотри на тарифы и цены. Что стоит поменять и почему?',
  'Найди в бизнес-логике места, где код расходится с замыслом.',
]

const fmtDT = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) }
const fmtNum = n => (n == null ? '—' : Number(n).toLocaleString('ru-RU'))

/**
 * Разобрать ответ, не веря, что это JSON.
 *
 * Между браузером и бэкендом стоит nginx, и на его ошибках (502, 504) приходит
 * HTML-страница. `r.json()` спотыкался об неё и выдавал «Unexpected token '<'»
 * вместо объяснения, что произошло.
 */
async function asJson(r) {
  const text = await r.text()
  try {
    const d = JSON.parse(text)
    if (!r.ok) throw new Error(d.error || `Ошибка ${r.status}`)
    return d
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(r.status === 504 || r.status === 502
        ? 'Сервер не ответил вовремя. Обновите страницу — разбор мог продолжиться и записаться в историю.'
        : `Неожиданный ответ сервера (${r.status})`)
    }
    throw e
  }
}

export default function AdminPrometheus() {
  const [status, setStatus] = useState(null)
  const [sessions, setSessions] = useState([])
  const [session, setSession] = useState(null)      // { session, messages }
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showTools, setShowTools] = useState(false)
  const [tab, setTab] = useState('chat')        // chat | memory | findings | conn
  const [memory, setMemory] = useState(null)
  const [findings, setFindings] = useState([])
  const bottomRef = useRef(null)
  const pollRef = useRef(null)      // таймер опроса идущего разбора
  const aliveRef = useRef(true)     // страница ещё открыта

  useEffect(() => {
    authFetch(`${API}/status`).then(r => r.json()).then(setStatus).catch(() => {})
    // Незаконченный разбор подхватываем сам: он идёт на сервере и не зависит от
    // того, открыта ли страница. Уйти и вернуться за ответом — нормально.
    loadSessions().then(items => {
      const live = (items || []).find(s => s.run_status === 'running')
      if (live) openSession(live.id)
    })
    return () => { aliveRef.current = false; clearTimeout(pollRef.current) }
  }, [])

  // Следим за концом разбора, но только когда реплик стало больше. Иначе
  // каждый опрос дёргал бы страницу вниз, пока человек читает написанное выше.
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) },
    [session?.session?.id, session?.messages?.length])

  useEffect(() => {
    if (tab === 'memory') authFetch(`${API}/memory`).then(r => r.json()).then(setMemory).catch(() => {})
    if (tab === 'findings') authFetch(`${API}/findings`).then(r => r.json()).then(d => setFindings(d.items || [])).catch(() => {})
  }, [tab])

  async function decide(id, status) {
    // Причина отказа важнее самого отказа: она уходит ему в память и объясняет,
    // почему здесь так. Без неё он поднимет ту же проблему в следующий раз.
    let verdict = ''
    if (status === 'dismissed') {
      verdict = prompt('Почему отклоняем? Он это запомнит и не будет поднимать снова.') || ''
      if (!verdict.trim()) return
    }
    await authFetch(`${API}/findings/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, verdict }),
    }).catch(() => {})
    const r = await authFetch(`${API}/findings`)
    setFindings((await r.json()).items || [])
  }

  async function forget(id) {
    if (!confirm('Забыть эту запись? Он перестанет на неё опираться.')) return
    await authFetch(`${API}/memory/${id}`, { method: 'DELETE' }).catch(() => {})
    const r = await authFetch(`${API}/memory`)
    setMemory(await r.json())
  }

  async function loadSessions() {
    try {
      const r = await authFetch(`${API}/sessions?limit=40`)
      const d = await r.json()
      setSessions(d.items || [])
      return d.items || []
    } catch { return [] /* список не критичен */ }
  }

  /**
   * Показать разбор, а пока он идёт — переспрашивать.
   *
   * Обращения к данным пишутся на сервере по ходу дела, поэтому опрос даёт не
   * только «готово / не готово», но и живую картину: куда он сходил, что нашёл.
   */
  async function openSession(id) {
    clearTimeout(pollRef.current)
    setError(null)
    try {
      const d = await asJson(await authFetch(`${API}/sessions/${id}`))
      if (!aliveRef.current) return
      setSession(d)
      setBusy(!!d.running)
      if (d.running) {
        pollRef.current = setTimeout(() => { if (aliveRef.current) openSession(id) }, 2500)
      } else {
        if (d.session?.run_status === 'error') setError(d.session.run_error || 'Разбор не удался')
        loadSessions()
      }
    } catch (e) {
      setBusy(false)
      setError(e.message)
    }
  }

  async function ask(text) {
    const q = (text ?? question).trim()
    if (!q || busy) return
    setBusy(true); setError(null)

    // Показываем вопрос сразу — разбор идёт долго, и пустой экран
    // выглядел бы как «ничего не происходит».
    setSession(s => ({
      session: s?.session || { id: null, title: q },
      messages: [...(s?.messages || []), { id: 'tmp', role: 'user', content: q }],
    }))
    setQuestion('')

    try {
      // Ответ приходит сразу и содержит только номер разбора: сам разбор идёт
      // на сервере минутами, и ждать его в одном запросе нельзя.
      const d = await asJson(await authFetch(`${API}/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, session_id: session?.session?.id || null }),
      }))
      await loadSessions()
      await openSession(d.session_id)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  async function removeSession(id) {
    if (!confirm('Удалить разбор из истории?')) return
    try {
      await asJson(await authFetch(`${API}/sessions/${id}`, { method: 'DELETE' }))
    } catch (e) { setError(e.message); return }   // идущий разбор удалять нельзя
    if (session?.session?.id === id) { clearTimeout(pollRef.current); setSession(null); setBusy(false) }
    loadSessions()
  }

  const guardOk = status?.readonly_ok
  const ready = guardOk && status?.has_key

  return (
    <div className="space-y-4">
      {/* ── Шапка ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/40 shrink-0">
            <Flame className="w-6 h-6 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white tracking-wide">PROMETHEUS</h1>
            <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
              Аналитический центр проекта. Видит базу, исходники и подключённые сервисы,
              разбирается в бизнес-логике и предлагает, что поправить. Ничего не меняет.
            </p>
          </div>
        </div>

        {status && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              tone={guardOk ? 'ok' : 'err'}
              Icon={guardOk ? ShieldCheck : ShieldAlert}
              text={guardOk ? 'только чтение' : 'защита не прошла проверку'}
            />
            {!status.has_key && <Badge tone="warn" Icon={AlertCircle} text="нет ключа ИИ" />}
            {status.model && <span className="text-[11px] text-slate-500 font-mono">{status.model}</span>}
          </div>
        )}
      </div>

      {/* ── Защита сломана — дальше нельзя ── */}
      {status && !guardOk && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/50 text-sm text-red-300">
          <div className="font-bold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Защита «только чтение» не прошла проверку
          </div>
          <div className="mt-1 text-red-200/90">
            Не сработали рубежи: {(status.readonly_failed || []).join(', ')}.
            Разборы отключены, пока это не исправлено — раздел не должен работать
            без гарантии, что он ничего не изменит.
          </div>
        </div>
      )}

      {!status?.has_key && status && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-sm text-amber-200">
          Не задан ключ ИИ — задайте его в разделе «ИИ-ассистент → Подключение», иначе разбор не запустится.
        </div>
      )}

      {/* ── Что он умеет ── */}
      {status?.tools && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40">
          <button onClick={() => setShowTools(v => !v)}
            className="w-full flex items-center gap-2 p-3 text-sm text-slate-300 hover:text-white">
            {showTools ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Wrench className="w-4 h-4 text-slate-400" />
            Чем он может пользоваться — {status.tools.length} инструментов, все на чтение
          </button>
          {showTools && (
            <div className="px-4 pb-4 space-y-2">
              {status.tools.map(t => (
                <div key={t.name} className="text-xs">
                  <span className="font-mono text-cyan-300">{t.name}</span>
                  <span className="text-slate-500"> — {TOOL_LABEL[t.name] || ''}</span>
                  <div className="text-slate-500 mt-0.5">{t.description}</div>
                </div>
              ))}
              <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-800">
                Инструментов записи нет ни одного. Запросы к базе идут в транзакции
                READ ONLY, секретов и персональных данных модель не видит:
                колонок с секретами скрыто {status.masked_columns?.secrets}, персональных — {status.masked_columns?.pii}.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Вкладки */}
      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto thin-scroll">
        {[
          { id: 'chat', label: 'Разбор', Icon: MessageSquare },
          { id: 'memory', label: 'Память' + (status?.memory?.total_memory ? ` · ${status.memory.total_memory}` : ''), Icon: Brain },
          { id: 'findings', label: 'Находки', Icon: ClipboardList },
          { id: 'conn', label: 'Подключение', Icon: Plug },
        ].map(x => (
          <button key={x.id} onClick={() => setTab(x.id)}
            className={`px-3 sm:px-4 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px transition shrink-0 whitespace-nowrap ${
              tab === x.id ? 'border-amber-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}>
            <x.Icon className="w-4 h-4 shrink-0" /> {x.label}
          </button>
        ))}
      </div>

      {/* Подключение */}
      {tab === 'conn' && <Connection onSaved={() => authFetch(`${API}/status`).then(r => r.json()).then(setStatus).catch(() => {})} />}

      {/* Память */}
      {tab === 'memory' && (
        <div className="space-y-3">
          <div className="p-3 rounded-xl border border-slate-700/60 bg-slate-900/40 text-xs text-slate-400">
            Что он вынес из прошлых разборов. Это подкладывается в начало каждого нового,
            поэтому ошибочная запись будет всплывать снова и снова — такую лучше забыть.
            <div className="mt-1 text-slate-500">
              Память лежит в нашей базе обычным текстом, без привязки к поставщику модели:
              смените нейросеть — накопленное останется, новая продолжит с того же места.
            </div>
          </div>
          {!memory ? <div className="text-sm text-slate-500">Загружаем…</div>
            : !memory.items.length ? (
              <div className="text-sm text-slate-500">
                Пока пусто. Память набирается по ходу разборов, а не закладывается заранее.
              </div>
            ) : memory.items.map(m => (
              <div key={m.id} className="p-3 rounded-xl border border-slate-700/60 bg-slate-900/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className={`px-1.5 py-0.5 rounded border ${KIND_TONE[m.kind] || 'text-slate-400 border-slate-600'}`}>
                      {KIND_LABEL[m.kind] || m.kind}
                    </span>
                    <span className="text-slate-300 font-medium">{m.topic}</span>
                    <span className="text-slate-600">уверенность {m.confidence}</span>
                    {m.used_count > 0 && <span className="text-emerald-400/70">пригодилось {m.used_count}</span>}
                  </div>
                  <button onClick={() => forget(m.id)} title="Забыть"
                    className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-[13px] text-slate-200 mt-1.5">{m.content}</div>
                {m.evidence && <div className="text-[11px] text-slate-500 mt-1">подтверждено: {m.evidence}</div>}
              </div>
            ))}
        </div>
      )}

      {/* Находки */}
      {tab === 'findings' && (
        <div className="space-y-3">
          <div className="p-3 rounded-xl border border-slate-700/60 bg-slate-900/40 text-xs text-slate-400">
            Проблемы, которые он нашёл. Ваше решение — это обратная связь: отклонённую он
            больше не поднимет, а причину отказа запомнит и учтёт в следующих разборах.
          </div>
          {!findings.length && <div className="text-sm text-slate-500">Пока ничего не найдено.</div>}
          {findings.map(f => (
            <div key={f.id} className={`p-3 rounded-xl border ${
              f.status === 'open' ? 'border-slate-700/60 bg-slate-900/40' : 'border-slate-800 bg-slate-950/40 opacity-75'
            }`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1">
                    <span className={`px-1.5 py-0.5 rounded border ${SEV_TONE[f.severity]}`}>{SEV_LABEL[f.severity]}</span>
                    {f.area && <span className="text-slate-500">{f.area}</span>}
                    <span className={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</span>
                  </div>
                  <div className="text-[13px] text-slate-200 font-medium">{f.title}</div>
                  {f.detail && <div className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{f.detail}</div>}
                  {f.evidence && <div className="text-[11px] text-slate-500 mt-1">подтверждено: {f.evidence}</div>}
                  {f.verdict && <div className="text-[11px] text-amber-300/80 mt-1">решение: {f.verdict}</div>}
                </div>
                {f.status === 'open' && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => decide(f.id, 'accepted')} title="Согласен, чиним"
                      className="px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-[11px] hover:bg-emerald-600/30">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => decide(f.id, 'dismissed')} title="Отклонить"
                      className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-[11px] hover:text-red-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {f.status === 'accepted' && (
                  <button onClick={() => decide(f.id, 'fixed')}
                    className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-[11px] shrink-0">
                    починено
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'chat' && (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        {/* ── Разбор ── */}
        <div className="min-w-0 space-y-3">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-sm text-red-300">{error}</div>
          )}

          {!session && (
            <div className="p-5 rounded-xl border border-slate-700/60 bg-slate-900/40">
              <div className="text-sm text-slate-300 mb-3">С чего начать:</div>
              <div className="space-y-2">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)} disabled={!ready || busy}
                    className="block w-full text-left px-3 py-2 rounded-lg bg-slate-950/50 border border-slate-800 hover:border-amber-500/50 text-sm text-slate-300 hover:text-white disabled:opacity-40 transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {session && (
            <div className="space-y-3">
              {(session.messages || []).map((m, i) => <Message key={m.id || i} m={m} />)}
              {busy && (
                <div className="flex items-start gap-2 text-sm text-amber-300/80 p-3">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
                  <div>
                    Разбирается: ходит за данными, это занимает минуты.
                    <div className="text-xs text-slate-500 mt-0.5">
                      Разбор идёт на сервере — страницу можно закрыть и вернуться за ответом позже.
                      {(session?.messages || []).some(m => m.role === 'tool') &&
                        ` Обращений к данным: ${(session.messages || []).filter(m => m.role === 'tool').length}.`}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* ── Ввод ── */}
          <div className="flex gap-2 items-end">
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask() }}
              rows={2}
              disabled={!ready || busy}
              placeholder={ready ? 'Спросите что угодно о проекте. Ctrl+Enter — отправить' : 'Недоступно'}
              className="flex-1 min-w-0 px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-xl text-white text-sm resize-y focus:border-amber-500 focus:outline-none disabled:opacity-40"
            />
            <button onClick={() => ask()} disabled={!ready || busy || !question.trim()}
              className="px-4 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white shrink-0">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* ── История ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> Разборы
            </div>
            {session && (
              <button onClick={() => setSession(null)}
                className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">
                новый
              </button>
            )}
          </div>
          {!sessions.length && <div className="text-xs text-slate-600">Пока пусто.</div>}
          {sessions.map(s => (
            <div key={s.id}
              className={`group p-2.5 rounded-lg border cursor-pointer transition ${
                session?.session?.id === s.id
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
              onClick={() => openSession(s.id)}>
              <div className="text-xs text-slate-300 line-clamp-2">{s.title || `Разбор #${s.id}`}</div>
              <div className="flex items-center justify-between mt-1">
                <div className="text-[10px] text-slate-600">
                  {s.run_status === 'running'
                    ? <span className="text-amber-400/90 flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> идёт разбор
                      </span>
                    : s.run_status === 'error'
                      ? <span className="text-red-400/80">не удался</span>
                      : `${fmtDT(s.updated_at)} · ${s.реплик} реплик · ${fmtNum(s.tool_calls)} обращений`}
                </div>
                <button onClick={e => { e.stopPropagation(); removeSession(s.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}

const KIND_LABEL = { fact: 'факт', context: 'как устроено', decision: 'решение владельца', lesson: 'вывод из ошибки' }
const KIND_TONE = {
  fact: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
  context: 'text-slate-400 border-slate-600',
  decision: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  lesson: 'text-violet-400 border-violet-500/40 bg-violet-500/10',
}
const SEV_LABEL = { high: 'важно', medium: 'средне', low: 'мелочь' }
const SEV_TONE = {
  high: 'text-red-300 border-red-500/40 bg-red-500/10',
  medium: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  low: 'text-slate-400 border-slate-600',
}
const STATUS_LABEL = { open: 'открыта', accepted: 'принята в работу', dismissed: 'отклонена', fixed: 'починено' }
const STATUS_TONE = {
  open: 'text-slate-300', accepted: 'text-emerald-400',
  dismissed: 'text-slate-500', fixed: 'text-emerald-500',
}

/**
 * Своё подключение к нейросети.
 *
 * Отдельное от ассистента тикетов намеренно: тот отвечает живым клиентам, и
 * переводить его на непроверенного провайдера ради разборов не стоит. Пустое
 * поле означает «как у ассистента».
 */
function Connection({ onSaved }) {
  const [own, setOwn] = useState(null)
  const [eff, setEff] = useState(null)
  const [form, setForm] = useState({ base_url: '', model: '', api_key: '', max_tokens: '' })
  const [models, setModels] = useState(null)
  const [test, setTest] = useState(null)
  const [state, setState] = useState('')        // saving | testing | models
  const [err, setErr] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const d = await asJson(await authFetch(`${API}/connection`))
      setOwn(d.own); setEff(d.effective); setTest(d.check_result)
      setForm({ base_url: d.own.base_url, model: d.own.model, api_key: '', max_tokens: d.own.max_tokens || '' })
    } catch (e) { setErr(e.message) }
  }

  async function save() {
    setState('saving'); setErr(null)
    try {
      const body = { base_url: form.base_url, model: form.model, max_tokens: form.max_tokens || null }
      if (form.api_key.trim()) body.api_key = form.api_key.trim()   // пусто = не менять
      await asJson(await authFetch(`${API}/connection`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }))
      await load(); onSaved?.()
    } catch (e) { setErr(e.message) } finally { setState('') }
  }

  async function runTest() {
    setState('testing'); setErr(null); setTest(null)
    try {
      setTest(await asJson(await authFetch(`${API}/connection/test`, { method: 'POST' })))
      onSaved?.()
    } catch (e) { setErr(e.message) } finally { setState('') }
  }

  async function loadModels() {
    setState('models'); setErr(null)
    try {
      const d = await asJson(await authFetch(`${API}/connection/models`))
      if (!d.ok) setErr(d.error + (d.detail ? ` · ${d.detail}` : ''))
      setModels(d.models || [])
    } catch (e) { setErr(e.message) } finally { setState('') }
  }

  if (!own) return <div className="text-sm text-slate-500">Загружаем…</div>

  const field = 'w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none'

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="p-3 rounded-xl border border-slate-700/60 bg-slate-900/40 text-xs text-slate-400">
        Подключение у раздела своё. Пустое поле — «как у ассистента тикетов», так что
        задавать нужно только то, что отличается.
        <div className="mt-1 text-slate-500">
          Врозь — намеренно: ассистент отвечает живым клиентам, и переводить его на непроверенного
          провайдера ради разборов не стоит. Память смену подключения переживает целиком —
          она лежит в нашей базе и к провайдеру не привязана.
        </div>
      </div>

      {err && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-sm text-red-300">{err}</div>}

      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400">Адрес провайдера</label>
          <input className={field} value={form.base_url} placeholder={eff?.base_url || 'https://…'}
            onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} />
          <div className="text-[11px] text-slate-600 mt-1">
            Без <span className="font-mono">/v1</span> на конце — его дописывает клиент.
            Лишний даст «не найдено». {own.base_url ? '' : `Сейчас наследуется: ${eff?.base_url}`}
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400">Ключ</label>
          <input className={field} type="password" value={form.api_key} autoComplete="new-password"
            placeholder={own.has_key ? 'ключ задан — оставьте пустым, чтобы не менять' : 'пусто — берётся ключ ассистента'}
            onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} />
        </div>

        <div>
          <label className="text-xs text-slate-400">Модель</label>
          <div className="flex gap-2">
            <input className={field} value={form.model} list="prometheus-models"
              placeholder={eff?.model || 'название модели'}
              onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            <button onClick={loadModels} disabled={!!state}
              className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs shrink-0 hover:text-white disabled:opacity-40 flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${state === 'models' ? 'animate-spin' : ''}`} /> список
            </button>
          </div>
          <datalist id="prometheus-models">
            {(models || []).map(m => <option key={m} value={m} />)}
          </datalist>
          {models && (
            <div className="text-[11px] text-slate-500 mt-1">
              {models.length ? `У провайдера доступно моделей: ${models.length}. Начните печатать — список подскажет.`
                : 'Провайдер не отдал список моделей — впишите название вручную.'}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-slate-400">Предел токенов на ответ</label>
          <input className={field} type="number" value={form.max_tokens}
            placeholder={String(eff?.max_tokens || 16000)}
            onChange={e => setForm(f => ({ ...f, max_tokens: e.target.value }))} />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={save} disabled={!!state}
          className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm">
          {state === 'saving' ? 'Сохраняю…' : 'Сохранить'}
        </button>
        <button onClick={runTest} disabled={!!state}
          className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm hover:text-white disabled:opacity-40 flex items-center gap-2">
          {state === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          Проверить связь
        </button>
      </div>

      {/* Проверяем не «отвечает ли», а «вызывает ли инструменты»: разбор состоит
          из обращений к данным, и без них провайдер бесполезен — хотя на обычном
          вопросе выглядит полностью исправным. */}
      {test && (
        <div className={`p-3 rounded-xl border text-sm ${
          test.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
          <div className="font-medium flex items-center gap-2">
            {test.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            {test.ok ? 'Связь есть, модель вызывает инструменты — разбор заработает' : 'Разбор не заработает'}
          </div>
          {test.error && <div className="mt-1 text-[13px]">{test.error}</div>}
          {test.ok && (
            <div className="mt-1 text-[11px] text-emerald-300/70">
              {test.model} · ответ за {(test.ms / 1000).toFixed(1)} с · {test.tokens} токенов
              {test.thinking_ok === false && ' · управление размышлением провайдер не понимает, обходимся без него'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Badge({ tone, Icon, text }) {
  const tones = {
    ok: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    warn: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
    err: 'text-red-300 border-red-500/40 bg-red-500/10',
  }
  return (
    <span className={`px-2 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 ${tones[tone]}`}>
      <Icon className="w-3.5 h-3.5" /> {text}
    </span>
  )
}

/** Одна реплика: вопрос, ответ или обращение к инструменту. */
function Message({ m }) {
  const [open, setOpen] = useState(false)

  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-slate-800 border border-slate-700 text-[13px] text-slate-100 whitespace-pre-wrap break-words">
          {m.content}
        </div>
      </div>
    )
  }

  if (m.role === 'tool') {
    const ok = m.tool_result?.ok !== false
    return (
      <div className="text-[11px]">
        <button onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {m.tool_name === 'db_query' || m.tool_name === 'db_schema'
            ? <Database className="w-3 h-3" /> : <FileCode className="w-3 h-3" />}
          <span className="font-mono">{m.tool_name}</span>
          <span>{TOOL_LABEL[m.tool_name] || ''}</span>
          {!ok && <span className="text-red-400">ошибка</span>}
        </button>
        {open && (
          <div className="mt-1 ml-5 space-y-1">
            <pre className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-400 overflow-x-auto thin-scroll whitespace-pre-wrap break-words">
              {JSON.stringify(m.tool_input, null, 1)}
            </pre>
            <pre className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-500 overflow-x-auto thin-scroll max-h-64 whitespace-pre-wrap break-words">
              {JSON.stringify(m.tool_result, null, 1)?.slice(0, 4000)}
            </pre>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-3.5 py-3 rounded-2xl rounded-tl-md bg-slate-900/60 border border-slate-700/60 text-[13px] text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
      {m.content}
    </div>
  )
}
