const express = require('express')
const router = express.Router()
const pool = require('../db')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin, JWT_SECRET } = require('../middleware')

/**
 * GET /api/plans
 * Получить все тарифы (активные для обычных пользователей, все для админов)
 */
router.get('/', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1]
    let isAdmin = false
    
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET)
        isAdmin = decoded.is_admin || false
      } catch (e) {
        // Невалидный токен, продолжаем как гость
      }
    }
    
    const query = isAdmin
      ? 'SELECT * FROM plans ORDER BY is_trial DESC, tier ASC, sort_order ASC, price_monthly ASC NULLS FIRST'
      : 'SELECT * FROM plans WHERE is_active = true ORDER BY is_trial DESC, tier ASC, sort_order ASC, price_monthly ASC NULLS FIRST'
    
    const result = await pool.query(query)
    res.json({ plans: result.rows })
  } catch (err) {
    console.error('[Plans] Error fetching plans:', err)
    res.status(500).json({ error: 'Ошибка получения тарифов' })
  }
})

/**
 * GET /api/plans/:id
 * Получить конкретный тариф
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query('SELECT * FROM plans WHERE id = $1', [id])
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Тариф не найден' })
    }
    
    res.json({ plan: result.rows[0] })
  } catch (err) {
    console.error('[Plans] Error fetching plan:', err)
    res.status(500).json({ error: 'Ошибка получения тарифа' })
  }
})

/**
 * POST /api/plans
 * Создать новый тариф (только админ)
 */
