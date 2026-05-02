/**
 * Traffic Guard — фоновая проверка трафика наших юзеров по нодам RemnaWave
 * с автоматической блокировкой нарушителей и нотификациями.
 *
 * Точка входа — runCheck(): дёргается из cron/trafficGuard.js или вручную.
 *
 * Логика:
 *   1. Загружаем settings (singleton) → если enabled=false — возвращаем no-op
 *   2. Загружаем активные лимиты (node + plan, в зависимости от source)
 *   3. Берём наших юзеров с подписками (uuid + plan_name + email)
 *   4. Параллельно (concurrency=5) дёргаем bandwidth-stats для каждого юзера
 *   5. Для каждой пары user×node:
 *        - смотрим, какой лимит применим (node / plan / min(both))
 *        - сравниваем с usedBytes
 *        - если >= 100% и нет блок-нарушения за этот period_key → блокируем + violation
 *        - если >= warn% и нет warn-нарушения за этот period_key → нотификация + violation
 *   6. Делаем auto_unblock для блокировок прошлых period_key (новый период наступил)
 *   7. Обновляем settings.last_check_at + summary
 */

const db = require('../db')
const remnwave = require('./remnwave')
const notifications = require('./notifications')
const { sendNotificationEmail } = require('./email')
const ipBan = require('./ipBan')
const sshAgent = require('./sshAgent')

const CONCURRENCY = 5

// ─── Утилиты периода ─────────────────────────────────────────────────────────

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

/**
 * Возвращает диапазон дат и ключ для дедупликации.
 *   day   → start = today,           end = today,           key='2026-04-29'
 *   week  → start = monday this week,end = today,           key='2026-W17'
 *   month → start = 1st day of month,end = today,           key='2026-04'
 *   30d   → start = 30 days ago,     end = today,           key='30d:<end>'
 */
