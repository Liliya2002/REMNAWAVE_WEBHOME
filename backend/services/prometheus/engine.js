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
 * бесконечно на чужие деньги. Потолок токенов — чтобы один разбор не съел
 * дневной бюджет: в отличие от ассистента тикетов, здесь в контекст утягивается
 * содержимое файлов и выборки из базы, и растёт он быстро.
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
const MAX_TOKENS_PER_RUN = 220000

const SYSTEM = `Ты — PROMETHEUS, аналитический центр проекта VPN Webhome.

Проект — веб-панель для продажи VPN-подписок поверх панели RemnaWave: сайт с личным кабинетом, админка, Telegram-бот, приём платежей через Platega, управление серверами у нескольких хостеров и мониторинг стороннего бота продаж Bedolaga.

Твоя работа — разбираться, как проект живёт на самом деле, и говорить владельцу то, чего он сам не видит: где бизнес-логика расходится с замыслом, где деньги теряются, что стоит поправить и куда расти.

Чем ты НЕ являешься. Ты ничего не меняешь. У тебя нет и не может быть инструментов записи: ни в базу, ни в файлы, ни во внешние сервисы. Если решение требует действия — опиши его словами, чтобы человек сделал сам.

Как работать.

Не отвечай по памяти и не строй догадок о том, что можно посмотреть. Сначала посмотри: структура базы, выборки, исходники. Один взгляд в данные стоит десяти рассуждений о том, как оно, наверное, устроено.

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

/** Модель не ответила — записать причину туда, где её увидят. */
async function modelFailed(sid, e, trace) {
  const why = humanError(e)
  log.warn(`Разбор #${sid}: модель не ответила — ${e.message}`)
  await saveMessage(sid, { role: 'assistant', content: why })
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

  for (let step = 0; step < MAX_STEPS; step++) {
    if (usedIn + usedOut > MAX_TOKENS_PER_RUN) {
      trace.push({ type: 'limit', text: 'Достигнут потолок токенов на разбор' })
      break
    }

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
        try { res = await client.messages.create(body) } catch (e2) { return modelFailed(sid, e2, trace) }
      } else {
        return modelFailed(sid, e, trace)
      }
    }

    usedIn += res.usage?.input_tokens || 0
    usedOut += res.usage?.output_tokens || 0

    if (res.stop_reason === 'refusal') {
      return { ok: false, error: 'Модель отклонила запрос', session_id: sid, trace }
    }

    const toolUses = (res.content || []).filter(b => b.type === 'tool_use')
    const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()

    // Инструменты не запрошены — значит это и есть ответ.
    if (!toolUses.length) {
      await saveMessage(sid, { role: 'assistant', content: text })
      await db.query(
        `UPDATE prometheus_sessions
            SET input_tokens = input_tokens + $2, output_tokens = output_tokens + $3,
                tool_calls = tool_calls + $4, updated_at = NOW()
          WHERE id = $1`, [sid, usedIn, usedOut, calls])
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

      results.push({
        type: 'tool_result',
        tool_use_id: u.id,
        content: JSON.stringify(out).slice(0, 60000),
      })
    }
    messages.push({ role: 'user', content: results })
  }

  const text = 'Разбор прерван: исчерпан лимит шагов. Сузьте вопрос — например, спросите про один раздел.'
  await saveMessage(sid, { role: 'assistant', content: text })
  return { ok: true, answer: text, session_id: sid, trace, usage: { input: usedIn, output: usedOut, tool_calls: calls }, incomplete: true }
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
