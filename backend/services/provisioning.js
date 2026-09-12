/**
 * Выдача доступа в RemnaWave для уже оплаченной подписки — с повторами.
 *
 * Почему это отдельный модуль, а не пара строк в activateSubscription.
 *
 * Деньги с человека уже взяты. Отказать ему нельзя: платёж состоялся, и «не
 * получилось создать пользователя» — наша проблема, а не его. Но и делать вид,
 * что всё хорошо, тоже нельзя: до этой правки подписка писалась в базу с
 * remnwave_user_uuid = NULL, и человек видел активную подписку, к которой
 * невозможно подключиться. Значит, нужен третий путь: записать, что доступ не
 * выдан, и выдавать его потом, пока не получится.
 *
 * Отсюда состояния:
 *   ok      — пользователь в панели есть, срок и трафик проставлены;
 *   pending — не получилось, стоит в очереди на повтор;
 *   failed  — попытки исчерпаны, дальше нужен человек.
 *
 * is_active при этом остаётся true. Снять его — значит показать заплатившему
 * человеку «подписки нет», и он решит, что деньги пропали; вдобавок он сможет
 * взять пробник поверх оплаченного тарифа или купить второй раз. Подписка
 * оплачена и существует — просто доступ к ней пока не выдан, и это разные вещи.
 */
const db = require('../db')
const remnwave = require('./remnwave')
const remnwaveUsernameSvc = require('./remnwaveUsername')
const log = require('./logger').for('Выдача доступа')

/**
 * Задержки перед повторами, минуты. Первые попытки частые — типичный сбой
 * (панель перезапускалась, сеть моргнула) проходит за минуты. Дальше реже,
 * чтобы не долбить панель сутками. Всего около 11 часов.
 */
const BACKOFF_MIN = [1, 2, 5, 10, 30, 60, 120, 180, 360, 360]
const MAX_ATTEMPTS = BACKOFF_MIN.length

function nextTry(attempts) {
  const min = BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)]
  return new Date(Date.now() + min * 60000)
}

