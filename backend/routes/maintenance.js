/**
 * Public maintenance status endpoint.
 * Без авторизации, без rate-limiter — фронт пингует каждые 30 сек.
 */
const express = require('express')
const router = express.Router()
const maint = require('../services/maintenance')

router.get('/status', async (req, res) => {
  const status = await maint.getStatus()
  res.json(status)
})

module.exports = router
