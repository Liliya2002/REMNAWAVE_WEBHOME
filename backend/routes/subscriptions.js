const express = require('express')
const router = express.Router()
const pool = require('../db')
const pgPool = pool.pool // для транзакций
const config = require('../config')
const { createRemnwaveUser, updateRemnwaveUser } = require('../services/remnwave')
const { verifyToken, verifyActive } = require('../middleware')

/**
 * GET /api/subscriptions/bonus
 * Получить баланс бонусных дней пользователя
 */
router.get('/bonus', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT pending_bonus_days FROM users WHERE id = $1',
      [req.userId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }
    res.json({
      pendingBonusDays: parseFloat(result.rows[0].pending_bonus_days) || 0
    })
  } catch (err) {
    console.error('[Subscriptions] Error getting bonus days:', err)
    res.status(500).json({ error: 'Ошибка получения бонусных дней' })
  }
})

/**
 * POST /api/subscriptions/apply-bonus
 * Активировать накопленные бонусные дни к подписке
 * - Обновляет expires_at в БД
 * - Обновляет expireAt в Remnawave
 * - Обнуляет pending_bonus_days
 * - Реактивирует подписку если expired
 */
router.post('/apply-bonus', verifyToken, async (req, res) => {
  const client = await pgPool.connect()
  try {
    await client.query('BEGIN')

    // 1. Получаем баланс бонусных дней
    const userResult = await client.query(
      'SELECT pending_bonus_days FROM users WHERE id = $1 FOR UPDATE',
      [req.userId]
    )
    
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const bonusDays = parseFloat(userResult.rows[0].pending_bonus_days) || 0
    
    if (bonusDays <= 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Нет доступных бонусных дней для активации' })
    }

    // 2. Ищем подписку (активную или последнюю с remnwave_user_uuid)
    const subResult = await client.query(
      `SELECT id, plan_name, remnwave_user_uuid, remnwave_username, subscription_url, 
              expires_at, is_active, traffic_limit_gb
       FROM subscriptions 
       WHERE user_id = $1 AND remnwave_user_uuid IS NOT NULL
       ORDER BY is_active DESC, created_at DESC 
       LIMIT 1`,
      [req.userId]
    )

    if (subResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Нет подписки для активации бонусных дней. Сначала создайте подписку.' })
    }

    const sub = subResult.rows[0]

    // 3. Рассчитываем новую дату истечения
    const now = new Date()
    const currentExpires = sub.expires_at ? new Date(sub.expires_at) : now
    const baseDate = currentExpires > now ? currentExpires : now
    const newExpiresAt = new Date(baseDate)
    newExpiresAt.setDate(newExpiresAt.getDate() + Math.floor(bonusDays))
    // Добавляем дробную часть дней в часах
    const fractionalHours = (bonusDays - Math.floor(bonusDays)) * 24
    newExpiresAt.setHours(newExpiresAt.getHours() + Math.round(fractionalHours))

    // 4. Обновляем подписку в БД
    await client.query(
      `UPDATE subscriptions 
       SET expires_at = $1, is_active = true, updated_at = NOW()
       WHERE id = $2`,
      [newExpiresAt, sub.id]
    )

    // 5. Обнуляем pending_bonus_days
    await client.query(
      'UPDATE users SET pending_bonus_days = 0 WHERE id = $1',
      [req.userId]
    )

    await client.query('COMMIT')

    // 6. Обновляем в Remnawave (вне транзакции — это внешний API)
    let remnwaveUpdated = false
    try {
      if (sub.remnwave_user_uuid) {
        await updateRemnwaveUser(sub.remnwave_user_uuid, {
          expireAt: newExpiresAt,
          status: 'ACTIVE'
        })
        remnwaveUpdated = true
        console.log(`[Subscriptions] Remnawave user ${sub.remnwave_user_uuid} extended to ${newExpiresAt.toISOString()}`)
      }
    } catch (remnErr) {
      console.error('[Subscriptions] Failed to update Remnawave, but DB was updated:', remnErr.message)
    }

    console.log(`[Subscriptions] User ${req.userId} applied ${bonusDays} bonus days. New expiry: ${newExpiresAt.toISOString()}`)

    res.json({
      success: true,
      appliedDays: bonusDays,
      newExpiresAt: newExpiresAt.toISOString(),
      wasReactivated: !sub.is_active,
      remnwaveUpdated,
      message: `Успешно активировано ${bonusDays} бонусных дней!`
    })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[Subscriptions] Error applying bonus days:', err)
    res.status(500).json({ error: 'Ошибка при активации бонусных дней' })
  } finally {
    client.release()
  }
})

/**
 * GET /api/subscriptions/squads
 * Получить сквады из локальной БД (используется в админке PlanForm)
 */
