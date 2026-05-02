/**
 * Squad Quotas — per-squad traffic limits + auto-disable/reactivate + top-up.
 *
 * Главные функции:
 *   - resolveSquadNodeMap()    → Map<squadUuid, Set<nodeUuid>> (с кешем 10 мин)
 *   - getCurrentPeriodKey()    → '2026-04' или '2026-04-15' в зависимости от strategy
 *   - getEffectiveLimits(planId) → Map<squadUuid, {limit_gb, topup_*}>
 *   - syncSquadUsage(sub)      → snapshot used_bytes per squad для текущего периода
 *   - enforceQuotas(sub)       → disable/reactivate squad'ы
 *   - disableSquad(sub, uuid)  → удалить из RW + mark
 *   - reactivateSquad(sub, u)  → вернуть в RW + mark
 *   - addExtraTraffic(...)     → +N ГБ в extra_gb (от покупки или подарка)
 *   - calculateTopupPrice(...) → ₽/ГБ × ГБ
 *
 * Запускается из cron/squadQuota.js
 */
const db = require('../db')
const remnwave = require('./remnwave')
const notifications = require('./notifications')
const { sendNotificationEmail } = require('./email')

// Кеш mapping squad → nodeUuids[] (RemnaWave не отдаёт это напрямую — собираем через
// intersect inbound UUIDs squad'а с activeInbounds каждой ноды)
let squadNodeMapCache = null
let squadNodeMapCachedAt = 0
const SQUAD_NODE_CACHE_TTL_MS = 10 * 60 * 1000

async function resolveSquadNodeMap(force = false) {
  const now = Date.now()
  if (!force && squadNodeMapCache && (now - squadNodeMapCachedAt) < SQUAD_NODE_CACHE_TTL_MS) {
    return squadNodeMapCache
  }
  const map = new Map()
  try {
    const squads = await remnwave.getInternalSquads()
    const nodes = await remnwave.getNodes()

    // Строим index inbound_uuid → set<node_uuid>
    const inboundToNodes = new Map()
    for (const n of nodes) {
      const activeInbounds = n.configProfile?.activeInbounds || []
      for (const ib of activeInbounds) {
        if (!ib.uuid) continue
        if (!inboundToNodes.has(ib.uuid)) inboundToNodes.set(ib.uuid, new Set())
        inboundToNodes.get(ib.uuid).add(n.uuid)
      }
    }

    // Для каждого squad — объединяем ноды его inbounds
    for (const sq of squads) {
      const nodeSet = new Set()
      for (const ib of (sq.inbounds || [])) {
        const nodesForIb = inboundToNodes.get(ib.uuid)
        if (nodesForIb) for (const n of nodesForIb) nodeSet.add(n)
      }
      map.set(sq.uuid, nodeSet)
    }

    squadNodeMapCache = map
    squadNodeMapCachedAt = now
  } catch (err) {
    console.error('[squadQuota] resolveSquadNodeMap failed:', err.message)
    if (squadNodeMapCache) return squadNodeMapCache // fallback на старый кеш
    return new Map()
  }
  return map
}

async function getSettings() {
  const r = await db.query('SELECT * FROM traffic_guard_settings WHERE id = 1')
  return r.rows[0] || null
}

/**
 * Возвращает period_key для подписки в зависимости от стратегии.
 * - 'calendar_month': '2026-04' (сбрасывается 1 числа)
 * - 'subscription_period': '2026-04-15' (30-дневное окно с момента создания подписки)
 */
