/**
 * ИИ-ассистент: обработка тикетов Bedolaga.
 *
 * Порядок проверок выстроен так, чтобы отправка была последним и самым
 * труднодостижимым исходом. Любая неопределённость на любом шаге — эскалация:
 * ошибочный ответ клиенту не отозвать, промолчать можно всегда.
 */
const db = require('../db')
const bedolaga = require('../services/bedolaga')
const ai = require('../services/aiAssistant')

const TAG = '[AI-tickets cron]'

/** Запись в журнал. Конфликт по уникальному ключу означает, что это сообщение
 *  уже обработано другим тиком — молча пропускаем. */
async function log(row) {
  const r = await db.query(
    `INSERT INTO ai_ticket_replies
       (account_id, ticket_id, last_message_id, action, escalation_reason,
        reply_text, category, confidence, resolved, closed_ticket,
        input_tokens, output_tokens, error, ticket_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (account_id, ticket_id, last_message_id) DO NOTHING
     RETURNING id`,
    [row.account_id, row.ticket_id, row.last_message_id, row.action,
     row.escalation_reason || null, row.reply_text || null, row.category || null,
     row.confidence ?? null, row.resolved ?? null, row.closed_ticket || false,
     row.input_tokens || null, row.output_tokens || null, row.error || null,
     row.ticket_updated_at || null]
  )
  return r.rowCount > 0
}

/**
 * Уже отвечали на это сообщение?
 *
 * Заодно проставляем версию тикета: у записей, сделанных до появления колонки,
 * она пустая, и без этого дозаписывания тикет пришлось бы загружать на каждом
 * прогоне заново — пропуск по версии для него никогда бы не сработал.
 */
async function alreadyHandled(accountId, ticketId, msgId, ticketUpdatedAt) {
  const r = await db.query(
    `UPDATE ai_ticket_replies
        SET ticket_updated_at = COALESCE($4, ticket_updated_at)
      WHERE account_id=$1 AND ticket_id=$2 AND last_message_id=$3
      RETURNING id`,
    [accountId, ticketId, msgId, ticketUpdatedAt || null]
  )
  return r.rowCount > 0
}

/**
 * Дозагрузка переписки.
 *
 * GET /tickets отдаёт тикеты БЕЗ массива messages — вопреки документации,
 * которая описывает его в схеме списка. Реально переписка приходит только
 * в карточке GET /tickets/{id}, поэтому её приходится запрашивать отдельно.
 */
async function withMessages(account, ticket) {
  if (Array.isArray(ticket.messages) && ticket.messages.length) return ticket
  const r = await bedolaga.getTicket(account, ticket.id)
  if (!r.ok) return null
  return r.data
}

/**
 * Последняя обработанная версия каждого тикета аккаунта, одним запросом.
 * По ней решаем, нужно ли вообще тянуть карточку: если тикет не менялся
 * с прошлого раза, там заведомо ничего нового.
 */
async function seenVersions(accountId) {
  const r = await db.query(
    `SELECT ticket_id, MAX(ticket_updated_at) AS seen
       FROM ai_ticket_replies
      WHERE account_id = $1 AND ticket_updated_at IS NOT NULL
      GROUP BY ticket_id`,
    [accountId]
  )
  const map = new Map()
  for (const row of r.rows) map.set(row.ticket_id, new Date(row.seen).getTime())
  return map
}

async function activeTemplates() {
  const r = await db.query(
    'SELECT category, question, answer FROM ai_reply_templates WHERE is_active = true ORDER BY priority, id'
  )
  return r.rows
}

/**
 * Обработка одного тикета. Возвращает короткую строку для лога.
 */
