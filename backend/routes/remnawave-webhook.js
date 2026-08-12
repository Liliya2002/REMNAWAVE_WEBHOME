/**
 * Приём вебхуков RemnaWave.
 *
 * Панель шлёт POST в момент события — опрашивать её не нужно, уведомление
 * уходит в Telegram практически мгновенно.
 *
 * Включается на стороне ПАНЕЛИ (её .env):
 *   WEBHOOK_ENABLED=true
 *   WEBHOOK_URL=https://наш-домен/api/webhooks/remnawave
 *   WEBHOOK_SECRET_HEADER=<секрет>
 *
 * Тот же секрет вводится у нас — им проверяется подпись.
 *
 * Эндпоинт публичный (JWT тут быть не может — это server-to-server вызов),
 * подлинность подтверждается ИСКЛЮЧИТЕЛЬНО подписью. Путь /api/webhooks/*
 * уже в белом списке middleware/maintenance.js, иначе в режиме обслуживания
 * события молча терялись бы.
 */
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const db = require('../db')
const { decrypt } = require('../services/encryption')
const tgNotify = require('../services/telegramBot/notify')

const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function getSettings() {
  const { rows } = await db.query('SELECT * FROM remnawave_webhook_settings WHERE id = 1')
  const s = rows[0] || {}
  return {
    ...s,
    // Пусто в базе — откат на .env, как у платёжных ключей
    secret: s.secret ? decrypt(s.secret) : (process.env.REMNAWAVE_WEBHOOK_SECRET || ''),
  }
}

/**
 * Проверка подписи.
 *
 * Считаем HMAC от СЫРЫХ байт тела, а не от повторной сериализации: любое
 * расхождение в пробелах или порядке ключей после JSON.parse → stringify
 * сломало бы совпадение. Сравниваем через timingSafeEqual — обычное ===
 * утекает информацию по времени сравнения.
 */
function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(signature), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const fmtDuration = ms => {
  if (!isFinite(ms) || ms < 0) return null
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  return `${h} ч ${m % 60} мин`
}

const fmtBytes = n => {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let i = 0, x = v
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++ }
  return `${x.toFixed(i ? 1 : 0)} ${u[i]}`
}

/** Сколько нода пролежала: ищем последнее падение в журнале. */
async function downtimeSince(nodeUuid) {
  if (!nodeUuid) return null
  const { rows } = await db.query(
    `SELECT created_at FROM remnawave_node_events
      WHERE node_uuid = $1 AND event = 'node.connection_lost'
      ORDER BY created_at DESC LIMIT 1`,
    [nodeUuid]
  )
  if (!rows[0]) return null
  return fmtDuration(Date.now() - new Date(rows[0].created_at).getTime())
}

/** Данные для шаблона уведомления. */
function nodeFields(n) {
  return {
    name: escapeHtml(n.name),
    address: escapeHtml(n.address) + (n.port ? `:${n.port}` : ''),
    country: escapeHtml(n.countryCode || '—'),
    users: n.usersOnline ?? 0,
    reason: escapeHtml(n.lastStatusMessage || 'причина не указана'),
    xray: escapeHtml(n.versions?.xray || '—'),
    nodeVer: escapeHtml(n.versions?.node || '—'),
    cpu: n.system?.info?.cpus ? `${n.system.info.cpus} ядер` : '—',
    ram: n.system?.info?.memoryTotal ? fmtBytes(n.system.info.memoryTotal) : '—',
    provider: escapeHtml(n.provider?.name || '—'),
    profile: escapeHtml(n.configProfile?.activeConfigProfileUuid ? 'задан' : 'не задан'),
    inbounds: Array.isArray(n.configProfile?.activeInbounds) ? n.configProfile.activeInbounds.length : 0,
  }
}

/** Событие → (шаблон уведомления, доп. поля). */
async function buildNotification(event, node) {
  const f = nodeFields(node)
  switch (event) {
    case 'node.connection_lost':
      return { key: 'admin_node_down', data: f }
    case 'node.connection_restored':
      return { key: 'admin_node_up', data: { ...f, downtime: (await downtimeSince(node.uuid)) || 'неизвестно' } }
    case 'node.created':
      return { key: 'admin_node_created', data: f }
    case 'node.deleted':
      return { key: 'admin_node_deleted', data: f }
    case 'node.disabled':
      return { key: 'admin_node_disabled', data: f }
    case 'node.enabled':
      return { key: 'admin_node_enabled', data: f }
    case 'node.traffic_notify':
      return {
        key: 'admin_node_traffic',
        data: {
          ...f,
          used: fmtBytes(node.trafficUsedBytes),
          limit: fmtBytes(node.trafficLimitBytes),
          percent: node.notifyPercent ?? '—',
        },
      }
    default:
      return null
  }
}

router.post('/remnawave', async (req, res) => {
  // Отвечаем панели быстро и всегда: она не должна ждать нашу отправку в
  // Telegram и не должна ретраить из-за нашей внутренней ошибки.
  try {
    const cfg = await getSettings()
    if (!cfg.enabled) return res.json({ ok: true, skipped: 'disabled' })

    const sig = req.get('x-remnawave-signature')
    if (!verifySignature(req.rawBody, sig, cfg.secret)) {
      console.warn('[RW-webhook] неверная подпись, событие отброшено')
      return res.status(401).json({ error: 'bad signature' })
    }

    const { scope, event, data } = req.body || {}
    res.json({ ok: true })          // подтверждаем приём, дальше работаем сами

    if (scope !== 'node' || !data) return

    await db.query(
      `INSERT INTO remnawave_node_events
         (event, node_uuid, node_name, node_address, country_code,
          status_message, users_online, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [event, data.uuid || null, data.name || null, data.address || null,
       data.countryCode || null, data.lastStatusMessage || null,
       data.usersOnline ?? null, JSON.stringify(data).slice(0, 100000)]
    )

    // Включение/выключение конкретных событий живёт в настройках Telegram
    // (notifications_enabled) — notifyAdmin проверяет их сам. Второй список
    // здесь только расходился бы с тем, что видно в админке.
    const note = await buildNotification(event, data)
    if (!note) return

    await tgNotify.notifyAdmin(note.key, note.data)
    await db.query(
      `UPDATE remnawave_node_events SET notified = true
        WHERE id = (SELECT MAX(id) FROM remnawave_node_events WHERE event=$1 AND node_uuid IS NOT DISTINCT FROM $2)`,
      [event, data.uuid || null]
    )
  } catch (e) {
    console.error('[RW-webhook] error:', e.message)
    if (!res.headersSent) res.status(200).json({ ok: false })
  }
})

module.exports = router