function getCurrentPeriodKey(strategy, subscription) {
  const now = new Date()
  if (strategy === 'subscription_period' && subscription?.created_at) {
    const created = new Date(subscription.created_at)
    const diffMs = now - created
    const periodIdx = Math.floor(diffMs / (30 * 24 * 60 * 60 * 1000))
    const periodStart = new Date(created.getTime() + periodIdx * 30 * 24 * 60 * 60 * 1000)
    return periodStart.toISOString().slice(0, 10)
  }
  // calendar_month default
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Возвращает Map<squadUuid, {limit_gb, topup_enabled, topup_price_per_gb, squad_name}> для плана.
 * Если в plan_squad_limits нет записи для squad'а из plan.squad_uuids — fallback:
 *   limit_gb = 0 (нет per-squad лимита, считается только общий из плана)
 */
async function getEffectiveLimits(planId) {
  const result = new Map()
  if (!planId) return result
  const r = await db.query('SELECT * FROM plan_squad_limits WHERE plan_id = $1', [planId])
  for (const row of r.rows) {
    result.set(row.squad_uuid, {
      limit_gb: Number(row.limit_gb || 0),
      topup_enabled: !!row.topup_enabled,
      topup_price_per_gb: row.topup_price_per_gb !== null ? Number(row.topup_price_per_gb) : null,
    })
  }
  return result
}

function periodIsCurrent(state, periodKey) {
  return state.period_key === periodKey
}

function totalLimitGB(state) {
  return Number(state.base_limit_gb || 0) + Number(state.extra_gb || 0)
}

function usagePercent(usedBytes, totalGb) {
  if (!totalGb || totalGb <= 0) return 0
  return (Number(usedBytes) / (totalGb * 1024 ** 3)) * 100
}

/**
 * Снимает usage юзера на каждом из squad'ов плана за текущий период.
 * Создаёт/обновляет subscription_squad_state для текущего period_key.
 */
async function syncSquadUsage(subscription, settings) {
  if (!subscription?.remnwave_user_uuid) return { ok: false, reason: 'no_remnwave_uuid' }

  const planId = subscription.plan_id
  if (!planId) return { ok: false, reason: 'no_plan_id' }

  const planR = await db.query('SELECT * FROM plans WHERE id = $1', [planId])
  const plan = planR.rows[0]
  if (!plan) return { ok: false, reason: 'plan_not_found' }

  const squadUuids = Array.isArray(plan.squad_uuids) ? plan.squad_uuids : []
  if (squadUuids.length === 0) return { ok: true, reason: 'no_squads' }

  const periodKey = getCurrentPeriodKey(settings.squad_period_strategy, subscription)
  const limits = await getEffectiveLimits(planId)
  const squadNodeMap = await resolveSquadNodeMap()

  // bandwidth-stats за текущий период
  const today = new Date().toISOString().slice(0, 10)
  let periodStart
  if (settings.squad_period_strategy === 'subscription_period') {
    periodStart = periodKey // YYYY-MM-DD
  } else {
    periodStart = `${periodKey}-01` // calendar_month
  }
  let stats
  try {
    stats = await remnwave.getUserBandwidthStats(subscription.remnwave_user_uuid, periodStart, today)
  } catch (err) {
    return { ok: false, reason: 'rw_stats_failed', error: err.message }
  }

  // series[] = per-node данные. Маппим их к squad'ам нашего плана.
  const perNodeBytes = new Map()
  for (const s of (stats?.series || [])) {
    perNodeBytes.set(s.uuid, Number(s.total || 0))
  }

  const squadNames = new Map()
  // Имена squad'ов берём из RemnaWave squads
  try {
    const allSquads = await remnwave.getInternalSquads()
    for (const sq of allSquads) squadNames.set(sq.uuid, sq.name || '')
  } catch {}

  const results = []
  for (const squadUuid of squadUuids) {
    const nodeSet = squadNodeMap.get(squadUuid) || new Set()
    let usedBytes = 0
    for (const nodeUuid of nodeSet) usedBytes += (perNodeBytes.get(nodeUuid) || 0)

    const limitInfo = limits.get(squadUuid) || { limit_gb: 0 }
    const baseLimitGb = Number(limitInfo.limit_gb || 0)

    // Upsert состояния
    const existing = await db.query(
      `SELECT * FROM subscription_squad_state
       WHERE subscription_id = $1 AND squad_uuid = $2 AND period_key = $3`,
      [subscription.id, squadUuid, periodKey]
    )

    let row
    if (existing.rows.length === 0) {
      const ins = await db.query(
        `INSERT INTO subscription_squad_state
          (subscription_id, user_id, squad_uuid, squad_name, period_key,
           base_limit_gb, used_bytes, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [subscription.id, subscription.user_id, squadUuid, squadNames.get(squadUuid) || null,
         periodKey, baseLimitGb, usedBytes]
      )
      row = ins.rows[0]
    } else {
      const upd = await db.query(
        `UPDATE subscription_squad_state
         SET used_bytes = $1, last_synced_at = NOW(),
             squad_name = COALESCE(squad_name, $2),
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [usedBytes, squadNames.get(squadUuid) || null, existing.rows[0].id]
      )
      row = upd.rows[0]
    }
    results.push(row)
  }
  return { ok: true, periodKey, states: results }
}

/**
 * Применяет политику: disable превышенные, reactivate если usage снизился (актуально после top-up).
 */
async function enforceQuotas(subscription, settings) {
  const periodKey = getCurrentPeriodKey(settings.squad_period_strategy, subscription)
  const states = (await db.query(
    `SELECT * FROM subscription_squad_state
     WHERE subscription_id = $1 AND period_key = $2`,
    [subscription.id, periodKey]
  )).rows

  let disabled = 0, reactivated = 0, warned = 0

  for (const state of states) {
    const totalGb = totalLimitGB(state)
    const pct = usagePercent(state.used_bytes, totalGb)

    if (totalGb <= 0) continue // нет лимита — нечего enforce'ить

    // Превышение → disable
    if (pct >= 100 && !state.is_disabled) {
      await disableSquad(subscription, state)
      disabled++
      continue
    }

    // Восстановление (после top-up)
    if (pct < 100 && state.is_disabled) {
      await reactivateSquad(subscription, state)
      reactivated++
      continue
    }

    // Warning 80%
    if (pct >= settings.squad_quota_warn_percent && !state.is_disabled && !state.warned_80_at) {
      await sendWarning(subscription, state, pct, settings)
      await db.query(
        `UPDATE subscription_squad_state SET warned_80_at = NOW() WHERE id = $1`,
        [state.id]
      )
      warned++
    }
  }
  return { disabled, reactivated, warned }
}

async function sendWarning(subscription, state, percent, settings) {
  if (!subscription.user_id) return
  if (settings.inapp_enabled) {
    await notifications.notifyTrafficWarning(subscription.user_id, {
      nodeName: state.squad_name || state.squad_uuid.slice(0, 8),
      usedGb: ((state.used_bytes || 0) / (1024 ** 3)).toFixed(2),
      limitGb: totalLimitGB(state).toFixed(2),
      percent: percent.toFixed(0),
    }).catch(() => {})
  }
  if (settings.email_enabled) {
    const userR = await db.query('SELECT email FROM users WHERE id = $1', [subscription.user_id])
    const email = userR.rows[0]?.email
    if (email) {
      await sendNotificationEmail(email, {
        subject: `Трафик на сервере «${state.squad_name || ''}» приближается к лимиту`,
        heading: '⚠ Внимание: лимит почти исчерпан',
        body: `На сервере <b>${state.squad_name || state.squad_uuid}</b> использовано <b>${((state.used_bytes || 0) / (1024 ** 3)).toFixed(2)} ГБ</b> из <b>${totalLimitGB(state).toFixed(2)} ГБ</b> (${percent.toFixed(0)}%).<br><br>При достижении 100% сервер будет автоматически отключён до начала следующего периода. Можно купить дополнительные ГБ чтобы продолжить пользоваться.`,
        ctaText: 'Купить трафик',
        ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
        accent: '#f59e0b',
      }).catch(() => {})
    }
  }
}

/**
 * Удаляет squad из activeInternalSquads юзера в RemnaWave. Помечает state как disabled.
 */
async function disableSquad(subscription, state) {
  if (!subscription.remnwave_user_uuid) return

  // 1. Получаем текущий список squads юзера в RW
  let user
  try {
    user = await remnwave.getRemnwaveUserByUuid(subscription.remnwave_user_uuid)
  } catch (err) {
    console.error('[squadQuota] disableSquad: getUser failed', err.message)
    return
  }
  const currentSquads = (user?.activeInternalSquads || []).map(s => s.uuid || s)
  const newSquads = currentSquads.filter(u => u !== state.squad_uuid)

  if (newSquads.length !== currentSquads.length) {
    try {
      await remnwave.updateRemnwaveUser(subscription.remnwave_user_uuid, {
        activeInternalSquads: newSquads,
      })
    } catch (err) {
      console.error('[squadQuota] disableSquad: updateUser failed', err.message)
    }
  }

  await db.query(
    `UPDATE subscription_squad_state
     SET is_disabled = true, disabled_at = NOW(), reactivated_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [state.id]
  )

  // Notify
  const settings = await getSettings()
  if (subscription.user_id && settings?.inapp_enabled) {
    await notifications.notifyTrafficBlocked(subscription.user_id, {
      nodeName: state.squad_name || state.squad_uuid.slice(0, 8),
      usedGb: ((state.used_bytes || 0) / (1024 ** 3)).toFixed(2),
      limitGb: totalLimitGB(state).toFixed(2),
    }).catch(() => {})
  }
  if (settings?.email_enabled && subscription.user_id) {
    const userR = await db.query('SELECT email FROM users WHERE id = $1', [subscription.user_id])
    const email = userR.rows[0]?.email
    if (email) {
      await sendNotificationEmail(email, {
        subject: `Сервер «${state.squad_name || ''}» отключён — лимит трафика`,
        heading: '🚫 Сервер отключён',
        body: `Лимит трафика на сервере <b>${state.squad_name || state.squad_uuid}</b> исчерпан (<b>${((state.used_bytes || 0) / (1024 ** 3)).toFixed(2)} ГБ</b> из <b>${totalLimitGB(state).toFixed(2)} ГБ</b>).<br><br>Сервер автоматически восстановится в начале нового периода. Чтобы вернуть его сейчас — купите дополнительные ГБ.`,
        ctaText: 'Купить трафик',
        ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
        accent: '#ef4444',
      }).catch(() => {})
    }
  }
}

/**
 * Возвращает squad в activeInternalSquads юзера в RemnaWave. Помечает state как реактивированный.
 */
async function reactivateSquad(subscription, state) {
  if (!subscription.remnwave_user_uuid) return

  let user
  try {
    user = await remnwave.getRemnwaveUserByUuid(subscription.remnwave_user_uuid)
  } catch (err) {
    console.error('[squadQuota] reactivateSquad: getUser failed', err.message)
    return
  }
  const currentSquads = (user?.activeInternalSquads || []).map(s => s.uuid || s)
  if (!currentSquads.includes(state.squad_uuid)) {
    try {
      await remnwave.updateRemnwaveUser(subscription.remnwave_user_uuid, {
        activeInternalSquads: [...currentSquads, state.squad_uuid],
      })
    } catch (err) {
      console.error('[squadQuota] reactivateSquad: updateUser failed', err.message)
    }
  }

  await db.query(
    `UPDATE subscription_squad_state
     SET is_disabled = false, reactivated_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [state.id]
  )

  const settings = await getSettings()
  if (subscription.user_id && settings?.inapp_enabled) {
    await notifications.notifyTrafficUnblocked(subscription.user_id, {
      nodeName: state.squad_name || state.squad_uuid.slice(0, 8),
    }).catch(() => {})
  }
}

/**
 * Добавляет N ГБ extra_gb в текущий период подписки на конкретный squad.
 * Используется при покупке топ-апа (user_purchase) или гранте от админа (admin_gift).
 *
 * Если squad был disabled и (used < new total limit) — auto-reactivate.
 */
async function addExtraTraffic({ subscription, squadUuid, gbAmount, source = 'user_purchase', amountPaid = 0, paymentId = null, grantedBy = null, notes = null }) {
  if (!subscription || !squadUuid || !gbAmount || gbAmount <= 0) {
    throw new Error('Invalid args for addExtraTraffic')
  }
  const settings = await getSettings()
  const periodKey = getCurrentPeriodKey(settings.squad_period_strategy, subscription)

  // Гарантируем существование state-row
  let stateR = await db.query(
    `SELECT * FROM subscription_squad_state WHERE subscription_id=$1 AND squad_uuid=$2 AND period_key=$3`,
    [subscription.id, squadUuid, periodKey]
  )
  let state = stateR.rows[0]
  if (!state) {
    // Создаём пустой state с base_limit_gb из тарифа
    const limits = await getEffectiveLimits(subscription.plan_id)
    const baseGb = limits.get(squadUuid)?.limit_gb || 0
    const ins = await db.query(
      `INSERT INTO subscription_squad_state
        (subscription_id, user_id, squad_uuid, period_key, base_limit_gb)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [subscription.id, subscription.user_id, squadUuid, periodKey, baseGb]
    )
    state = ins.rows[0]
  }

  const upd = await db.query(
    `UPDATE subscription_squad_state
     SET extra_gb = extra_gb + $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [Number(gbAmount), state.id]
  )

  // Журнал покупки
  await db.query(
    `INSERT INTO squad_traffic_purchases
      (subscription_id, user_id, squad_uuid, squad_name, period_key,
       gb_amount, amount_paid, source, payment_id, granted_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [subscription.id, subscription.user_id, squadUuid, state.squad_name,
     periodKey, gbAmount, amountPaid, source, paymentId, grantedBy, notes]
  )

  // Если был disabled и теперь usage в пределах — реактивируем
  const updated = upd.rows[0]
  if (updated.is_disabled && usagePercent(updated.used_bytes, totalLimitGB(updated)) < 100) {
    await reactivateSquad(subscription, updated)
  }

  return updated
}

function calculateTopupPrice({ planId, squadUuid, gbAmount, settings, planLimits }) {
  // 1. Override из plan_squad_limits
  let pricePerGb = planLimits?.get?.(squadUuid)?.topup_price_per_gb
  // 2. Fallback из settings
  if (pricePerGb == null) pricePerGb = Number(settings?.squad_topup_default_price || 0)
  return {
    pricePerGb,
    total: +(Number(gbAmount) * pricePerGb).toFixed(2),
  }
}

/**
 * Тик cron'а: проходит по активным подпискам и применяет sync + enforce.
 */
async function runScan() {
  const settings = await getSettings()
  if (!settings) return { ok: false, reason: 'no_settings' }
  if (!settings.squad_quota_enabled) return { ok: false, reason: 'disabled' }

  const startedAt = Date.now()
  const subs = (await db.query(`
    SELECT s.* FROM subscriptions s
    WHERE s.is_active = true
      AND s.remnwave_user_uuid IS NOT NULL
      AND s.plan_id IS NOT NULL
  `)).rows

  let totalDisabled = 0, totalReactivated = 0, totalWarned = 0, errors = 0
  for (const sub of subs) {
    try {
      await syncSquadUsage(sub, settings)
      const r = await enforceQuotas(sub, settings)
      totalDisabled    += r.disabled
      totalReactivated += r.reactivated
      totalWarned      += r.warned
    } catch (err) {
      console.error('[squadQuota] tick error for sub', sub.id, err.message)
      errors++
    }
  }

  const summary = `subs:${subs.length} disabled:${totalDisabled} react:${totalReactivated} warn:${totalWarned} err:${errors}`
  console.log(`[squadQuota] scan: ${summary}`)
  return { ok: true, durationMs: Date.now() - startedAt, ...{ totalDisabled, totalReactivated, totalWarned, errors } }
}

module.exports = {
  resolveSquadNodeMap,
  getCurrentPeriodKey,
  getEffectiveLimits,
  syncSquadUsage,
  enforceQuotas,
  disableSquad,
  reactivateSquad,
  addExtraTraffic,
  calculateTopupPrice,
  runScan,
  totalLimitGB,
  usagePercent,
}
