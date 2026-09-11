/**
 * Админ-роуты промокодов: CRUD, генерация пачками, журнал активаций, CSV.
 *
 * Не путать с /api/admin/bedolaga/promo — там чужие коды стороннего бота
 * продаж, только чтение. Здесь наши собственные.
 *
 * Коды не удаляются, а деактивируются: журнал активаций обязан их пережить.
 * На уровне БД это закреплено через ON DELETE RESTRICT, здесь эндпоинта
 * удаления просто нет.
 */
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { verifyToken, verifyAdmin } = require('../middleware')
const db = require('../db')
const promoService = require('../services/promoCodes')
const audit = require('../services/auditLog')

router.use(verifyToken, verifyAdmin)

const PERIODS = ['monthly', 'quarterly', 'yearly']

// Алфавит без 0/O и 1/I/L: коды диктуют голосом и переписывают с экрана.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

const BULK_MAX = 1000

/** Случайный код из безопасного алфавита. randomInt — без смещения. */
function randomCode(len) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)]
  return out
}

const toNum = v => (v === '' || v == null ? null : Number(v))
const toDate = v => (v === '' || v == null ? null : new Date(v))

/**
 * Разбор и проверка тела запроса. Возвращает { fields } или { error }.
 * @param {boolean} partial — для PUT: отсутствующие поля не трогаем
 */
function parseBody(body, partial = false) {
  const f = {}
  const has = k => Object.prototype.hasOwnProperty.call(body, k)

  if (!partial || has('code')) {
    const code = String(body.code || '').trim()
    if (!code) return { error: 'Код обязателен' }
    // Только латиница и цифры: «СКИДКА» кириллицей и латиницей выглядят
    // одинаково, а это разные строки — пользователь не поймёт, почему код
    // «не работает».
    if (!/^[A-Za-z0-9\-_]+$/.test(code)) {
      return { error: 'Код может содержать только латинские буквы, цифры, дефис и подчёркивание' }
    }
    if (code.length > 64) return { error: 'Код длиннее 64 символов' }
    f.code = code
    f.code_normalized = promoService.normalize(code)
  }

  if (!partial || has('type')) {
    if (!promoService.TYPES.includes(body.type)) return { error: 'Неизвестный тип промокода' }
    f.type = body.type
  }

  if (!partial || has('value')) {
    const value = Number(body.value)
    if (!Number.isFinite(value) || value <= 0) return { error: 'Значение должно быть больше нуля' }
    const type = f.type || body.type
    if (type === 'percent' && value > 100) return { error: 'Процент не может быть больше 100' }
    f.value = value
  }

  if (has('max_uses')) {
    const v = toNum(body.max_uses)
    if (v != null && (!Number.isInteger(v) || v < 1)) return { error: 'Лимит активаций — целое число от 1' }
    f.max_uses = v
  }
  if (has('max_uses_per_user')) {
    const v = toNum(body.max_uses_per_user)
    if (v == null || !Number.isInteger(v) || v < 1) return { error: 'Лимит на пользователя — целое число от 1' }
    f.max_uses_per_user = v
  }
  if (has('starts_at')) f.starts_at = toDate(body.starts_at)
  if (has('expires_at')) f.expires_at = toDate(body.expires_at)

  if (f.starts_at && f.expires_at && f.starts_at >= f.expires_at) {
    return { error: 'Начало действия позже окончания' }
  }

  if (has('min_amount')) {
    const v = toNum(body.min_amount)
    if (v != null && !(v > 0)) return { error: 'Минимальная сумма должна быть больше нуля' }
    f.min_amount = v
  }
  if (has('plan_ids')) {
    const arr = Array.isArray(body.plan_ids) ? body.plan_ids.map(Number).filter(Number.isInteger) : []
    f.plan_ids = arr
  }
  if (has('periods')) {
    const arr = Array.isArray(body.periods) ? body.periods.filter(p => PERIODS.includes(p)) : []
    f.periods = arr
  }
  if (has('first_purchase_only')) f.first_purchase_only = !!body.first_purchase_only
  if (has('new_users_only_days')) {
    const v = toNum(body.new_users_only_days)
    if (v != null && (!Number.isInteger(v) || v < 0)) return { error: 'Возраст аккаунта — целое число дней' }
    f.new_users_only_days = v
  }
  if (has('assigned_user_id')) f.assigned_user_id = toNum(body.assigned_user_id)
  if (has('is_active')) f.is_active = !!body.is_active
  if (has('comment')) f.comment = body.comment ? String(body.comment).slice(0, 2000) : null
  if (has('batch_label')) f.batch_label = body.batch_label ? String(body.batch_label).slice(0, 64) : null

  // Ограничения тарифа и периода имеют смысл только для скидок: days и
  // balance не привязаны к заказу.
  if ((f.type || body.type) && !promoService.DISCOUNT_TYPES.includes(f.type || body.type)) {
    if (f.plan_ids?.length || f.periods?.length || f.min_amount != null) {
      return { error: 'Тариф, период и минимальная сумма применимы только к скидкам' }
    }
  }

  return { fields: f }
}

