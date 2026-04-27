const express = require('express')
const db = require('../db')
const { verifyToken, verifyAdmin } = require('../middleware')
const maint = require('../services/maintenance')

const router = express.Router()

let settingsSchemaEnsured = false

async function ensureSettingsSchema() {
  if (settingsSchemaEnsured) return

  await db.query(`
    CREATE TABLE IF NOT EXISTS site_config (
      id SERIAL PRIMARY KEY,
      active_template_id INTEGER REFERENCES site_templates(id),
      site_title VARCHAR(255) DEFAULT 'VPN Webhome',
      site_description TEXT,
      site_logo_url VARCHAR(512),
      site_favicon_url VARCHAR(512),
      color_primary VARCHAR(20) DEFAULT '#3b82f6',
      color_secondary VARCHAR(20) DEFAULT '#06b6d4',
      color_accent VARCHAR(20) DEFAULT '#f59e0b',
      color_danger VARCHAR(20) DEFAULT '#ef4444',
      color_success VARCHAR(20) DEFAULT '#10b981',
      font_family VARCHAR(128) DEFAULT 'Inter, sans-serif',
      font_size_base VARCHAR(32) DEFAULT '16px',
      layout_width VARCHAR(64) DEFAULT '1280px',
      navbar_fixed BOOLEAN DEFAULT true,
      social_twitter VARCHAR(256),
      social_github VARCHAR(256),
      social_discord VARCHAR(256),
      social_telegram VARCHAR(256),
      google_analytics_id VARCHAR(128),
      custom_css TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS project_tagline VARCHAR(255)`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS support_email VARCHAR(255)`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS support_telegram VARCHAR(255)`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) DEFAULT 'RUB'`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'Europe/Moscow'`)

  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS enable_registration BOOLEAN DEFAULT true`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS enable_payments BOOLEAN DEFAULT true`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS enable_referrals BOOLEAN DEFAULT true`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS enable_notifications BOOLEAN DEFAULT true`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS allow_trial_plan BOOLEAN DEFAULT true`)

  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT false`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS maintenance_message TEXT DEFAULT 'Ведутся технические работы'`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS require_email_confirmation BOOLEAN DEFAULT false`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS session_timeout_minutes INTEGER DEFAULT 1440`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS max_login_attempts INTEGER DEFAULT 5`)

  // Remnwave API
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS remnwave_api_url VARCHAR(512)`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS remnwave_api_token TEXT`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS remnwave_secret_key VARCHAR(256)`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(256)`)
  await db.query(`ALTER TABLE site_config ADD COLUMN IF NOT EXISTS verify_webhooks BOOLEAN DEFAULT false`)

  await db.query(`
    INSERT INTO site_config (site_title)
    SELECT 'VPN Webhome'
    WHERE NOT EXISTS (SELECT 1 FROM site_config)
  `)

  settingsSchemaEnsured = true
}

// ============================================
// TEMPLATES ENDPOINTS
// ============================================

/**
 * GET /api/admin/templates
 * Получить список всех шаблонов
 */
