#!/usr/bin/env node
/**
 * Создание / обновление пароля администратора.
 *
 * Использование (читает значения из ENV):
 *   ADMIN_EMAIL=admin@example.com \
 *   ADMIN_LOGIN=admin \
 *   ADMIN_PASSWORD=secret \
 *   [ADMIN_OVERWRITE=1]   # если 1 — обновить пароль/права если уже существует
 *   node scripts/create_admin.js
 *
 * Идемпотентность:
 *   - Если пользователя нет — создаётся с is_admin=true, is_active=true, email_confirmed=true
 *   - Если есть и ADMIN_OVERWRITE=1 — обновляется password_hash и is_admin=true
 *   - Если есть и ADMIN_OVERWRITE!=1 — выходит с кодом 3 (no-op, чтобы не сломать deploy)
 *
 * Exit codes:
 *   0  — создан/обновлён
 *   2  — невалидные входные данные
 *   3  — пользователь уже существует, overwrite не задан
 *   1  — другие ошибки
 */
require('dotenv').config()
const bcrypt = require('bcryptjs')
const { Pool } = require('pg')

const EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const LOGIN = (process.env.ADMIN_LOGIN || '').trim()
const PASSWORD = process.env.ADMIN_PASSWORD || ''
const OVERWRITE = process.env.ADMIN_OVERWRITE === '1'

function bail(code, msg) {
  console.error(msg)
  process.exit(code)
}

if (!EMAIL || !LOGIN || !PASSWORD) {
  bail(2, 'ENV ADMIN_EMAIL, ADMIN_LOGIN, ADMIN_PASSWORD должны быть заданы')
}
if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(EMAIL)) {
  bail(2, 'Некорректный email: ' + EMAIL)
}
if (!/^[a-zA-Z0-9_]{3,32}$/.test(LOGIN)) {
  bail(2, 'Некорректный login (3-32 символа [a-zA-Z0-9_])')
}
if (PASSWORD.length < 8) {
  bail(2, 'Пароль должен быть не менее 8 символов')
}

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT, 10) || 5432,
  user: process.env.PGUSER || 'vpn_user',
  password: process.env.PGPASSWORD || 'vpn_pass',
  database: process.env.PGDATABASE || 'vpn_db',
})

;(async () => {
  try {
    const hash = await bcrypt.hash(PASSWORD, 12)

    const existing = await pool.query(
      'SELECT id, email, login, is_admin FROM users WHERE email=$1 OR login=$2 LIMIT 1',
      [EMAIL, LOGIN]
    )

    if (existing.rows.length > 0) {
      const u = existing.rows[0]
      if (!OVERWRITE) {
        bail(3, `Пользователь уже существует: id=${u.id}, email=${u.email}, login=${u.login}, is_admin=${u.is_admin}. Передайте ADMIN_OVERWRITE=1 для обновления.`)
      }
      await pool.query(
        `UPDATE users
            SET password_hash = $1,
                is_admin = true,
                is_active = true,
                email_confirmed = true,
                updated_at = NOW()
          WHERE id = $2`,
        [hash, u.id]
      )
      console.log(`✓ Admin обновлён: id=${u.id} email=${u.email} login=${u.login}`)
      process.exit(0)
    }

    const r = await pool.query(
      `INSERT INTO users (email, login, password_hash, is_admin, is_active, email_confirmed)
       VALUES ($1, $2, $3, true, true, true)
       RETURNING id`,
      [EMAIL, LOGIN, hash]
    )
    console.log(`✓ Admin создан: id=${r.rows[0].id} email=${EMAIL} login=${LOGIN}`)
    process.exit(0)
  } catch (e) {
    console.error('Ошибка:', e.message)
    process.exit(1)
  } finally {
    await pool.end().catch(() => {})
  }
})()