/** Отметить, что доступ выдан. */
async function markOk(subId, { uuid, username, url }) {
  await db.query(
    `UPDATE subscriptions
        SET remnwave_user_uuid = COALESCE($2, remnwave_user_uuid),
            remnwave_username  = COALESCE($3, remnwave_username),
            subscription_url   = COALESCE($4, subscription_url),
            provisioning_status = 'ok',
            provisioning_error = NULL,
            provisioning_next_try_at = NULL,
            provisioned_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [subId, uuid || null, username || null, url || null]
  )
}

/**
 * Отметить неудачу и поставить в очередь.
 * @returns {{status: string, attempts: number, giveUp: boolean}}
 */
async function markFailed(subId, errorText) {
  const { rows } = await db.query(
    'SELECT provisioning_attempts FROM subscriptions WHERE id = $1',
    [subId]
  )
  const attempts = (rows[0]?.provisioning_attempts || 0) + 1
  const giveUp = attempts >= MAX_ATTEMPTS
  await db.query(
    `UPDATE subscriptions
        SET provisioning_status = $2,
            provisioning_error = $3,
            provisioning_attempts = $4,
            provisioning_next_try_at = $5,
            updated_at = NOW()
      WHERE id = $1`,
    [subId, giveUp ? 'failed' : 'pending', String(errorText || '').slice(0, 1000),
     attempts, giveUp ? null : nextTry(attempts)]
  )
  return { status: giveUp ? 'failed' : 'pending', attempts, giveUp }
}

/**
 * Выдать доступ для одной подписки: создать пользователя в панели либо
 * обновить существующего.
 *
 * Идемпотентна. Сначала ищем пользователя по стабильному username — если он
 * уже есть (остался от пробника или от неудачной попытки, где панель успела
 * создать его до обрыва ответа), обновляем, а не плодим второго.
 *
 * @returns {{ok: true, uuid} | {ok: false, error, status, attempts}}
 */
async function provisionSubscription(sub) {
  // Сначала по plan_id: имя тарифа админ может переименовать, и тогда поиск по
  // имени промахнётся ровно в тот момент, когда чинить уже нечем.
  const planRes = sub.plan_id
    ? await db.query('SELECT * FROM plans WHERE id = $1', [sub.plan_id])
    : await db.query('SELECT * FROM plans WHERE name = $1 ORDER BY id LIMIT 1', [sub.plan_name])
  const plan = planRes.rows[0] || null
  const squadUuids = plan?.squad_uuids || []

  if (!squadUuids.length) {
    // Повторять нечего: пока админ не задаст серверную группу, следующая
    // попытка кончится тем же. Ставим в очередь всё равно — вдруг починит.
    const msg = plan
      ? `У тарифа «${sub.plan_name}» не задана серверная группа (squad_uuids пуст)`
      : `Тариф «${sub.plan_name}» не найден`
    const r = await markFailed(sub.id, msg)
    log.warn(`Подписка #${sub.id}: ${msg}`)
    return { ok: false, error: msg, ...r }
  }

  const trafficLimitBytes = (plan.traffic_gb || 0) * 1024 * 1024 * 1024

  // Срок берём из подписки — он посчитан при активации. Пересчитывать его при
  // повторе нельзя: человек потеряет дни, пока мы чинились.
  const expireAt = new Date(sub.expires_at)

  try {
    const username = sub.remnwave_username
      || await remnwaveUsernameSvc.resolveUsernameForUser(sub.user_id, remnwave)
    const userMeta = await remnwaveUsernameSvc.getRemnwaveMetadata(sub.user_id)
    const hwid = plan.hwid_device_limit != null ? { hwidDeviceLimit: Number(plan.hwid_device_limit) } : {}

    let rwUser = null
    const existing = await remnwave.getRemnwaveUserByUsername(username).catch(() => null)

    if (existing?.uuid) {
      rwUser = await remnwave.updateRemnwaveUser(existing.uuid, {
        expireAt, trafficLimitBytes, status: 'ACTIVE',
        activeInternalSquads: squadUuids, ...userMeta, ...hwid,
      })
      rwUser = { ...existing, ...(rwUser || {}) }
    } else {
      rwUser = await remnwave.createRemnwaveUser({
        username, trafficLimitBytes, expireAt,
        activeInternalSquads: squadUuids, ...userMeta, ...hwid,
      })
    }

    if (!rwUser?.uuid) throw new Error('панель не вернула uuid пользователя')

    let url = rwUser.subscriptionUrl || null
    if (!url && rwUser.shortUuid) {
      const base = process.env.REMNWAVE_API_URL || 'https://panel-root.guard-proxy.pro'
      url = `${base}/api/sub/${rwUser.shortUuid}`
    }

    await markOk(sub.id, { uuid: rwUser.uuid, username: rwUser.username || username, url })
    log.info(`Подписка #${sub.id}: доступ выдан, uuid=${rwUser.uuid}`)
    return { ok: true, uuid: rwUser.uuid }
  } catch (err) {
    const r = await markFailed(sub.id, err.message)
    log.error(`Подписка #${sub.id}: выдать доступ не удалось (попытка ${r.attempts}/${MAX_ATTEMPTS})`, err)
    return { ok: false, error: err.message, ...r }
  }
}

/**
 * Поставить подписку в очередь и позвать админа.
 *
 * Вызывается из активации, когда доступ выдать не удалось. Уведомление —
 * единственный способ узнать о проблеме вовремя: снаружи всё выглядит
 * успешно, платёж прошёл, кабинет показывает подписку.
 */
async function queueAndAlert(subId, errorText, { userId, planName } = {}) {
  const r = await markFailed(subId, errorText)
  notifyAdmin(subId, errorText, r, { userId, planName }).catch(e =>
    log.warn('Уведомление админу не ушло: ' + e.message))
  return r
}

