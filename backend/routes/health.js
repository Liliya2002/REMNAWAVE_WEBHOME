/**
 * Public health endpoints.
 * Used by:
 *   - Docker HEALTHCHECK (in Dockerfile)
 *   - deploy.sh smoke test
 *   - external uptime monitoring
 *
 * Никаких секретов в ответах не возвращаем.
 */
const express = require('express')
const router = express.Router()
const db = require('../db')
const version = require('../services/version')

/**
 * GET /api/health
 * Минимальный «жив или нет». Проверяет DB connectivity.
 * Возвращает 200/503.
 */
router.get('/', async (req, res) => {
  const info = version.getInfo()
  let dbOk = false
  let dbError = null
  try {
    await db.query('SELECT 1')
    dbOk = true
  } catch (e) {
    dbError = e.message
  }

  const ok = dbOk
  res.status(ok ? 200 : 503).json({
    ok,
    version: info.version,
    sha: info.shaShort,
    uptime_seconds: Math.round(process.uptime()),
    db: dbOk ? 'ok' : 'down',
    ...(dbError ? { db_error: dbError } : {}),
  })
})

module.exports = router
