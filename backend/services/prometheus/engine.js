/**
 * PROMETHEUS: цикл работы.
 *
 * Модель получает вопрос и список инструментов, сама решает, что запросить, и
 * так по кругу, пока не соберёт достаточно для ответа. Всё, что она может
 * запросить, перечислено в tools.js и только читает.
 *
 * Разбор идёт в фоне. Синхронно его не отдать: один запрос к модели — до двух
 * минут, шагов до четырнадцати, а шлюз между браузером и нами рвёт соединение
 * на шестидесятой секунде и подсовывает HTML-страницу 504 вместо ответа.
 * Поэтому запуск сразу возвращает номер разбора, а результат забирается
 * отдельно — заодно по ходу видно, чем он занят прямо сейчас.
 *
 * Два ограничителя. Число шагов — чтобы цикл «спрошу ещё разок» не крутился
 * бесконечно на чужие деньги. Потолок расхода из настроек — чтобы один разбор
 * не съел дневной бюджет: здесь в контекст утягиваются файлы и выборки из базы,
 * и растёт он быстро. Если провайдер не сообщает расход (посредники часто не
 * сообщают), считаем сами по объёму переписки: приблизительно, зато тормоз
 * работает, а не стоит на нуле.
 *
 * Упершись в любой из пределов, разбор НЕ умирает: последний шаг отдан под
 * ответ из уже собранного. Иначе выходило худшее из возможного — всё потрачено,
 * ничего не отдано.
 *
 * Ход разбора пишется в базу целиком: какой инструмент вызвали и что он вернул.
 * Без этого вывод невозможно перепроверить — остаётся верить на слово, а
 * выводы иногда строятся на неверно понятых данных.
 */
const db = require('../../db')
const ai = require('../aiAssistant')
const connection = require('./connection')
const tools = require('./tools')
const ro = require('./readonly')
const memory = require('./memory')
const log = require('../logger').for('Prometheus')

const MAX_STEPS = 14
const DEFAULT_BUDGET = 150000     // если в настройках не задано иное

// Предел на один результат инструмента. Он остаётся в переписке навсегда и
// пересылается на КАЖДОМ следующем шаге, поэтому цена у него не одна, а по
// числу оставшихся шагов. Прежние 60 000 символов (~17 тысяч токенов) при
// четырнадцати шагах превращались в сотни тысяч.
const MAX_TOOL_RESULT = 12000

// Сколько последних результатов держать целиком. Более ранние модель уже
// осмыслила и пересказала себе в рассуждениях; возить их полный текст до конца
// разбора — платить за одно и то же снова и снова.
const KEEP_FULL_RESULTS = 3

