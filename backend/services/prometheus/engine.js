/**
 * PROMETHEUS: цикл работы.
 *
 * Модель получает вопрос и список инструментов, сама решает, что запросить, и
 * так по кругу, пока не соберёт достаточно для ответа. Всё, что она может
 * запросить, перечислено в tools.js и только читает.
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

/** Сохранить реплику в историю разбора. */
async function saveMessage(sessionId, row) {
  await db.query(
    `INSERT INTO prometheus_messages (session_id, role, content, tool_name, tool_input, tool_result)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [sessionId, row.role, row.content || null, row.tool_name || null,
     row.tool_input ? JSON.stringify(row.tool_input) : null,
     row.tool_result ? JSON.stringify(row.tool_result) : null]
  ).catch(e => log.warn('Реплика не записалась: ' + e.message))
}

/**
 * Провести разбор.
 *
 * @param {string} question вопрос владельца
 * @param {object} opts { sessionId, userId, onStep }
 */
async function ask(question, { sessionId = null, userId = null, onStep = null } = {}) {
  const conn = await ai.getSettings(db)
  if (!conn.apiKey) return { ok: false, error: 'Не задан ключ ИИ: админка → ИИ-ассистент → Подключение' }

  // Рубежи проверяем перед каждым разбором, а не один раз при старте: если
  // защиту сломали правкой, узнать об этом надо до обращения к модели, а не
  // после того, как она что-то сделает.
  const guard = await ro.selfCheck()
  if (!guard.ok) {
    return { ok: false, error: `Защита «только чтение» не прошла проверку (${guard.failed.join(', ')}). Разбор отменён.` }
  }

  let sid = sessionId
  if (!sid) {
    const r = await db.query(
      'INSERT INTO prometheus_sessions (title, started_by) VALUES ($1,$2) RETURNING id',
      [String(question).replace(/\s+/g, ' ').slice(0, 120), userId]
    )
    sid = r.rows[0].id
  }
  await saveMessage(sid, { role: 'user', content: question })

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

  for (let step = 0; step < MAX_STEPS; step++) {
    if (usedIn + usedOut > MAX_TOKENS_PER_RUN) {
      trace.push({ type: 'limit', text: 'Достигнут потолок токенов на разбор' })
      break
    }

    let res
    try {
      res = await client.messages.create({
        model: conn.model || 'claude-opus-4-8',
        max_tokens: Number(conn.max_tokens) || ai.DEFAULT_MAX_TOKENS,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: defs,
        messages,
      })
    } catch (e) {
      await saveMessage(sid, { role: 'assistant', content: `Ошибка обращения к модели: ${e.message}` })
      return { ok: false, error: e.message, session_id: sid, trace }
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
      if (onStep) { try { onStep({ name: u.name, input: u.input, ok: out.ok !== false }) } catch {} }

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

module.exports = { ask, SYSTEM, MAX_STEPS }
