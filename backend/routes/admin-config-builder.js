/**
 * Конструктор конфигов RemnaWave.
 *
 * Сборка JSON идёт на фронте — она мгновенная и не требует похода на сервер
 * при каждом нажатии. Здесь только то, что на фронте сделать нельзя:
 * генерация ключей Reality (нужен crypto) и выдача существующих профилей
 * панели как основы для нового.
 *
 * Создания профиля в панели тут НЕТ намеренно: схема API RemnaWave закрыта
 * (/api-json и /openapi.json отдают 404), а вслепую дёргать write-эндпоинты
 * на боевой панели нельзя.
 */
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { verifyToken, verifyAdmin } = require('../middleware')
const rw = require('../services/remnwave')

router.use(verifyToken, verifyAdmin)

/** base64url без паддинга — в этом виде Xray ждёт ключи Reality. */
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Пара ключей x25519 для Reality.
 *
 * Экспортируем DER и берём последние 32 байта: у x25519 сырой ключ лежит
 * в хвосте структуры, а Node не отдаёт его напрямую. Это то же, что делает
 * `xray x25519` на сервере, только без похода по SSH.
 */
function realityKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  const raw = k => k.export({ type: k.type === 'private' ? 'pkcs8' : 'spki', format: 'der' }).subarray(-32)
  return { privateKey: b64url(raw(privateKey)), publicKey: b64url(raw(publicKey)) }
}

/** shortId — произвольная hex-строка чётной длины, до 16 символов. */
function shortIds(count = 4, bytes = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(bytes).toString('hex'))
}

router.post('/reality-keys', (req, res) => {
  try {
    const count = Math.min(Math.max(Number(req.body?.shortIdCount) || 4, 1), 8)
    res.json({ ...realityKeypair(), shortIds: shortIds(count) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/short-ids', (req, res) => {
  const count = Math.min(Math.max(Number(req.body?.count) || 4, 1), 8)
  res.json({ shortIds: shortIds(count) })
})

/**
 * Существующие профили панели — как основа для нового.
 *
 * Отдаём и сам config: смысл в том, чтобы взять рабочую конструкцию, поменять
 * домен с портом и получить новый профиль, а не собирать с нуля.
 */
router.get('/presets', async (req, res) => {
  try {
    const r = await rw.listConfigProfiles()
    const list = r?.response?.configProfiles || r?.configProfiles || []
    res.json({
      presets: list.map(p => ({
        uuid: p.uuid,
        name: p.name,
        inboundCount: Array.isArray(p.config?.inbounds) ? p.config.inbounds.length : 0,
        nodeCount: Array.isArray(p.nodes) ? p.nodes.length : 0,
        config: p.config,
      })),
    })
  } catch (e) {
    res.status(502).json({ error: `Панель не ответила: ${e.message}` })
  }
})

module.exports = router
