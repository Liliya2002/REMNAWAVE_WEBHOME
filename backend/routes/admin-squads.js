const express = require('express')
const router = express.Router()
const pool = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')
const { getInternalSquads } = require('../services/remnwave')

// Все маршруты требуют авторизации + админ
router.use(verifyToken, verifyAdmin)

/**
 * POST /api/admin/squads/sync
 * Синхронизировать сквады из RemnaWave в локальную БД
 * Новые сквады добавляются, существующие обновляются (tag, counts)
 * display_name НЕ перезаписывается при синхронизации
 */
router.post('/sync', async (req, res) => {
  try {
    const remoteSquads = await getInternalSquads()

    if (!Array.isArray(remoteSquads) || remoteSquads.length === 0) {
      return res.status(502).json({ error: 'Не удалось получить сквады из RemnaWave' })
    }

    let created = 0
    let updated = 0

    for (const squad of remoteSquads) {
      const tag = squad.tag || squad.name || 'Без имени'
      const inboundsCount = squad.inboundsCount ?? 0
      const nodesCount = squad.nodesCount ?? 0

      const existing = await pool.query('SELECT id FROM squads WHERE uuid = $1', [squad.uuid])

      if (existing.rows.length === 0) {
        // Новый сквад — создаём с display_name = tag
        await pool.query(
          `INSERT INTO squads (uuid, tag, display_name, inbounds_count, nodes_count, synced_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [squad.uuid, tag, tag, inboundsCount, nodesCount]
        )
        created++
      } else {
        // Существующий — обновляем tag и counts, НЕ трогаем display_name
        await pool.query(
          `UPDATE squads SET tag = $1, inbounds_count = $2, nodes_count = $3, synced_at = NOW(), updated_at = NOW()
           WHERE uuid = $4`,
          [tag, inboundsCount, nodesCount, squad.uuid]
        )
        updated++
      }
    }

    console.log(`[Squads] Synced from RemnaWave: ${created} created, ${updated} updated`)

    // Возвращаем обновлённый список
    const result = await pool.query('SELECT * FROM squads ORDER BY display_name ASC')

    res.json({
      success: true,
      created,
      updated,
      total: result.rows.length,
      squads: result.rows
    })
  } catch (err) {
    console.error('[Squads] Sync error:', err.message)
    res.status(500).json({ error: 'Ошибка синхронизации сквадов' })
  }
})

/**
 * GET /api/admin/squads
 * Получить все сквады из локальной БД
 * Включает информацию о привязанных тарифах
 */
router.get('/', async (req, res) => {
  try {
    const squadsResult = await pool.query('SELECT * FROM squads ORDER BY display_name ASC')
    const plansResult = await pool.query('SELECT id, name, squad_uuids, is_active FROM plans ORDER BY name ASC')

    // Маппим: для каждого сквада — список тарифов, которые его используют
    const squads = squadsResult.rows.map(squad => {
      const linkedPlans = plansResult.rows
        .filter(plan => (plan.squad_uuids || []).includes(squad.uuid))
        .map(plan => ({ id: plan.id, name: plan.name, is_active: plan.is_active }))

      return {
        ...squad,
        linked_plans: linkedPlans
      }
    })

    res.json({ squads })
  } catch (err) {
    console.error('[Squads] Error fetching squads:', err.message)
    res.status(500).json({ error: 'Ошибка получения сквадов' })
  }
})

/**
 * PATCH /api/admin/squads/:id
 * Обновить display_name сквада (только локально, НЕ в RemnaWave)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { display_name } = req.body

    if (!display_name || !display_name.trim()) {
      return res.status(400).json({ error: 'Укажите название сервера' })
    }

    if (display_name.length > 100) {
      return res.status(400).json({ error: 'Название слишком длинное (макс. 100)' })
    }

    const result = await pool.query(
      `UPDATE squads SET display_name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [display_name.trim(), id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сквад не найден' })
    }

    console.log(`[Squads] Renamed squad ${id} to "${display_name.trim()}"`)
    res.json({ success: true, squad: result.rows[0] })
  } catch (err) {
    console.error('[Squads] Error updating squad:', err.message)
    res.status(500).json({ error: 'Ошибка обновления сквада' })
  }
})

/**
 * GET /api/admin/squads/:id/users
 * Получить количество пользователей с подписками, привязанными к данному сквадуu
 */
router.get('/:id/users', async (req, res) => {
  try {
    const { id } = req.params

    // Получаем UUID сквада
    const squadResult = await pool.query('SELECT uuid FROM squads WHERE id = $1', [id])
    if (squadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Сквад не найден' })
    }

    const squadUuid = squadResult.rows[0].uuid

    // Считаем пользователей с активными подписками на этот сквад
    const usersResult = await pool.query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE s.is_active = true) as active
       FROM subscriptions s
       WHERE s.squad_uuid = $1`,
      [squadUuid]
    )

    res.json({
      total: parseInt(usersResult.rows[0].total) || 0,
      active: parseInt(usersResult.rows[0].active) || 0
    })
  } catch (err) {
    console.error('[Squads] Error fetching users:', err.message)
    res.status(500).json({ error: 'Ошибка получения пользователей' })
  }
})

module.exports = router
