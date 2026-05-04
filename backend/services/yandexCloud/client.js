/**
 * Yandex.Cloud HTTP client.
 *
 * Используется compute/vpc/billing модулями. Делает:
 *   - Bearer-авторизацию через IAM-токен (auto-refresh при 401)
 *   - SOCKS5 если у аккаунта задан socks5_url (этап 6)
 *   - Retry на 429/503/504 с экспоненциальной задержкой
 *
 * Использование:
 *   const yc = await ycClient(accountId)
 *   const r = await yc.get('https://compute.api.cloud.yandex.net/compute/v1/instances', {
 *     params: { folderId: '...' }
 *   })
 */
const axios = require('axios')
const https = require('https')
const auth = require('./auth')
const db = require('../../db')
const { decrypt } = require('../encryption')

const DEFAULT_TIMEOUT_MS = 60000  // YC API иногда отвечает медленно из не-RU сетей
const MAX_RETRIES = 3

// Глобальный keep-alive агент с IPv4-приоритетом.
// Yandex.Cloud публикует AAAA-записи, но IPv6 часто недоступен с не-RU сетей —
// это вызывает 30-60с зависания на первом запросе. Принудительно используем IPv4.
const ipv4Agent = new https.Agent({
  family: 4,
  keepAlive: true,
  keepAliveMsecs: 30000,
})

// Lazy require socks-proxy-agent — он подтянется только если у какого-то аккаунта
// задан socks5_url, чтобы не падать на этапах когда либа ещё не установлена.
let SocksProxyAgent = null
function getSocksAgent(socks5Url) {
  if (!socks5Url) return null
  if (!SocksProxyAgent) {
    try {
      ({ SocksProxyAgent } = require('socks-proxy-agent'))
    } catch (e) {
      throw new Error(
        'У аккаунта задан socks5_url, но пакет socks-proxy-agent не установлен. ' +
        'Запусти: npm install socks-proxy-agent --save'
      )
    }
  }
  return new SocksProxyAgent(socks5Url)
}

/**
 * Создаёт обёртку axios для конкретного аккаунта.
 * @param {number} accountId
 * @returns {object} объект с методами get/post/put/patch/delete и meta { account }
 */
async function ycClient(accountId) {
  // Получаем аккаунт + IAM-токен
  const accRes = await db.query('SELECT * FROM yc_accounts WHERE id = $1', [accountId])
  if (accRes.rows.length === 0) throw new Error(`YC-аккаунт ${accountId} не найден`)
  const account = auth.decryptAccount(accRes.rows[0])
  if (!account.is_active) throw new Error(`YC-аккаунт ${accountId} деактивирован`)

  const iamToken = await auth.getIamToken(accountId)

  // Конфиг axios
  const config = {
    timeout: DEFAULT_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${iamToken}` },
    validateStatus: () => true, // обрабатываем сами
  }

  // SOCKS5 — применяем если задан, иначе используем IPv4-only keep-alive агент
  if (account.socks5_url) {
    const agent = getSocksAgent(account.socks5_url)
    if (agent) {
      config.httpAgent = agent
      config.httpsAgent = agent
    }
  } else {
    config.httpsAgent = ipv4Agent
  }

  const instance = axios.create(config)

  // Универсальный wrapper с retry + 401-refresh
  async function request(method, url, opts = {}) {
    let attempt = 0
    let lastErr
    let currentToken = iamToken

    while (attempt < MAX_RETRIES) {
      attempt++
      let res
      try {
        res = await instance.request({
          method, url,
          ...opts,
          headers: { Authorization: `Bearer ${currentToken}`, ...(opts.headers || {}) },
        })
      } catch (err) {
        // network error — retry на временных
        lastErr = err
        const transient = isTransientNetworkError(err)
        const reason = err.code || err.message || 'unknown'
        console.warn(`[YC] ${method} ${url} attempt ${attempt}/${MAX_RETRIES} failed: ${reason}${transient ? ' (will retry)' : ''}`)
        if (attempt < MAX_RETRIES && transient) {
          await sleep(retryDelayMs(attempt))
          continue
        }
        // Обогащаем ошибку понятным сообщением
        if (reason === 'ECONNABORTED' || /timeout/i.test(err.message)) {
          err.diagHint = `Запрос к ${new URL(url).hostname} превысил таймаут ${DEFAULT_TIMEOUT_MS}мс. Возможные причины: 1) YC API недоступен с этого IP 2) включён сломанный SOCKS5 3) DNS проблемы. Попробуй curl ${url} с этой машины — должно отвечать за 1-2 секунды.`
        } else if (/ENOTFOUND|EAI/.test(reason)) {
          err.diagHint = `Не удалось разрезолвить домен ${new URL(url).hostname}. Проверь DNS на сервере.`
        } else if (reason === 'ECONNREFUSED') {
          err.diagHint = `Соединение с ${new URL(url).hostname} отвергнуто. Возможно firewall.`
        }
        throw err
      }

      // 401 → перевыпустить токен один раз
      if (res.status === 401 && attempt === 1) {
        currentToken = await auth.refreshIamToken(accountId)
        continue
      }

      // 429/503/504 → retry с экспоненциальной задержкой
      if ([429, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(attempt))
        continue
      }

      // 4xx/5xx → бросаем понятную ошибку
      if (res.status >= 400) {
        const detail = res.data?.message || res.data?.error_description ||
                       JSON.stringify(res.data || {}).slice(0, 500)
        const e = new Error(`YC ${method} ${url} → ${res.status}: ${detail}`)
        e.status = res.status
        e.response = res
        throw e
      }

      return res
    }
    throw lastErr || new Error('YC client: неизвестная ошибка')
  }

  function isTransientNetworkError(err) {
    const code = err.code || ''
    if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)) return true
    // axios.timeout кидает Error без code, но с message "timeout of Xms exceeded"
    if (/timeout/i.test(err.message || '')) return true
    return false
  }

  function retryDelayMs(attempt) {
    return Math.min(500 * Math.pow(2, attempt - 1), 4000)
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
  }

  return {
    get:    (url, opts) => request('GET',    url, opts),
    post:   (url, data, opts) => request('POST',   url, { ...opts, data }),
    put:    (url, data, opts) => request('PUT',    url, { ...opts, data }),
    patch:  (url, data, opts) => request('PATCH',  url, { ...opts, data }),
    delete: (url, opts) => request('DELETE', url, opts),
    meta: { account, hasSocks5: !!account.socks5_url },
  }
}

module.exports = { ycClient }
