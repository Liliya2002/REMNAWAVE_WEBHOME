/**
 * planSync — синхронизация изменений в плане → активные подписки → RemnaWave.
 *
 * Сценарии когда вызывается:
 *   - Админ изменил squad_uuids в /admin/plans (PUT /api/plans/:id)
 *   - Админ изменил traffic_gb в плане
 *   - Ручной trigger из UI «Применить ко всем подпискам»
 *
 * Уважает squadQuota disabled-state: если у юзера какой-то squad был отключён
 * системой за превышение трафика — он НЕ реактивируется sync'ом.
 */
const dbModule = require('../db')
const remnwave = require('./remnwave')

/**
 * Синхронизирует все активные подписки плана с RemnaWave.
 *
 * @param {number} planId
 * @param {object} [opts]
 * @param {boolean} [opts.syncSquads=true]   — обновлять activeInternalSquads
 * @param {boolean} [opts.syncTraffic=true]  — обновлять trafficLimitBytes
 * @returns {Promise<{total, synced, skipped, failed, errors}>}
 */
async function syncPlanToSubscriptions(planId, opts = {}) {
  const { syncSquads = true, syncTraffic = true, syncHwid = true } = opts

  const planQ = await dbModule.query('SELECT * FROM plans WHERE id = $1', [planId])
  const plan = planQ.rows[0]
  if (!plan) throw new Error('Plan not found')

  const planSquadUuids = Array.isArray(plan.squad_uuids) ? plan.squad_uuids : []
  const planTrafficGb = Number(plan.traffic_gb || 0)
  const planTrafficBytes = planTrafficGb * (1024 ** 3)

  // Все активные подписки этого плана с привязанным RW
  const subsQ = await dbModule.query(
    `SELECT s.id, s.user_id, s.remnwave_user_uuid, s.expires_at, s.traffic_limit_gb
       FROM subscriptions s
      WHERE s.plan_id = $1
        AND s.is_active = true
        AND s.expires_at > NOW()
        AND s.remnwave_user_uuid IS NOT NULL`,
    [planId]
  )

  const total = subsQ.rows.length
  let synced = 0, skipped = 0, failed = 0
  const errors = []

  // Squad-quota: какие squad'ы заблокированы у каких подписок в текущем периоде
  // (чтобы не реактивировать их sync'ом)
  let disabledMap = new Map() // subscription_id → Set<squad_uuid>
  if (syncSquads && planSquadUuids.length > 0) {
    const settingsQ = await dbModule.query('SELECT squad_period_strategy FROM traffic_guard_settings WHERE id = 1')
    const strategy = settingsQ.rows[0]?.squad_period_strategy || 'calendar_month'

    // Простая выборка disabled state для подписок этого плана за актуальные периоды
    const disabledQ = await dbModule.query(
      `SELECT subscription_id, squad_uuid FROM subscription_squad_state
        WHERE subscription_id IN (SELECT id FROM subscriptions WHERE plan_id = $1)
          AND is_disabled = true`,
      [planId]
    )
    for (const row of disabledQ.rows) {
      if (!disabledMap.has(row.subscription_id)) disabledMap.set(row.subscription_id, new Set())
      disabledMap.get(row.subscription_id).add(row.squad_uuid)
    }
  }

  for (const sub of subsQ.rows) {
    try {
      const updatePayload = {}

      if (syncSquads) {
        const disabledForSub = disabledMap.get(sub.id) || new Set()
        const targetSquads = planSquadUuids.filter(uuid => !disabledForSub.has(uuid))
        updatePayload.activeInternalSquads = targetSquads
      }

      if (syncTraffic && Number(sub.traffic_limit_gb || 0) !== planTrafficGb) {
        updatePayload.trafficLimitBytes = planTrafficBytes
        // Обновляем и в нашей БД для консистентности
        await dbModule.query(
          'UPDATE subscriptions SET traffic_limit_gb = $1, updated_at = NOW() WHERE id = $2',
          [planTrafficGb, sub.id]
        )
      }

      if (syncHwid && plan.hwid_device_limit != null) {
        updatePayload.hwidDeviceLimit = Number(plan.hwid_device_limit)
      }

      if (Object.keys(updatePayload).length === 0) {
        skipped++
        continue
      }

      await remnwave.updateRemnwaveUser(sub.remnwave_user_uuid, updatePayload)
      synced++
    } catch (err) {
      failed++
      errors.push({ subscription_id: sub.id, user_id: sub.user_id, error: err.message })
    }
  }

  return { total, synced, skipped, failed, errors }
}

/**
 * Сравнивает старое и новое состояние плана и решает нужен ли sync.
 * @returns {boolean}
 */
function needsSync(oldPlan, newPlan) {
  if (!oldPlan || !newPlan) return false
  const oldSquads = JSON.stringify((oldPlan.squad_uuids || []).slice().sort())
  const newSquads = JSON.stringify((newPlan.squad_uuids || []).slice().sort())
  if (oldSquads !== newSquads) return true
  if (Number(oldPlan.traffic_gb || 0) !== Number(newPlan.traffic_gb || 0)) return true
  // hwid_device_limit может быть null — сравниваем строго
  if ((oldPlan.hwid_device_limit ?? null) !== (newPlan.hwid_device_limit ?? null)) return true
  return false
}

module.exports = { syncPlanToSubscriptions, needsSync }