async function notifyAdmin(subId, errorText, r, { userId, planName } = {}) {
  const notify = require('./telegramBot/notify')
  let login = userId ? String(userId) : '?'
  if (userId) {
    const u = await db.query('SELECT login FROM users WHERE id = $1', [userId]).catch(() => null)
    if (u?.rows?.[0]?.login) login = u.rows[0].login
  }
  return notify.notifyAdmin('admin_provisioning_failed', {
    sub_id: subId,
    login,
    plan: planName || '?',
    error: String(errorText || '').slice(0, 300),
    attempts: r.attempts,
    max: MAX_ATTEMPTS,
    next: r.giveUp ? 'повторов больше не будет' : 'следующая попытка скоро',
  })
}

/**
 * Разобрать очередь. Дёргается кроном.
 *
 * Строку забираем атомарно (сдвигаем next_try_at вперёд под условием), чтобы
 * два тика не начали выдавать доступ одновременно: в панели это дало бы две
 * параллельные правки одного пользователя.
 */
async function retryDue({ limit = 5 } = {}) {
  const { rows } = await db.query(
    `UPDATE subscriptions
        SET provisioning_next_try_at = NOW() + interval '5 minutes'
      WHERE id IN (
        SELECT id FROM subscriptions
         WHERE provisioning_status = 'pending'
           AND (provisioning_next_try_at IS NULL OR provisioning_next_try_at <= NOW())
         ORDER BY provisioning_next_try_at NULLS FIRST
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [limit]
  )
  if (!rows.length) return { picked: 0, fixed: 0 }

  let fixed = 0
  for (const sub of rows) {
    const before = sub.provisioning_attempts
    const r = await provisionSubscription(sub)
    if (r.ok) {
      fixed++
      notifyFixed(sub, before + 1).catch(() => {})
    } else if (r.giveUp) {
      notifyAdmin(sub.id, r.error, r, { userId: sub.user_id, planName: sub.plan_name }).catch(() => {})
    }
  }
  return { picked: rows.length, fixed }
}

async function notifyFixed(sub, attempts) {
  const notify = require('./telegramBot/notify')
  const u = await db.query('SELECT login FROM users WHERE id = $1', [sub.user_id]).catch(() => null)
  return notify.notifyAdmin('admin_provisioning_fixed', {
    sub_id: sub.id,
    login: u?.rows?.[0]?.login || String(sub.user_id),
    plan: sub.plan_name,
    attempts,
  })
}

/**
 * Активация упала целиком — подписки не появилось вовсе.
 *
 * Отдельно от queueAndAlert: там подписка есть и её чинит крон, а здесь чинить
 * нечего — в базе нет строки, которую можно поставить в очередь. Нужен человек:
 * посмотреть платёж и выдать подписку руками.
 */
async function alertActivationFailed(payment, err) {
  if (!payment) return
  const notify = require('./telegramBot/notify')
  let login = String(payment.user_id || '?')
  const u = await db.query('SELECT login FROM users WHERE id = $1', [payment.user_id]).catch(() => null)
  if (u?.rows?.[0]?.login) login = u.rows[0].login

  log.error(`Платёж #${payment.id}: активация упала, подписки нет`, err)
  return notify.notifyAdmin('admin_activation_failed', {
    payment_id: payment.id,
    login,
    amount: payment.amount,
    plan_id: payment.plan_id == null ? 'тариф удалён' : payment.plan_id,
    error: String(err?.message || err).slice(0, 300),
  })
}

/** Сводка для админки: сколько подписок сейчас без доступа. */
async function queueStats() {
  const { rows } = await db.query(
    `SELECT provisioning_status AS status, COUNT(*)::int AS n
       FROM subscriptions
      WHERE provisioning_status <> 'ok'
      GROUP BY provisioning_status`
  )
  const out = { pending: 0, failed: 0 }
  for (const r of rows) out[r.status] = r.n
  return out
}

module.exports = {
  provisionSubscription, queueAndAlert, alertActivationFailed, retryDue, queueStats,
  markOk, markFailed, MAX_ATTEMPTS, BACKOFF_MIN,
}