router.get('/templates', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, is_active, is_default, created_at, updated_at
       FROM site_templates
       ORDER BY is_active DESC, is_default DESC, created_at DESC`
    )
    res.json({ templates: result.rows })
  } catch (err) {
    console.error('Error fetching templates:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * GET /api/admin/templates/:id
 * Получить полный шаблон с контентом
 */
router.get('/templates/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const result = await db.query(
      `SELECT id, name, description, html_content, css_content, config_data, is_active, is_default
       FROM site_templates WHERE id = $1`,
      [id]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' })
    }
    
    res.json({ template: result.rows[0] })
  } catch (err) {
    console.error('Error fetching template:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * POST /api/admin/templates
 * Создать новый шаблон
 */
router.post('/templates', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { name, description, html_content, css_content, config_data } = req.body
    
    if (!name || !html_content) {
      return res.status(400).json({ error: 'Name and html_content required' })
    }
    
    const result = await db.query(
      `INSERT INTO site_templates (name, description, html_content, css_content, config_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, is_active`,
      [name, description || '', html_content, css_content || '', config_data || {}, req.userId]
    )
    
    // Логируем в историю
    await db.query(
      `INSERT INTO config_history (changed_by, template_id, action, changes)
       VALUES ($1, $2, 'created', $3)`,
      [req.userId, result.rows[0].id, { name, description }]
    )
    
    res.status(201).json({ template: result.rows[0], message: 'Template created' })
  } catch (err) {
    console.error('Error creating template:', err)
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Template with this name already exists' })
    }
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * PUT /api/admin/templates/:id
 * Обновить шаблон
 */
router.put('/templates/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, html_content, css_content, config_data } = req.body
    
    // Проверяем существование
    const checkResult = await db.query(
      'SELECT id FROM site_templates WHERE id = $1',
      [id]
    )
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' })
    }
    
    const result = await db.query(
      `UPDATE site_templates 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           html_content = COALESCE($3, html_content),
           css_content = COALESCE($4, css_content),
           config_data = COALESCE($5, config_data),
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, is_active`,
      [name, description, html_content, css_content, config_data ? JSON.stringify(config_data) : null, id]
    )
    
    // Логируем в историю
    await db.query(
      `INSERT INTO config_history (changed_by, template_id, action, changes)
       VALUES ($1, $2, 'updated', $3)`,
      [req.userId, id, { name, description, html_content: !!html_content, css_content: !!css_content }]
    )
    
    res.json({ template: result.rows[0], message: 'Template updated' })
  } catch (err) {
    console.error('Error updating template:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * PUT /api/admin/templates/:id/activate
 * Активировать шаблон (сделать его активным)
 */
router.put('/templates/:id/activate', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params
    
    // Отключаем все остальные шаблоны
    await db.query('UPDATE site_templates SET is_active = false')
    
    // Активируем этот шаблон
    const result = await db.query(
      `UPDATE site_templates 
       SET is_active = true, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, is_active`,
      [id]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' })
    }
    
    // Обновляем активный шаблон в конфигурации
    await db.query('UPDATE site_config SET active_template_id = $1', [id])
    
    // Логируем в историю
    await db.query(
      `INSERT INTO config_history (changed_by, template_id, action, changes)
       VALUES ($1, $2, 'activated', $3)`,
      [req.userId, id, { activated: true }]
    )
    
    res.json({ template: result.rows[0], message: 'Template activated' })
  } catch (err) {
    console.error('Error activating template:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * DELETE /api/admin/templates/:id
 * Удалить шаблон
 */
router.delete('/templates/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params
    
    // Проверяем что это не активный и не default шаблон
    const checkResult = await db.query(
      'SELECT is_active, is_default FROM site_templates WHERE id = $1',
      [id]
    )
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' })
    }
    
    if (checkResult.rows[0].is_active) {
      return res.status(400).json({ error: 'Cannot delete active template' })
    }
    
    if (checkResult.rows[0].is_default) {
      return res.status(400).json({ error: 'Cannot delete default template' })
    }
    
    await db.query('DELETE FROM site_templates WHERE id = $1', [id])
    
    // Логируем в историю
    await db.query(
      `INSERT INTO config_history (changed_by, template_id, action, changes)
       VALUES ($1, $2, 'deleted', $3)`,
      [req.userId, id, { deleted: true }]
    )
    
    res.json({ message: 'Template deleted' })
  } catch (err) {
    console.error('Error deleting template:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

// ============================================
// SITE CONFIG ENDPOINTS
// ============================================

/**
 * GET /api/admin/config
 * Получить конфигурацию сайта
 */
router.get('/config', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await ensureSettingsSchema()

    const result = await db.query(
      `SELECT id, active_template_id, site_title, site_description, site_logo_url, 
              site_favicon_url, color_primary, color_secondary, color_accent, 
              color_danger, color_success, font_family, font_size_base,
              layout_width, navbar_fixed, social_twitter, social_github,
              social_discord, social_telegram, google_analytics_id, custom_css,
              project_tagline, support_email, support_telegram, default_currency,
              timezone, enable_registration, enable_payments, enable_referrals,
              enable_notifications, allow_trial_plan, maintenance_mode,
              maintenance_message, require_email_confirmation,
              session_timeout_minutes, max_login_attempts,
              remnwave_api_url, remnwave_api_token, remnwave_secret_key,
              webhook_secret, verify_webhooks
       FROM site_config LIMIT 1`
    )
    
    let config = result.rows[0] || {}
    
    // Подставляем значения из .env если в БД пусто
    if (!config.remnwave_api_url) config.remnwave_api_url = process.env.REMNWAVE_API_URL || ''
    if (!config.remnwave_api_token) config.remnwave_api_token = process.env.REMNWAVE_API_TOKEN || ''
    if (!config.remnwave_secret_key) config.remnwave_secret_key = process.env.REMNWAVE_SECRET_KEY || ''
    if (!config.webhook_secret) config.webhook_secret = process.env.WEBHOOK_SECRET || ''
    if (config.verify_webhooks == null) config.verify_webhooks = process.env.VERIFY_WEBHOOKS !== 'false'

    // Получаем активный шаблон
    if (config.active_template_id) {
      const templateResult = await db.query(
        'SELECT id, name FROM site_templates WHERE id = $1',
        [config.active_template_id]
      )
      config.active_template = templateResult.rows[0] || null
    }
    
    res.json({ config })
  } catch (err) {
    console.error('Error fetching config:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * PUT /api/admin/config
 * Обновить конфигурацию сайта (только админ)
 */
router.put('/config', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await ensureSettingsSchema()

    const {
      site_title, site_description, site_logo_url, site_favicon_url,
      color_primary, color_secondary, color_accent, color_danger, color_success,
      font_family, font_size_base, layout_width, navbar_fixed,
      social_twitter, social_github, social_discord, social_telegram,
      google_analytics_id, custom_css,
      project_tagline, support_email, support_telegram, default_currency,
      timezone, enable_registration, enable_payments, enable_referrals,
      enable_notifications, allow_trial_plan, maintenance_mode,
      maintenance_message, require_email_confirmation,
      session_timeout_minutes, max_login_attempts,
      remnwave_api_url, remnwave_api_token, remnwave_secret_key,
      webhook_secret, verify_webhooks
    } = req.body
    
    const result = await db.query(
      `UPDATE site_config
       SET site_title = COALESCE($1, site_title),
           site_description = COALESCE($2, site_description),
           site_logo_url = COALESCE($3, site_logo_url),
           site_favicon_url = COALESCE($4, site_favicon_url),
           color_primary = COALESCE($5, color_primary),
           color_secondary = COALESCE($6, color_secondary),
           color_accent = COALESCE($7, color_accent),
           color_danger = COALESCE($8, color_danger),
           color_success = COALESCE($9, color_success),
           font_family = COALESCE($10, font_family),
           font_size_base = COALESCE($11, font_size_base),
           layout_width = COALESCE($12, layout_width),
           navbar_fixed = COALESCE($13, navbar_fixed),
           social_twitter = COALESCE($14, social_twitter),
           social_github = COALESCE($15, social_github),
           social_discord = COALESCE($16, social_discord),
           social_telegram = COALESCE($17, social_telegram),
           google_analytics_id = COALESCE($18, google_analytics_id),
           custom_css = COALESCE($19, custom_css),
           project_tagline = COALESCE($20, project_tagline),
           support_email = COALESCE($21, support_email),
           support_telegram = COALESCE($22, support_telegram),
           default_currency = COALESCE($23, default_currency),
           timezone = COALESCE($24, timezone),
           enable_registration = COALESCE($25, enable_registration),
           enable_payments = COALESCE($26, enable_payments),
           enable_referrals = COALESCE($27, enable_referrals),
           enable_notifications = COALESCE($28, enable_notifications),
           allow_trial_plan = COALESCE($29, allow_trial_plan),
           maintenance_mode = COALESCE($30, maintenance_mode),
           maintenance_message = COALESCE($31, maintenance_message),
           require_email_confirmation = COALESCE($32, require_email_confirmation),
           session_timeout_minutes = COALESCE($33, session_timeout_minutes),
           max_login_attempts = COALESCE($34, max_login_attempts),
           remnwave_api_url = COALESCE($35, remnwave_api_url),
           remnwave_api_token = COALESCE($36, remnwave_api_token),
           remnwave_secret_key = COALESCE($37, remnwave_secret_key),
           webhook_secret = COALESCE($38, webhook_secret),
           verify_webhooks = COALESCE($39, verify_webhooks),
           updated_at = NOW()
       WHERE id = (SELECT id FROM site_config LIMIT 1)
       RETURNING *`,
      [
        site_title, site_description, site_logo_url, site_favicon_url,
        color_primary, color_secondary, color_accent, color_danger, color_success,
        font_family, font_size_base, layout_width, navbar_fixed,
        social_twitter, social_github, social_discord, social_telegram,
        google_analytics_id, custom_css,
        project_tagline, support_email, support_telegram, default_currency,
        timezone, enable_registration, enable_payments, enable_referrals,
        enable_notifications, allow_trial_plan, maintenance_mode,
        maintenance_message, require_email_confirmation,
        session_timeout_minutes, max_login_attempts,
        remnwave_api_url, remnwave_api_token, remnwave_secret_key,
        webhook_secret, verify_webhooks
      ]
    )
    
    // Логируем в историю
    await db.query(
      `INSERT INTO config_history (changed_by, action, changes)
       VALUES ($1, 'updated', $2)`,
      [req.userId, {
        site_title,
        color_primary,
        layout_width,
        maintenance_mode,
        enable_registration,
        enable_payments,
        support_telegram,
        default_currency
      }]
    )
    
    // Сбрасываем кеш Remnwave при изменении настроек
    const remnwave = require('../services/remnwave')
    if (typeof remnwave.invalidateConfigCache === 'function') {
      remnwave.invalidateConfigCache()
    }

    // Сбрасываем кеш maintenance — изменение применится сразу, не через 30с
    maint.invalidate()

    res.json({ config: result.rows[0], message: 'Configuration updated' })
  } catch (err) {
    console.error('Error updating config:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * POST /api/admin/test-remnwave
 * Проверить подключение к Remnwave API
 */
router.post('/test-remnwave', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { api_url, api_token } = req.body
    if (!api_url || !api_token) {
      return res.status(400).json({ error: 'API URL и API Token обязательны' })
    }

    const testRes = await fetch(`${api_url}/api/nodes`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${api_token}`,
        'X-Api-Key': api_token
      }
    })
    const data = await testRes.json()

    if (!testRes.ok) {
      return res.status(400).json({ error: `Ошибка API: ${testRes.status} ${data.message || ''}` })
    }

    const nodes = data.response?.nodes || data.nodes || data || []
    res.json({ ok: true, nodesCount: Array.isArray(nodes) ? nodes.length : 0 })
  } catch (err) {
    res.status(500).json({ error: `Не удалось подключиться: ${err.message}` })
  }
})