async function handleTicket(cfg, templates, account, ticket) {
  const msgs = Array.isArray(ticket.messages) ? ticket.messages : []
  if (!msgs.length) return null

  const last = msgs[msgs.length - 1]
  // Последнее слово за нами — клиент ещё не ответил, ждать нечего
  if (last.is_from_admin) return null

  if (await alreadyHandled(account.id, ticket.id, last.id, ticket.updated_at)) return null

  const base = {
    account_id: account.id, ticket_id: ticket.id, last_message_id: last.id,
    ticket_updated_at: ticket.updated_at || null,
  }

  // ── Слой 1: стоп-слова по ВСЕЙ переписке клиента ───────────────────────────
  // Смотрим все реплики клиента, а не только последнюю: про возврат могли
  // написать в первом сообщении, а последним уточнить что-то безобидное.
  const clientText = msgs.filter(m => !m.is_from_admin).map(m => m.message_text || '').join('\n')
  const hit = ai.matchStopWord(clientText, cfg.stopWords)
  if (hit) {
    await log({ ...base, action: 'escalated', escalation_reason: 'stop_word', error: `Совпадение: ${hit}` })
    return `#${ticket.id} эскалация (стоп-слово: ${hit})`
  }

  // ── Слой 2: модель ─────────────────────────────────────────────────────────
  let res
  try {
    res = await ai.askModel(cfg, templates, ticket)
  } catch (e) {
    await log({ ...base, action: 'error', escalation_reason: 'api_error', error: e.message?.slice(0, 500) })
    return `#${ticket.id} ошибка API: ${e.message}`
  }

  if (!res.ok) {
    await log({ ...base, action: 'escalated', escalation_reason: res.refusal ? 'model_refusal' : 'classify_failed', error: res.error })
    return `#${ticket.id} эскалация (${res.error})`
  }

  const d = res.data
  const usage = { input_tokens: res.usage.input, output_tokens: res.usage.output }

  // Модель сама распознала тему денег — второй слой той же защиты
  if (d.is_refund_request) {
    await log({ ...base, action: 'escalated', escalation_reason: 'model_refund_flag',
                category: d.category, confidence: d.confidence, reply_text: d.reply, ...usage })
    return `#${ticket.id} эскалация (модель: возврат)`
  }
  if (d.needs_human) {
    await log({ ...base, action: 'escalated', escalation_reason: 'needs_human',
                category: d.category, confidence: d.confidence, reply_text: d.reply, ...usage })
    return `#${ticket.id} эскалация (нужен человек)`
  }
  const threshold = Number(cfg.confidence_threshold) || 0.75
  if (Number(d.confidence) < threshold) {
    await log({ ...base, action: 'escalated', escalation_reason: 'low_confidence',
                category: d.category, confidence: d.confidence, reply_text: d.reply, ...usage })
    return `#${ticket.id} эскалация (уверенность ${d.confidence} < ${threshold})`
  }
  if (!String(d.reply || '').trim()) {
    await log({ ...base, action: 'escalated', escalation_reason: 'empty_reply', ...usage })
    return `#${ticket.id} эскалация (пустой ответ)`
  }

  // ── Холостой режим: всё то же самое, но без отправки ───────────────────────
  if (cfg.dry_run) {
    await log({ ...base, action: 'dry_run', reply_text: d.reply, category: d.category,
                confidence: d.confidence, resolved: d.resolved,
                closed_ticket: false, ...usage })
    return `#${ticket.id} холостой прогон (ответ записан, не отправлен)`
  }

  // ── Отправка ───────────────────────────────────────────────────────────────
  const sent = await bedolaga.replyToTicket(account, ticket.id, d.reply)
  if (!sent.ok) {
    await log({ ...base, action: 'error', escalation_reason: 'send_failed',
                reply_text: d.reply, error: sent.error, ...usage })
    return `#${ticket.id} НЕ отправлено: ${sent.error}`
  }

  // Закрываем только когда сошлось всё сразу
  let closed = false
  if (cfg.can_close_tickets && d.should_close && d.resolved) {
    const st = await bedolaga.setTicketStatus(account, ticket.id, 'closed')
    closed = !!st.ok
  }

  await log({ ...base, action: closed ? 'closed' : 'replied', reply_text: d.reply,
              category: d.category, confidence: d.confidence, resolved: d.resolved,
              closed_ticket: closed, ...usage })
  return `#${ticket.id} отвечено${closed ? ' и закрыто' : ''}`
}

/**
 * Закрытие заброшенного тикета.
 *
 * Тема возврата не закрывается никогда, даже спустя месяцы: молча закрытая
 * денежная претензия исчезает из очереди, и о ней уже не вспомнят. Это правило
 * несокращаемое и настройкой не выключается.
 *
 * Тикеты, где клиент написал последним и остался без ответа, по умолчанию
 * ТОЖЕ закрываются по давности — решение владельца проекта. На этой базе
 * таких оказалось 34 из 35, и разбирать их вручную никто не будет. Снятая
 * галочка close_stale_unanswered возвращает осторожное поведение: отдавать
 * их человеку. В журнале они помечаются отдельно, чтобы масштаб был виден.
 */
async function closeStaleTicket(cfg, account, ticket) {
  const msgs = Array.isArray(ticket.messages) ? ticket.messages : []
  if (!msgs.length) return null

  const last = msgs[msgs.length - 1]
  if (await alreadyHandled(account.id, ticket.id, last.id, ticket.updated_at)) return null

  const base = {
    account_id: account.id, ticket_id: ticket.id, last_message_id: last.id,
    ticket_updated_at: ticket.updated_at || null,
  }

  const clientText = msgs.filter(m => !m.is_from_admin).map(m => m.message_text || '').join('\n')
  const hit = ai.matchStopWord(clientText, cfg.stopWords)
  if (hit) {
    await log({ ...base, action: 'escalated', escalation_reason: 'stale_but_refund',
                error: `Старый тикет про возврат — закрывать нельзя. Совпадение: ${hit}` })
    return `#${ticket.id} НЕ закрыт — тема возврата`
  }

  // Клиент написал последним и остался без ответа — виноваты мы, а не он.
  // По умолчанию такие тикеты всё равно закрываются по давности (решение
  // владельца: разбирать их руками никто не станет). Снятая галочка возвращает
  // осторожное поведение — отдавать их человеку.
  const unanswered = !last.is_from_admin
  if (unanswered && cfg.close_stale_unanswered === false) {
    await log({ ...base, action: 'escalated', escalation_reason: 'stale_unanswered',
                error: 'Клиент написал последним и остался без ответа' })
    return `#${ticket.id} НЕ закрыт — клиент без ответа, нужен человек`
  }

  const note = String(cfg.close_stale_message || '').trim()

  if (cfg.dry_run) {
    await log({ ...base, action: 'dry_run', reply_text: note || null,
                category: unanswered ? 'закрыл бы без ответа' : 'заброшенный',
                closed_ticket: false })
    return `#${ticket.id} холостой прогон (закрыл бы)`
  }

  if (note) {
    const sent = await bedolaga.replyToTicket(account, ticket.id, note)
    if (!sent.ok) {
      await log({ ...base, action: 'error', escalation_reason: 'send_failed', error: sent.error })
      return `#${ticket.id} не удалось отправить прощание: ${sent.error}`
    }
  }

  const st = await bedolaga.setTicketStatus(account, ticket.id, 'closed')
  if (!st.ok) {
    await log({ ...base, action: 'error', escalation_reason: 'close_failed', error: st.error })
    return `#${ticket.id} не удалось закрыть: ${st.error}`
  }

  await log({ ...base, action: 'closed', reply_text: note || null,
              category: unanswered ? 'закрыт без ответа' : 'заброшенный',
              escalation_reason: unanswered ? 'closed_unanswered' : null,
              closed_ticket: true })
  return `#${ticket.id} закрыт по давности${unanswered ? ' (клиент остался без ответа)' : ''}`
}