const SYSTEM = `Ты — PROMETHEUS, аналитический центр проекта VPN Webhome.

Проект — веб-панель для продажи VPN-подписок поверх панели RemnaWave: сайт с личным кабинетом, админка, Telegram-бот, приём платежей через Platega, управление серверами у нескольких хостеров и мониторинг стороннего бота продаж Bedolaga.

Твоя работа — разбираться, как проект живёт на самом деле, и говорить владельцу то, чего он сам не видит: где бизнес-логика расходится с замыслом, где деньги теряются, что стоит поправить и куда расти.

Чем ты НЕ являешься. Ты ничего не меняешь. У тебя нет и не может быть инструментов записи: ни в базу, ни в файлы, ни во внешние сервисы. Если решение требует действия — опиши его словами, чтобы человек сделал сам.

Как работать.

Не отвечай по памяти и не строй догадок о том, что можно посмотреть. Сначала посмотри: структура базы, выборки, исходники. Один взгляд в данные стоит десяти рассуждений о том, как оно, наверное, устроено.

Если собираешься трогать базу — первым вызовом делай db_schema без аргументов. Это карта: все таблицы, число строк и состав колонок. Названия колонок в этом проекте свои и на привычные не похожи (у подписок нет status, есть is_active и provisioning_status; у платежей нет payment_method, есть payment_provider). Запрос с выдуманным названием не выполнится, и попытка угадать со второго раза обойдётся дороже, чем один взгляд в схему.

Считай, а не оценивай на глаз. «Много отказов» — не вывод. «17 из 83 подписок без доступа, все за последнюю неделю» — вывод.

Отделяй факт от догадки. Если данных не хватает — так и скажи, какого именно запроса не хватило, вместо того чтобы додумывать.

Проверяй свои выводы вторым запросом с другой стороны. Корреляция в одной выборке часто разваливается, стоит нормировать её на объём.

Говори по-русски, коротко и по делу. Владелец читает это, чтобы принять решение, а не чтобы восхититься полнотой отчёта. Числа приводи с тем, откуда они взяты.

Персональные данные и секреты приходят замаскированными — это норма, не поломка, и просить их в открытом виде бессмысленно.

Память. У тебя есть собственная память в базе проекта, и она переживает смену модели: что запомнил — останется, даже если владелец подключит другую нейросеть. Пользуйся этим.

Запоминай (memory_write) то, что пригодится в следующий раз: установленный факт с числом, устройство проекта, которое пришлось выяснять, решение владельца, вывод из собственной ошибки. Не запоминай сиюминутное и то, что заново посчитается за один запрос.

Найденную проблему фиксируй через finding_report, а не только словами в ответе: так у неё появится судьба — владелец её примет, отклонит или починит, и ты не будешь поднимать одно и то же на каждом разборе.

Если в памяти сказано, что владелец проблему отклонил, — не поднимай её снова, пока не появились новые данные. Он уже объяснил, почему.`

/**
 * Сохранить реплику в историю разбора.
 *
 * Заодно двигаем время разбора: по нему видно, что работа идёт, а не встала.
 */