router.get('/squads', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT uuid, display_name as name, inbounds_count as "inboundsCount", nodes_count as "nodesCount" FROM squads WHERE is_active = true ORDER BY display_name ASC'
    )
    res.json({ squads: result.rows })
  } catch (err) {
    console.error('[Subscriptions] Error fetching squads:', err)
    res.status(500).json({ error: 'Ошибка получения списка серверных групп' })
  }
})

/**
 * POST /api/subscriptions/activate
 * Активировать бесплатный тестовый период
 * Сквады назначаются автоматически из пробного тарифа
 */
router.post('/activate', verifyToken, verifyActive, async (req, res) => {
  try {
    const userId = req.userId

    // Проверка: пробный период можно активировать только один раз за всё время
    const alreadyUsedTrial = await pool.query(
      `SELECT id
       FROM subscriptions
       WHERE user_id = $1 AND plan_name = 'FREE_TRIAL'
       LIMIT 1`,
      [userId]
    )

    if (alreadyUsedTrial.rows.length > 0) {
      return res.status(400).json({
        error: 'Пробный период уже был использован ранее'
      })
    }
    
    // Получаем пробный тариф и его сквады
    const trialPlan = await pool.query(
      'SELECT id, squad_uuids FROM plans WHERE is_trial = true AND is_active = true LIMIT 1'
    )
    
    const squadUuids = trialPlan.rows.length > 0 ? (trialPlan.rows[0].squad_uuids || []) : []
    const squadUuid = squadUuids[0] || null
    
    if (!squadUuid) {
      return res.status(400).json({ 
        error: 'Не настроен пробный тариф с серверной группой. Обратитесь к администратору.' 
      })
    }
    
    // Проверка: есть ли уже активная подписка
    const existingSub = await pool.query(
      'SELECT id FROM subscriptions WHERE user_id = $1 AND is_active = true',
      [userId]
    )
    
    if (existingSub.rows.length > 0) {
      return res.status(400).json({ 
        error: 'У вас уже есть активная подписка' 
      })
    }
    
    // Формируем имя пользователя: userweb_{id}
    const username = `userweb_${userId}`
    
    // Рассчитываем дату истечения: текущая + FREE_TRIAL_DAYS дней
    const expirationDate = new Date()
    expirationDate.setDate(expirationDate.getDate() + config.FREE_TRIAL_DAYS)
    
    // Трафик в байтах (GB -> bytes)
    const trafficLimitBytes = config.FREE_TRIAL_TRAFFIC_GB * 1024 * 1024 * 1024
    
    console.log(`[Subscriptions] Activating free trial for user ${userId}:`, {
      username,
      squadUuid,
      expirationDate: expirationDate.toISOString(),
      trafficLimitBytes
    })
    
    // Создаем пользователя в Remnwave с привязкой к сквадам из тарифа
    const remnwaveUser = await createRemnwaveUser({
      username,
      trafficLimitBytes,
      expireAt: expirationDate,
      activeInternalSquads: squadUuids
    })
    
    if (!remnwaveUser) {
      return res.status(500).json({ 
        error: 'Не удалось создать VPN пользователя в системе Remnwave' 
      })
    }
    
    const userUuid = remnwaveUser.uuid || remnwaveUser.id
    const shortUuid = remnwaveUser.shortUuid
    
    // Сохраняем remnwave_uuid в таблицу users для дальнейшего поиска
    if (userUuid) {
      await pool.query(
        'UPDATE users SET remnwave_uuid = $1 WHERE id = $2',
        [userUuid, userId]
      )
      console.log(`[Subscriptions] Saved remnwave_uuid=${userUuid} to users table`)
    }
    
    // subscriptionUrl берётся прямо из ответа создания пользователя
    let subscriptionUrl = remnwaveUser.subscriptionUrl || null
    
    // Если subscriptionUrl нет в ответе, но есть shortUuid — формируем URL
    if (!subscriptionUrl && shortUuid) {
      const baseUrl = process.env.REMNWAVE_API_URL || 'https://panel-root.guard-proxy.pro'
      subscriptionUrl = `${baseUrl}/api/sub/${shortUuid}`
      console.log(`[Subscriptions] Built subscription URL from shortUuid: ${subscriptionUrl}`)
    }
    
    if (!subscriptionUrl) {
      console.warn('[Subscriptions] No subscription URL found in response')
    } else {
      console.log(`[Subscriptions] Subscription URL: ${subscriptionUrl}`)
    }
    
    // Сохраняем подписку в БД
    const result = await pool.query(
      `INSERT INTO subscriptions 
       (user_id, plan_name, remnwave_user_uuid, remnwave_username, subscription_url, expires_at, traffic_limit_gb, squad_uuid, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING *`,
      [
        userId,
        'FREE_TRIAL',
        userUuid,
        username,
        subscriptionUrl || null,
        expirationDate,
        config.FREE_TRIAL_TRAFFIC_GB,
        squadUuid
      ]
    )
    
    const subscription = result.rows[0]
    
    console.log(`[Subscriptions] Free trial activated successfully for user ${userId}`)
    
    res.json({ 
      success: true,
      subscription: {
        id: subscription.id,
        plan: subscription.plan_name,
        username: subscription.remnwave_username,
        subscriptionUrl: subscription.subscription_url,
        expiresAt: subscription.expires_at,
        trafficLimitGb: subscription.traffic_limit_gb
      }
    })
    
  } catch (err) {
    console.error('[Subscriptions] Error activating free trial:', err)
    res.status(500).json({ 
      error: 'Ошибка при активации бесплатного периода'
    })
  }
})

