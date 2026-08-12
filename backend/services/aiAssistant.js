/**
 * ИИ-ассистент поддержки: отвечает на тикеты Bedolaga.
 *
 * Провайдер Anthropic-совместимый (по умолчанию Customix), поэтому используем
 * официальный SDK с подменой baseURL — не самописный fetch и не OpenAI-шим.
 *
 * Главное правило: при любой неопределённости ассистент МОЛЧИТ и отдаёт тикет
 * человеку. Ошибочный ответ клиенту отозвать нельзя, промолчать — можно всегда.
 */
const Anthropic = require('@anthropic-ai/sdk')
const { decrypt } = require('./encryption')

// ─── Настройки ────────────────────────────────────────────────────────────────

async function getSettings(pool) {
  const { rows } = await pool.query('SELECT * FROM ai_assistant_settings WHERE id = 1')
  const s = rows[0] || {}
  return {
    ...s,
    apiKey: s.api_key ? decrypt(s.api_key) : '',
    stopWords: Array.isArray(s.stop_words) ? s.stop_words : [],
  }
}

// ─── Слой 1 защиты: стоп-слова ────────────────────────────────────────────────

/* Латиница, визуально неотличимая от кириллицы. Подмена буквы — самый дешёвый
   способ обойти фильтр, а чаще это просто раскладка или опечатка. */
const HOMOGLYPHS = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м',
  h: 'н', t: 'т', b: 'в', i: 'и', î: 'и', ï: 'и', í: 'и', ì: 'и',
  é: 'е', è: 'е', ë: 'е', ó: 'о', ò: 'о', ö: 'о', á: 'а', à: 'а', ä: 'а',
}

/**
 * Нормализация под поиск. Регистр, ё→е, схлопывание пробелов, снятие пунктуации
 * и сведение похожих букв к кириллице — иначе «вернîте ДЕНЬГИ» проходит мимо.
 */