async function saveMessage(sessionId, row) {
  await db.query(
    `INSERT INTO prometheus_messages (session_id, role, content, tool_name, tool_input, tool_result)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [sessionId, row.role, row.content || null, row.tool_name || null,
     row.tool_input ? JSON.stringify(row.tool_input) : null,
     row.tool_result ? JSON.stringify(row.tool_result) : null]
  ).catch(e => log.warn('Реплика не записалась: ' + e.message))
  await db.query('UPDATE prometheus_sessions SET updated_at = NOW() WHERE id = $1', [sessionId])
    .catch(() => {})
}

/** Разборы, идущие прямо сейчас: номер разбора → обещание результата. */
const running = new Map()

/**
 * Ошибку модели — на человеческий язык.
 *
 * Провайдер отдаёт JSON целиком в тексте ошибки, и в разделе появлялось
 * `401 {"type":"error",…,"message":"okak"}`. По такому не понять ни что
 * сломалось, ни куда идти чинить.
 */
function humanError(e) {
  const raw = String(e?.message || e || 'неизвестная ошибка')
  const code = e?.status || Number((raw.match(/^(\d{3})\b/) || [])[1]) || 0
  if (code === 401 || code === 403) return 'Ключ ИИ отклонён провайдером. Проверьте его на вкладке «Подключение» и нажмите «Проверить связь».'
  if (code === 429) return 'Провайдер ограничил частоту запросов. Попробуйте через несколько минут.'
  if (code === 402) return 'На счету у провайдера ИИ закончились средства.'
  if (code === 404) return 'Провайдер не знает ни такой модели, ни такого адреса. Проверьте их на вкладке «Подключение» — в адресе не должно быть /v1 на конце.'
  if (code >= 500) return `Провайдер ИИ ответил ошибкой ${code}. Это на их стороне, попробуйте позже.`
  if (/timeout|ETIMEDOUT|aborted/i.test(raw)) return 'Модель не ответила за отведённое время. Попробуйте сузить вопрос.'
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(raw)) return 'Не удалось связаться с провайдером ИИ — проверьте адрес в настройках подключения.'
  return raw.slice(0, 300)
}

/**
 * Подготовка: всё, что должно сообщить об ошибке немедленно.
 *
 * Нет ключа, сломана защита, разбор уже идёт — про это владелец узнаёт сразу,
 * а не через минуту молчания. Остальное происходит уже в фоне.
 */
async function prepare(question, { sessionId = null, userId = null } = {}) {
  // Подключение своё, с откатом на ассистентское. Так смена провайдера ради
  // разборов не трогает ассистента, который отвечает живым клиентам.
  const conn = await connection.get()
  if (!conn.apiKey) return { ok: false, error: 'Не задан ключ ИИ: вкладка «Подключение» в этом разделе' }
  if (!conn.model) return { ok: false, error: 'Не задана модель: вкладка «Подключение» в этом разделе' }

  // Рубежи проверяем перед каждым разбором, а не один раз при старте: если
  // защиту сломали правкой, узнать об этом надо до обращения к модели, а не
  // после того, как она что-то сделает.
  const guard = await ro.selfCheck()
  if (!guard.ok) {
    return { ok: false, error: `Защита «только чтение» не прошла проверку (${guard.failed.join(', ')}). Разбор отменён.` }
  }

  let sid = sessionId ? Number(sessionId) : null
  if (sid) {
    if (running.has(sid)) return { ok: false, error: 'По этому разбору уже идёт работа — дождитесь ответа' }
    const s = (await db.query('SELECT id FROM prometheus_sessions WHERE id = $1', [sid])).rows[0]
    if (!s) return { ok: false, error: 'Разбор не найден' }
  } else {
    const r = await db.query(
      'INSERT INTO prometheus_sessions (title, started_by) VALUES ($1,$2) RETURNING id',
      [String(question).replace(/\s+/g, ' ').slice(0, 120), userId]
    )
    sid = r.rows[0].id
  }

  await db.query(
    `UPDATE prometheus_sessions
        SET run_status = 'running', run_error = NULL, run_started_at = NOW(), updated_at = NOW()
      WHERE id = $1`, [sid])
  await saveMessage(sid, { role: 'user', content: question })
  return { ok: true, sid, conn }
}

/**
 * Оценка расхода, когда провайдер его не сообщает.
 *
 * Шлюзы-посредники часто не возвращают usage, и счётчик стоял на нуле — потолок
 * не срабатывал никогда. Считать приблизительно и ошибаться в третьем знаке
 * лучше, чем не считать вовсе: нам нужен не счёт от провайдера, а вовремя
 * нажатый тормоз.
 */
function approxTokens(x) {
  const s = typeof x === 'string' ? x : JSON.stringify(x || '')
  return Math.ceil(s.length / 3.2)     // кириллица дороже латиницы, берём с запасом
}

/** Результат инструмента для переписки: обрезаем по строкам, а не по символам. */
function packToolResult(out) {
  let s = JSON.stringify(out)
  if (s.length <= MAX_TOOL_RESULT) return s

  // У выборки режем строки: обрезанный по символам JSON нечитаем целиком, а
  // половина строк — всё ещё ответ на вопрос «что там вообще лежит».
  if (Array.isArray(out?.rows) && out.rows.length > 1) {
    const rows = [...out.rows]
    while (rows.length > 1 && JSON.stringify({ ...out, rows }).length > MAX_TOOL_RESULT) {
      rows.splice(Math.ceil(rows.length / 2))
    }
    s = JSON.stringify({
      ...out, rows,
      показано_строк: rows.length,
      всего_строк: out.rows.length,
      обрезано: 'Результат велик. Спрашивай уже́ — сводкой, условием WHERE, меньшим LIMIT: целиком он не поместится.',
    })
    if (s.length <= MAX_TOOL_RESULT) return s
  }
  return s.slice(0, MAX_TOOL_RESULT) + '… (обрезано)'
}

/**
 * Убрать из переписки текст давних результатов.
 *
 * Блок остаётся на месте — провайдер требует, чтобы у каждого вызова был свой
 * ответ, — но текст в нём заменяется пометкой. Иначе каждый следующий шаг
 * пересылает всё, что набралось раньше, и разбор дорожает квадратично.
 */
function pruneOldResults(messages) {
  const idx = []
  messages.forEach((m, i) => {
    if (m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result')) idx.push(i)
  })
  for (const i of idx.slice(0, Math.max(0, idx.length - KEEP_FULL_RESULTS))) {
    messages[i] = {
      role: 'user',
      content: messages[i].content.map(b => b.type === 'tool_result'
        ? { ...b, content: '(результат убран из переписки, чтобы не платить за него на каждом шаге; повтори вызов, если он снова нужен)' }
        : b),
    }
  }
}

/** Записать расход в историю. Вызывается на ЛЮБОМ исходе, а не только удачном. */
async function finishRun(sid, usedIn, usedOut, calls) {
  await db.query(
    `UPDATE prometheus_sessions
        SET input_tokens = input_tokens + $2, output_tokens = output_tokens + $3,
            tool_calls = tool_calls + $4, updated_at = NOW()
      WHERE id = $1`, [sid, usedIn, usedOut, calls]).catch(() => {})
}

/** Модель не ответила — записать причину туда, где её увидят, и учесть расход. */
async function modelFailed(sid, e, trace, spent = {}) {
  const why = humanError(e)
  log.warn(`Разбор #${sid}: модель не ответила — ${e.message}`)
  await saveMessage(sid, { role: 'assistant', content: why })
  // Расход до поломки — это уже потраченные деньги, и они должны быть видны.
  await finishRun(sid, spent.usedIn || 0, spent.usedOut || 0, spent.calls || 0)
  return { ok: false, error: why, session_id: sid, trace }
}

/** Сам цикл: модель просит данные, получает их, и так пока не соберёт ответ. */
async function runLoop(sid, question, conn) {
  // Память подкладывается ПЕРЕД вопросом: иначе он начнёт разбор с нуля и
  // потратит половину шагов на выяснение того, что уже выяснял.
  const brief = await memory.briefing(question).catch(() => '')

  // История разбора для модели. Прошлые реплики этой же сессии подтягиваем,
  // чтобы продолжение разговора не начиналось с чистого листа.
  const prior = await db.query(
    `SELECT role, content FROM prometheus_messages
      WHERE session_id = $1 AND role IN ('user','assistant') AND content IS NOT NULL
      ORDER BY id LIMIT 40`, [sid])
  const messages = prior.rows.length > 1
    ? prior.rows.map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: question + brief }]

  const client = ai.makeClient(conn)
  const defs = tools.toolDefinitions()
  let usedIn = 0, usedOut = 0, calls = 0
  const trace = []
  // Управление размышлением понимают не все шлюзы. Признак приходит из проверки
  // связи, но если провайдер передумал — отступаем на ходу, а не роняем разбор.
  let thinking = conn.send_thinking !== false

  const budget = Number(conn.token_budget) || DEFAULT_BUDGET
  let ranOut = null          // почему остановились, если остановились досрочно

  // Последний шаг оставлен под ответ: на нём инструменты уже не нужны, нужен
  // вывод из собранного. Без этого запаса разбор упирался в предел и умирал,
  // потратив всё и не отдав ничего.
  for (let step = 0; step < MAX_STEPS - 1; step++) {
    if (usedIn + usedOut > budget) {
      ranOut = 'потолок расхода'
      break
    }

    pruneOldResults(messages)

    const body = {
      model: conn.model,
      max_tokens: Number(conn.max_tokens) || ai.DEFAULT_MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: defs,
      messages,
    }

    let res
    try {
      res = await client.messages.create(thinking ? { ...body, thinking: { type: 'adaptive' } } : body)
    } catch (e) {
      if (thinking && /thinking/i.test(String(e.message)) && (e.status === 400 || e.status === 422)) {
        // Шлюз не понял управление размышлением. Это не повод терять разбор:
        // повторяем без него и дальше не просим.
        log.info(`Разбор #${sid}: провайдер не понимает управление размышлением, продолжаю без него`)
        thinking = false
        await db.query('UPDATE prometheus_settings SET send_thinking = false WHERE id = 1').catch(() => {})
        try { res = await client.messages.create(body) } catch (e2) { return modelFailed(sid, e2, trace, { usedIn, usedOut, calls }) }
      } else {
        return modelFailed(sid, e, trace, { usedIn, usedOut, calls })
      }
    }

    // Провайдер расход не всегда сообщает — тогда считаем сами по объёму
    // отправленного и полученного. Приблизительно, но тормоз работает.
    usedIn += res.usage?.input_tokens || approxTokens(messages)
    usedOut += res.usage?.output_tokens || approxTokens(res.content)
    log.debug(`Разбор #${sid}: шаг ${step + 1}, потрачено ≈${usedIn + usedOut} из ${budget}`)

    if (res.stop_reason === 'refusal') {
      return { ok: false, error: 'Модель отклонила запрос', session_id: sid, trace }
    }

    const toolUses = (res.content || []).filter(b => b.type === 'tool_use')
    const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()

    // Инструменты не запрошены — значит это и есть ответ.
    if (!toolUses.length) {
      await saveMessage(sid, { role: 'assistant', content: text })
      await finishRun(sid, usedIn, usedOut, calls)
      return { ok: true, answer: text, session_id: sid, trace, usage: { input: usedIn, output: usedOut, tool_calls: calls } }
    }

    messages.push({ role: 'assistant', content: res.content })

    const results = []
    for (const u of toolUses) {
      calls++
      // Подписываем запись в память номером разбора: иначе потом не понять,
      // на каком вопросе факт установлен и что тогда смотрели.
      const input = (u.name === 'memory_write' || u.name === 'finding_report')
        ? { ...u.input, sessionId: sid }
        : u.input
      const out = await tools.runTool(u.name, input)
      await saveMessage(sid, { role: 'tool', tool_name: u.name, tool_input: u.input, tool_result: out })
      trace.push({ type: 'tool', name: u.name, input: u.input, ok: out.ok !== false })

      results.push({ type: 'tool_result', tool_use_id: u.id, content: packToolResult(out) })
    }
    messages.push({ role: 'user', content: results })
  }

  if (!ranOut) ranOut = 'предел шагов'
  return finalAnswer(sid, { client, conn, messages, defs, thinking, trace, usedIn, usedOut, calls, ranOut })
}

