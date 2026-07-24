/**
 * Активация бесплатного тестового периода — единый источник правды для веба
 * (POST /api/subscriptions/activate) и Telegram-бота.
 *
 * Логика 1:1 с прежним роутом: проверки → создание/переиспользование юзера в
 * RemnaWave → запись подписки FREE_TRIAL. Возвращает структурированный результат.
 */
const pool = require('../db')
const config = require('../config')
const remnwaveSvc = require('./remnwave')
const { createRemnwaveUser, updateRemnwaveUser } = require('./remnwave')
const remnwaveUsernameSvc = require('./remnwaveUsername')

/**
 * @param {number} userId
 * @returns {{ ok:boolean, code?:string, error?:string, subscription?:object, days?:number, trafficGb?:number }}
 */
async function activateTrial(userId) {
  // 1. Пробный период — один раз за всё время
  const used = await pool.query(
    `SELECT id FROM subscriptions WHERE user_id = $1 AND plan_name = 'FREE_TRIAL' LIMIT 1`, [userId]
  )
  if (used.rows.length > 0) {
    return { ok: false, code: 'already_used', error: 'Пробный период уже был использован ранее' }
  }

  // 2. Пробный тариф и его сквады
  const trialPlan = await pool.query(
    'SELECT id, squad_uuids, hwid_device_limit FROM plans WHERE is_trial = true AND is_active = true LIMIT 1'
  )
  const squadUuids = trialPlan.rows.length > 0 ? (trialPlan.rows[0].squad_uuids || []) : []
  const squadUuid = squadUuids[0] || null
  if (!squadUuid) {
    return { ok: false, code: 'no_trial_plan', error: 'Не настроен пробный тариф с серверной группой. Обратитесь к администратору.' }
  }

  // 3. Уже есть активная подписка?
  const existingSub = await pool.query('SELECT id FROM subscriptions WHERE user_id = $1 AND is_active = true', [userId])
  if (existingSub.rows.length > 0) {
    return { ok: false, code: 'has_active', error: 'У вас уже есть активная подписка' }
  }

  // 4. Username + метаданные RemnaWave
  const username = await remnwaveUsernameSvc.resolveUsernameForUser(userId, remnwaveSvc)
  const userMeta = await remnwaveUsernameSvc.getRemnwaveMetadata(userId)
  const planHwid = trialPlan.rows[0]?.hwid_device_limit

  const expirationDate = new Date()
  expirationDate.setDate(expirationDate.getDate() + config.FREE_TRIAL_DAYS)
  const trafficLimitBytes = config.FREE_TRIAL_TRAFFIC_GB * 1024 * 1024 * 1024

  // 5. Создаём (или переиспользуем) юзера в RemnaWave
  let remnwaveUser
  try {
    remnwaveUser = await createRemnwaveUser({
      username, trafficLimitBytes, expireAt: expirationDate,
      activeInternalSquads: squadUuids, ...userMeta,
      ...(planHwid != null ? { hwidDeviceLimit: Number(planHwid) } : {}),
    })
  } catch (err) {
    const existing = await remnwaveSvc.getRemnwaveUserByUsername(username).catch(() => null)
    if (!existing?.uuid) {
      return { ok: false, code: 'rw_error', error: 'Не удалось создать VPN-пользователя: ' + err.message }
    }
    remnwaveUser = await updateRemnwaveUser(existing.uuid, {
      expireAt: expirationDate, trafficLimitBytes, status: 'ACTIVE',
      activeInternalSquads: squadUuids, ...userMeta,
      ...(planHwid != null ? { hwidDeviceLimit: Number(planHwid) } : {}),
    })
    remnwaveUser = { ...existing, ...(remnwaveUser || {}) }
  }
  if (!remnwaveUser || !remnwaveUser.uuid) {
    return { ok: false, code: 'rw_error', error: 'Не удалось создать VPN-пользователя в системе Remnwave' }
  }

  const userUuid = remnwaveUser.uuid || remnwaveUser.id
  const shortUuid = remnwaveUser.shortUuid
  let subscriptionUrl = remnwaveUser.subscriptionUrl || null
  if (!subscriptionUrl && shortUuid) {
    const baseUrl = process.env.REMNWAVE_API_URL || 'https://panel-root.guard-proxy.pro'
    subscriptionUrl = `${baseUrl}/api/sub/${shortUuid}`
  }

  // 6. Пишем подписку
  const result = await pool.query(
    `INSERT INTO subscriptions
       (user_id, plan_name, remnwave_user_uuid, remnwave_username, subscription_url, expires_at, traffic_limit_gb, squad_uuid, is_active)
     VALUES ($1, 'FREE_TRIAL', $2, $3, $4, $5, $6, $7, true)
     RETURNING *`,
    [userId, userUuid, username, subscriptionUrl || null, expirationDate, config.FREE_TRIAL_TRAFFIC_GB, squadUuid]
  )
  const s = result.rows[0]

  return {
    ok: true,
    subscription: {
      id: s.id, plan: s.plan_name, username: s.remnwave_username,
      subscriptionUrl: s.subscription_url, expiresAt: s.expires_at, trafficLimitGb: s.traffic_limit_gb,
    },
    days: config.FREE_TRIAL_DAYS,
    trafficGb: config.FREE_TRIAL_TRAFFIC_GB,
  }
}

module.exports = { activateTrial }
