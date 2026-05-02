/**
 * Cron: ежедневные снимки потребления трафика для подписок.
 *
 * Раз в N часов (по умолчанию 24) проходит по всем активным подпискам с remnwave_user_uuid,
 * получает текущий usedTrafficBytes / trafficLimitBytes из Remnawave и пишет строку
 * в subscription_traffic_snapshots с UNIQUE(subscription_id, snapshot_date).
 *
 * При повторном запуске за сутки строка обновляется (UPSERT).
 *
 * Старт: backend/index.js
 */
const db = require('../db')
const { getRemnwaveUserByUuid } = require('../services/remnwave')

const HOURS = parseInt(process.env.CRON_TRAFFIC_SNAPSHOT_HOURS || '24', 10)

function num(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function snapshotAll() {
  const { rows: subs } = await db.query(
    `SELECT id, user_id, remnwave_user_uuid, traffic_limit_gb
       FROM subscriptions
      WHERE is_active = true
        AND remnwave_user_uuid IS NOT NULL`
  )

  let ok = 0, fail = 0
  for (const sub of subs) {
    try {
      const rwUser = await getRemnwaveUserByUuid(sub.remnwave_user_uuid)
      if (!rwUser) { fail++; continue }

      // RemnaWave 2.7+ кладёт usedTrafficBytes внутрь userTraffic, оставляем fallback на старый формат
      const used = num(rwUser.userTraffic?.usedTrafficBytes ?? rwUser.usedTrafficBytes)
      const limit = num(rwUser.trafficLimitBytes) || (sub.traffic_limit_gb * 1024 * 1024 * 1024)

      await db.query(
        `INSERT INTO subscription_traffic_snapshots (subscription_id, user_id, snapshot_date, used_bytes, limit_bytes, recorded_at)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, NOW())
         ON CONFLICT (subscription_id, snapshot_date)
         DO UPDATE SET used_bytes = EXCLUDED.used_bytes,
                       limit_bytes = EXCLUDED.limit_bytes,
                       recorded_at = NOW()`,
        [sub.id, sub.user_id, used, limit]
      )

      // Также обновляем поле в subscriptions, чтобы Dashboard и /my endpoint
      // видели актуальный трафик без задержки до следующего snapshot.
      const usedGb = +(used / (1024 ** 3)).toFixed(2)
      await db.query(
        `UPDATE subscriptions SET traffic_used_gb = $1, updated_at = NOW() WHERE id = $2`,
        [usedGb, sub.id]
      )
      ok++
    } catch (e) {
      fail++
      console.error(`[Cron] traffic snapshot для подписки ${sub.id} упал:`, e.message)
    }
  }

  if (ok || fail) console.log(`[Cron] traffic snapshots: ok=${ok} fail=${fail}`)
}

function start() {
  // Схема создаётся миграцией 0020_traffic_snapshots.
  // Первый прогон через 60 секунд (даём БД и Remnawave подняться)
  setTimeout(() => snapshotAll().catch(e => console.error('[Cron] traffic init error:', e.message)), 60 * 1000)
  setInterval(() => snapshotAll().catch(e => console.error('[Cron] traffic tick error:', e.message)), HOURS * 60 * 60 * 1000)
  console.log(`[Cron] Traffic snapshots запущены, интервал ${HOURS} ч.`)
}

module.exports = { start, snapshotAll }