/**
 * GET /api/subscriptions/my
 * Получить подписки текущего пользователя
 */
router.get('/my', verifyToken, verifyActive, async (req, res) => {
  try {
    const userId = req.userId
    
    // Автоматически деактивируем истекшие подписки
    await pool.query(
      `UPDATE subscriptions 
       SET is_active = false 
       WHERE user_id = $1 AND is_active = true AND expires_at <= NOW()`,
      [userId]
    )
    
    const result = await pool.query(
      `SELECT id, plan_name, remnwave_username, remnwave_user_uuid, subscription_url, expires_at, 
              traffic_limit_gb, traffic_used_gb, squad_uuid, is_active, created_at
       FROM subscriptions 
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    )
    
    res.json({ subscriptions: result.rows })
    
  } catch (err) {
    console.error('[Subscriptions] Error fetching user subscriptions:', err)
    res.status(500).json({ error: 'Ошибка при получении подписок' })
  }
})

/**
 * GET /api/subscriptions/config
 * Получить конфиг подписки (проксирует запрос к Remnawave sub URL)
 * Возвращает: configs (массив VLESS/Trojan ссылок), userInfo (трафик, expire), profileTitle
 */
router.get('/config', verifyToken, verifyActive, async (req, res) => {
  try {
    const userId = req.userId

    // Ищем активную подписку с subscription_url
    const result = await pool.query(
      `SELECT id, plan_name, remnwave_username, remnwave_user_uuid, subscription_url, 
              expires_at, traffic_limit_gb, traffic_used_gb, squad_uuid, is_active
       FROM subscriptions 
       WHERE user_id = $1 AND is_active = true AND subscription_url IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Активная подписка не найдена' })
    }

    const sub = result.rows[0]

    // Запрашиваем конфиг с Remnawave
    const subRes = await fetch(sub.subscription_url, {
      headers: { 'User-Agent': 'v2rayN' }
    })

    if (!subRes.ok) {
      return res.status(502).json({ error: 'Не удалось получить конфиг подписки' })
    }

    const body = await subRes.text()

    // Декодируем base64 → список ссылок
    let configs = []
    try {
      const decoded = Buffer.from(body, 'base64').toString('utf-8')
      configs = decoded.split('\n').filter(line => line.trim().length > 0)
    } catch (e) {
      // Если не base64, просто разделяем по строкам
      configs = body.split('\n').filter(line => line.trim().length > 0)
    }

    // Парсим subscription-userinfo из заголовков
    const userInfoHeader = subRes.headers.get('subscription-userinfo') || ''
    const userInfo = {}
    userInfoHeader.split(';').forEach(part => {
      const [key, val] = part.trim().split('=')
      if (key && val) userInfo[key.trim()] = parseInt(val.trim())
    })

    // Получаем profile-title
    let profileTitle = ''
    const profileTitleHeader = subRes.headers.get('profile-title') || ''
    if (profileTitleHeader.startsWith('base64:')) {
      try {
        profileTitle = Buffer.from(profileTitleHeader.replace('base64:', ''), 'base64').toString('utf-8')
      } catch (e) {
        profileTitle = profileTitleHeader
      }
    } else {
      profileTitle = profileTitleHeader
    }

    const supportUrl = subRes.headers.get('support-url') || ''

    res.json({
      subscription: {
        id: sub.id,
        plan: sub.plan_name,
        username: sub.remnwave_username,
        subscriptionUrl: sub.subscription_url,
        expiresAt: sub.expires_at,
        trafficLimitGb: sub.traffic_limit_gb,
        trafficUsedGb: sub.traffic_used_gb,
        isActive: sub.is_active
      },
      configs,
      userInfo: {
        upload: userInfo.upload || 0,
        download: userInfo.download || 0,
        total: userInfo.total || 0,
        expire: userInfo.expire || 0
      },
      profileTitle,
      supportUrl
    })

  } catch (err) {
    console.error('[Subscriptions] Error fetching config:', err)
    res.status(500).json({ error: 'Ошибка при получении конфига подписки' })
  }
})

