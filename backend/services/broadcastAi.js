/**
 * ИИ-планировщик рассылок: решает, нужна ли рассылка, какому сегменту и с
 * каким текстом.
 *
 * ── Режимы ─────────────────────────────────────────────────────────────────
 *   off      ничего не делает
 *   prepare  создаёт карточку-предложение, отправляет человек
 *   auto     ставит рассылку в очередь и отправляет сам по истечении окна
 *            отмены; до этого момента её можно снять
 *
 * ── Что здесь В КОДЕ, а не в промпте ───────────────────────────────────────
 * Промпт обходится формулировкой, код — нет. Поэтому кодом проверяются:
 *   • лимиты частоты, тихие часы и список разрешённых сегментов — ДО того,
 *     как предложение вообще будет создано;
 *   • порог уверенности;
 *   • обещания скидок и промокодов, которых нет среди активных;
 *   • в режиме prepare отправка недоступна физически;
 *   • в режиме auto отправку выполняет не этот сервис, а диспетчер очереди
 *     (cron/broadcastAi.js) — и обязательно через broadcasts.send(), где
 *     лимиты проверяются ЗАНОВО, уже в момент отправки. Условия за время
 *     окна отмены могли измениться.
 *
 * Подключение к модели берём из ai_assistant_settings: провайдер один, и
 * второй ключ пришлось бы менять в двух местах.
 */
const db = require('../db')
const bedolaga = require('./bedolaga')
const broadcasts = require('./broadcasts')
const ai = require('./aiAssistant')
const stats = require('./broadcastStats')

// ─── Схема ответа ────────────────────────────────────────────────────────────

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    should_send: {
      type: 'boolean',
      description: 'Нужна ли рассылка прямо сейчас. Если поводов нет — false, это нормальный ответ.',
    },
    target: {
      type: 'string',
      description: 'Сегмент получателей из списка доступных. Если should_send=false — пустая строка.',
    },
    template_name: {
      type: 'string',
      description: 'Название шаблона, взятого за основу, точно как в списке. Если ни один не подошёл — пустая строка.',
    },
    message_text: {
      type: 'string',
      description: 'Готовый текст для Telegram с разметкой <b>, <i>, <u>. Без приветствия «Здравствуйте», сразу по делу.',
    },
    reason: {
      type: 'string',
      description: 'Почему именно сейчас и именно этот сегмент. Одно-два предложения по-русски.',
    },
    risks: {
      type: 'string',
      description: 'Чем эта рассылка может навредить. Если рисков не видно — пустая строка.',
    },
    confidence: {
      type: 'number',
      description: 'Насколько уверен, что рассылку стоит отправить, от 0 до 1.',
    },
  },
  required: ['should_send', 'target', 'template_name', 'message_text', 'reason', 'risks', 'confidence'],
  additionalProperties: false,
}

const BASE_PROMPT = `Ты отвечаешь за рассылки VPN-сервиса в Telegram-боте. Твоя задача — решить, нужна ли рассылка сейчас, кому и с каким текстом.

Молчание — нормальный ответ. Если явного повода нет, ставь should_send=false: лишняя рассылка не приносит продаж, а людей раздражает.

Пиши коротко и по делу. Один повод — одно сообщение. Без длинных списков и без воды.

Никогда не обещай того, чего нет: не выдумывай скидки, промокоды, сроки акций и цены. Упоминать можно только те промокоды, что перечислены ниже как активные. Если хочется сослаться на скидку, которой нет в списке, — не ссылайся.

Разметка Telegram: <b>жирный</b>, <i>курсив</i>, <u>подчёркнутый</u>, <code>моноширинный</code>. Другие теги не поддерживаются.

Смотри на результаты прошлых рассылок. Показатель «блокировок в сутки» считается внутри сегмента и делится на дни с прошлой рассылки — чем он ниже, тем лучше сообщение было принято.`

// ─── Сбор контекста ──────────────────────────────────────────────────────────

