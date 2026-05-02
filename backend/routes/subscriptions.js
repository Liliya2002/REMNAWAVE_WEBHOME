const express = require('express')
const router = express.Router()
const pool = require('../db')
const pgPool = pool.pool // для транзакций
const config = require('../config')
const { createRemnwaveUser, updateRemnwaveUser } = require('../services/remnwave')
const { verifyToken, verifyActive } = require('../middleware')
const planChange = require('../services/planChange')
const squadQuota = require('../services/squadQuota')

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
      'SELECT id, squad_uuids, hwid_device_limit FROM plans WHERE is_trial = true AND is_active = true LIMIT 1'
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
    
    // Резолвим стабильный username (либо legacy userweb_<id>, либо новый userweb_<8 цифр>)
    const remnwaveUsernameSvc = require('../services/remnwaveUsername')
    const remnwaveSvc = require('../services/remnwave')
    const username = await remnwaveUsernameSvc.resolveUsernameForUser(userId, remnwaveSvc)
    const userMeta = await remnwaveUsernameSvc.getRemnwaveMetadata(userId)

    // Free Trial обычно имеет hwid_device_limit заданный в самом плане
    const planHwid = trialPlan.rows[0]?.hwid_device_limit

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
      activeInternalSquads: squadUuids,
      ...userMeta,
      ...(planHwid != null ? { hwidDeviceLimit: Number(planHwid) } : {}),
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
// Кеш live-данных RemnaWave (per-uuid, TTL 60 сек) — чтобы не долбить RW
// при каждом GET /my (Dashboard polls раз в N сек).
const rwUserCache = new Map() // uuid → { data, fetchedAt }
const RW_CACHE_TTL_MS = 60 * 1000

async function getCachedRwUser(uuid) {
  const now = Date.now()
  const cached = rwUserCache.get(uuid)
  if (cached && (now - cached.fetchedAt) < RW_CACHE_TTL_MS) return cached.data
  try {
    const remnwave = require('../services/remnwave')
    const data = await remnwave.getRemnwaveUserByUuid(uuid)
    rwUserCache.set(uuid, { data, fetchedAt: now })
    return data
  } catch (err) {
    // Если RW недоступен — отдаём stale-кеш если есть, иначе null
    return cached?.data || null
  }
}

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
      `SELECT id, plan_name, plan_id, remnwave_username, remnwave_user_uuid, subscription_url, expires_at,
              traffic_limit_gb, traffic_used_gb, squad_uuid, is_active, created_at
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    )

    // Live-обновление traffic_used_gb из RemnaWave для активных подписок
    const subs = await Promise.all(result.rows.map(async (sub) => {
      if (!sub.is_active || !sub.remnwave_user_uuid) return sub
      const rwUser = await getCachedRwUser(sub.remnwave_user_uuid)
      if (!rwUser) return sub
      const liveUsedBytes = Number(rwUser.userTraffic?.usedTrafficBytes ?? rwUser.usedTrafficBytes ?? 0)
      if (liveUsedBytes > 0) {
        sub.traffic_used_gb = +(liveUsedBytes / (1024 ** 3)).toFixed(2)
      }
      return sub
    }))

    res.json({ subscriptions: subs })

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
      `SELECT id, plan_name, traffic_limit_gb, traffic_used_gb, remnwave_user_uuid, expires_at
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
    const limitBytes = (Number(sub.traffic_limit_gb) || 0) * (1024 ** 3)

    // 1. Пытаемся взять live-данные из RemnaWave bandwidth-stats — они дают
    //    дневную разбивку. Если RW недоступен — fallback на snapshots из БД.
    let points = []
    let source = 'snapshots'
    if (sub.remnwave_user_uuid) {
      try {
        const remnwave = require('../services/remnwave')
        const today = new Date()
        const start = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
        const startStr = start.toISOString().slice(0, 10)
        const endStr = today.toISOString().slice(0, 10)
        const stats = await remnwave.getUserBandwidthStats(sub.remnwave_user_uuid, startStr, endStr)
        const categories = stats?.categories || []
        const spark = Array.isArray(stats?.sparklineData) ? stats.sparklineData : []
        if (categories.length > 0 && categories.length === spark.length) {
          // sparklineData — дневной трафик (delta). TrafficChart ожидает cumulative
          // usedBytes, чтобы самому посчитать дельту → собираем нарастающую сумму.
          let acc = 0
          points = categories.map((date, i) => {
            acc += Number(spark[i] || 0)
            return { date, usedBytes: acc, limitBytes }
          })
          source = 'remnawave'
        }
      } catch (err) {
        console.warn('[traffic-history] RemnaWave fetch failed, fallback to snapshots:', err.message)
      }
    }

    // 2. Fallback — snapshots из БД (если RW недоступен или uuid не привязан)
    if (points.length === 0) {
      const histRes = await pool.query(
        `SELECT snapshot_date, used_bytes, limit_bytes
           FROM subscription_traffic_snapshots
          WHERE subscription_id = $1
            AND snapshot_date >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'
          ORDER BY snapshot_date ASC`,
        [sub.id, days]
      )
      points = histRes.rows.map(r => ({
        date: r.snapshot_date,
        usedBytes: Number(r.used_bytes),
        limitBytes: Number(r.limit_bytes),
      }))
    }

    res.json({
      subscription: {
        id: sub.id,
        planName: sub.plan_name,
        trafficLimitGb: sub.traffic_limit_gb,
        trafficUsedGb: Number(sub.traffic_used_gb || 0),
        expiresAt: sub.expires_at,
      },
      points,
      source,
      hasData: points.length > 0,
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

// ─── Смена тарифа (upgrade/downgrade/swap) ─────────────────────────────────

/**
 * Helper: получить активную подписку юзера + связанные планы.
 */
async function loadSubAndPlans(userId, subscriptionId, targetPlanId) {
  const subQ = subscriptionId
    ? await pool.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subscriptionId, userId])
    : await pool.query(
        `SELECT * FROM subscriptions
         WHERE user_id=$1 AND is_active=true
         ORDER BY expires_at DESC NULLS LAST LIMIT 1`,
        [userId]
      )
  const sub = subQ.rows[0]
  if (!sub) return { error: 'Активная подписка не найдена' }

  // current plan: сначала plan_id, потом fallback на name
  let currentPlan = null
  if (sub.plan_id) {
    const r = await pool.query('SELECT * FROM plans WHERE id=$1', [sub.plan_id])
    currentPlan = r.rows[0] || null
  }
  if (!currentPlan && sub.plan_name) {
    const r = await pool.query('SELECT * FROM plans WHERE name=$1 LIMIT 1', [sub.plan_name])
    currentPlan = r.rows[0] || null
  }

  const tgtQ = await pool.query('SELECT * FROM plans WHERE id=$1', [targetPlanId])
  const targetPlan = tgtQ.rows[0]
  if (!targetPlan) return { error: 'Целевой тариф не найден' }

  return { sub, currentPlan, targetPlan }
}