/**
 * GET /api/config
 * Получить публичную конфигурацию (для фронтенда)
 */
router.get('/public/config', async (req, res) => {
  try {
    await ensureSettingsSchema()

    const configResult = await db.query(
      `SELECT site_title, site_description, site_logo_url, site_favicon_url,
              color_primary, color_secondary, color_accent, color_danger, color_success,
              font_family, font_size_base, layout_width, navbar_fixed,
              social_twitter, social_github, social_discord, social_telegram,
              google_analytics_id, custom_css, active_template_id,
              project_tagline, support_email, support_telegram, default_currency,
              timezone, enable_registration, enable_payments, enable_referrals,
              enable_notifications, allow_trial_plan, maintenance_mode,
              maintenance_message, require_email_confirmation,
              session_timeout_minutes, max_login_attempts
       FROM site_config LIMIT 1`
    )
    
    let config = configResult.rows[0] || {}
    
    // Получаем активный шаблон
    if (config.active_template_id) {
      const templateResult = await db.query(
        'SELECT id, name, html_content, css_content, config_data FROM site_templates WHERE id = $1 AND is_active = true',
        [config.active_template_id]
      )
      config.active_template = templateResult.rows[0] || null
    }
    
    res.json({ config })
  } catch (err) {
    console.error('Error fetching public config:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

/**
 * GET /api/admin/settings/history
 * История изменений настроек проекта
 */
router.get('/settings/history', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ch.id, ch.action, ch.changes, ch.created_at,
              u.id as user_id, u.login as changed_by_login
       FROM config_history ch
       LEFT JOIN users u ON u.id = ch.changed_by
       ORDER BY ch.created_at DESC
       LIMIT 100`
    )

    res.json({ history: result.rows })
  } catch (err) {
    console.error('Error fetching settings history:', err)
    res.status(500).json({ error: 'Database error' })
  }
})

module.exports = router