const fmtDate = v => new Date(v).toISOString().slice(0, 10)

/**
 * Всё, что модель должна знать для решения. Собирается из уже готовых
 * источников: истории рассылок, размеров сегментов, промокодов и наших
 * настроек.
 */
async function buildContext(account, settings) {
  const [hist, segs, promo] = await Promise.all([
    bedolaga.getBroadcastHistory(account),
    bedolaga.getSegmentSizes(account),
    bedolaga.listPromoCodes(account, { limit: 50, is_active: true }).catch(() => ({ ok: false })),
  ])

  const items = hist.ok ? hist.items : []
  const withRate = items.filter(b => b.blocked_per_day != null)

  // Лучшие и худшие — по приросту блокировок в сутки. Именно эта величина
  // сопоставима между рассылками: сырая дельта растёт просто от длины
  // интервала, а blocked_count считается внутри сегмента.
  const sorted = [...withRate].sort((a, b) => a.blocked_per_day - b.blocked_per_day)
  const best = sorted.slice(0, 5)
  const worst = sorted.slice(-3).reverse()

  // Отклонённые предложения — чтобы не предлагать одно и то же по кругу.
  const { rows: rejected } = await db.query(
    `SELECT target, message_text, reject_reason FROM broadcast_proposals
      WHERE account_id = $1 AND status = 'rejected' AND reject_reason IS NOT NULL
      ORDER BY decided_at DESC LIMIT 5`,
    [account.id]
  )

  const templates = await broadcasts.listTemplates({ activeOnly: true })
  const rules = await stats.getSegmentRules()

  // Отдача промокодов: сколько раз активировали код после рассылки с ним.
  // Может вернуть пусто — тогда в промпт просто не пойдёт (см. buildPrompt).
  const promoPerf = await stats.promoPerformance(account, { windowDays: 7 })
    .catch(() => ({ ok: false }))

  // Отдача по деньгам, дни простоя сегментов и недавние тексты — три вещи,
  // которых модели не хватало: чем рассылка закончилась, где давно не писали
  // и что именно не надо повторять.
  const [revenue, neglect, recent] = await Promise.all([
    stats.revenueLift(account).catch(() => ({ ok: false })),
    stats.segmentNeglect(account).catch(() => ({})),
    stats.recentTexts(account, { days: 14, limit: 8 }).catch(() => []),
  ])

  // Активные промокоды — единственное, на что модели разрешено ссылаться.
  const promoCodes = promo.ok
    ? ((promo.data && promo.data.items) || []).map(p => p.code).filter(Boolean).slice(0, 20)
    : []

  const lastByTarget = {}
  for (const b of items) if (!lastByTarget[b.target_type]) lastByTarget[b.target_type] = b

  return { items, segs: segs.ok ? segs.segments : [], best, worst, rejected, templates, promoCodes, lastByTarget, rules, promoPerf, revenue, neglect, recent }
}

