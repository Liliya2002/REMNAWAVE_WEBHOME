/**
 * Рассылки: настройки, шаблоны, лимиты и ЕДИНАЯ точка отправки.
 *
 * Почему отдельный сервис, а не дописано в bedolaga.js: тот — чистый клиент
 * API бота и о базе ничего не знает. Лимиты, шаблоны и журнал живут у нас,
 * поэтому им нужен свой слой поверх клиента.
 *
 * Главное правило: отправка идёт ТОЛЬКО через send() отсюда. У API бота нет
 * ни отмены, ни паузы, ни ограничений частоты — всё, что может остановить
 * ошибочную рассылку, существует только здесь и обязано проверяться ДО
 * вызова. Второй путь отправки в обход этой функции означал бы, что лимиты
 * можно обойти, не заметив.
 */
const db = require('../db')
const bedolaga = require('./bedolaga')

const SETTINGS_TTL_MS = 30 * 1000
let _cache = null

const DEFAULTS = {
  min_interval_minutes: 60,
  max_per_week: 0,
  quiet_from_hour: null,
  quiet_to_hour: null,
  timezone_offset_minutes: 180,
  confirm_typing_threshold: 1000,
  allowed_targets: [],
}

async function getSettings({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cache.ts < SETTINGS_TTL_MS) return _cache.data
  const { rows } = await db.query('SELECT * FROM broadcast_settings WHERE id = 1')
  const data = { ...DEFAULTS, ...(rows[0] || {}) }
  _cache = { ts: Date.now(), data }
  return data
}

function invalidate() { _cache = null }

const FIELDS = [
  'min_interval_minutes', 'max_per_week', 'quiet_from_hour', 'quiet_to_hour',
  'timezone_offset_minutes', 'confirm_typing_threshold', 'allowed_targets',
]

async function updateSettings(patch) {
  const cols = FIELDS.filter(f => Object.prototype.hasOwnProperty.call(patch, f))
  if (!cols.length) return getSettings({ force: true })

  const sets = cols.map((c, i) => `${c} = $${i + 1}`)
  const vals = cols.map(c => {
    const v = patch[c]
    if (c === 'allowed_targets') {
      return Array.isArray(v) ? v.filter(x => bedolaga.BROADCAST_TARGETS.includes(x)) : []
    }
    if (c === 'quiet_from_hour' || c === 'quiet_to_hour') {
      return (v === '' || v == null) ? null : Number(v)
    }
    return Number(v)
  })

  await db.query(
    `UPDATE broadcast_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = 1`,
    vals
  )
  invalidate()
  return getSettings({ force: true })
}

/**
 * Сейчас тихие часы?
 *
 * Окно может пересекать полночь: 22 → 9 означает «с десяти вечера до девяти
 * утра», и наивное `h >= from && h < to` в этом случае всегда ложно.
 */
function inQuietHours(s, now = new Date()) {
  const { quiet_from_hour: from, quiet_to_hour: to } = s
  if (from == null || to == null || from === to) return false
  const local = new Date(now.getTime() + (Number(s.timezone_offset_minutes) || 0) * 60000)
  const h = local.getUTCHours()
  return from < to ? (h >= from && h < to) : (h >= from || h < to)
}

