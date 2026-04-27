// Шифрование/дешифрование чувствительных данных (SSH-ключи, пароли VPS)
const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const ENC_PREFIX = 'enc_v1:' // маркер зашифрованного формата

let cachedKey = null
let warnedMissing = false

function getEncryptionKey() {
  if (cachedKey) return cachedKey
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      console.error('\x1b[31m[SECURITY] ENCRYPTION_KEY не задан или короче 16 символов. Production не запустится.\x1b[0m')
      process.exit(1)
    }
    if (!warnedMissing) {
      console.error('\x1b[33m[SECURITY] ENCRYPTION_KEY не задан. SSH-данные сохраняются в открытом виде. Сгенерируйте: openssl rand -hex 32\x1b[0m')
      warnedMissing = true
    }
    return null
  }
  cachedKey = crypto.createHash('sha256').update(key).digest()
  return cachedKey
}

// Признак нового формата (с префиксом).
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

// Признак старого формата (3 hex-сегмента через ":", длины iv=32 hex, tag=32 hex).
function isLegacyEncrypted(value) {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  if (parts.length !== 3) return false
  const [iv, enc, tag] = parts
  return /^[0-9a-f]{32}$/i.test(iv) && /^[0-9a-f]+$/i.test(enc) && /^[0-9a-f]{32}$/i.test(tag)
}

function tryDecryptParts(parts, key) {
  const iv = Buffer.from(parts[0], 'hex')
  const encrypted = parts[1]
  const tag = Buffer.from(parts[2], 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Шифрует строку с помощью AES-256-GCM. Возвращает enc_v1:iv:enc:tag в hex.
 * Если ключ отсутствует (только dev) — возвращает исходный текст без префикса.
 */
function encrypt(text) {
  if (text == null || text === '') return ''
  const value = String(text)
  if (isEncrypted(value)) return value // не шифруем повторно
  const key = getEncryptionKey()
  if (!key) return value // dev-режим без ключа

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(value, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`
}

/**
 * Дешифрует строку. Если значение не в зашифрованном формате — возвращает как есть
 * (легаси/plaintext данные до миграции).
 */
function decrypt(value) {
  if (value == null || value === '') return ''
  const str = String(value)

  // Новый формат с префиксом
  if (isEncrypted(str)) {
    const key = getEncryptionKey()
    if (!key) throw new Error('Нельзя расшифровать данные: ENCRYPTION_KEY не задан')
    const parts = str.slice(ENC_PREFIX.length).split(':')
    if (parts.length !== 3) throw new Error('Некорректный формат зашифрованных данных')
    return tryDecryptParts(parts, key)
  }

  // Старый формат без префикса (iv:enc:tag) — поддержка для уже зашифрованных строк
  if (isLegacyEncrypted(str)) {
    const key = getEncryptionKey()
    if (key) {
      try { return tryDecryptParts(str.split(':'), key) } catch { /* падёт ниже как plaintext */ }
    }
  }

  // Plaintext / нераспознанный формат
  return str
}

module.exports = { encrypt, decrypt, isEncrypted }