function normalize(text) {
  let s = String(text || '').toLowerCase().replace(/ё/g, 'е')
  s = s.replace(/[a-zàáäèéëìíîïòóö]/g, ch => HOMOGLYPHS[ch] || ch)
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // пунктуация не должна разрывать фразу
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Встроенные правила на тему «верните деньги». Ищем не фразу целиком, а корни
 * рядом друг с другом: между «верните» и «деньги» легко влезает слово
 * («верните МНЕ деньги»), и подстрочный поиск на этом ломается.
 *
 * Список несокращаемый и правится только в коде — это последний рубеж перед
 * тем, как ИИ ответит на вопрос о деньгах. Настраиваемые стоп-слова из БД
 * работают в дополнение к нему, а не вместо.
 */
const REFUND_RULES = [
  { stems: ['верн', 'деньг'],       window: 5 },
  { stems: ['верн', 'средств'],     window: 5 },
  { stems: ['возврат'],             window: 0 },
  { stems: ['возврат', 'средств'],  window: 5 },
  { stems: ['отмен', 'платеж'],     window: 5 },
  { stems: ['отмен', 'оплат'],      window: 5 },
  { stems: ['списал', 'дважды'],    window: 6 },
  { stems: ['списал', 'два раза'],  window: 6 },
  { stems: ['двойн', 'списан'],     window: 5 },
  { stems: ['refund'],              window: 0 },
  { stems: ['chargeback'],          window: 0 },
  { stems: ['чарджбэк'],            window: 0 },
  { stems: ['деньг', 'обратно'],    window: 5 },
  { stems: ['средств', 'обратно'],  window: 5 },
]

/** Все корни правила встречаются, и разброс их позиций укладывается в окно. */
function matchesRule(words, rule) {
  const positions = rule.stems.map(stem => {
    const norm = normalize(stem)
    // корень может состоять из нескольких слов («два раза») — ищем по строке
    if (norm.includes(' ')) {
      const idx = words.join(' ').indexOf(norm)
      return idx === -1 ? -1 : words.join(' ').slice(0, idx).split(' ').length - 1
    }
    return words.findIndex(w => w.startsWith(norm))
  })
  if (positions.some(p => p === -1)) return false
  if (rule.stems.length === 1) return true
  return Math.max(...positions) - Math.min(...positions) <= rule.window
}

/**
 * Первый слой защиты. Детерминированный и обязательный: промпт можно обойти
 * формулировкой, код — нет. Второй слой (классификация моделью) добирает
 * перефразировки, которых здесь нет.
 *
 * @returns строка-причина срабатывания или null
 */
function matchStopWord(text, stopWords = []) {
  const hay = normalize(text)
  const words = hay.split(' ')

  for (const rule of REFUND_RULES) {
    if (matchesRule(words, rule)) return rule.stems.join(' + ')
  }
  // Настраиваемые из админки — простым вхождением, их правит человек
  for (const w of stopWords) {
    const needle = normalize(w)
    if (needle && hay.includes(needle)) return w
  }
  return null
}

// ─── Схема структурированного ответа ──────────────────────────────────────────

/**
 * Ответ модели забираем структурой, а не разбором текста: регулярки по
 * свободному тексту рано или поздно ломаются, а тут схема гарантирует форму.
 */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    is_refund_request: {
      type: 'boolean',
      description: 'Клиент просит вернуть деньги, отменить платёж или оспорить списание — в любой формулировке, даже косвенной.',
    },
    needs_human: {
      type: 'boolean',
      description: 'Вопрос требует человека: доступ к чужим данным, спорная ситуация, угрозы, жалоба на сотрудника, нестандартный случай.',
    },
    category: {
      type: 'string',
      description: 'Короткая категория вопроса на русском: подключение, оплата, скорость, устройства, тариф, прочее.',
    },
    confidence: {
      type: 'number',
      description: 'Насколько уверенно можно отвечать без человека, от 0 до 1.',
    },
    resolved: {
      type: 'boolean',
      description: 'Вопрос клиента полностью решён этим ответом.',
    },
    should_close: {
      type: 'boolean',
      description: 'Диалог можно завершить и закрыть тикет: вопрос решён и клиенту больше нечего добавить.',
    },
    reply: {
      type: 'string',
      description: 'Текст ответа клиенту на русском. Без приветствий вида «Здравствуйте!», сразу по делу.',
    },
  },
  required: ['is_refund_request', 'needs_human', 'category', 'confidence', 'resolved', 'should_close', 'reply'],
  additionalProperties: false,
}

// ─── Промпт ───────────────────────────────────────────────────────────────────

const BASE_PROMPT = `Ты — сотрудник поддержки VPN-сервиса. Отвечаешь клиентам в тикетах на русском.

Отвечай коротко и по делу: клиент пришёл с проблемой, а не читать инструкцию. Одна-две мысли, без воды и без списков там, где хватит пары предложений.

Никогда не обещай того, чего не знаешь: не называй сроки, которые тебе не сообщили, не подтверждай возвраты, скидки и компенсации, не выдумывай тарифы и их цены. Если данных не хватает — так и скажи и отметь needs_human.

Ставь is_refund_request, если клиент хочет деньги назад в любой форме: «сделайте возврат», «верните средства», «хочу отказаться и получить деньги», «отмените платёж», «спишите обратно». Такие обращения ведёт человек, не ты.

Ставь needs_human при спорной ситуации, угрозах, жалобе на сотрудника, просьбе о данных другого пользователя или любом случае, где ошибка дорого стоит.

should_close ставь только когда вопрос действительно закрыт и от клиента ничего не ждёшь. Если ты задал уточняющий вопрос — диалог не закончен.`

/** Шаблоны подмешиваем как примеры тона. Промпт одинаков для всех тикетов,
 *  поэтому кэшируется — при десятке шаблонов это уже экономит заметно. */