/** Часы и минуты в локальном поясе настроек — для внятного текста ошибки. */
function localTimeLabel(s, now = new Date()) {
  const local = new Date(now.getTime() + (Number(s.timezone_offset_minutes) || 0) * 60000)
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * Можно ли отправлять прямо сейчас.
 *
 * Считаем по НАШЕМУ журналу (broadcast_log), а не по истории бота: там лежат
 * и рассылки, отправленные мимо этой админки, и запрещать из-за них было бы
 * неверно — как и разрешать, если кто-то отправил только что.
 *
 * @returns {{ok: true, settings} | {ok: false, reason, message, settings}}
 */
async function checkCanSend(accountId, target, source = 'manual') {
  const s = await getSettings()

  if (target && !bedolaga.BROADCAST_TARGETS.includes(target)) {
    return { ok: false, reason: 'bad_target', message: 'Недопустимый сегмент рассылки', settings: s }
  }
  if (target && s.allowed_targets.length && !s.allowed_targets.includes(target)) {
    return { ok: false, reason: 'target_not_allowed', message: `Сегмент «${target}» отключён в настройках рассылки`, settings: s }
  }

  // Правила конкретного сегмента. Требуется отложенный require: broadcastStats
  // тянет этот же модуль, и статический импорт дал бы цикл.
  if (target) {
    const stats = require('./broadcastStats')
    const rules = await stats.getSegmentRules()
    const rule = rules[target]

    if (rule && !rule.manual_allowed && source !== 'ai') {
      return { ok: false, reason: 'segment_closed', message: `Сегмент «${rule.label}» закрыт для ручной отправки`, settings: s }
    }
    if (rule && !rule.ai_allowed && source === 'ai') {
      return { ok: false, reason: 'segment_closed_ai', message: `Сегмент «${rule.label}» закрыт для ИИ`, settings: s }
    }

    // Свой интервал сегмента — поверх общего: общий ограничивает рассылки
    // вообще, этот бережёт конкретную аудиторию от частых повторов.
    const si = await stats.checkSegmentInterval(accountId, target)
    if (!si.ok) return { ok: false, reason: si.reason, message: si.message, settings: s }
  }

  if (inQuietHours(s)) {
    return {
      ok: false,
      reason: 'quiet_hours',
      message: `Тихие часы: с ${s.quiet_from_hour}:00 до ${s.quiet_to_hour}:00, сейчас ${localTimeLabel(s)}`,
      settings: s,
    }
  }

  const min = Number(s.min_interval_minutes) || 0
  if (min > 0) {
    const { rows } = await db.query(
      `SELECT created_at FROM broadcast_log
        WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [accountId]
    )
    if (rows[0]) {
      const passed = (Date.now() - new Date(rows[0].created_at).getTime()) / 60000
      if (passed < min) {
        return {
          ok: false,
          reason: 'too_soon',
          message: `С прошлой рассылки прошло ${Math.floor(passed)} мин., минимум — ${min}`,
          settings: s,
        }
      }
    }
  }

  const week = Number(s.max_per_week) || 0
  if (week > 0) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM broadcast_log
        WHERE account_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [accountId]
    )
    if (rows[0].n >= week) {
      return {
        ok: false,
        reason: 'weekly_limit',
        message: `За неделю уже отправлено ${rows[0].n} рассылок, лимит — ${week}`,
        settings: s,
      }
    }
  }

  return { ok: true, settings: s }
}

/**
 * Отправка. Единственный путь к POST /broadcasts.
 *
 * Журнал пишем ПОСЛЕ успешного вызова: запись до отправки означала бы, что
 * неудачная попытка съедает недельный лимит, а в журнале появляется рассылка,
 * которой не было.
 */
async function send(account, { target, message_text, source = 'manual', templateId = null, userId = null, recipients = null }) {
  const gate = await checkCanSend(account.id, target, source)
  if (!gate.ok) return { ok: false, blocked: true, reason: gate.reason, error: gate.message }

  const r = await bedolaga.sendBroadcast(account, { target, message_text })
  if (!r.ok) return { ok: false, error: r.error }

  await db.query(
    `INSERT INTO broadcast_log
       (account_id, broadcast_id, target, message_text, recipients, source, template_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [account.id, r.broadcast?.id || null, target, message_text,
     r.broadcast?.total_count ?? recipients ?? null, source, templateId, userId]
  ).catch(e => console.error('[broadcasts] журнал не записался:', e.message))

  return { ok: true, broadcast: r.broadcast }
}

// ─── Шаблоны ─────────────────────────────────────────────────────────────────

async function listTemplates({ activeOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM broadcast_templates
      ${activeOnly ? 'WHERE is_active' : ''}
      ORDER BY sort_order, id`
  )
  return rows
}

async function createTemplate({ name, occasion, body, target_default, sort_order = 0 }) {
  const { rows } = await db.query(
    `INSERT INTO broadcast_templates (name, occasion, body, target_default, sort_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, occasion || null, body, target_default || null, Number(sort_order) || 0]
  )
  return rows[0]
}

async function updateTemplate(id, patch) {
  const allowed = ['name', 'occasion', 'body', 'target_default', 'is_active', 'sort_order']
  const cols = allowed.filter(f => Object.prototype.hasOwnProperty.call(patch, f))
  if (!cols.length) return null
  const sets = cols.map((c, i) => `${c} = $${i + 1}`)
  const vals = cols.map(c => patch[c])
  vals.push(id)
  const { rows } = await db.query(
    `UPDATE broadcast_templates SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${vals.length} RETURNING *`,
    vals
  )
  return rows[0] || null
}

async function deleteTemplate(id) {
  const { rowCount } = await db.query('DELETE FROM broadcast_templates WHERE id = $1', [id])
  return rowCount > 0
}

module.exports = {
  getSettings, updateSettings, invalidate,
  checkCanSend, inQuietHours, send,
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  DEFAULTS,
}