function periodRange(period) {
  const today = new Date()
  const ymd = (d) => d.toISOString().slice(0, 10)
  let start
  let key
  if (period === 'day') {
    start = today
    key = ymd(today)
  } else if (period === 'week') {
    const dayOfWeek = today.getUTCDay() || 7
    start = new Date(today)
    start.setUTCDate(today.getUTCDate() - (dayOfWeek - 1))
    const w = isoWeek(today).toString().padStart(2, '0')
    key = `${today.getUTCFullYear()}-W${w}`
  } else if (period === '30d') {
    start = new Date(today.getTime() - 30 * 86400000)
    key = `30d:${ymd(today)}`
  } else { // month (default)
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    key = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`
  }
  return { start: ymd(start), end: ymd(today), key }
}

// ─── Concurrency-limited map ─────────────────────────────────────────────────

async function pmap(items, mapper, concurrency = CONCURRENCY) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      try { results[i] = await mapper(items[i], i) }
      catch (err) { results[i] = { __error: err.message } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

// ─── Node host resolver (с кешем) ────────────────────────────────────────────
// RemnaWave отдает массив нод с полем `address`. Кешируем на 5 минут.
let nodeHostCache = null
let nodeHostCachedAt = 0

async function resolveNodeHost(nodeUuid) {
  if (!nodeUuid) return null
  const now = Date.now()
  if (!nodeHostCache || (now - nodeHostCachedAt) > 5 * 60 * 1000) {
    try {
      const nodes = await remnwave.getNodes()
      nodeHostCache = new Map()
      for (const n of nodes) {
        if (n.uuid && n.address) nodeHostCache.set(n.uuid, n.address)
      }
      nodeHostCachedAt = now
    } catch (err) {
      console.error('[trafficGuard] resolveNodeHost: getNodes failed:', err.message)
      return null
    }
  }
  return nodeHostCache.get(nodeUuid) || null
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  const r = await db.query('SELECT * FROM traffic_guard_settings WHERE id = 1')
  return r.rows[0]
}

// ─── Загрузка лимитов ────────────────────────────────────────────────────────

async function loadNodeLimits() {
  const r = await db.query('SELECT * FROM node_traffic_limits WHERE enabled = true AND limit_gb > 0')
  const map = new Map()
  for (const row of r.rows) map.set(row.node_uuid, row)
  return map
}

async function loadPlanLimits() {
  // plan_id → { per_node_limit_gb, period }, плюс плану нужно имя
  const r = await db.query(`
    SELECT ptl.*, p.name AS plan_name
    FROM plan_traffic_limits ptl
    JOIN plans p ON p.id = ptl.plan_id
    WHERE ptl.enabled = true AND ptl.per_node_limit_gb > 0
  `)
  const map = new Map()
  for (const row of r.rows) {
    if (row.plan_name) map.set(row.plan_name, row)
  }
  return map
}

/**
 * Возвращает применимый лимит для пары (user_plan, node_uuid).
 * @returns {{ limit_gb, period, action }} или null если лимита нет
 */
function resolveLimit({ source, defaultPeriod, defaultAction, planLimit, nodeLimit }) {
  const candidates = []
  if ((source === 'node' || source === 'both') && nodeLimit) {
    candidates.push({
      limit_gb: nodeLimit.limit_gb,
      period: nodeLimit.period || defaultPeriod,
      action: nodeLimit.action || defaultAction,
      origin: 'node',
    })
  }
  if ((source === 'plan' || source === 'both') && planLimit) {
    candidates.push({
      limit_gb: planLimit.per_node_limit_gb,
      period: planLimit.period || defaultPeriod,
      action: defaultAction,
      origin: 'plan',
    })
  }
  if (!candidates.length) return null
  // При 'both' — берём более строгий (меньший лимит)
  candidates.sort((a, b) => a.limit_gb - b.limit_gb)
  return candidates[0]
}

// ─── Применение действия в RemnaWave ─────────────────────────────────────────

async function applyBlockAction(action, userUuid) {
  if (action === 'warn_only') return { applied: false, reason: 'warn_only' }
  if (action === 'disable_user') {
    try {
      await remnwave.disableRemnwaveUser(userUuid)
      return { applied: true, action: 'disabled_user' }
    } catch (err) {
      return { applied: false, error: err.message }
    }
  }
  if (action === 'disable_squad') {
    // Точечная блокировка squad'а — TODO для будущего расширения.
    // Для MVP fallback на disable_user.
    try {
      await remnwave.disableRemnwaveUser(userUuid)
      return { applied: true, action: 'disabled_user', note: 'disable_squad fallback to disable_user' }
    } catch (err) {
      return { applied: false, error: err.message }
    }
  }
  return { applied: false, reason: 'unknown_action' }
}

// ─── Главная функция проверки ────────────────────────────────────────────────

async function runCheck() {
  const startedAt = Date.now()
  const settings = await getSettings()
  if (!settings) return { ok: false, reason: 'no_settings' }
  if (!settings.enabled) return { ok: false, reason: 'guard_disabled' }

  const nodeLimits = await loadNodeLimits()
  const planLimits = await loadPlanLimits()
  if (nodeLimits.size === 0 && planLimits.size === 0) {
    await db.query(
      `UPDATE traffic_guard_settings
       SET last_check_at=NOW(), last_check_status='no_limits', last_check_summary='No active limits configured'
       WHERE id=1`
    )
    return { ok: true, reason: 'no_limits' }
  }

  // 1. Берём наших юзеров с активными подписками
  const usersResult = await db.query(`
    SELECT DISTINCT
      s.remnwave_user_uuid AS uuid,
      s.remnwave_username AS username,
      s.plan_name,
      s.user_id,
      u.email,
      u.registration_ip
    FROM subscriptions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.remnwave_user_uuid IS NOT NULL
      AND s.remnwave_user_uuid <> ''
      AND s.is_active = true
  `)
  const ourUsers = usersResult.rows
  if (ourUsers.length === 0) {
    await db.query(
      `UPDATE traffic_guard_settings
       SET last_check_at=NOW(), last_check_status='no_users', last_check_summary='No active subscriptions'
       WHERE id=1`
    )
    return { ok: true, reason: 'no_users', usersChecked: 0 }
  }

  // 2. Считаем сколько проверок нужно — берём все уникальные периоды
  const usedPeriods = new Set([settings.default_period])
  for (const l of nodeLimits.values()) if (l.period) usedPeriods.add(l.period)
  for (const l of planLimits.values()) if (l.period) usedPeriods.add(l.period)
  const periodCache = new Map()
  for (const p of usedPeriods) periodCache.set(p, periodRange(p))

  let totalWarnings = 0
  let totalBlocks = 0
  let totalErrors = 0
  let usersWithViolations = 0

  // 3. Параллельно проверяем каждого юзера
  await pmap(ourUsers, async (user) => {
    let userTouched = false
    // Для каждого периода нужны отдельные данные
    for (const [period, range] of periodCache.entries()) {
      let stats
      try {
        stats = await remnwave.getUserBandwidthStats(user.uuid, range.start, range.end)
      } catch (err) {
        totalErrors++
        return
      }
      const series = stats?.series || []
      const planLimit = user.plan_name ? planLimits.get(user.plan_name) : null

      for (const node of series) {
        const nodeLimit = nodeLimits.get(node.uuid)
        const limit = resolveLimit({
          source: settings.limit_source,
          defaultPeriod: settings.default_period,
          defaultAction: settings.default_action,
          planLimit: planLimit?.period === period || (!planLimit?.period && settings.default_period === period) ? planLimit : null,
          nodeLimit: nodeLimit?.period === period || (!nodeLimit?.period && settings.default_period === period) ? nodeLimit : null,
        })
        if (!limit || limit.limit_gb <= 0) continue

        const usedBytes = Number(node.total || 0)
        const limitBytes = limit.limit_gb * 1024 * 1024 * 1024 // GB → bytes
        const percent = (usedBytes / limitBytes) * 100

        // 100% — блокировка
        if (percent >= 100) {
          const inserted = await tryInsertViolation({
            user_id: user.user_id,
            remnwave_user_uuid: user.uuid,
            username: user.username,
            node_uuid: node.uuid,
            node_name: node.name,
            used_bytes: usedBytes,
            limit_bytes: limitBytes,
            used_percent: percent.toFixed(2),
            level: 'blocked',
            period,
            period_key: range.key,
          })
          if (inserted) {
            const result = await applyBlockAction(limit.action, user.uuid)
            await db.query(
              'UPDATE traffic_violations SET action_taken=$1, notes=$2 WHERE id=$3',
              [result.action || (result.applied ? 'disabled_user' : 'failed'),
               JSON.stringify({ resolveOrigin: limit.origin, applyResult: result }),
               inserted.id]
            )
            // IP-collection: registration_ip (Phase 1) + SSH-lookup настоящих IP с ноды (Phase 2)
            const collectedIps = new Set()
            if (user.registration_ip) collectedIps.add(user.registration_ip)

            if (settings.ssh_lookup_enabled && sshAgent.isConfigured()) {
              try {
                const nodeHost = node.address || node.uuid // RemnaWave series отдаёт name+uuid, host придётся резолвить отдельно
                const realHost = await resolveNodeHost(node.uuid)
                if (realHost) {
                  const liveIps = await sshAgent.lookupIp(realHost, user.username, 1)
                  for (const ip of liveIps) collectedIps.add(ip)
                }
              } catch (err) {
                console.error('[trafficGuard] SSH lookup failed for', user.username, '@', node.uuid, ':', err.message)
              }
            }

            const ipsArr = [...collectedIps]
            if (ipsArr.length > 0) {
              // Запишем IP в client_ips для UI
              await db.query(
                `UPDATE traffic_violations SET client_ips = $1::jsonb WHERE id = $2`,
                [JSON.stringify(ipsArr), inserted.id]
              )
              // Авто-бан всех собранных IP (если включено)
              if (settings.ip_ban_enabled) {
                for (const ip of ipsArr) {
                  await ipBan.addAutoBan({
                    ip,
                    violationId: inserted.id,
                    userId: user.user_id,
                    userUuid: user.uuid,
                    durationHours: settings.ip_ban_duration_hours,
                    reason: `Превышение лимита на ноде ${node.name}`,
                  })
                }
              }
            }
            // Notify user
            const usedGb = (usedBytes / 1024 / 1024 / 1024).toFixed(2)
            if (settings.inapp_enabled && user.user_id) {
              await notifications.notifyTrafficBlocked(user.user_id, {
                nodeName: node.name, usedGb, limitGb: limit.limit_gb,
              })
            }
            if (settings.email_enabled && user.email) {
              await sendNotificationEmail(user.email, {
                subject: 'Подписка отключена — превышен лимит трафика',
                heading: '🚫 Подписка отключена',
                body: `Превышен лимит трафика на сервере <b>${node.name}</b>: <b>${usedGb} ГБ</b> из <b>${limit.limit_gb} ГБ</b> (${percent.toFixed(0)}%).<br><br>Подписка автоматически отключена. Лимит будет сброшен в начале следующего периода (${period}).<br><br>Для восстановления раньше — свяжитесь с поддержкой.`,
                ctaText: 'Открыть личный кабинет',
                ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
                accent: '#ef4444',
              }).catch(() => {})
            }
            totalBlocks++
            userTouched = true
          }
        }
        // ≥80% — warning (только если ещё нет блокировки)
        else if (percent >= settings.warn_threshold_percent) {
          const inserted = await tryInsertViolation({
            user_id: user.user_id,
            remnwave_user_uuid: user.uuid,
            username: user.username,
            node_uuid: node.uuid,
            node_name: node.name,
            used_bytes: usedBytes,
            limit_bytes: limitBytes,
            used_percent: percent.toFixed(2),
            level: 'warning',
            period,
            period_key: range.key,
          })
          if (inserted) {
            await db.query('UPDATE traffic_violations SET action_taken=$1 WHERE id=$2', ['notified', inserted.id])
            const usedGb = (usedBytes / 1024 / 1024 / 1024).toFixed(2)
            if (settings.inapp_enabled && user.user_id) {
              await notifications.notifyTrafficWarning(user.user_id, {
                nodeName: node.name, usedGb, limitGb: limit.limit_gb, percent: percent.toFixed(0),
              })
            }
            if (settings.email_enabled && user.email) {
              await sendNotificationEmail(user.email, {
                subject: `Приближение к лимиту трафика (${percent.toFixed(0)}%)`,
                heading: '⚠️ Внимание: приближение к лимиту',
                body: `Вы использовали <b>${usedGb} ГБ</b> из <b>${limit.limit_gb} ГБ</b> (${percent.toFixed(0)}%) на сервере <b>${node.name}</b>.<br><br>При достижении 100% подписка будет автоматически отключена до начала следующего периода (${period}).`,
                ctaText: 'Посмотреть статистику',
                ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
                accent: '#f59e0b',
              }).catch(() => {})
            }
            totalWarnings++
            userTouched = true
          }
        }
      }
    }
    if (userTouched) usersWithViolations++
  })

  // 4. Auto-unblock: блокировки прошлых period_key → разблокировать в RemnaWave + пометить resolved
  const expiredBlocks = await db.query(`
    SELECT id, remnwave_user_uuid, username, node_name, user_id, period, period_key
    FROM traffic_violations
    WHERE level='blocked' AND resolved_at IS NULL AND action_taken='disabled_user'
  `)
  let autoUnblocked = 0
  for (const v of expiredBlocks.rows) {
    const currentKey = periodCache.get(v.period)?.key
    if (!currentKey) continue
    if (v.period_key !== currentKey) {
      // Период истёк — разблокируем
      try {
        await remnwave.enableRemnwaveUser(v.remnwave_user_uuid)
        await db.query(
          `UPDATE traffic_violations SET resolved_at=NOW(), action_taken='auto_unblock' WHERE id=$1`,
          [v.id]
        )
        // Снимаем связанные IP-баны (только source='auto_violation')
        await ipBan.removeBansByViolation(v.id)
        if (settings.inapp_enabled && v.user_id) {
          await notifications.notifyTrafficUnblocked(v.user_id, { nodeName: v.node_name })
        }
        autoUnblocked++
      } catch (err) {
        console.error('[trafficGuard] auto-unblock failed for', v.remnwave_user_uuid, err.message)
      }
    }
  }

  // 5. Cleanup expired IP-bans (TTL прошёл)
  const expiredBans = await ipBan.cleanupExpired()

  const summary = `users:${ourUsers.length} warn:${totalWarnings} block:${totalBlocks} unblock:${autoUnblocked} ip-expired:${expiredBans} err:${totalErrors}`
  await db.query(
    `UPDATE traffic_guard_settings
     SET last_check_at=NOW(), last_check_status='ok', last_check_summary=$1
     WHERE id=1`,
    [summary]
  )

  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    usersChecked: ourUsers.length,
    usersWithViolations,
    warnings: totalWarnings,
    blocks: totalBlocks,
    expiredBans,
    autoUnblocked,
    errors: totalErrors,
  }
}

async function tryInsertViolation(v) {
  try {
    const r = await db.query(
      `INSERT INTO traffic_violations
        (user_id, remnwave_user_uuid, username, node_uuid, node_name,
         used_bytes, limit_bytes, used_percent, level, period, period_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (remnwave_user_uuid, node_uuid, period_key, level) DO NOTHING
       RETURNING *`,
      [v.user_id, v.remnwave_user_uuid, v.username, v.node_uuid, v.node_name,
       v.used_bytes, v.limit_bytes, v.used_percent, v.level, v.period, v.period_key]
    )
    return r.rows[0] || null
  } catch (err) {
    console.error('[trafficGuard] tryInsertViolation error:', err.message)
    return null
  }
}

module.exports = { runCheck, getSettings, periodRange, resolveNodeHost }