function buildPrompt(settings, ctx, allowedTargets) {
  const parts = [BASE_PROMPT]

  if (settings.ai_prompt && settings.ai_prompt.trim()) {
    parts.push('\nДополнительные указания владельца:\n' + settings.ai_prompt.trim())
  }

  parts.push('\n── Доступные сегменты ──')
  for (const id of allowedTargets) {
    const s = ctx.segs.find(x => x.id === id)
    const size = s && s.lastSent ? `${s.lastSent.count} получателей` : 'размер неизвестен'
    // Дни простоя, а не дата: «не писали 45 дней» — сразу повод, а дату
    // модели пришлось бы вычитать из сегодняшней в уме.
    const idle = ctx.neglect ? ctx.neglect[id] : null
    const when = idle == null
      ? 'ещё не отправлялся'
      : `не писали ${idle} дн.`
    const rule = ctx.rules ? ctx.rules[id] : null
    const extra = []
    if (rule && rule.is_sandbox) extra.push('ПОЛИГОН: здесь можно пробовать новое, аудитория маленькая')

    // Отдача — наблюдение, а не правило, поэтому отдельной припиской. Порог в
    // пять рассылок: по трём медиана скачет от одной удачной отправки, и
    // модель выучила бы шум.
    const rev = ctx.revenue && ctx.revenue.ok
      ? ctx.revenue.by_segment.find(x => x.target === id) : null
    const revNote = rev && rev.n >= 5
      ? `; выручка после рассылок x${rev.median} к обычному дню (по ${rev.n})` : ''
    if (rule && rule.purpose === 'sales') extra.push('только продающие сообщения')
    if (rule && rule.purpose === 'service') extra.push('только сервисные новости, без продаж')
    if (rule && rule.min_interval_hours) extra.push(`не чаще раза в ${rule.min_interval_hours} ч`)
    if (rule && rule.note) extra.push(rule.note)
    parts.push(`${id} — ${s ? s.hint : ''}; ${size}; ${when}${revNote}${extra.length ? '; ПРАВИЛО: ' + extra.join('; ') : ''}`)
  }

  if (ctx.templates.length) {
    parts.push('\n── Шаблоны. Выбери подходящий по поводу и подстрой текст под ситуацию ──')
    for (const t of ctx.templates) {
      parts.push(`\n[${t.name}]${t.occasion ? ' — уместен когда: ' + t.occasion : ''}\n${t.body}`)
    }
  }

  if (ctx.best.length) {
    parts.push('\n── Рассылки, принятые лучше всего (низкий прирост блокировок) ──')
    for (const b of ctx.best) {
      parts.push(`[${b.target_type}, ${b.blocked_per_day} блок./сутки, дошло ${b.delivery_pct}%]\n${String(b.message_text).slice(0, 400)}`)
    }
  }
  if (ctx.worst.length) {
    parts.push('\n── Рассылки, принятые хуже всего. Так писать не надо ──')
    for (const b of ctx.worst) {
      parts.push(`[${b.target_type}, ${b.blocked_per_day} блок./сутки]\n${String(b.message_text).slice(0, 250)}`)
    }
  }

  if (ctx.rejected.length) {
    parts.push('\n── Предложения, которые владелец отклонил. Не повторяй их ──')
    for (const r of ctx.rejected) {
      parts.push(`[${r.target}] причина отказа: ${r.reject_reason}\n${String(r.message_text).slice(0, 200)}`)
    }
  }

  if (ctx.revenue && ctx.revenue.ok && ctx.revenue.measured >= 10) {
    parts.push('\n── Что рассылки дают в деньгах ──')
    parts.push(`По ${ctx.revenue.measured} рассылкам: выручка за сутки после отправки относительно обычного дня (тот же день недели, среднее за 3 недели). 1.0 — без изменений.`)
    parts.push(`В среднем по всем: x${ctx.revenue.overall}.`)
    parts.push('Если по сегменту показатель около единицы или ниже — рассылки туда не окупаются, и это повод не писать, а не писать чаще.')
  }

  if (ctx.recent && ctx.recent.length) {
    parts.push('\n── Что уже отправляли за последние две недели. НЕ ПОВТОРЯЙ ──')
    for (const r of ctx.recent) {
      parts.push(`[${r.target}, ${fmtDate(r.created_at)}] ${r.text}`)
    }
    parts.push('Похожий текст в тот же сегмент будет отклонён автоматически.')
  }

  // Отдача кодов — только если данные и надёжны, и содержательны.
  //
  // Мало проверить число рассылок: если крон синхронизации активаций
  // отключён, все значения окажутся нулевыми, блок попадёт в промпт и научит
  // модель, что промокоды не работают вообще. Это артефакт, а не факт.
  // Поэтому требуем ещё и хотя бы одно ненулевое значение.
  const perf = ctx.promoPerf
  const hasSignal = perf && perf.ok && perf.byCode.some(c => Number(c.uses) > 0)
  if (hasSignal && perf.coverage.reliable >= 3) {
    parts.push('\n── Отдача промокодов в рассылках ──')
    parts.push('Активаций на 1000 доставленных за 7 дней после рассылки. Чем больше, тем лучше код привлекает.')
    for (const c of perf.byCode) {
      parts.push(`${c.code}: ${c.avg_per_thousand} на 1000 (рассылок ${c.broadcasts}, активаций ${c.uses})`)
    }
  }

  parts.push('\n── Активные промокоды ──')
  parts.push(ctx.promoCodes.length
    ? ctx.promoCodes.join(', ') + '\nСсылаться можно ТОЛЬКО на них.'
    : 'Активных промокодов нет. Не упоминай никакие коды и скидки.')

  // Контракт ответа словами, хотя схема уже передана в output_config.
  // Через прокси structured output до модели не доходит: в журнале лежат ответы
  // «**should_send:** true **segment:** expired» — markdown вместо JSON и с
  // выдуманными именами полей. Отсюда и блокировка «недоступный сегмент
  // undefined»: модель вернула segment, а код читает target.
  parts.push('\n' + ai.describeSchema(PROPOSAL_SCHEMA))

  return parts.join('\n')
}

