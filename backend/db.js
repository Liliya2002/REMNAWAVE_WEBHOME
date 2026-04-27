// db.js — подключение к PostgreSQL и базовые функции
const { Pool } = require('pg')
require('dotenv').config()

// Проверка что credentials заданы через .env
if (process.env.NODE_ENV === 'production' && (!process.env.PGUSER || !process.env.PGPASSWORD)) {
  console.error('\x1b[31m[SECURITY] PGUSER/PGPASSWORD не заданы! Задайте credentials БД в .env\x1b[0m')
  process.exit(1)
}

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT, 10) || 5432,
  user: process.env.PGUSER || 'vpn_user',
  password: process.env.PGPASSWORD || 'vpn_pass',
  database: process.env.PGDATABASE || 'vpn_db',
})

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
}