router.post('/', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      is_trial,
      traffic_gb,
      price_monthly,
      price_quarterly,
      price_yearly,
      squad_uuids,
      hwid_device_limit,
      features,
      tier,
      tier_label,
      sort_order,
      color,
    } = req.body

    if (!name || traffic_gb === undefined) {
      return res.status(400).json({ error: 'Укажите название и трафик' })
    }
    if (name.length > 100) {
      return res.status(400).json({ error: 'Название тарифа слишком длинное (макс. 100)' })
    }
    if (description && description.length > 500) {
      return res.status(400).json({ error: 'Описание тарифа слишком длинное (макс. 500)' })
    }

    if (!is_trial && !price_monthly && !price_quarterly && !price_yearly) {
      return res.status(400).json({ error: 'Укажите хотя бы одну цену для платного тарифа' })
    }

    const result = await pool.query(
      `INSERT INTO plans (name, description, is_trial, traffic_gb, price_monthly, price_quarterly,
       price_yearly, squad_uuids, features, is_active, tier, tier_label, sort_order, color,
       hwid_device_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        name,
        description || null,
        is_trial || false,
        traffic_gb,
        price_monthly || null,
        price_quarterly || null,
        price_yearly || null,
        squad_uuids || [],
        features || [],
        Number.isFinite(Number(tier)) ? Number(tier) : 0,
        tier_label || null,
        Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0,
        color || null,
        hwid_device_limit != null && hwid_device_limit !== '' ? Number(hwid_device_limit) : null,
      ]
    )
    
    console.log(`[Plans] Created plan: ${name}`)
    res.json({ success: true, plan: result.rows[0] })
  } catch (err) {
    console.error('[Plans] Error creating plan:', err)
    res.status(500).json({ error: 'Ошибка создания тарифа' })
  }
})

/**
 * PUT /api/plans/:id
 * Обновить тариф (только админ)
 */
router.put('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const {
      name,
      description,
      is_trial,
      traffic_gb,
      price_monthly,
      price_quarterly,
      price_yearly,
      squad_uuids,
      hwid_device_limit,
      features,
      is_active,
      tier,
      tier_label,
      sort_order,
      color,
    } = req.body

    // Сохраняем старое состояние для diff (определить нужен ли RemnaWave sync)
    const oldQ = await pool.query('SELECT squad_uuids, traffic_gb, hwid_device_limit FROM plans WHERE id=$1', [id])
    const oldPlan = oldQ.rows[0] || null

    const result = await pool.query(
      `UPDATE plans SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       is_trial = COALESCE($3, is_trial),
       traffic_gb = COALESCE($4, traffic_gb),
       price_monthly = $5,
       price_quarterly = $6,
       price_yearly = $7,
       squad_uuids = COALESCE($8, squad_uuids),
       features = COALESCE($9, features),
       is_active = COALESCE($10, is_active),
       tier = COALESCE($11, tier),
       tier_label = COALESCE($12, tier_label),
       sort_order = COALESCE($13, sort_order),
       color = COALESCE($14, color),
       hwid_device_limit = CASE WHEN $16::boolean THEN $15::int ELSE hwid_device_limit END
       WHERE id = $17
       RETURNING *`,
      [
        name,
        description,
        is_trial,
        traffic_gb,
        price_monthly,
        price_quarterly,
        price_yearly,
        squad_uuids,
        features,
        is_active,
        tier !== undefined ? Number(tier) : null,
        tier_label,
        sort_order !== undefined ? Number(sort_order) : null,
        color,
        // hwid: значение для записи (null или число)
        hwid_device_limit === null || hwid_device_limit === '' ? null
          : hwid_device_limit !== undefined ? Number(hwid_device_limit) : null,
        // hwid: флаг — было ли поле в body (если нет — UPDATE сохраняет существующее)
        hwid_device_limit !== undefined,
        id
      ]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Тариф не найден' })
    }

    const updatedPlan = result.rows[0]
    console.log(`[Plans] Updated plan: ${id}`)

    // Если изменились squad_uuids или traffic_gb — синхронизируем активные подписки
    // с RemnaWave. Делаем fire-and-forget, чтобы не блокировать ответ.
    let syncTriggered = false
    try {
      const planSync = require('../services/planSync')
      if (planSync.needsSync(oldPlan, updatedPlan)) {
        syncTriggered = true
        // Не await — пусть выполняется в фоне
        planSync.syncPlanToSubscriptions(parseInt(id, 10))
          .then(r => console.log(`[Plans] Sync to RemnaWave done: ${JSON.stringify(r)}`))
          .catch(err => console.error('[Plans] Sync failed:', err.message))
      }
    } catch (e) {
      console.error('[Plans] Sync trigger failed:', e.message)
    }

    res.json({ success: true, plan: updatedPlan, remnawaveSyncTriggered: syncTriggered })
  } catch (err) {
    console.error('[Plans] Error updating plan:', err)
    res.status(500).json({ error: 'Ошибка обновления тарифа' })
  }
})

/**
 * POST /api/plans/:id/resync-subscriptions
 * Ручной trigger пересинхронизации всех подписок этого плана с RemnaWave.
 * Полезно если автоsync упал или хочется применить силой.
 */
router.post('/:id/resync-subscriptions', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const planSync = require('../services/planSync')
    const result = await planSync.syncPlanToSubscriptions(parseInt(req.params.id, 10))
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[Plans] Resync error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/plans/:id
 * Удалить тариф (только админ)
 */
router.delete('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params
    
    const result = await pool.query('DELETE FROM plans WHERE id = $1 RETURNING *', [id])
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Тариф не найден' })
    }
    
    console.log(`[Plans] Deleted plan: ${id}`)
    res.json({ success: true, plan: result.rows[0] })
  } catch (err) {
    console.error('[Plans] Error deleting plan:', err)
    res.status(500).json({ error: 'Ошибка удаления тарифа' })
  }
})

/**
 * POST /api/plans/:id/toggle
 * Активировать/деактивировать тариф (только админ)
 */
router.post('/:id/toggle', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params
    
    const result = await pool.query(
      'UPDATE plans SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [id]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Тариф не найден' })
    }
    
    const plan = result.rows[0]
    console.log(`[Plans] Toggled plan ${id}: ${plan.is_active ? 'activated' : 'deactivated'}`)
    res.json({ success: true, plan })
  } catch (err) {
    console.error('[Plans] Error toggling plan:', err)
    res.status(500).json({ error: 'Ошибка переключения статуса тарифа' })
  }
})

/**
 * POST /api/plans/reorder
 * Bulk-обновление tier/sort_order для drag-and-drop в админке.
 * body: { items: [{ id, tier, sort_order }, ...] }
 */
router.post('/reorder', verifyToken, verifyAdmin, async (req, res) => {
  const { items } = req.body || {}
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items[] is required' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const it of items) {
      if (!it.id) continue
      await client.query(
        'UPDATE plans SET tier = COALESCE($1, tier), sort_order = COALESCE($2, sort_order) WHERE id = $3',
        [
          Number.isFinite(Number(it.tier)) ? Number(it.tier) : null,
          Number.isFinite(Number(it.sort_order)) ? Number(it.sort_order) : null,
          Number(it.id),
        ]
      )
    }
    await client.query('COMMIT')
    res.json({ success: true, updated: items.length })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[Plans] reorder error:', err)
    res.status(500).json({ error: 'Ошибка переупорядочивания' })
  } finally {
    client.release()
  }
})

/**
 * GET /api/plans/:id/squad-limits
 * Возвращает per-squad лимиты для плана
 */
router.get('/:id/squad-limits', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM plan_squad_limits WHERE plan_id=$1 ORDER BY id', [req.params.id])
    res.json({ items: r.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * PUT /api/plans/:id/squad-limits
 * Bulk-обновление лимитов: body = { items: [{squad_uuid, limit_gb, topup_enabled, topup_price_per_gb}] }
 * Записи которых нет в items — удаляются.
 */
router.put('/:id/squad-limits', verifyToken, verifyAdmin, async (req, res) => {
  const planId = parseInt(req.params.id, 10)
  const { items } = req.body || {}
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items[] required' })

  const client = await pool.pool.connect()
  try {
    await client.query('BEGIN')
    const keepUuids = items.map(it => it.squad_uuid).filter(Boolean)
    // Удаляем те что не в items
    if (keepUuids.length > 0) {
      await client.query(
        `DELETE FROM plan_squad_limits WHERE plan_id=$1 AND squad_uuid <> ALL($2::text[])`,
        [planId, keepUuids]
      )
    } else {
      await client.query('DELETE FROM plan_squad_limits WHERE plan_id=$1', [planId])
    }
    // Upsert
    for (const it of items) {
      if (!it.squad_uuid) continue
      await client.query(
        `INSERT INTO plan_squad_limits (plan_id, squad_uuid, limit_gb, topup_enabled, topup_price_per_gb)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (plan_id, squad_uuid) DO UPDATE SET
           limit_gb           = EXCLUDED.limit_gb,
           topup_enabled      = EXCLUDED.topup_enabled,
           topup_price_per_gb = EXCLUDED.topup_price_per_gb,
           updated_at         = NOW()`,
        [
          planId,
          it.squad_uuid,
          Number(it.limit_gb || 0),
          it.topup_enabled !== false,
          it.topup_price_per_gb != null && it.topup_price_per_gb !== '' ? Number(it.topup_price_per_gb) : null,
        ]
      )
    }
    await client.query('COMMIT')
    const r = await pool.query('SELECT * FROM plan_squad_limits WHERE plan_id=$1 ORDER BY id', [planId])
    res.json({ items: r.rows })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

module.exports = router