// ─── Проверки, которые нельзя доверить промпту ───────────────────────────────

/**
 * Не обещает ли текст скидок и кодов, которых нет.
 *
 * Ищем похожее на промокод — слово капсом из латиницы и цифр — и сверяем со
 * списком активных. Модель может выдумать «SALE30», и в промпте это запрещено,
 * но запрет в промпте обходится, а проверка здесь — нет.
 */
function findInventedCodes(text, activeCodes) {
  const upper = new Set(activeCodes.map(c => String(c).toUpperCase()))
  const found = String(text || '').match(/\b[A-Z][A-Z0-9]{3,19}\b/g) || []
  // Частые слова капсом, не являющиеся кодами
  const stop = new Set(['VPN', 'HTTP', 'HTTPS', 'IOS', 'ANDROID', 'WIFI', 'QR', 'SBP', 'TELEGRAM'])
  return [...new Set(found)].filter(c => !upper.has(c) && !stop.has(c))
}

/**
 * Привести ответ модели к именам полей схемы.
 *
 * Контракт в промпте описан явно, но это просьба, а не гарантия. В журнале
 * прода лежит ответ с полями segment/title/message вместо target/message_text —
 * модель придумала свои имена, и код прочитал target как undefined, а потом
 * заблокировал «недоступный сегмент undefined». Терять из-за этого готовое
 * предложение жалко: понять, что segment — это target, ничего не стоит.
 *
 * Синонимы берём только однозначные. Там, где смысл мог бы разойтись, лучше
 * отбраковать ответ, чем угадать неверно.
 */
const ALIASES = {
  target: ['segment', 'audience', 'target_type'],
  message_text: ['message', 'text', 'body'],
  template_name: ['template'],
  should_send: ['send'],
}

function normalizeProposal(d) {
  if (!d || typeof d !== 'object') return d
  const out = { ...d }
  for (const [canon, alts] of Object.entries(ALIASES)) {
    if (out[canon] !== undefined && out[canon] !== null && out[canon] !== '') continue
    for (const a of alts) {
      if (out[a] !== undefined && out[a] !== null && out[a] !== '') {
        out[canon] = out[a]
        console.warn(`[broadcastAi] модель вернула «${a}» вместо «${canon}» — подставил`)
        break
      }
    }
  }
  return out
}