/**
 * GET /api/subscriptions/traffic-history
 * История потребления трафика по активной подписке: до 90 дней.
 * Query: ?days=30 (по умолчанию 30, max 365)
 */
router.get('/traffic-history', verifyToken, verifyActive, async (req, res) => {
  try {
    const userId = req.userId
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30))

    // Берём ту же подписку что показываем в кабинете
    const subRes = await pool.query(
      `SELECT id, plan_name, traffic_limit_gb, traffic_used_gb
         FROM subscriptions
        WHERE user_id = $1
        ORDER BY (CASE WHEN is_active AND expires_at > NOW() THEN 0 ELSE 1 END),
                 created_at DESC
        LIMIT 1`,
      [userId]
    )
    if (subRes.rows.length === 0) {
      return res.json({ subscription: null, points: [], hasData: false })
    }
    const sub = subRes.rows[0]

    const histRes = await pool.query(
      `SELECT snapshot_date, used_bytes, limit_bytes
         FROM subscription_traffic_snapshots
        WHERE subscription_id = $1
          AND snapshot_date >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'
        ORDER BY snapshot_date ASC`,
      [sub.id, days]
    )

    res.json({
      subscription: {
        id: sub.id,
        planName: sub.plan_name,
        trafficLimitGb: sub.traffic_limit_gb,
        trafficUsedGb: Number(sub.traffic_used_gb || 0),
      },
      points: histRes.rows.map(r => ({
        date: r.snapshot_date,
        usedBytes: Number(r.used_bytes),
        limitBytes: Number(r.limit_bytes),
      })),
      hasData: histRes.rows.length > 0,
    })
  } catch (err) {
    console.error('[Subscriptions] Error fetching traffic history:', err)
    res.status(500).json({ error: 'Ошибка получения истории трафика' })
  }
})

/**
 * GET /api/subscriptions/setup-guide
 * Получить инструкцию по настройке из RemnaWave subscription-page-configs
 */
router.get('/setup-guide', verifyToken, verifyActive, async (req, res) => {
  try {
    const userId = req.userId

    const result = await pool.query(
      `SELECT subscription_url FROM subscriptions 
       WHERE user_id = $1 AND is_active = true AND subscription_url IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Активная подписка не найдена' })
    }

    const sub = result.rows[0]
    const shortUuid = sub.subscription_url.split('/').pop()
    const API_URL = process.env.REMNWAVE_API_URL
    const API_TOKEN = process.env.REMNWAVE_API_TOKEN

    // Получаем список конфигов subscription page
    const configsRes = await fetch(`${API_URL}/api/subscription-page-configs`, {
      headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    })

    if (!configsRes.ok) {
      return res.status(502).json({ error: 'Не удалось получить конфигурацию инструкций' })
    }

    const configsData = await configsRes.json()
    const configsList = configsData.response?.configs || []

    if (configsList.length === 0 || !configsList[0].uuid) {
      return res.status(404).json({ error: 'Конфигурация инструкций не найдена' })
    }

    // Получаем полный конфиг
    const configUuid = configsList[0].uuid
    const fullRes = await fetch(`${API_URL}/api/subscription-page-configs/${configUuid}`, {
      headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    })

    if (!fullRes.ok) {
      return res.status(502).json({ error: 'Не удалось получить детальную конфигурацию' })
    }

    const fullData = await fullRes.json()
    const pageConfig = fullData.response?.config

    if (!pageConfig) {
      return res.status(404).json({ error: 'Конфигурация пуста' })
    }

    // Получаем ссылку подписки пользователя
    let subscriptionLink = sub.subscription_url
    const infoRes = await fetch(`${API_URL}/api/sub/${shortUuid}/info`, {
      headers: { 'Authorization': `Bearer ${API_TOKEN}` }
    })
    if (infoRes.ok) {
      const infoData = await infoRes.json()
      if (infoData.response?.subscriptionUrl) {
        subscriptionLink = infoData.response.subscriptionUrl
      }
    }

    res.json({
      platforms: pageConfig.platforms || {},
      uiConfig: pageConfig.uiConfig || {},
      baseSettings: pageConfig.baseSettings || {},
      brandingSettings: pageConfig.brandingSettings || {},
      baseTranslations: pageConfig.baseTranslations || {},
      subscriptionLink,
      locale: 'ru'
    })

  } catch (err) {
    console.error('[Subscriptions] Error fetching setup guide:', err)
    res.status(500).json({ error: 'Ошибка при получении инструкции' })
  }
})

module.exports = router