/**
 * Список кодов со счётчиками активаций.
 * Счётчики считаем по журналу — денормализованное поле разъехалось бы.
 */
router.get('/', async (req, res) => {
  try {
    const { type, active, q, batch } = req.query
    const params = []
    const where = []

    if (type && promoService.TYPES.includes(type)) {
      params.push(type); where.push(`p.type = $${params.length}`)
    }
    if (active === 'true' || active === 'false') {
      params.push(active === 'true'); where.push(`p.is_active = $${params.length}`)
    }
    if (q) {
      params.push(`%${promoService.normalize(q)}%`)
      where.push(`p.code_normalized LIKE $${params.length}`)
    }
    if (batch) {
      params.push(batch); where.push(`p.batch_label = $${params.length}`)
    }

    const { rows } = await db.query(
      `SELECT p.*,
              COUNT(u.id) FILTER (WHERE u.status = 'applied')                                AS used_count,
              COUNT(u.id) FILTER (WHERE u.status = 'reserved' AND u.reserved_until > NOW())  AS reserved_count,
              COUNT(u.id) FILTER (WHERE u.over_limit)                                        AS over_limit_count,
              us.login AS assigned_login
         FROM promo_codes p
         LEFT JOIN promo_code_uses u ON u.promo_id = p.id
         LEFT JOIN users us ON us.id = p.assigned_user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        GROUP BY p.id, us.login
        ORDER BY p.created_at DESC
        LIMIT 500`,
      params
    )
    res.json({ items: rows })
  } catch (err) {
    console.error('[admin-promo] list error:', err.message)
    res.status(500).json({ error: 'Не удалось получить список промокодов' })
  }
})