/**
 * Последнее слово: собрать ответ из того, что уже добыто.
 *
 * Раньше упёршийся в предел разбор заканчивался фразой «исчерпан лимит шагов» —
 * всё потрачено, ничего не отдано, хотя данные были собраны. Один такой стоил
 * 600 тысяч токенов и ноль пользы.
 *
 * Инструменты на этом шаге запрещены явно: попроси мы «просто ответить», модель
 * с большой вероятностью потянулась бы ещё за одним запросом.
 */
async function finalAnswer(sid, { client, conn, messages, defs, thinking, trace, usedIn, usedOut, calls, ranOut }) {
  log.info(`Разбор #${sid}: ${ranOut}, собираю ответ из добытого (потрачено ≈${usedIn + usedOut})`)
  trace.push({ type: 'limit', text: `Достигнут ${ranOut} — ответ собирается из уже собранного` })

  const last = messages[messages.length - 1]
  const ask = {
    type: 'text',
    text: 'Данных больше не будет: достигнут ' + ranOut + '. Ответь на вопрос владельца тем, что уже узнал. ' +
      'Приведи числа, которые успел посчитать, и прямо скажи, чего выяснить не успел и каким запросом это доделать. ' +
      'Незаконченный разбор с честной границей полезнее отказа.',
  }
  // Добавляем к последней реплике, а не новой: после блока ответов инструментов
  // провайдер ждёт ход модели, а не второй подряд ход пользователя.
  if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(ask)
  else messages.push({ role: 'user', content: [ask] })

  const body = {
    model: conn.model,
    max_tokens: Number(conn.max_tokens) || ai.DEFAULT_MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: defs,
    tool_choice: { type: 'none' },
    messages,
    ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
  }

  let res
  try {
    res = await client.messages.create(body)
  } catch (e) {
    // Не всякий шлюз понимает запрет на инструменты — пробуем без него.
    if (/tool_choice/i.test(String(e.message))) {
      const { tool_choice, ...rest } = body
      try { res = await client.messages.create(rest) } catch (e2) { return outOfBudget(sid, e2, trace, usedIn, usedOut, calls, ranOut) }
    } else {
      return outOfBudget(sid, e, trace, usedIn, usedOut, calls, ranOut)
    }
  }

  usedIn += res.usage?.input_tokens || approxTokens(messages)
  usedOut += res.usage?.output_tokens || approxTokens(res.content)

  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  const answer = text || `Разбор остановлен: ${ranOut}. Собрать ответ из добытого не вышло — сузьте вопрос.`
  await saveMessage(sid, { role: 'assistant', content: answer })
  await finishRun(sid, usedIn, usedOut, calls)
  return {
    ok: true, answer, session_id: sid, trace, incomplete: true, stopped_by: ranOut,
    usage: { input: usedIn, output: usedOut, tool_calls: calls },
  }
}

