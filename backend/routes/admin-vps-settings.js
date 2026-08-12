/**
 * Параметры мониторинга VPS (Настройки → VPS → Параметры мониторинга).
 *
 * Раньше жили только в .env, поэтому менялись через сервер и перезапуск.
 * Здесь редактируются и применяются сразу: после сохранения сбрасывается кэш
 * и перепланируется таймер health-check.
 *
 * Пустое значение = «использовать из .env» (в базе хранится NULL).
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const vpsSettings = require('../services/vpsSettings')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

const FIELDS = [
  'health_enabled', 'health_interval_min', 'health_ping_port',
  'health_check_nodes', 'health_parallelism', 'expiry_notify_hour',
  'default_ssh_port',
]

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM vps_settings WHERE id = 1')
    const row = rows[0] || {}
    const effective = await vpsSettings.get({ force: true })
    res.json({
      // Что реально сохранено (null = берётся из .env)
      saved: FIELDS.reduce((acc, f) => { acc[f] = row[f] ?? null; return acc }, {}),
      // Что применяется сейчас + откуда взято
      effective,
      limits: vpsSettings.LIMITS,
      defaults: vpsSettings.DEFAULTS,
      updated_at: row.updated_at || null,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/', async (req, res) => {
  try {
    const b = req.body || {}
    const sets = [], vals = []
    let i = 1

    for (const f of FIELDS) {
      if (!(f in b)) continue
      let v = b[f]
      if (v === '' || v === null) {
        v = null                                  // вернуть к значению из .env
      } else if (f === 'health_enabled') {
        v = !!v
      } else {
        const n = parseInt(v, 10)
        if (!Number.isFinite(n)) return res.status(400).json({ error: `Некорректное значение: ${f}` })
        const lim = vpsSettings.LIMITS[f]
        if (lim && (n < lim[0] || n > lim[1])) {
          return res.status(400).json({ error: `${f}: допустимо от ${lim[0]} до ${lim[1]}` })
        }
        v = n
      }
      sets.push(`${f} = $${i++}`); vals.push(v)
    }

    if (!sets.length) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()', `updated_by = $${i++}`)
    vals.push(req.userId || null)

    await db.query(`UPDATE vps_settings SET ${sets.join(', ')} WHERE id = 1`, vals)
    vpsSettings.invalidate()

    // Применяем сразу: перепланируем таймер health-check под новый интервал.
    try { await require('../cron/vpsHealth').reschedule() }
    catch (e) { console.warn('[vps-settings] reschedule:', e.message) }

    audit.write(req, 'vps.settings.update', { type: 'vps_settings', id: 1 },
      { fields: Object.keys(b) }).catch(() => {})

    const effective = await vpsSettings.get({ force: true })
    res.json({ ok: true, effective })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Разовый запуск проверки — чтобы не ждать следующего тика.
router.post('/run-check', async (req, res) => {
  try {
    await require('../cron/vpsHealth').tick()
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
