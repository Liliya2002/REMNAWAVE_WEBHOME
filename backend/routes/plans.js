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
      ? 'SELECT * FROM plans ORDER BY is_trial DESC, price_monthly ASC NULLS FIRST'
      : 'SELECT * FROM plans WHERE is_active = true ORDER BY is_trial DESC, price_monthly ASC NULLS FIRST'
    
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
      features
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
       price_yearly, squad_uuids, features, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
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
        features || []
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
      features,
      is_active
    } = req.body
    
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
       is_active = COALESCE($10, is_active)
       WHERE id = $11
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
        id
      ]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Тариф не найден' })
    }
    
    console.log(`[Plans] Updated plan: ${id}`)
    res.json({ success: true, plan: result.rows[0] })
  } catch (err) {
    console.error('[Plans] Error updating plan:', err)
    res.status(500).json({ error: 'Ошибка обновления тарифа' })
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

module.exports = router
