/**
 * Утилиты для сохранённых SSH-ключей пер-аккаунт (yc_ssh_keys).
 * Ключи хранятся в БД (ТОЛЬКО публичная часть — приватная остаётся у пользователя).
 */
const crypto = require('crypto')

const SUPPORTED_PREFIXES = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']

/**
 * Валидация публичного ключа. Возвращает {ok, key, prefix, comment} или {ok:false, error}.
 */
function validatePublicKey(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Ключ должен быть строкой' }
  // Обрезаем переводы строк, лишние пробелы, BOM
  const cleaned = raw.replace(/^﻿/, '').trim().replace(/\s+/g, ' ')
  if (!cleaned) return { ok: false, error: 'Ключ пустой' }
  const parts = cleaned.split(' ')
  if (parts.length < 2) return { ok: false, error: 'Ключ должен быть в формате "<prefix> <base64> [comment]"' }
  const [prefix, base64, ...rest] = parts
  if (!SUPPORTED_PREFIXES.includes(prefix)) {
    return { ok: false, error: `Неподдерживаемый префикс ${prefix}. Допустимы: ${SUPPORTED_PREFIXES.join(', ')}` }
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    return { ok: false, error: 'Base64-блок ключа невалиден' }
  }
  // Длина base64 для ed25519 ~68 символов, rsa-2048 ~370, rsa-4096 ~720
  if (base64.length < 32 || base64.length > 4000) {
    return { ok: false, error: 'Длина base64 неожиданная — ключ повреждён?' }
  }
  return { ok: true, key: cleaned, prefix, comment: rest.join(' ') || null }
}

/**
 * Stable fingerprint от содержимого ключа (sha256-hex от prefix+base64).
 * Используется для дедупа — два разных юзера могут сохранить тот же ключ.
 */
function computeFingerprint(publicKey) {
  const v = validatePublicKey(publicKey)
  if (!v.ok) return null
  return crypto.createHash('sha256').update(`${v.prefix} ${v.key.split(' ')[1]}`).digest('hex').slice(0, 32)
}

/**
 * Валидация приватного ключа. Принимаем PEM (RSA, EC) и OpenSSH формат (ed25519, RSA).
 * Не используем эту функцию чтобы парсить ключ — только чтобы убедиться что это
 * хоть как-то правдоподобно SSH-ключ. Реальная попытка подключения через ssh2 покажет
 * валидность по факту.
 */
function validatePrivateKey(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Ключ должен быть строкой' }
  const cleaned = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim()
  if (!cleaned) return { ok: false, error: 'Ключ пустой' }
  if (cleaned.length < 64) return { ok: false, error: 'Ключ слишком короткий' }
  if (cleaned.length > 16384) return { ok: false, error: 'Ключ слишком длинный (>16K)' }
  // Проверяем разумные начальные/конечные маркеры
  const startsOk = /^-----BEGIN (OPENSSH|RSA|DSA|EC|PRIVATE) (PRIVATE )?KEY-----/.test(cleaned)
  const endsOk   = /-----END (OPENSSH|RSA|DSA|EC|PRIVATE) (PRIVATE )?KEY-----\s*$/.test(cleaned)
  if (!startsOk || !endsOk) {
    return { ok: false, error: 'Ожидается формат "-----BEGIN ... PRIVATE KEY-----" / "-----END ... PRIVATE KEY-----"' }
  }
  return { ok: true, key: cleaned }
}

module.exports = {
  validatePublicKey,
  validatePrivateKey,
  computeFingerprint,
  SUPPORTED_PREFIXES,
}
