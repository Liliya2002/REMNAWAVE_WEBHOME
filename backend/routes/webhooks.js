const express = require('express')
const router = express.Router()
const pool = require('../db')
const crypto = require('crypto')

// Кеш webhook secret (из БД с фоллбеком на .env)
let webhookSecretCache = null
let webhookSecretCacheTime = 0
const WEBHOOK_CONFIG_TTL = 60 * 1000

async function getWebhookSecret() {
  const now = Date.now()
  if (webhookSecretCache !== null && (now - webhookSecretCacheTime) < WEBHOOK_CONFIG_TTL) {
    return webhookSecretCache
  }
  let secret = ''
  try {
    const r = await pool.query('SELECT webhook_secret FROM site_config LIMIT 1')
    const row = r.rows[0]
    if (row && row.webhook_secret) secret = row.webhook_secret
  } catch { /* fallback to env */ }

  if (!secret) secret = process.env.WEBHOOK_SECRET || ''
  webhookSecretCache = secret
  webhookSecretCacheTime = now
  return secret
}

if (!process.env.WEBHOOK_SECRET) {
  console.error('\x1b[31m[SECURITY] WEBHOOK_SECRET не задан в .env (может быть задан в БД через админку).\x1b[0m')
}

/**
 * Верификация webhook подписи.
 * Возвращает true только если секрет задан И подпись совпала.
 */
async function verifyWebhookSignature(req, signature) {
  const secret = await getWebhookSecret()
  if (!secret || !signature) return false

  const payload = JSON.stringify(req.body)
  const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex')

  const sigBuf = Buffer.from(String(signature), 'utf8')
  const hashBuf = Buffer.from(hash, 'utf8')
  if (sigBuf.length !== hashBuf.length) return false

  try {
    return crypto.timingSafeEqual(sigBuf, hashBuf)
  } catch {
    return false
  }
}

/**
 * POST /api/webhooks/remnwave
 * Получение событий от Remnwave Panel
 */
router.post('/remnwave', express.json(), async (req, res) => {
  try {
    const signature = req.headers['x-remnwave-signature']

    // Верификация подписи обязательна. Если WEBHOOK_SECRET не задан
    // или подпись невалидна — отклоняем запрос.
    if (!(await verifyWebhookSignature(req, signature))) {
      console.warn('[Webhook] Invalid or missing signature')
      return res.status(401).json({ error: 'Invalid signature' })
    }
    
    const { event, data } = req.body
    
    console.log(`[Webhook] Received event: ${event}`, data)
    
    // Обработка событий
    switch (event) {
      case 'user.created':
        await handleUserCreated(data)
        break
      
      case 'user.updated':
        await handleUserUpdated(data)
        break
      
      case 'user.traffic_updated':
        await handleTrafficUpdated(data)
        break
      
      case 'user.expired':
        await handleUserExpired(data)
        break
      
      case 'user.disabled':
        await handleUserDisabled(data)
        break
      
      case 'user.enabled':
        await handleUserEnabled(data)
        break
      
      case 'user.deleted':
        await handleUserDeleted(data)
        break
      
      default:
        console.warn(`[Webhook] Unknown event: ${event}`)
    }
    
    // Всегда возвращаем 200 OK чтобы Remnwave знал что webhook получен
    res.json({ success: true, event })
    
  } catch (err) {
    console.error('[Webhook] Error processing webhook:', err)
    res.status(500).json({ success: false, error: 'Internal error' })
  }
})

/**
 * Обработчики событий
 */

async function handleUserCreated(data) {
  console.log('[Webhook] User created:', data.uuid)
  // Пользователь создан в Remnwave
  // Обычно мы сами создаем через API, поэтому просто логируем
}

async function handleUserUpdated(data) {
  console.log('[Webhook] User updated:', data.uuid)
  
  const { uuid, username, expirationDate, trafficLimitBytes, isActive } = data
  
  // Обновляем данные в нашей БД
  await pool.query(
    `UPDATE subscriptions 
     SET expires_at = $1, 
         traffic_limit_gb = $2,
         is_active = $3,
         updated_at = NOW()
     WHERE remnwave_user_uuid = $4`,
    [
      expirationDate ? new Date(expirationDate) : null,
      trafficLimitBytes ? Math.round(trafficLimitBytes / (1024 * 1024 * 1024)) : null,
      isActive !== undefined ? isActive : true,
      uuid
    ]
  )
  
  console.log(`[Webhook] Updated subscription for user ${uuid}`)
}

async function handleTrafficUpdated(data) {
  console.log('[Webhook] Traffic updated:', data.uuid)
  
  const { uuid, usedTrafficBytes, totalTrafficBytes } = data
  
  // Добавляем поля для отслеживания трафика
  await pool.query(
    `UPDATE subscriptions 
     SET traffic_used_gb = $1,
         traffic_limit_gb = $2,
         updated_at = NOW()
     WHERE remnwave_user_uuid = $3`,
    [
      usedTrafficBytes ? Math.round(usedTrafficBytes / (1024 * 1024 * 1024)) : 0,
      totalTrafficBytes ? Math.round(totalTrafficBytes / (1024 * 1024 * 1024)) : null,
      uuid
    ]
  )
  
  console.log(`[Webhook] Updated traffic for user ${uuid}`)
}

async function handleUserExpired(data) {
  console.log('[Webhook] User expired:', data.uuid)
  
  const { uuid } = data
  
  // Деактивируем подписку
  await pool.query(
    `UPDATE subscriptions 
     SET is_active = false,
         updated_at = NOW()
     WHERE remnwave_user_uuid = $1`,
    [uuid]
  )
  
  console.log(`[Webhook] Deactivated subscription for expired user ${uuid}`)
}

async function handleUserDisabled(data) {
  console.log('[Webhook] User disabled:', data.uuid)
  
  const { uuid } = data
  
  // Деактивируем подписку
  await pool.query(
    `UPDATE subscriptions 
     SET is_active = false,
         updated_at = NOW()
     WHERE remnwave_user_uuid = $1`,
    [uuid]
  )
  
  console.log(`[Webhook] Deactivated subscription for disabled user ${uuid}`)
}

async function handleUserEnabled(data) {
  console.log('[Webhook] User enabled:', data.uuid)
  
  const { uuid } = data
  
  // Активируем подписку
  await pool.query(
    `UPDATE subscriptions 
     SET is_active = true,
         updated_at = NOW()
     WHERE remnwave_user_uuid = $1`,
    [uuid]
  )
  
  console.log(`[Webhook] Activated subscription for enabled user ${uuid}`)
}

async function handleUserDeleted(data) {
  console.log('[Webhook] User deleted:', data.uuid)
  
  const { uuid } = data
  
  // Деактивируем подписку (не удаляем для истории)
  await pool.query(
    `UPDATE subscriptions 
     SET is_active = false,
         updated_at = NOW()
     WHERE remnwave_user_uuid = $1`,
    [uuid]
  )
  
  console.log(`[Webhook] Deactivated subscription for deleted user ${uuid}`)
}

module.exports = router
