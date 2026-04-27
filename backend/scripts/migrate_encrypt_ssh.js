#!/usr/bin/env node
/**
 * Миграция: перешифровать SSH-данные VPS под новый ENCRYPTION_KEY.
 *
 * Когда запускать:
 *   1) После первичной установки ENCRYPTION_KEY в .env (если в БД лежат plaintext-пароли).
 *   2) Не запускать после смены ключа — старые данные расшифровать уже нельзя.
 *
 * Поведение:
 *   - Читает все vps_servers.
 *   - Для каждой записи: если поле не имеет префикса enc_v1: — шифрует и сохраняет.
 *   - Если поле уже зашифровано (enc_v1:...) — пытается расшифровать (валидация ключа), не трогает.
 *
 * Запуск:  node backend/scripts/migrate_encrypt_ssh.js [--dry-run]
 */
require('dotenv').config()
const db = require('../db')
const { encrypt, decrypt, isEncrypted } = require('../services/encryption')

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  if (!process.env.ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY не задан в .env. Завершено.')
    process.exit(1)
  }

  const { rows } = await db.query('SELECT id, name, ssh_password, ssh_key FROM vps_servers ORDER BY id')
  console.log(`Найдено VPS: ${rows.length}${DRY_RUN ? ' (DRY-RUN)' : ''}`)

  let toEncrypt = 0
  let alreadyEncrypted = 0
  let errors = 0

  for (const row of rows) {
    const updates = {}
    for (const field of ['ssh_password', 'ssh_key']) {
      const v = row[field]
      if (!v) continue

      if (isEncrypted(v)) {
        try {
          decrypt(v) // валидируем что ключ совпадает
          alreadyEncrypted++
        } catch (e) {
          console.error(`  [VPS #${row.id} ${row.name}] поле ${field}: НЕ РАСШИФРОВЫВАЕТСЯ текущим ключом (${e.message}). ПРОПУЩЕНО.`)
          errors++
        }
        continue
      }

      updates[field] = encrypt(v)
      toEncrypt++
    }

    if (Object.keys(updates).length === 0) continue

    if (DRY_RUN) {
      console.log(`  [VPS #${row.id} ${row.name}] зашифровать: ${Object.keys(updates).join(', ')}`)
      continue
    }

    const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`)
    const vals = Object.values(updates)
    vals.push(row.id)
    await db.query(`UPDATE vps_servers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals)
    console.log(`  [VPS #${row.id} ${row.name}] зашифровано: ${Object.keys(updates).join(', ')}`)
  }

  console.log('---')
  console.log(`Зашифровано полей: ${toEncrypt}`)
  console.log(`Уже было зашифровано: ${alreadyEncrypted}`)
  if (errors) console.log(`Ошибок (несовпадение ключа): ${errors}`)
  console.log(DRY_RUN ? 'DRY-RUN завершён, изменения не сохранены.' : 'Готово.')
  process.exit(errors ? 2 : 0)
}

main().catch((err) => {
  console.error('Фатальная ошибка миграции:', err)
  process.exit(1)
})