function buildSystemPrompt(settings, templates) {
  const parts = [settings.system_prompt?.trim() || BASE_PROMPT]

  if (templates.length) {
    parts.push('\nПримеры того, как отвечать. Это образцы тона и формулировок, а не готовые ответы — подстраивай под вопрос клиента:')
    for (const t of templates) {
      parts.push(`\n[${t.category || 'общее'}]\nВопрос: ${t.question}\nОтвет: ${t.answer}`)
    }
  }

  const limit = Number(settings.reply_char_limit) || 1200
  parts.push(`\nДержи ответ в пределах ${limit} символов.`)
  return parts.join('\n')
}

/** Переписка тикета → диалог для модели. is_from_admin отделяет наши реплики. */
function buildConversation(ticket) {
  const msgs = Array.isArray(ticket.messages) ? ticket.messages : []
  const lines = msgs.map(m => `${m.is_from_admin ? 'Поддержка' : 'Клиент'}: ${m.message_text || '(вложение без текста)'}`)
  return `Тема тикета: ${ticket.title || 'без темы'}\n\nПереписка:\n${lines.join('\n')}`
}

// ─── Вызов модели ─────────────────────────────────────────────────────────────

function makeClient(settings) {
  return new Anthropic({
    apiKey: settings.apiKey,
    baseURL: (settings.base_url || 'https://customix.fun/api').replace(/\/+$/, ''),
    maxRetries: 2,       // ретраи безопасны: это чтение, ничего не отправляется клиенту
    timeout: 120000,
    defaultHeaders: {
      // Фильтр Customix отбивает запросы с User-Agent официального SDK
      // («Anthropic/JS …») — отвечает 403 «Your request was blocked» ещё до
      // проверки ключа. Проверено: с браузерным заголовком тот же запрос
      // доходит до авторизации. С Anthropic напрямую строка роли не играет.
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  })
}

/**
 * Одно обращение к модели. Возвращает разобранный объект по REPLY_SCHEMA.
 *
 * Параметры под Opus 4.8: мышление задаём явно — в отличие от Opus 5, здесь
 * пропуск поля означает работу БЕЗ мышления. temperature не передаём: на этой
 * модели он удалён и вернёт 400. max_tokens ограничивает мышление и текст
 * вместе, поэтому запас нужен ощутимо больше лимита длины ответа.
 */
async function askModel(settings, templates, ticket) {
  const client = makeClient(settings)

  const res = await client.messages.create({
    model: settings.model || 'claude-opus-4-8',
    max_tokens: Number(settings.max_tokens) || 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: settings.effort || 'low',
      format: { type: 'json_schema', schema: REPLY_SCHEMA },
    },
    system: [
      { type: 'text', text: buildSystemPrompt(settings, templates), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildConversation(ticket) }],
  })

  // Классификаторы провайдера могут отклонить запрос — это не ошибка HTTP.
  // Проверяем ДО чтения content, иначе упадём на пустом массиве.
  if (res.stop_reason === 'refusal') {
    return { ok: false, refusal: true, error: 'Модель отклонила запрос' }
  }

  const textBlock = (res.content || []).find(b => b.type === 'text')
  if (!textBlock) return { ok: false, error: 'Пустой ответ модели' }

  let data
  try { data = JSON.parse(textBlock.text) }
  catch { return { ok: false, error: 'Ответ модели не разобрался как JSON' } }

  return {
    ok: true,
    data,
    usage: {
      input: res.usage?.input_tokens || 0,
      output: res.usage?.output_tokens || 0,
    },
  }
}


/** Проверка связи: минимальный запрос, чтобы убедиться в ключе и базовом URL. */
async function ping(settings) {
  try {
    const client = makeClient(settings)
    const res = await client.messages.create({
      model: settings.model || 'claude-opus-4-8',
      max_tokens: 16,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'Ответь одним словом: ок' }],
    })
    const t = (res.content || []).find(b => b.type === 'text')
    return { ok: true, model: res.model, reply: t?.text?.trim() || '', usage: res.usage }
  } catch (e) {
    return { ok: false, error: e?.message || String(e), status: e?.status }
  }
}

module.exports = {
  ping, getSettings, normalize, matchStopWord, buildSystemPrompt, buildConversation,
  askModel, REPLY_SCHEMA, BASE_PROMPT,
}
