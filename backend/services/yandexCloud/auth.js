/**
 * Yandex.Cloud auth — получение IAM-токена для аккаунта.
 *
 * Поддерживаем два метода:
 *   1. OAuth-токен (получают на oauth.yandex.ru, копи-паст в админку)
 *      → POST iam/v1/tokens с body { yandexPassportOauthToken: <token> }
 *
 *   2. Service Account JSON-ключ (рекомендованный для прода)
 *      → JWT (PS256) подписанный private_key из ключа
 *      → POST iam/v1/tokens с body { jwt: <signedJwt> }
 *
 * IAM-токен живёт 12ч, кэшируем в БД (yc_iam_token_cache),
 * перевыпускаем за 60 минут до истечения.
 */
const axios = require('axios')
const https = require('https')
const jwt = require('jsonwebtoken')
const db = require('../../db')
const { encrypt, decrypt } = require('../encryption')

const IAM_TOKEN_URL = 'https://iam.api.cloud.yandex.net/iam/v1/tokens'
const IAM_REFRESH_BUFFER_SEC = 60 * 60   // перевыпускаем за час до экспирации
const REQUEST_TIMEOUT_MS = 30000

// IPv4-only agent — некоторые сети не доходят до IPv6 YC-эндпоинтов.
// Без keep-alive: на Windows под антивирусом keep-alive иногда даёт ложные ETIMEDOUT
// на повторных запросах через тот же агент.
const ipv4Agent = new https.Agent({
  family: 4,
  keepAlive: false,
})

const FETCH_RETRY_ATTEMPTS = 3
const FETCH_RETRY_DELAY_MS = 1500

/**
 * Подписывает JWT для Yandex.Cloud Service Account.
 * @param {object} saKey — распарсенный JSON ключа SA (id, service_account_id, private_key)
 * @returns {string} signed JWT
 */
function signSaJwt(saKey) {
  if (!saKey || typeof saKey !== 'object') {
    throw new Error('Невалидный SA-ключ: ожидается JSON-объект')
  }
  const { id: keyId, service_account_id: saId, private_key: privateKey } = saKey
  if (!keyId || !saId || !privateKey) {
    throw new Error('SA-ключ должен содержать поля id, service_account_id, private_key')
  }

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    aud: IAM_TOKEN_URL,
    iss: saId,
    iat: now,
    exp: now + 3600,
  }
  return jwt.sign(payload, privateKey, {
    algorithm: 'PS256',
    keyid: keyId,
  })
}

/**
 * Запрос IAM-токена у Yandex.Cloud.
 * @param {object} account — строка из yc_accounts (после decrypt sensitive полей)
 * @returns {{ iamToken: string, expiresAt: Date }}
 */
async function fetchIamToken(account) {
  let body
  if (account.auth_type === 'oauth') {
    if (!account.oauth_token) throw new Error('У аккаунта не задан OAuth-токен')
    body = { yandexPassportOauthToken: account.oauth_token }
  } else if (account.auth_type === 'sa_key') {
    if (!account.sa_key_json) throw new Error('У аккаунта не задан SA-ключ')
    let saKey
    try { saKey = JSON.parse(account.sa_key_json) }
    catch { throw new Error('SA-ключ невалидный JSON') }
    body = { jwt: signSaJwt(saKey) }
  } else {
    throw new Error(`Неподдерживаемый auth_type: ${account.auth_type}`)
  }

  // Retry на временных сетевых ошибках. На Windows под антивирусом часто
  // первая попытка ETIMEDOUT-ит, вторая нормально проходит.
  let lastErr
  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await axios.post(IAM_TOKEN_URL, body, {
        timeout: REQUEST_TIMEOUT_MS,
        httpsAgent: ipv4Agent,
        validateStatus: () => true,
      })
      if (res.status !== 200) {
        const detail = res.data?.message || res.data?.error_description || JSON.stringify(res.data || {})
        // Невалидные creds → сразу бросаем без retry
        throw new Error(`IAM token request failed (${res.status}): ${detail}`)
      }
      if (!res.data?.iamToken) {
        throw new Error('IAM ответил без поля iamToken')
      }
      return {
        iamToken: res.data.iamToken,
        expiresAt: new Date(res.data.expiresAt || (Date.now() + 12 * 3600 * 1000)),
      }
    } catch (err) {
      lastErr = err
      const isNetwork = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EAI_AGAIN'].includes(err.code) ||
                        /timeout/i.test(err.message)
      const isLast = attempt >= FETCH_RETRY_ATTEMPTS
      // Расширенная диагностика — видим что именно и где упало
      const detail = {
        code:    err.code,
        errno:   err.errno,
        syscall: err.syscall,
        address: err.address,
        port:    err.port,
        msg:     err.message,
      }
      console.warn(`[YC auth] IAM attempt ${attempt}/${FETCH_RETRY_ATTEMPTS} failed: ${JSON.stringify(detail)}${isNetwork && !isLast ? ' — retry' : ''}`)
      if (isNetwork && !isLast) {
        await new Promise(r => setTimeout(r, FETCH_RETRY_DELAY_MS * attempt))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

/**
 * Возвращает живой IAM-токен из кэша или перевыпускает.
 * @param {number} accountId
 * @returns {string} iamToken
 */
async function getIamToken(accountId) {
  const accRes = await db.query('SELECT * FROM yc_accounts WHERE id = $1', [accountId])
  if (accRes.rows.length === 0) throw new Error(`YC-аккаунт ${accountId} не найден`)
  const account = decryptAccount(accRes.rows[0])

  // Кэш
  const cacheRes = await db.query(
    'SELECT iam_token, expires_at FROM yc_iam_token_cache WHERE account_id = $1',
    [accountId]
  )
  if (cacheRes.rows.length > 0) {
    const cached = cacheRes.rows[0]
    const remainingSec = (new Date(cached.expires_at).getTime() - Date.now()) / 1000
    if (remainingSec > IAM_REFRESH_BUFFER_SEC) {
      return decrypt(cached.iam_token)
    }
  }

  // Перевыпуск
  const { iamToken, expiresAt } = await fetchIamToken(account)
  await db.query(
    `INSERT INTO yc_iam_token_cache (account_id, iam_token, expires_at, refreshed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id) DO UPDATE
       SET iam_token = EXCLUDED.iam_token,
           expires_at = EXCLUDED.expires_at,
           refreshed_at = NOW()`,
    [accountId, encrypt(iamToken), expiresAt]
  )
  return iamToken
}

/**
 * Принудительная перевыпуск (использовать когда получили 401 от YC API).
 */
async function refreshIamToken(accountId) {
  await db.query('DELETE FROM yc_iam_token_cache WHERE account_id = $1', [accountId])
  return getIamToken(accountId)
}

/**
 * Расшифровывает sensitive-поля аккаунта (для использования в auth/client).
 * Возвращает новый объект — не мутирует оригинал.
 */
function decryptAccount(row) {
  return {
    ...row,
    oauth_token: row.oauth_token ? decrypt(row.oauth_token) : null,
    sa_key_json: row.sa_key_json ? decrypt(row.sa_key_json) : null,
    socks5_url:  row.socks5_url  ? decrypt(row.socks5_url)  : null,
  }
}

module.exports = {
  getIamToken,
  refreshIamToken,
  fetchIamToken,
  decryptAccount,
  signSaJwt,
}