async function tick() {
  try {
    const cfg = await ai.getSettings(db)
    if (!cfg.enabled) return
    if (!cfg.apiKey) { console.warn(`${TAG} включён, но ключ не задан`); return }
    if (!cfg.started_at) { console.warn(`${TAG} нет отметки started_at — пропуск`); return }

    const templates = await activeTemplates()
    const accs = await db.query('SELECT * FROM bedolaga_accounts WHERE is_active = true ORDER BY id')

    for (const account of accs.rows) {
      // Берём открытые и ожидающие: закрытые нас не касаются
      const lists = await Promise.all([
        bedolaga.listTickets(account, { status: 'open', limit: 100 }),
        bedolaga.listTickets(account, { status: 'pending', limit: 100 }),
      ])
      const tickets = lists.filter(r => r.ok).flatMap(r => r.data?.items || r.data || [])

      const started = new Date(cfg.started_at)
      const maxAgeMs = (Number(cfg.max_ticket_age_hours) || 48) * 3600 * 1000
      const now = Date.now()

      const staleMs = (Number(cfg.close_stale_days) || 30) * 24 * 3600 * 1000
      const seenMap = await seenVersions(account.id)

      for (const t of tickets) {
        const created = new Date(t.created_at)
        const age = now - created.getTime()

        try {
          // Тикет не менялся с прошлой обработки — карточку не запрашиваем.
          // Без этой проверки на каждом прогоне уходил запрос на каждый тикет,
          // хотя меняются единицы.
          const seen = seenMap.get(t.id)
          const upd = t.updated_at ? new Date(t.updated_at).getTime() : null
          if (seen != null && upd != null && upd <= seen) continue

          // Заброшенные — отдельная ветка. Она НАМЕРЕННО игнорирует отсечку
          // бэклога: смысл режима именно в том, чтобы разобрать накопившееся.
          // Поэтому он и включается отдельным флагом, а не вместе с ответами.
          const isStale = cfg.close_stale_enabled && age > staleMs

          // Отсечка бэклога для ОТВЕТОВ. Именно она гарантирует, что старая
          // переписка не получит ответа — лимита возраста для этого мало:
          // подняв его потом, можно случайно запустить ассистента в бэклог.
          const isAnswerable = created > started && age <= maxAgeMs

          // Ни то ни другое — карточку даже не запрашиваем. Условия обеих
          // веток читаются из списка, переписка для них не нужна.
          if (!isStale && !isAnswerable) continue

          const full = await withMessages(account, t)
          if (!full) continue

          const note = isStale
            ? await closeStaleTicket(cfg, account, full)
            : await handleTicket(cfg, templates, account, full)
          if (note) console.log(`${TAG} ${account.name}: ${note}`)
        } catch (e) {
          console.error(`${TAG} тикет #${t.id}:`, e.message)
        }
      }
    }
  } catch (e) {
    console.error(`${TAG} tick error:`, e.message)
  }
}

let timer = null

async function schedule() {
  const cfg = await ai.getSettings(db)
  if (timer) { clearInterval(timer); timer = null }
  if (!cfg.enabled) { console.log(`${TAG} отключён`); return }
  const min = Math.min(Math.max(Number(cfg.poll_interval_min) || 10, 2), 120)
  timer = setInterval(tick, min * 60 * 1000)
  console.log(`${TAG} интервал ${min} мин${cfg.dry_run ? ', ХОЛОСТОЙ РЕЖИМ' : ', боевой режим'}`)
}

function start() {
  setTimeout(tick, 60 * 1000)
  schedule().catch(e => console.error(`${TAG} schedule error:`, e.message))
}

function reschedule() {
  return schedule().catch(e => console.error(`${TAG} reschedule error:`, e.message))
}

module.exports = { start, tick, reschedule, handleTicket, closeStaleTicket }