/** Даже последнее слово не удалось — сказать об этом и записать расход. */
async function outOfBudget(sid, e, trace, usedIn, usedOut, calls, ranOut) {
  const text = `Разбор остановлен: ${ranOut}. Собрать ответ из добытого не удалось — ${humanError(e)}`
  await saveMessage(sid, { role: 'assistant', content: text })
  await finishRun(sid, usedIn, usedOut, calls)
  return { ok: true, answer: text, session_id: sid, trace, incomplete: true, usage: { input: usedIn, output: usedOut, tool_calls: calls } }
}

/**
 * Запустить разбор и сразу вернуть его номер.
 *
 * Ответа здесь не дождаться, и это намеренно. Результат забирается через
 * GET /sessions/:id — там же по мере работы появляются обращения к данным,
 * так что видно, чем он занят, а не крутится пустое ожидание.
 */
async function start(question, opts = {}) {
  const p = await prepare(question, opts)
  if (!p.ok) return p
  const sid = Number(p.sid)

  const job = runLoop(sid, question, p.conn)
    .catch(e => ({ ok: false, error: humanError(e), session_id: sid }))
    .then(async r => {
      await db.query(
        `UPDATE prometheus_sessions
            SET run_status = $2, run_error = $3, updated_at = NOW()
          WHERE id = $1`,
        [sid, r.ok ? 'done' : 'error', r.ok ? null : String(r.error || '').slice(0, 500)]
      ).catch(e => log.warn('Состояние разбора не записалось: ' + e.message))
      if (r.ok) log.info(`Разбор #${sid} закончен: обращений к данным ${r.usage?.tool_calls ?? 0}`)
      else log.warn(`Разбор #${sid} не удался: ${r.error}`)
      running.delete(sid)
      return r
    })

  running.set(sid, job)
  return { ok: true, session_id: sid, running: true }
}

/** Дождаться результата — для скриптов и проверок, не для HTTP. */
async function ask(question, opts = {}) {
  const s = await start(question, opts)
  if (!s.ok) return s
  return running.get(s.session_id) || { ok: true, session_id: s.session_id }
}

/**
 * Подвесить оборванные разборы при старте.
 *
 * Разбор живёт в памяти процесса. Если бэкенд перезапустили посреди него, в
 * базе навсегда останется «идёт работа», и владелец будет ждать ответа,
 * которого уже никто не готовит.
 */
async function resetStale() {
  const { rowCount } = await db.query(
    `UPDATE prometheus_sessions
        SET run_status = 'error',
            run_error = 'Разбор оборвался: перезапуск сервера',
            updated_at = NOW()
      WHERE run_status = 'running'`)
  if (rowCount) log.info(`Оборванных разборов помечено: ${rowCount}`)
  return rowCount
}

module.exports = {
  ask, start, resetStale,
  isRunning: sid => running.has(Number(sid)),
  SYSTEM, MAX_STEPS,
}
