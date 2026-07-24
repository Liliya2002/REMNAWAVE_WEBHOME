/**
 * Общие действия над VPS (продление, удаление) — единый источник правды для
 * веб-роутов и Telegram-бота, чтобы обе точки входа писали в одни и те же
 * таблицы (vps_servers, vps_payment_history, admin_audit_log) одинаково.
 *
 * actor: { adminId?, adminLogin?, ip?, userAgent?, source? } — кто выполняет.
 */
const db = require('../db')

async function writeAudit(actor = {}, action, target = {}, changes = {}) {
  try {
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, admin_login, action, target_type, target_id, changes, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actor.adminId || null,
        actor.adminLogin || 'bot',
        action,
        target.type || null,
        target.id != null ? String(target.id) : null,
        changes || {},
        actor.ip || null,
        actor.userAgent || 'telegram-bot',
      ]
    )
  } catch (err) {
    console.error('[vpsActions] audit failed:', err.message)
  }
}

/**
 * Продлить VPS на N месяцев. Логика 1:1 с POST /api/admin/vps/:id/renew.
 * @returns {{ ok, error?, name?, newDateStr?, months?, monthlyCost?, currency? }}
 */
async function renewVps(id, months, note, actor = {}) {
  const renewMonths = Math.max(1, Math.min(120, Number(months) || 1))
  const { rows } = await db.query('SELECT * FROM vps_servers WHERE id = $1', [id])
  if (rows.length === 0) return { ok: false, error: 'VPS не найден' }
  const vps = rows[0]

  const oldDate = vps.paid_until
  const baseDate = oldDate && new Date(oldDate) > new Date() ? new Date(oldDate) : new Date()
  const newDate = new Date(baseDate)
  newDate.setMonth(newDate.getMonth() + renewMonths)
  const newDateStr = newDate.toISOString().split('T')[0]

  await db.query(
    'UPDATE vps_servers SET paid_until = $1, paid_months = paid_months + $2, updated_at = NOW() WHERE id = $3',
    [newDateStr, renewMonths, id]
  )
  await db.query(
    `INSERT INTO vps_payment_history (vps_id, action, months, old_paid_until, new_paid_until, amount, currency, admin_user, note)
     VALUES ($1, 'renewal', $2, $3, $4, $5, $6, $7, $8)`,
    [id, renewMonths, oldDate || null, newDateStr,
     (Number(vps.monthly_cost) || 0) * renewMonths, vps.currency || 'RUB',
     actor.adminLogin || 'bot', note || '']
  )
  await writeAudit(actor, 'vps.renew', { type: 'vps', id }, {
    months: renewMonths, paid_until_before: oldDate, paid_until_after: newDateStr,
    amount: (Number(vps.monthly_cost) || 0) * renewMonths, currency: vps.currency || 'RUB',
    source: actor.source || 'bot',
  })

  return {
    ok: true, name: vps.name, newDateStr, months: renewMonths,
    monthlyCost: Number(vps.monthly_cost) || 0, currency: vps.currency || 'RUB',
  }
}

/**
 * Удалить VPS из базы. Логика 1:1 с DELETE /api/admin/vps/:id.
 * @returns {{ ok, error?, name? }}
 */
async function deleteVps(id, actor = {}) {
  const snap = await db.query(
    'SELECT id, name, ip_address, hosting_provider FROM vps_servers WHERE id = $1', [id]
  )
  if (snap.rows.length === 0) return { ok: false, error: 'VPS не найден' }

  await db.query('DELETE FROM vps_servers WHERE id = $1', [id])
  await writeAudit(actor, 'vps.delete', { type: 'vps', id }, {
    before: snap.rows[0], source: actor.source || 'bot',
  })
  return { ok: true, name: snap.rows[0].name }
}

// Разрешённые к правке из бота поля (подмножество PATCH /api/admin/vps/:id).
const EDITABLE_FIELDS = ['ip_address', 'paid_until', 'node_uuid', 'node_name', 'name', 'location', 'notes']

/**
 * Точечное обновление полей VPS. Логика согласована с PATCH /api/admin/vps/:id.
 * @returns {{ ok, error? }}
 */
async function updateVpsFields(id, patch, actor = {}) {
  const snap = await db.query('SELECT * FROM vps_servers WHERE id = $1', [id])
  if (snap.rows.length === 0) return { ok: false, error: 'VPS не найден' }

  const sets = []
  const vals = []
  let i = 1
  for (const k of Object.keys(patch || {})) {
    if (!EDITABLE_FIELDS.includes(k)) continue
    sets.push(`${k} = $${i++}`)
    vals.push(patch[k])
  }
  if (sets.length === 0) return { ok: false, error: 'Нет полей для обновления' }
  vals.push(id)
  await db.query(`UPDATE vps_servers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)

  await writeAudit(actor, 'vps.update', { type: 'vps', id }, {
    fields: sets.map(s => s.split(' = ')[0]), patch, source: actor.source || 'bot',
  })
  return { ok: true }
}

module.exports = { renewVps, deleteVps, updateVpsFields }