async function logRun(accountId, row) {
  await db.query(
    `INSERT INTO broadcast_ai_runs
       (account_id, should_send, target, confidence, reason, outcome, detail, dry_run, input_tokens, output_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [accountId, row.should_send ?? null, row.target || null, row.confidence ?? null,
     row.reason || null, row.outcome, row.detail || null, !!row.dry_run,
     row.input_tokens || null, row.output_tokens || null]
  ).catch(e => console.error('[broadcastAi] журнал не записался:', e.message))
}

// ─── Один прогон ─────────────────────────────────────────────────────────────

/**
 * Проанализировать и, если нужно, создать предложение.
 *
 * Ничего не отправляет: в этом сервисе нет вызова отправки вовсе.
 * @returns {{outcome: string, detail?: string, proposalId?: number}}
 */
async function runOnce(account, { force = false } = {}) {
  const settings = await broadcasts.getSettings({ force: true })

  if (settings.ai_mode === 'off' && !force) {
    return { outcome: 'skipped', detail: 'ИИ выключен' }
  }

  // Уже есть необработанная карточка — вторую не плодим: человек утонет в
  // списке, а свежесть предложений от этого не вырастет.
  // Запланированная автопилотом рассылка тоже занимает очередь: пока она
  // не ушла и не снята, новую готовить незачем.
  const { rows: pending } = await db.query(
    `SELECT id, status FROM broadcast_proposals
      WHERE account_id = $1 AND status IN ('pending', 'scheduled') LIMIT 1`,
    [account.id]
  )
  if (pending.length) {
    const d = pending[0].status === 'scheduled'
      ? 'рассылка уже стоит в очереди на отправку'
      : 'уже есть необработанное предложение'
    await logRun(account.id, { outcome: 'skipped', detail: d })
    return { outcome: 'skipped', detail: d }
  }

  // Сегменты, которые ИИ вправе предлагать: своё ограничение, а если пусто —
  // общее из настроек рассылки, а если и там пусто — все.
  let allowed = settings.ai_allowed_targets.length ? settings.ai_allowed_targets
    : (settings.allowed_targets.length ? settings.allowed_targets : bedolaga.BROADCAST_TARGETS)

  // Отбрасываем те, что сейчас всё равно запрещены лимитами: предлагать
  // заведомо неотправляемое — пустая трата и запроса, и внимания человека.
  const gates = await Promise.all(allowed.map(t => broadcasts.checkCanSend(account.id, t, 'ai')))
  const sendable = allowed.filter((t, i) => gates[i].ok)
  if (!sendable.length) {
    const why = gates[0] ? gates[0].message : 'ограничения настроек'
    await logRun(account.id, { outcome: 'blocked', detail: why })
    return { outcome: 'blocked', detail: why }
  }

  const conn = await ai.getSettings(db)
  if (!conn.apiKey) {
    await logRun(account.id, { outcome: 'error', detail: 'не задан ключ ИИ' })
    return { outcome: 'error', detail: 'не задан ключ ИИ' }
  }

  const ctx = await buildContext(account, settings)
  const prompt = buildPrompt(settings, ctx, sendable)

  const client = ai.makeClient(conn)
  let res
  try {
    res = await client.messages.create({
      model: conn.model || 'claude-opus-4-8',
      max_tokens: Number(conn.max_tokens) || ai.DEFAULT_MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: conn.effort || 'low',
        format: { type: 'json_schema', schema: PROPOSAL_SCHEMA },
      },
      system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Сегодня ${fmtDate(Date.now())}. Нужна ли рассылка сейчас?` }],
    })
  } catch (e) {
    await logRun(account.id, { outcome: 'error', detail: e.message })
    return { outcome: 'error', detail: e.message }
  }

  if (res.stop_reason === 'refusal') {
    await logRun(account.id, { outcome: 'error', detail: 'модель отклонила запрос' })
    return { outcome: 'error', detail: 'модель отклонила запрос' }
  }
  if (res.stop_reason === 'max_tokens') {
    const d = `ответ обрезан лимитом max_tokens (${conn.max_tokens})`
    await logRun(account.id, { outcome: 'error', detail: d })
    return { outcome: 'error', detail: d }
  }

  const block = (res.content || []).find(b => b.type === 'text')
  const parsed = block ? ai.parseModelJson(block.text) : { ok: false }
  if (!parsed.ok) {
    const d = 'ответ модели не разобрался как JSON: ' + String(block?.text || '').replace(/\s+/g, ' ').slice(0, 150)
    await logRun(account.id, { outcome: 'error', detail: d })
    return { outcome: 'error', detail: d }
  }

  const d = normalizeProposal(parsed.data)
  const usage = { input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens }
  const base = { should_send: d.should_send, target: d.target, confidence: d.confidence, reason: d.reason, ...usage }

  if (!d.should_send) {
    await logRun(account.id, { ...base, outcome: 'skipped', detail: 'модель решила, что повода нет' })
    return { outcome: 'skipped', detail: d.reason }
  }

  // ── Проверки кодом ──
  if (!sendable.includes(d.target)) {
    const detail = `модель предложила недоступный сегмент «${d.target}»`
    await logRun(account.id, { ...base, outcome: 'blocked', detail })
    return { outcome: 'blocked', detail }
  }
  const minConf = Number(settings.ai_min_confidence) || 0
  if (Number(d.confidence) < minConf) {
    const detail = `уверенность ${d.confidence} ниже порога ${minConf}`
    await logRun(account.id, { ...base, outcome: 'skipped', detail })
    return { outcome: 'skipped', detail }
  }
  const invented = findInventedCodes(d.message_text, ctx.promoCodes)
  if (invented.length) {
    const detail = `в тексте коды, которых нет среди активных: ${invented.join(', ')}`
    await logRun(account.id, { ...base, outcome: 'blocked', detail })
    return { outcome: 'blocked', detail }
  }
  if (!d.message_text || d.message_text.length > 4096) {
    const detail = 'пустой текст или длиннее 4096 символов'
    await logRun(account.id, { ...base, outcome: 'blocked', detail })
    return { outcome: 'blocked', detail }
  }

  if (settings.ai_dry_run) {
    await logRun(account.id, { ...base, outcome: 'dry_run', dry_run: true, detail: 'холостой режим: карточка не создана' })
    return { outcome: 'dry_run', detail: 'холостой режим' }
  }

  const tpl = ctx.templates.find(t => t.name === d.template_name) || null
  const seg = ctx.segs.find(s => s.id === d.target)
  const recipients = seg && seg.lastSent ? seg.lastSent.count : (seg ? seg.estimate : null)

  // В автопилоте карточка сразу становится в очередь: ей проставляется время
  // отправки, и до его наступления рассылку можно снять. Задержка 0 означает
  // «без окна отмены» — уйдёт на ближайшем тике диспетчера.
  const auto = settings.ai_mode === 'auto'
  const delayMin = Math.max(0, Number(settings.ai_auto_delay_minutes) || 0)
  const scheduledAt = auto ? new Date(Date.now() + delayMin * 60000) : null

  const { rows } = await db.query(
    `INSERT INTO broadcast_proposals
       (account_id, target, message_text, template_id, reason, risks, confidence,
        recipients, input_tokens, output_tokens, status, scheduled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [account.id, d.target, d.message_text, tpl ? tpl.id : null, d.reason || null,
     d.risks || null, d.confidence, recipients, usage.input_tokens, usage.output_tokens,
     auto ? 'scheduled' : 'pending', scheduledAt]
  )
  const proposalId = rows[0].id

  await db.query('UPDATE broadcast_settings SET ai_last_run_at = NOW() WHERE id = 1')

  if (auto) {
    // Уведомление — единственный шанс человека вмешаться. Шлём его ДО
    // отправки и не молча: ошибка автопилота необратима.
    notifyScheduled(account, {
      id: proposalId, target: d.target, recipients, delayMin, text: d.message_text,
    }).catch(e => console.warn('[broadcastAi] уведомление не ушло:', e.message))

    await logRun(account.id, { ...base, outcome: 'scheduled',
      detail: `#${proposalId} уйдёт через ${delayMin} мин.` })
    return { outcome: 'scheduled', proposalId, scheduledAt }
  }

  await logRun(account.id, { ...base, outcome: 'proposed', detail: `предложение #${proposalId}` })
  return { outcome: 'proposed', proposalId }
}

