/**
 * Настройки платёжных систем в админке (раньше жили только в .env).
 *
 * Секрет наружу не отдаётся никогда — только флаг has_secret и «хвост»
 * merchant_id для визуальной сверки. Пустая строка в PUT = не менять секрет.
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const { encrypt } = require('../services/encryption')
const paymentSettings = require('../services/paymentSettings')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

async function loadRow() {
  const { rows } = await db.query('SELECT * FROM payment_settings WHERE id = 1')
  if (rows[0]) return rows[0]
  const ins = await db.query('INSERT INTO payment_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING RETURNING *')
  return ins.rows[0] || (await db.query('SELECT * FROM payment_settings WHERE id = 1')).rows[0]
}

// GET — текущие настройки (без секретов) + эффективное состояние
router.get('/', async (req, res) => {
  try {
    const row = await loadRow()
    const { platega } = await paymentSettings.get({ force: true })
    res.json({
      platega: {
        enabled: row.platega_enabled !== false,
        merchant_id: row.platega_merchant_id || '',
        has_secret: !!row.platega_secret,
        payment_method: row.platega_payment_method ?? 2,
        api_url: row.platega_api_url || '',
        success_url: row.success_url || '',
        failed_url: row.failed_url || '',
      },
      // Что реально используется прямо сейчас (учитывает fallback на .env)
      effective: {
        configured: platega.configured,
        source: platega.source,          // db | env | none
        api_url: platega.apiUrl,
        success_url: platega.successUrl,
        failed_url: platega.failedUrl,
        payment_method: platega.paymentMethod,
        merchant_id_tail: platega.merchantId ? '…' + platega.merchantId.slice(-6) : '',
      },
      updated_at: row.updated_at,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT — сохранение
router.put('/', async (req, res) => {
  try {
    await loadRow()
    const b = req.body || {}
    const sets = [], vals = []
    let i = 1
    const put = (col, val) => { sets.push(`${col} = $${i++}`); vals.push(val) }

    if ('enabled' in b) put('platega_enabled', !!b.enabled)
    if ('merchant_id' in b) put('platega_merchant_id', String(b.merchant_id || '').trim() || null)
    if ('payment_method' in b) put('platega_payment_method', parseInt(b.payment_method, 10) || 2)
    if ('api_url' in b) put('platega_api_url', String(b.api_url || '').trim() || null)
    if ('success_url' in b) put('success_url', String(b.success_url || '').trim() || null)
    if ('failed_url' in b) put('failed_url', String(b.failed_url || '').trim() || null)
    // Секрет: '' = не менять, null = стереть, строка = зашифровать
    if ('secret' in b && b.secret !== '') {
      put('platega_secret', b.secret === null ? null : encrypt(String(b.secret).trim()))
    }

    if (!sets.length) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()', `updated_by = $${i++}`)
    vals.push(req.userId || null)

    await db.query(`UPDATE payment_settings SET ${sets.join(', ')} WHERE id = 1`, vals)
    paymentSettings.invalidate()   // применяем сразу, без перезапуска backend

    audit.write(req, 'payments.settings.update', { type: 'payment_settings', id: 1 },
      { fields: Object.keys(b).filter(k => k !== 'secret'), secret_changed: 'secret' in b && b.secret !== '' }).catch(() => {})

    const { platega } = await paymentSettings.get({ force: true })
    res.json({ ok: true, configured: platega.configured, source: platega.source })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /test — проверка ключей боевым запросом к Platega на минимальную сумму.
// Транзакция создаётся в статусе PENDING и не оплачивается — денег не списывает.
router.post('/test', async (req, res) => {
  try {
    const { platega } = await paymentSettings.get({ force: true })
    if (!platega.configured) return res.json({ ok: false, error: 'Merchant ID и Secret не заданы' })

    const { createPayment } = require('../services/platega')
    const r = await createPayment(10, 'RUB', 'Проверка настроек платёжной системы', 'settings-test')
    res.json({
      ok: true,
      transaction_id: r.transactionId,
      status: r.status,
      message: 'Ключи рабочие: тестовая транзакция создана (не оплачена, деньги не списаны).',
    })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

module.exports = router
