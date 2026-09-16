/**
 * PROMETHEUS: подключение к нейросети.
 *
 * Своё, отдельное от ассистента тикетов. Пустое поле означает «как у
 * ассистента», так что задавать нужно только отличающееся — обычно это модель.
 *
 * Зачем врозь. Ассистент отвечает живым клиентам, и переводить его на
 * непроверенного провайдера ради одного разбора не стоит. Да и требования
 * разные: ассистенту нужна дешёвая модель на короткий ответ, PROMETHEUS живёт
 * вызовом инструментов — модель, которая их не умеет, бесполезна здесь целиком,
 * хотя тикеты ею отвечать можно.
 *
 * Память смену подключения переживает: она лежит отдельным текстом в нашей
 * базе и к провайдеру не привязана никак.
 */
const db = require('../../db')
const ai = require('../aiAssistant')
const { encrypt, decrypt } = require('../encryption')
const log = require('../logger').for('Prometheus')

/**
 * Привести адрес к тому виду, который ждёт SDK.
 *
 * SDK сам дописывает `/v1/messages`, поэтому базовый адрес не должен
 * заканчиваться на `/v1` — иначе выйдет `/v1/v1/messages` и провайдер ответит
 * «не найдено». Ошибка соблазнительная: в гайдах провайдеров адрес для
 * OpenAI-совместимого обращения как раз пишут с `/v1` на конце.
 */
function normalizeBase(url) {
  return String(url || '').trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/messages$/i, '')
    .replace(/\/v1$/i, '')
}

/** Действующее подключение: своё поверх ассистентского. */
async function get() {
  const own = (await db.query('SELECT * FROM prometheus_settings WHERE id = 1')).rows[0] || {}
  const base = await ai.getSettings(db)

  const apiKey = own.api_key ? decrypt(own.api_key) : base.apiKey
  return {
    apiKey,
    base_url: normalizeBase(own.base_url || base.base_url),
    model: own.model || base.model,
    max_tokens: own.max_tokens || base.max_tokens,
    // Потолок расхода на один разбор — не наследуется: у ассистента тикетов
    // такого понятия нет, у него один короткий запрос на тикет.
    token_budget: own.token_budget || 150000,
    send_thinking: own.send_thinking !== false,
    // Откуда что взято — это видно в админке, чтобы не гадать, почему разбор
    // идёт не той моделью, что ожидали.
    own: {
      has_key: !!own.api_key,
      base_url: own.base_url || '',
      model: own.model || '',
      max_tokens: own.max_tokens || null,
      token_budget: own.token_budget || 150000,
    },
    inherited: {
      key: !own.api_key,
      base_url: !own.base_url,
      model: !own.model,
    },
    checked_at: own.checked_at || null,
    check_result: own.check_result || null,
  }
}

/**
 * Сохранить.
 *
 * Ключ: пустая строка — «не менять» (иначе секрет затирался бы при каждом
 * сохранении формы), явный null — «забыть свой, брать у ассистента».
 * Остальные поля: пусто — наследовать.
 */
async function save(b = {}) {
  const keyMode = b.api_key === null ? 'clear' : (b.api_key ? 'set' : 'keep')
  const clampTokens = v => {
    const n = Number(v)
    return isFinite(n) && n > 0 ? Math.min(Math.max(n, 1000), 64000) : null
  }
  await db.query(
    `UPDATE prometheus_settings SET
       api_key    = CASE $1 WHEN 'clear' THEN NULL WHEN 'set' THEN $2 ELSE api_key END,
       base_url   = $3,
       model      = $4,
       max_tokens = $5,
       token_budget = COALESCE($6, token_budget),
       updated_at = NOW()
     WHERE id = 1`,
    [
      keyMode,
      keyMode === 'set' ? encrypt(b.api_key) : null,
      normalizeBase(b.base_url) || null,
      String(b.model || '').trim() || null,
      b.max_tokens == null ? null : clampTokens(b.max_tokens),
      b.token_budget == null || b.token_budget === '' ? null
        : Math.min(Math.max(Number(b.token_budget) || 150000, 20000), 2000000),
    ]
  )
  return get()
}

// ─── Проверка связи ──────────────────────────────────────────────────────────

