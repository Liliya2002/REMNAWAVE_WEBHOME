/**
 * Справочник хостинг-провайдеров VPS (Настройки → VPS → Провайдеры).
 *
 * Список раньше был захардкожен во фронте. Здесь он редактируется, а также
 * хранятся ссылки на сайт и личный кабинет провайдера — чтобы при продлении не
 * искать их вручную.
 *
 * Связь с vps_servers строковая (hosting_provider), поэтому удаление провайдера
 * не ломает серверы — но мы предупреждаем, сколько их привязано, и предлагаем
 * деактивацию вместо удаления.
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

const norm = v => { const s = String(v ?? '').trim(); return s || null }

// Приводим ссылку к виду с протоколом: админ обычно вводит «selectel.ru».
function normUrl(v) {
  const s = norm(v)
  if (!s) return null
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

// GET / — список со счётчиком привязанных серверов
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.*,
             (SELECT COUNT(*)::int FROM vps_servers v WHERE v.hosting_provider = p.name) AS servers_count
        FROM vps_providers p
       ORDER BY p.sort_order, p.name`)
    res.json({ providers: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { name, website_url, panel_url, notes, sort_order } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Название обязательно' })
    const { rows } = await db.query(
      `INSERT INTO vps_providers (name, website_url, panel_url, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [String(name).trim(), normUrl(website_url), normUrl(panel_url), norm(notes),
       Number.isFinite(+sort_order) ? +sort_order : 100]
    )
    audit.write(req, 'vps.provider.create', { type: 'vps_provider', id: rows[0].id }, { name }).catch(() => {})
    res.status(201).json({ provider: rows[0] })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Провайдер с таким названием уже есть' })
    res.status(500).json({ error: e.message })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {}
    const sets = [], vals = []
    let i = 1
    const put = (col, val) => { sets.push(`${col} = $${i++}`); vals.push(val) }

    // Переименование тянет за собой серверы — иначе они «отвяжутся» от справочника.
    let rename = null
    if ('name' in b) {
      const newName = String(b.name || '').trim()
      if (!newName) return res.status(400).json({ error: 'Название не может быть пустым' })
      const cur = await db.query('SELECT name FROM vps_providers WHERE id = $1', [req.params.id])
      if (!cur.rows.length) return res.status(404).json({ error: 'Провайдер не найден' })
      if (cur.rows[0].name !== newName) rename = { from: cur.rows[0].name, to: newName }
      put('name', newName)
    }
    if ('website_url' in b) put('website_url', normUrl(b.website_url))
    if ('panel_url' in b) put('panel_url', normUrl(b.panel_url))
    if ('notes' in b) put('notes', norm(b.notes))
    if ('is_active' in b) put('is_active', !!b.is_active)
    if ('sort_order' in b) put('sort_order', Number.isFinite(+b.sort_order) ? +b.sort_order : 100)

    if (!sets.length) return res.status(400).json({ error: 'Нет полей для обновления' })
    sets.push('updated_at = NOW()')
    vals.push(req.params.id)

    const { rows } = await db.query(
      `UPDATE vps_providers SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals)
    if (!rows.length) return res.status(404).json({ error: 'Провайдер не найден' })

    let movedServers = 0
    if (rename) {
      const r = await db.query('UPDATE vps_servers SET hosting_provider = $1 WHERE hosting_provider = $2',
        [rename.to, rename.from])
      movedServers = r.rowCount
    }
    audit.write(req, 'vps.provider.update', { type: 'vps_provider', id: req.params.id }, { rename, movedServers }).catch(() => {})
    res.json({ provider: rows[0], movedServers })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Провайдер с таким названием уже есть' })
    res.status(500).json({ error: e.message })
  }
})

// DELETE /:id — с защитой: если есть привязанные серверы, требуем ?force=1
router.delete('/:id', async (req, res) => {
  try {
    const cur = await db.query('SELECT name FROM vps_providers WHERE id = $1', [req.params.id])
    if (!cur.rows.length) return res.status(404).json({ error: 'Провайдер не найден' })
    const name = cur.rows[0].name

    const used = await db.query('SELECT COUNT(*)::int AS n FROM vps_servers WHERE hosting_provider = $1', [name])
    const n = used.rows[0].n
    if (n > 0 && req.query.force !== '1') {
      return res.status(409).json({
        error: `К провайдеру привязано серверов: ${n}`,
        servers_count: n,
        hint: 'Лучше отключить провайдера, чем удалять — тогда он пропадёт из выпадающего списка, но серверы сохранят название. Для удаления повторите с ?force=1.',
      })
    }

    await db.query('DELETE FROM vps_providers WHERE id = $1', [req.params.id])
    audit.write(req, 'vps.provider.delete', { type: 'vps_provider', id: req.params.id }, { name, servers_count: n }).catch(() => {})
    res.json({ ok: true, servers_kept: n })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
