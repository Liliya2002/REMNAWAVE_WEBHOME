// db.js — подключение к PostgreSQL и базовые функции
const { Pool, types } = require('pg')
require('dotenv').config()

// Возвращаем NUMERIC как JS-число (parseFloat), а не как строку (default).
// БЕЗ этого `numeric(10,2)` приходит на фронт как "0.00", и `.toFixed()` падает.
// 1700 = OID для NUMERIC. Точность до ~15 значащих цифр — для денег/трафика хватает.
types.setTypeParser(1700, parseFloat)
// 20 = OID для int8/bigint. Тоже бывает что приходит как строка (т.к. 64-bit).
// Для размеров трафика в байтах это может быть >2^53, но для всех остальных полей —
// числа достаточно. Если нужно — конкретные запросы могут использовать ::text приведение.
types.setTypeParser(20, (val) => {
  const n = parseInt(val, 10)
  return Number.isSafeInteger(n) ? n : val // fallback на строку если выходит за safe-integer
})

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
