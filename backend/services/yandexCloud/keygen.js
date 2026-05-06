/**
 * Генерация SSH-keypair на стороне нашего бэкенда.
 *
 * Используется при создании VM с опцией "Сгенерировать новый ключ":
 *   - Public кладётся в YC через metadata.ssh-keys
 *   - Private возвращается в response один раз (для скачивания пользователем)
 *     и опционально шифруется и сохраняется в yc_ssh_keys.private_key
 *
 * Поддерживаются ed25519 (рекомендуется — короче, быстрее) и rsa-4096 (универсальнее).
 */
const crypto = require('crypto')

/**
 * Создаёт пару ключей в формате SSH:
 *   - publicKey: "ssh-ed25519 AAAA... <comment>" / "ssh-rsa AAAA... <comment>"
 *   - privateKey: OpenSSH PEM ("-----BEGIN OPENSSH PRIVATE KEY-----...")
 *
 * @param {object} opts
 * @param {'ed25519'|'rsa-4096'} opts.algo
 * @param {string} [opts.comment]  — комментарий в публичной части (например vm-name@yc-bobik)
 */
function generateKeypair({ algo = 'ed25519', comment = 'auto-generated@vpnwebhome' } = {}) {
  let publicKeyObj, privateKeyObj
  let opensshPrefix

  if (algo === 'ed25519') {
    ({ publicKey: publicKeyObj, privateKey: privateKeyObj } = crypto.generateKeyPairSync('ed25519'))
    opensshPrefix = 'ssh-ed25519'
  } else if (algo === 'rsa-4096') {
    ({ publicKey: publicKeyObj, privateKey: privateKeyObj } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicExponent: 0x10001,
    }))
    opensshPrefix = 'ssh-rsa'
  } else {
    throw new Error(`Неподдерживаемый алгоритм: ${algo}. Используй 'ed25519' или 'rsa-4096'.`)
  }

  // Public — экспортируем в формат OpenSSH ("ssh-ed25519 AAAA...")
  const publicKey = publicKeyObj.export({ type: 'spki', format: 'der' })
  const sshPublic = encodeOpenSshPublicKey(publicKey, opensshPrefix)
  const publicKeyStr = `${opensshPrefix} ${sshPublic} ${cleanComment(comment)}`

  // Private — экспортируем в формате OpenSSH (современный, поддерживается всеми ssh-клиентами)
  // Если crypto не умеет 'openssh' — fallback на PEM PKCS#8 (тоже подходит для ssh)
  let privateKeyStr
  try {
    privateKeyStr = privateKeyObj.export({ type: 'pkcs8', format: 'pem' })
  } catch (e) {
    // Не должно случиться, но на всякий случай
    privateKeyStr = privateKeyObj.export({ type: 'pkcs1', format: 'pem' })
  }

  return {
    algo,
    publicKey: publicKeyStr,
    privateKey: typeof privateKeyStr === 'string' ? privateKeyStr : privateKeyStr.toString(),
    comment: cleanComment(comment),
  }
}

/**
 * Преобразовать DER SubjectPublicKeyInfo (SPKI) в формат OpenSSH wire (base64 в одну строку).
 *
 * OpenSSH wire-формат публичного ключа:
 *   uint32 len_of_alg_name | algorithm_name (ascii)
 *   for ed25519: uint32 len(32) | 32 bytes raw key
 *   for rsa:     uint32 len(e_bytes) | e (big-endian) | uint32 len(n_bytes) | n (big-endian)
 *
 * Реализация:
 *   - Используем crypto.createPublicKey + jwk export → достаём raw компоненты
 *   - Сериализуем в SSH wire-format
 */
function encodeOpenSshPublicKey(spkiDer, prefix) {
  const keyObj = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' })
  const jwk = keyObj.export({ format: 'jwk' })

  if (prefix === 'ssh-ed25519') {
    // jwk.x — base64url-encoded 32-byte raw public key
    const raw = Buffer.from(jwk.x, 'base64url')
    const buf = Buffer.concat([
      sshUint32(prefix.length), Buffer.from(prefix, 'ascii'),
      sshUint32(raw.length), raw,
    ])
    return buf.toString('base64')
  }
  if (prefix === 'ssh-rsa') {
    const n = bigIntFromBase64url(jwk.n)
    const e = bigIntFromBase64url(jwk.e)
    const buf = Buffer.concat([
      sshUint32(prefix.length), Buffer.from(prefix, 'ascii'),
      sshMpint(e),
      sshMpint(n),
    ])
    return buf.toString('base64')
  }
  throw new Error(`encodeOpenSshPublicKey: неподдерживаемый prefix ${prefix}`)
}

function sshUint32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

/**
 * SSH "mpint" — большое число со знаком в big-endian, prepended с 4-byte length.
 * Если старший бит первого байта = 1, добавляется leading 0x00 чтобы не считать число отрицательным.
 */
function sshMpint(buf) {
  // buf — это положительное big-endian число
  let bytes = buf
  // Убираем leading нули
  let i = 0
  while (i < bytes.length - 1 && bytes[i] === 0) i++
  bytes = bytes.slice(i)
  // Если старший бит установлен — prepend 0x00
  if (bytes[0] & 0x80) {
    bytes = Buffer.concat([Buffer.from([0]), bytes])
  }
  return Buffer.concat([sshUint32(bytes.length), bytes])
}

function bigIntFromBase64url(s) {
  return Buffer.from(s, 'base64url')
}

function cleanComment(c) {
  return String(c || '').replace(/[^\w@.-]/g, '').slice(0, 64) || 'auto'
}

module.exports = { generateKeypair }