/** Уведомление админу о запланированной автопилотом рассылке. */
async function notifyScheduled(account, { id, target, recipients, delayMin, text }) {
  const tgNotify = require('./telegramBot/notify')
  const plain = String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 300)
  return tgNotify.notifyAdmin('admin_broadcast_scheduled', {
    id,
    target,
    recipients: recipients == null ? '?' : Number(recipients).toLocaleString('ru-RU'),
    delay: delayMin,
    text: plain,
  })
}

/**
 * Отправить всё, чему пришло время.
 *
 * Отправка идёт через broadcasts.send — лимиты, тихие часы и белый список
 * проверяются ЗАНОВО. За время окна отмены владелец мог поменять настройки,
 * и решение, принятое полчаса назад, могло устареть.
 *
 * Статус меняем ДО отправки (scheduled → approved под условием), чтобы два
 * параллельных тика не отправили одно и то же дважды: у API бота нет
 * идемпотентности, дубль ушёл бы людям.
 */
async function dispatchDue() {
  const settings = await broadcasts.getSettings({ force: true })
  if (settings.ai_mode !== 'auto') return { sent: 0, skipped: 'автопилот выключен' }

  const { rows } = await db.query(
    `SELECT * FROM broadcast_proposals
      WHERE status = 'scheduled' AND scheduled_at <= NOW()
      ORDER BY scheduled_at LIMIT 5`
  )
  let sent = 0

  for (const p of rows) {
    // Забираем задачу атомарно: если строку уже взял другой тик, rowCount = 0.
    const claim = await db.query(
      `UPDATE broadcast_proposals SET status = 'approved', decided_at = NOW()
        WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [p.id]
    )
    if (!claim.rowCount) continue

    const { rows: accs } = await db.query('SELECT * FROM bedolaga_accounts WHERE id = $1', [p.account_id])
    const acc = accs[0]
    if (!acc) continue

    const r = await broadcasts.send(acc, {
      target: p.target, message_text: p.message_text, source: 'ai',
      templateId: p.template_id, recipients: p.recipients,
    })

    if (r.ok) {
      await db.query(
        `UPDATE broadcast_proposals SET sent_at = NOW(), broadcast_id = $2 WHERE id = $1`,
        [p.id, r.broadcast?.id || null]
      )
      await logRun(p.account_id, { outcome: 'sent', target: p.target, detail: `#${p.id} отправлено автопилотом` })
      sent++
    } else {
      // Не смогли — возвращаем в ожидание человека, а не теряем молча.
      await db.query(
        `UPDATE broadcast_proposals
            SET status = 'pending', decided_at = NULL, fail_reason = $2 WHERE id = $1`,
        [p.id, r.error]
      )
      await logRun(p.account_id, { outcome: 'blocked', target: p.target,
        detail: `#${p.id} не ушло: ${r.error}. Ждёт решения человека.` })
    }
  }
  return { sent }
}

/** Аварийный выключатель: гасит автопилот и снимает всё из очереди. */
async function emergencyStop(userId = null) {
  await db.query("UPDATE broadcast_settings SET ai_mode = 'off' WHERE id = 1")
  broadcasts.invalidate()
  const { rowCount } = await db.query(
    `UPDATE broadcast_proposals
        SET status = 'cancelled', decided_at = NOW(), decided_by = $1
      WHERE status = 'scheduled'`,
    [userId]
  )
  return { cancelled: rowCount }
}

module.exports = {
  runOnce, buildContext, buildPrompt, findInventedCodes,
  dispatchDue, emergencyStop, notifyScheduled,
  PROPOSAL_SCHEMA, BASE_PROMPT,
}