/**
 * Инструмент-пустышка для проверки.
 *
 * Имя только латиницей: провайдеры отбивают остальное. Проверяем именно вызов
 * инструмента, а не «ответила ли модель хоть что-то»: разбор состоит из
 * вызовов, и шлюз, который их молча проглатывает, здесь бесполезен — а на
 * обычном вопросе выглядит полностью исправным.
 */
const PROBE_TOOL = {
  name: 'probe_sum',
  description: 'Сложить два числа. Используй этот инструмент, не считай в уме.',
  input_schema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
}

/** Список моделей у провайдера — чтобы не угадывать название руками. */
async function models() {
  const c = await get()
  if (!c.apiKey) return { ok: false, error: 'Не задан ключ ИИ' }
  try {
    const r = await fetch(`${c.base_url}/v1/models`, {
      headers: {
        // Оба заголовка сразу: одни шлюзы ждут Bearer, другие — x-api-key,
        // и лишний никому не мешает.
        'authorization': `Bearer ${c.apiKey}`,
        'x-api-key': c.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(20000),
    })
    const text = await r.text()
    if (!r.ok) return { ok: false, error: `Провайдер ответил ${r.status}`, detail: text.slice(0, 300) }
    const d = JSON.parse(text)
    const list = (d.data || d.models || [])
      .map(m => (typeof m === 'string' ? m : m.id || m.name))
      .filter(Boolean)
    return { ok: true, models: list }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Проверить связь по-настоящему: дойти до модели и заставить её вызвать
 * инструмент. Заодно выясняем, понимает ли шлюз управление размышлением —
 * часть их отбивает такой запрос, и тогда мы просто перестаём его слать.
 */
async function check() {
  const c = await get()
  if (!c.apiKey) return { ok: false, error: 'Не задан ключ ИИ — ни свой, ни у ассистента' }
  if (!c.model) return { ok: false, error: 'Не задана модель' }

  const client = ai.makeClient(c)
  const body = {
    model: c.model,
    max_tokens: 1024,
    tools: [PROBE_TOOL],
    messages: [{ role: 'user', content: 'Сколько будет 17 плюс 25? Посчитай инструментом probe_sum.' }],
  }

  const started = Date.now()
  let res, thinkingOk = c.send_thinking
  try {
    res = await client.messages.create(
      thinkingOk ? { ...body, thinking: { type: 'adaptive' } } : body)
  } catch (e) {
    // Не понял управление размышлением — не повод считать провайдера негодным.
    if (thinkingOk && /thinking/i.test(String(e.message)) && (e.status === 400 || e.status === 422)) {
      thinkingOk = false
      try { res = await client.messages.create(body) } catch (e2) { return fail(e2, c) }
    } else {
      return fail(e, c)
    }
  }

  const used = (res.content || []).some(b => b.type === 'tool_use')
  const result = {
    ok: used,
    model: res.model || c.model,
    tools_ok: used,
    thinking_ok: thinkingOk,
    ms: Date.now() - started,
    tokens: (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0),
    error: used ? null
      : 'Модель ответила, но инструмент не вызвала. Разбор так работать не будет: он целиком состоит из обращений к данным. Попробуйте другую модель.',
  }

  await db.query(
    `UPDATE prometheus_settings
        SET checked_at = NOW(), check_result = $1, send_thinking = $2, updated_at = NOW()
      WHERE id = 1`,
    [JSON.stringify(result), thinkingOk])
  log.info(`Проверка связи: ${result.ok ? 'модель вызывает инструменты' : 'инструменты не работают'} (${result.model}, ${result.ms} мс)`)
  return result
}

/** Отказ провайдера — с подсказкой, куда смотреть. */
function fail(e, c) {
  const status = e?.status || 0
  const hint =
    status === 401 || status === 403 ? 'Ключ не принят. Проверьте, что он скопирован целиком.'
    : status === 404 ? `Провайдер не знает ни адреса, ни модели «${c.model}». Проверьте название модели и адрес (в нём не должно быть /v1 на конце — его дописывает клиент).`
    : status === 402 ? 'На счету у провайдера закончились средства.'
    : status === 429 ? 'Провайдер ограничил частоту запросов — попробуйте через минуту.'
    : status >= 500 ? `Провайдер ответил ошибкой ${status} — это на его стороне.`
    : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(String(e.message)) ? 'Адрес недоступен — проверьте его написание.'
    : String(e.message).slice(0, 300)
  return { ok: false, error: hint, status, raw: String(e.message).slice(0, 500) }
}

module.exports = { get, save, check, models, normalizeBase }