/**
 * POST /api/subscriptions/calculate-change
 * Preview расчёта смены тарифа. Без побочных эффектов.
 *
 * body: { subscription_id?, target_plan_id, period: 'remaining'|'monthly'|'quarterly'|'yearly' }
 */
router.post('/calculate-change', verifyToken, verifyActive, async (req, res) => {
  try {
    const { subscription_id, target_plan_id, period = 'remaining' } = req.body || {}
    if (!target_plan_id) {
    console.warn('[change] missing target_plan_id. body:', JSON.stringify(req.body), 'user:', req.userId)
    return res.status(400).json({ error: 'Сначала выберите тариф' })
  }

    const { sub, currentPlan, targetPlan, error } = await loadSubAndPlans(req.userId, subscription_id, target_plan_id)
    if (error) return res.status(404).json({ error })

    const calc = planChange.calculateChange({
      subscription: sub,
      currentPlan,
      targetPlan,
      period,
    })

    if (!calc.ok) return res.status(400).json(calc)

    // Текущий баланс юзера
    const balanceR = await pool.query('SELECT balance FROM user_wallets WHERE user_id = $1', [req.userId])
    const balance = Number(balanceR.rows[0]?.balance || 0)

    const fromBalance = Math.min(balance, calc.payDifference)
    const fromGateway = +(calc.payDifference - fromBalance).toFixed(2)

    res.json({
      ...calc,
      subscription: {
        id: sub.id,
        plan_name: sub.plan_name,
        expires_at: sub.expires_at,
        traffic_used_gb: sub.traffic_used_gb,
        traffic_limit_gb: sub.traffic_limit_gb,
      },
      balance,
      fromBalance,
      fromGateway,
      canPayFromBalance: balance >= calc.payDifference,
    })
  } catch (err) {
    console.error('[change] calculate error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/subscriptions/change
 * Применить смену тарифа.
 *
 * body: { subscription_id?, target_plan_id, period, payment_method: 'balance'|'gateway' }
 *
 * Если payment_method='balance' и хватает средств — применяется немедленно.
 * Если 'gateway' (или не хватает баланса) — создаётся payment с типом 'subscription_change',
 * Platega-flow завершит активацию через webhook (см. services/payment.js).
 *
 * Если payDifference == 0 (downgrade) — применяется немедленно без payment.
 */
router.post('/change', verifyToken, verifyActive, async (req, res) => {
  const { subscription_id, target_plan_id, period = 'remaining', payment_method = 'balance' } = req.body || {}
  if (!target_plan_id) {
    console.warn('[change] missing target_plan_id. body:', JSON.stringify(req.body), 'user:', req.userId)
    return res.status(400).json({ error: 'Сначала выберите тариф' })
  }

  try {
    const { sub, currentPlan, targetPlan, error } = await loadSubAndPlans(req.userId, subscription_id, target_plan_id)
    if (error) return res.status(404).json({ error })

    const calc = planChange.calculateChange({
      subscription: sub,
      currentPlan,
      targetPlan,
      period,
    })
    if (!calc.ok) return res.status(400).json(calc)

    const paymentService = require('../services/payment')

    // 1. Бесплатно (downgrade или swap-cheaper) или баланс хватает
    if (calc.payDifference === 0) {
      const result = await paymentService.applyPlanChange({
        subscriptionId: sub.id,
        targetPlanId: targetPlan.id,
        newExpiresAt: calc.newExpiresAt,
        period,
        amount: 0,
      })
      return res.json({ ok: true, instant: true, calc, result })
    }

    if (payment_method === 'balance') {
      const balanceR = await pool.query('SELECT balance FROM user_wallets WHERE user_id = $1', [req.userId])
      const balance = Number(balanceR.rows[0]?.balance || 0)
      if (balance < calc.payDifference) {
        return res.status(400).json({ error: 'Недостаточно средств на балансе', required: calc.payDifference, balance })
      }
      const result = await paymentService.payChangeFromBalance({
        userId: req.userId,
        subscriptionId: sub.id,
        targetPlanId: targetPlan.id,
        amount: calc.payDifference,
        period,
        newExpiresAt: calc.newExpiresAt,
        calc,
      })
      return res.json({ ok: true, instant: true, calc, result })
    }

    // Gateway (Platega) — создаём pending payment с типом 'subscription_change'
    const gatewayResult = await paymentService.createChangeGatewayPayment({
      userId: req.userId,
      subscriptionId: sub.id,
      targetPlanId: targetPlan.id,
      amount: calc.payDifference,
      period,
      newExpiresAt: calc.newExpiresAt,
      calc,
    })
    return res.json({ ok: true, instant: false, calc, payment: gatewayResult })
  } catch (err) {
    console.error('[change] apply error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Squad Quotas (per-squad usage + topup) ──────────────────────────────────

/**
 * GET /api/subscriptions/:id/squad-usage
 * Возвращает per-squad usage/limits/state для подписки в текущем периоде.
 */
router.get('/:id/squad-usage', verifyToken, verifyActive, async (req, res) => {
  try {
    const subId = parseInt(req.params.id, 10)
    const subQ = await pool.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, req.userId])
    const sub = subQ.rows[0]
    if (!sub) return res.status(404).json({ error: 'Subscription not found' })

    const settingsQ = await pool.query('SELECT * FROM traffic_guard_settings WHERE id=1')
    const settings = settingsQ.rows[0]
    const periodKey = squadQuota.getCurrentPeriodKey(settings.squad_period_strategy, sub)

    // Получаем squad_uuids из плана
    const planR = await pool.query('SELECT * FROM plans WHERE id=$1', [sub.plan_id])
    const plan = planR.rows[0]
    const squadUuids = Array.isArray(plan?.squad_uuids) ? plan.squad_uuids : []

    // Лимиты per-squad из тарифа
    const limits = await squadQuota.getEffectiveLimits(sub.plan_id)

    // Текущие states для подписки в этом периоде
    const stateR = await pool.query(
      `SELECT * FROM subscription_squad_state
       WHERE subscription_id = $1 AND period_key = $2`,
      [sub.id, periodKey]
    )
    const stateMap = new Map(stateR.rows.map(r => [r.squad_uuid, r]))

    // Имена squad'ов из RemnaWave
    const remnwave = require('../services/remnwave')
    let squadInfo = new Map()
    try {
      const allSquads = await remnwave.getInternalSquads()
      for (const sq of allSquads) {
        squadInfo.set(sq.uuid, { name: sq.name, info: sq.info })
      }
    } catch {}

    const items = squadUuids.map(uuid => {
      const state = stateMap.get(uuid)
      const limit = limits.get(uuid) || { limit_gb: 0, topup_enabled: !!settings.squad_quota_enabled, topup_price_per_gb: null }
      const baseGb = state ? Number(state.base_limit_gb || 0) : limit.limit_gb
      const extraGb = state ? Number(state.extra_gb || 0) : 0
      const totalGb = baseGb + extraGb
      const usedBytes = state ? Number(state.used_bytes || 0) : 0
      const usedGb = usedBytes / (1024 ** 3)
      return {
        squad_uuid: uuid,
        squad_name: squadInfo.get(uuid)?.name || state?.squad_name || uuid.slice(0, 8),
        base_limit_gb: baseGb,
        extra_gb: extraGb,
        total_limit_gb: totalGb,
        used_bytes: usedBytes,
        used_gb: usedGb,
        used_percent: totalGb > 0 ? Math.min(100, (usedGb / totalGb) * 100) : 0,
        is_disabled: state?.is_disabled || false,
        disabled_at: state?.disabled_at || null,
        last_synced_at: state?.last_synced_at || null,
        topup_enabled: limit.topup_enabled,
        topup_price_per_gb: limit.topup_price_per_gb !== null
          ? limit.topup_price_per_gb
          : Number(settings.squad_topup_default_price || 0),
      }
    })

    res.json({
      subscription_id: sub.id,
      plan_id: sub.plan_id,
      period_key: periodKey,
      strategy: settings.squad_period_strategy,
      enabled: !!settings.squad_quota_enabled,
      topup_mode: settings.squad_topup_mode,
      items,
    })
  } catch (err) {
    console.error('[squad-usage]', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/subscriptions/:id/squad-topup
 * body: { squad_uuid, gb_amount, payment_method: 'balance'|'gateway' }
 *
 * Покупка доп. трафика на squad. Списание с баланса (мгновенно) или Platega gateway.
 */
router.post('/:id/squad-topup', verifyToken, verifyActive, async (req, res) => {
  try {
    const subId = parseInt(req.params.id, 10)
    const { squad_uuid, gb_amount, payment_method = 'balance' } = req.body || {}
    const gb = Number(gb_amount)
    if (!squad_uuid) return res.status(400).json({ error: 'Missing squad_uuid' })
    if (!gb || gb <= 0 || gb > 1000) return res.status(400).json({ error: 'Invalid gb_amount (1-1000)' })

    const subQ = await pool.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subId, req.userId])
    const sub = subQ.rows[0]
    if (!sub) return res.status(404).json({ error: 'Subscription not found' })

    const settingsQ = await pool.query('SELECT * FROM traffic_guard_settings WHERE id=1')
    const settings = settingsQ.rows[0]

    // Проверим что squad действительно из плана
    const planR = await pool.query('SELECT * FROM plans WHERE id=$1', [sub.plan_id])
    const plan = planR.rows[0]
    if (!plan || !Array.isArray(plan.squad_uuids) || !plan.squad_uuids.includes(squad_uuid)) {
      return res.status(400).json({ error: 'Squad не входит в текущий тариф' })
    }

    const limits = await squadQuota.getEffectiveLimits(sub.plan_id)
    const limit = limits.get(squad_uuid)
    if (limit && !limit.topup_enabled) {
      return res.status(403).json({ error: 'Доп. трафик на этот сервер отключён' })
    }

    const { pricePerGb, total } = squadQuota.calculateTopupPrice({
      planId: sub.plan_id, squadUuid: squad_uuid, gbAmount: gb, settings, planLimits: limits,
    })

    if (payment_method === 'balance') {
      // Списываем с баланса в транзакции
      const client = await pool.pool.connect()
      try {
        await client.query('BEGIN')
        const wQ = await client.query('SELECT balance FROM user_wallets WHERE user_id=$1 FOR UPDATE', [req.userId])
        const balance = Number(wQ.rows[0]?.balance || 0)
        if (balance < total) throw new Error('Недостаточно средств на балансе')

        const newBalance = +(balance - total).toFixed(2)
        await client.query('UPDATE user_wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2', [newBalance, req.userId])

        const payQ = await client.query(
          `INSERT INTO payments (user_id, plan_id, amount, currency, period, payment_provider, status,
                                 payment_type, payment_source, completed_at, provider_metadata)
           VALUES ($1, $2, $3, 'RUB', NULL, 'wallet', 'completed', 'squad_traffic_topup', 'balance', NOW(), $4)
           RETURNING id`,
          [req.userId, sub.plan_id, total, JSON.stringify({ subscription_id: sub.id, squad_uuid, gb_amount: gb })]
        )
        const paymentId = payQ.rows[0].id

        await client.query(
          `INSERT INTO wallet_transactions
            (user_id, type, direction, amount, currency, balance_before, balance_after, reference_type, reference_id)
           VALUES ($1, 'purchase', 'out', $2, 'RUB', $3, $4, 'payment', $5)`,
          [req.userId, total, balance, newBalance, paymentId]
        )

        await client.query('COMMIT')

        // Применяем доп. трафик
        const result = await squadQuota.addExtraTraffic({
          subscription: sub,
          squadUuid: squad_uuid,
          gbAmount: gb,
          source: 'user_purchase',
          amountPaid: total,
          paymentId,
        })
        return res.json({ ok: true, instant: true, paymentId, balanceBefore: balance, balanceAfter: newBalance, state: result, pricePerGb, total })
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        return res.status(400).json({ error: err.message })
      } finally {
        client.release()
      }
    }

    // Gateway flow — Platega payment
    const platega = require('../services/platega')
    const orderId = `squad_topup_${req.userId}_${sub.id}_${Date.now()}`
    const payR = await pool.query(
      `INSERT INTO payments (user_id, plan_id, amount, currency, period, payment_provider, status,
                             payment_type, payment_source, expires_at, provider_metadata)
       VALUES ($1, $2, $3, 'RUB', NULL, 'platega', 'pending', 'squad_traffic_topup', 'gateway',
               NOW() + INTERVAL '1 hour', $4)
       RETURNING id`,
      [req.userId, sub.plan_id, total, JSON.stringify({ subscription_id: sub.id, squad_uuid, gb_amount: gb })]
    )
    const paymentId = payR.rows[0].id
    try {
      const txn = await platega.createTransaction({
        orderId,
        amount: total,
        description: `Доп. ${gb} ГБ на сервер ${squad_uuid.slice(0, 8)}…`,
        successUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success?id=${paymentId}`,
        failUrl:    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/failed?id=${paymentId}`,
      })
      await pool.query(`UPDATE payments SET provider_payment_id=$1, payment_url=$2 WHERE id=$3`,
        [txn.transactionId, txn.redirectUrl, paymentId])
      res.json({ ok: true, instant: false, paymentId, paymentUrl: txn.redirectUrl, total, pricePerGb })
    } catch (err) {
      await pool.query(`UPDATE payments SET status='failed' WHERE id=$1`, [paymentId])
      res.status(500).json({ error: err.message })
    }
  } catch (err) {
    console.error('[squad-topup]', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Connected devices (HWID) ────────────────────────────────────────────────

/**
 * GET /api/subscriptions/devices
 * Возвращает список подключённых устройств юзера + текущий лимит.
 */
router.get('/devices', verifyToken, verifyActive, async (req, res) => {
  try {
    const subQ = await pool.query(
      `SELECT s.remnwave_user_uuid, p.hwid_device_limit
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.is_active = true AND s.remnwave_user_uuid IS NOT NULL
       ORDER BY s.expires_at DESC LIMIT 1`,
      [req.userId]
    )
    if (!subQ.rows[0]) return res.json({ devices: [], limit: null, hasSubscription: false })

    const remnwave = require('../services/remnwave')
    const data = await remnwave.getRemnwaveUserHwidDevices(subQ.rows[0].remnwave_user_uuid)
    const devices = (data?.devices || data || []).map(d => ({
      hwid: d.hwid,
      platform: d.platform || null,
      osVersion: d.osVersion || null,
      deviceModel: d.deviceModel || null,
      userAgent: d.userAgent || null,
      createdAt: d.createdAt || null,
    }))
    res.json({
      devices,
      limit: subQ.rows[0].hwid_device_limit,
      hasSubscription: true,
    })
  } catch (err) {
    console.error('[devices]', err.message)
    res.status(502).json({ error: 'Failed to fetch devices', detail: err.message })
  }
})

/**
 * DELETE /api/subscriptions/devices/:hwid
 * Удалить одно устройство по HWID
 */
router.delete('/devices/:hwid', verifyToken, verifyActive, async (req, res) => {
  try {
    const { hwid } = req.params
    if (!hwid) return res.status(400).json({ error: 'Missing hwid' })

    const subQ = await pool.query(
      `SELECT remnwave_user_uuid FROM subscriptions
       WHERE user_id = $1 AND is_active = true AND remnwave_user_uuid IS NOT NULL
       ORDER BY expires_at DESC LIMIT 1`,
      [req.userId]
    )
    if (!subQ.rows[0]) return res.status(404).json({ error: 'Active subscription not found' })

    const remnwave = require('../services/remnwave')
    await remnwave.deleteRemnwaveUserHwid(subQ.rows[0].remnwave_user_uuid, hwid)
    res.json({ ok: true })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

module.exports = router
