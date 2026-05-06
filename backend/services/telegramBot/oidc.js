/**
 * Telegram OAuth 2.0 / OpenID Connect — клиент.
 *
 * Discovery:    https://oauth.telegram.org/.well-known/openid-configuration
 * Authorize:    https://oauth.telegram.org/auth
 * Token:        https://oauth.telegram.org/token
 * JWKS:         https://oauth.telegram.org/.well-known/jwks.json
 *
 * Flow: `authorization_code` + PKCE (S256).
 * ID Token подписан RS256 — валидируем подпись через JWKS (с кэшем 10 мин).
 *
 * Регистрация в @BotFather:
 *   /newoauth          — выдаёт client_id и client_secret
 *   /setoauthredirects — список разрешённых redirect_uri
 *
 * Получаемые claims (см. discovery):
 *   sub                 — публичный telegram user id (мапим на users.telegram_id)
 *   preferred_username  — @username
 *   name                — отображаемое имя
 *   picture             — URL аватара
 *   phone_number        — если запрошен scope=phone и юзер дал согласие
 */
const crypto = require('crypto')
const axios = require('axios')
const jwt = require('jsonwebtoken')

const ISSUER    = 'https://oauth.telegram.org'
const AUTH_URL  = 'https://oauth.telegram.org/auth'
const TOKEN_URL = 'https://oauth.telegram.org/token'
const JWKS_URL  = 'https://oauth.telegram.org/.well-known/jwks.json'

const DEFAULT_SCOPES = ['openid', 'profile']
const JWKS_TTL_MS    = 10 * 60 * 1000

let jwksCache = { keys: null, fetchedAt: 0 }

async function fetchJwks(force = false) {
  const now = Date.now()
  if (!force && jwksCache.keys && (now - jwksCache.fetchedAt) < JWKS_TTL_MS) {
    return jwksCache.keys
  }
  const r = await axios.get(JWKS_URL, { timeout: 10_000 })
  if (!r.data || !Array.isArray(r.data.keys)) {
    throw new Error('JWKS: пустой/невалидный ответ от oauth.telegram.org')
  }
  jwksCache = { keys: r.data.keys, fetchedAt: now }
  return r.data.keys
}

async function getPublicKey(kid) {
  let keys = await fetchJwks(false)
  let jwk = keys.find(k => k.kid === kid)
  if (!jwk) {
    keys = await fetchJwks(true)
    jwk = keys.find(k => k.kid === kid)
    if (!jwk) throw new Error(`JWKS: ключ kid=${kid} не найден`)
  }
  return crypto.createPublicKey({ key: jwk, format: 'jwk' })
}

function genState() {
  return crypto.randomBytes(16).toString('base64url')
}

function genPkce() {
  const verifier  = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function buildAuthUrl({ clientId, redirectUri, state, codeChallenge, scopes = DEFAULT_SCOPES }) {
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             clientId,
    redirect_uri:          redirectUri,
    scope:                 scopes.join(' '),
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${AUTH_URL}?${params.toString()}`
}

/**
 * Обмен authorization code → tokens.
 * Используем client_secret_post (Basic тоже поддерживается, но post проще читается в логах).
 */
async function exchangeCode({ clientId, clientSecret, redirectUri, code, codeVerifier }) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri,
    client_id:     clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  })

  const r = await axios.post(TOKEN_URL, body.toString(), {
    headers:        { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout:        15_000,
    validateStatus: () => true,
  })
  if (r.status !== 200) {
    const err = (r.data && (r.data.error_description || r.data.error)) || `HTTP ${r.status}`
    throw new Error(`Token exchange: ${err}`)
  }
  if (!r.data || !r.data.id_token) {
    throw new Error('Token exchange: в ответе нет id_token')
  }
  return r.data
}

/**
 * Валидация ID Token: подпись (JWKS) + iss/aud/exp.
 * Возвращает payload (claims).
 */
async function verifyIdToken(idToken, { clientId }) {
  const decoded = jwt.decode(idToken, { complete: true })
  if (!decoded || !decoded.header || !decoded.payload) {
    throw new Error('id_token: malformed')
  }
  if (decoded.header.alg !== 'RS256') {
    throw new Error(`id_token: неподдерживаемый alg=${decoded.header.alg}`)
  }
  if (!decoded.header.kid) {
    throw new Error('id_token: нет kid в header')
  }
  const pubKey = await getPublicKey(decoded.header.kid)
  return jwt.verify(idToken, pubKey, {
    algorithms: ['RS256'],
    issuer:     ISSUER,
    audience:   clientId,
  })
}

module.exports = {
  ISSUER, AUTH_URL, TOKEN_URL, JWKS_URL, DEFAULT_SCOPES,
  buildAuthUrl,
  exchangeCode,
  verifyIdToken,
  genState,
  genPkce,
}