/** Метки пачек — для фильтра */
router.get('/batches', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT batch_label, COUNT(*)::int AS n, MIN(created_at) AS created_at
         FROM promo_codes WHERE batch_label IS NOT NULL
        GROUP BY batch_label ORDER BY MIN(created_at) DESC LIMIT 100`
    )
    res.json({ items: rows })
  } catch (err) {
    res.status(500).json({ error: 'Не удалось получить список пачек' })
  }
})

router.post('/', async (req, res) => {
  const { fields, error } = parseBody(req.body)
  if (error) return res.status(400).json({ error })

  try {
    const cols = Object.keys(fields)
    cols.push('created_by')
    const vals = cols.map(c => (c === 'created_by' ? req.userId : fields[c]))

    const { rows } = await db.query(
      `INSERT INTO promo_codes (${cols.join(', ')})
       VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})
       RETURNING *`,
      vals
    )
    audit.write(req, 'promo.create', { type: 'promo_code', id: rows[0].id },
      { code: rows[0].code, type: rows[0].type, value: rows[0].value }).catch(() => {})
    res.json({ item: rows[0] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Такой код уже существует' })
    console.error('[admin-promo] create error:', err.message)
    res.status(500).json({ error: 'Не удалось создать промокод' })
  }
})

router.put('/:id', async (req, res) => {
  const { fields, error } = parseBody(req.body, true)
  if (error) return res.status(400).json({ error })

  const cols = Object.keys(fields)
  if (!cols.length) return res.status(400).json({ error: 'Нечего менять' })

  try {
    const sets = cols.map((c, i) => `${c} = $${i + 1}`)
    const vals = cols.map(c => fields[c])
    vals.push(req.params.id)

    const { rows } = await db.query(
      `UPDATE promo_codes SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${vals.length} RETURNING *`,
      vals
    )
    if (!rows[0]) return res.status(404).json({ error: 'Промокод не найден' })

    audit.write(req, 'promo.update', { type: 'promo_code', id: req.params.id }, fields).catch(() => {})
    res.json({ item: rows[0] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Такой код уже существует' })
    console.error('[admin-promo] update error:', err.message)
    res.status(500).json({ error: 'Не удалось изменить промокод' })
  }
})

/** Выключение. Удаления нет намеренно — журнал активаций должен остаться. */
router.post('/:id/deactivate', async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE promo_codes SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id, code',
      [req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Промокод не найден' })
    audit.write(req, 'promo.deactivate', { type: 'promo_code', id: req.params.id }, { code: rows[0].code }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Не удалось отключить промокод' })
  }
})

/**
 * Генерация пачки.
 *
 * dry_run: true возвращает примеры кодов, ничего не создавая — по правилу
 * проекта массовые действия делаются с предпросмотром.
 */
router.post('/bulk', async (req, res) => {
  const count = Number(req.body?.count)
  const length = Number(req.body?.length || 8)
  const prefix = String(req.body?.prefix || '').trim().toUpperCase()
  const dryRun = req.body?.dry_run !== false

  if (!Number.isInteger(count) || count < 1 || count > BULK_MAX) {
    return res.status(400).json({ error: `Количество — от 1 до ${BULK_MAX}` })
  }
  if (!Number.isInteger(length) || length < 4 || length > 32) {
    return res.status(400).json({ error: 'Длина кода — от 4 до 32 символов' })
  }
  if (prefix && !/^[A-Z0-9\-]+$/.test(prefix)) {
    return res.status(400).json({ error: 'Префикс — только латиница, цифры и дефис' })
  }

  const { fields, error } = parseBody(
    Object.assign({}, req.body, { code: prefix ? `${prefix}-X` : 'X' })
  )
  if (error) return res.status(400).json({ error })
  delete fields.code
  delete fields.code_normalized

  // Генерируем с запасом и отбрасываем дубли внутри пачки; коллизия с уже
  // существующими отсеется уникальным индексом при вставке.
  const set = new Set()
  for (let i = 0; i < count * 20 && set.size < count; i++) {
    set.add(prefix ? `${prefix}-${randomCode(length)}` : randomCode(length))
  }
  const codes = [...set]
  if (codes.length < count) {
    return res.status(400).json({ error: 'Не удалось сгенерировать столько уникальных кодов — увеличьте длину' })
  }

  if (dryRun) {
    return res.json({ dry_run: true, count: codes.length, sample: codes.slice(0, 10) })
  }

  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')
    const cols = Object.keys(fields)
    const created = []
    for (const code of codes) {
      const allCols = ['code', 'code_normalized', ...cols, 'created_by']
      const vals = [code, promoService.normalize(code), ...cols.map(c => fields[c]), req.userId]
      const { rows } = await client.query(
        `INSERT INTO promo_codes (${allCols.join(', ')})
         VALUES (${allCols.map((_, i) => '$' + (i + 1)).join(', ')})
         ON CONFLICT (code_normalized) DO NOTHING
         RETURNING code`,
        vals
      )
      if (rows[0]) created.push(rows[0].code)
    }
    await client.query('COMMIT')

    audit.write(req, 'promo.bulk_create', { type: 'promo_code' },
      { count: created.length, batch_label: fields.batch_label || null }).catch(() => {})
    res.json({ created: created.length, codes: created })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[admin-promo] bulk error:', err.message)
    res.status(500).json({ error: 'Не удалось сгенерировать пачку' })
  } finally {
    client.release()
  }
})

/** Журнал активаций. Без :id — по всем кодам. */
router.get('/uses', async (req, res) => {
  try {
    const { promo_id, user_id, status } = req.query
    const params = []
    const where = []
    if (promo_id) { params.push(Number(promo_id)); where.push(`u.promo_id = $${params.length}`) }
    if (user_id) { params.push(Number(user_id)); where.push(`u.user_id = $${params.length}`) }
    if (status) { params.push(status); where.push(`u.status = $${params.length}`) }

    const { rows } = await db.query(
      `SELECT u.*, p.code, p.type, us.login
         FROM promo_code_uses u
         JOIN promo_codes p ON p.id = u.promo_id
         LEFT JOIN users us ON us.id = u.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY u.created_at DESC LIMIT 500`,
      params
    )
    res.json({ items: rows })
  } catch (err) {
    console.error('[admin-promo] uses error:', err.message)
    res.status(500).json({ error: 'Не удалось получить журнал активаций' })
  }
})

/** Выгрузка кодов в CSV. Фильтр по пачке — чтобы отдать партнёру её коды. */
router.get('/export', async (req, res) => {
  try {
    const params = []
    let where = ''
    if (req.query.batch) { params.push(req.query.batch); where = 'WHERE batch_label = $1' }

    const { rows } = await db.query(
      `SELECT p.code, p.type, p.value, p.max_uses, p.expires_at, p.is_active,
              COUNT(u.id) FILTER (WHERE u.status = 'applied') AS used_count
         FROM promo_codes p
         LEFT JOIN promo_code_uses u ON u.promo_id = p.id
         ${where}
         GROUP BY p.id ORDER BY p.created_at DESC`,
      params
    )

    const esc = v => {
      const s = v == null ? '' : String(v)
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const head = 'code;type;value;max_uses;expires_at;is_active;used_count'
    const body = rows.map(r => [r.code, r.type, r.value, r.max_uses, r.expires_at, r.is_active, r.used_count]
      .map(esc).join(';')).join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="promo-codes-${Date.now()}.csv"`)
    // BOM — иначе Excel открывает кириллицу кракозябрами
    res.send('﻿' + head + '\n' + body)
  } catch (err) {
    console.error('[admin-promo] export error:', err.message)
    res.status(500).json({ error: 'Не удалось выгрузить коды' })
  }
})

module.exports = router
