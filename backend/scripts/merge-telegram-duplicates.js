#!/usr/bin/env node
/**
 * Слияние дублей аккаунтов Telegram.
 *
 * Проблема: вход через бота/Mini App ищет юзера по users.telegram_id, а вход
 * через браузер (Telegram OIDC) — по users.telegram_oidc_sub, оставляя
 * telegram_id пустым. OIDC-идентификатор не равен telegram_id, поэтому один
 * человек получал ДВА аккаунта: подписка из бота не видна в кабинете, открытом
 * из браузера, и наоборот.
 *
 * Скрипт находит такие пары по совпадению telegram_username и объединяет их:
 * все данные переносятся на аккаунт с telegram_id (он нужен боту, Mini App и
 * уведомлениям), туда же копируется telegram_oidc_sub — после этого оба способа
 * входа ведут в один кабинет. Дубль удаляется.
 *
 * Использование (на сервере):
 *   docker compose exec backend node scripts/merge-telegram-duplicates.js          # разбор без изменений
 *   docker compose exec backend node scripts/merge-telegram-duplicates.js --apply  # выполнить слияние
 *
 * ВАЖНО: связывание по username безопасно только как разовая административная
 * операция под присмотром — username в Telegram можно сменить и переуступить,
 * поэтому автоматически при входе так делать нельзя (захват чужого аккаунта).
 * Сначала запустите без --apply и глазами проверьте пары.
 */
require('dotenv').config()
const db = require('../db')

const APPLY = process.argv.includes('--apply')

// Таблицы с уникальностью по user_id — простой UPDATE упрётся в конфликт,
// поэтому обрабатываются отдельно.
const WALLET = 'user_wallets'
const REFERRAL_LINKS = 'referral_links'

async function fkTables() {
  const { rows } = await db.query(`
    SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'users'
     ORDER BY 1, 2`)
  return rows
}

async function countRefs(userId, refs) {
  const out = {}
  for (const { table_name, column_name } of refs) {
    try {
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "${table_name}" WHERE "${column_name}" = $1`, [userId])
      if (rows[0].n > 0) out[`${table_name}.${column_name}`] = rows[0].n
    } catch { /* таблицы может не быть */ }
  }
  return out
}

async function findPairs() {
  // Пара: аккаунт из бота (telegram_id) + аккаунт из браузера (oidc_sub)
  // с одинаковым telegram_username.
  const { rows } = await db.query(`
    SELECT b.id AS bot_id, b.login AS bot_login, b.telegram_id, b.telegram_oidc_sub AS bot_sub,
           o.id AS oidc_id, o.login AS oidc_login, o.telegram_oidc_sub AS oidc_sub,
           b.telegram_username AS username,
           b.is_admin AS bot_admin, o.is_admin AS oidc_admin
      FROM users b
      JOIN users o
        ON LOWER(o.telegram_username) = LOWER(b.telegram_username)
       AND o.id <> b.id
     WHERE b.telegram_id IS NOT NULL
       AND b.telegram_username IS NOT NULL
       AND o.telegram_id IS NULL
       AND o.telegram_oidc_sub IS NOT NULL
     ORDER BY b.id`)
  return rows
}

async function mergePair(pair, refs) {
  const { bot_id, oidc_id, oidc_sub, bot_sub } = pair
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Кошелёк: если есть у обоих — переносим баланс на основной, дубль удаляем.
    try {
      const w = await client.query(`SELECT user_id, balance FROM ${WALLET} WHERE user_id IN ($1,$2)`, [bot_id, oidc_id])
      const mainW = w.rows.find(r => r.user_id === bot_id)
      const dupW = w.rows.find(r => r.user_id === oidc_id)
      if (dupW) {
        if (mainW) {
          await client.query(`UPDATE ${WALLET} SET balance = balance + $1 WHERE user_id = $2`, [dupW.balance || 0, bot_id])
          await client.query(`DELETE FROM ${WALLET} WHERE user_id = $1`, [oidc_id])
        } else {
          await client.query(`UPDATE ${WALLET} SET user_id = $1 WHERE user_id = $2`, [bot_id, oidc_id])
        }
      }
    } catch { /* таблицы может не быть */ }

    // 2. Реферальные ссылки: код привязан к юзеру и уникален — у основного свой
    //    уже есть, дубликат просто удаляем (его кодом никто не пользовался).
    try {
      const rl = await client.query(`SELECT 1 FROM ${REFERRAL_LINKS} WHERE user_id = $1`, [bot_id])
      if (rl.rows.length) await client.query(`DELETE FROM ${REFERRAL_LINKS} WHERE user_id = $1`, [oidc_id])
      else await client.query(`UPDATE ${REFERRAL_LINKS} SET user_id = $1 WHERE user_id = $2`, [bot_id, oidc_id])
    } catch { /* ignore */ }

    // 3. Всё остальное — переносим ссылки на основной аккаунт.
    const moved = {}
    for (const { table_name, column_name } of refs) {
      if (table_name === WALLET || table_name === REFERRAL_LINKS) continue
      try {
        const r = await client.query(`UPDATE "${table_name}" SET "${column_name}" = $1 WHERE "${column_name}" = $2`, [bot_id, oidc_id])
        if (r.rowCount > 0) moved[`${table_name}.${column_name}`] = r.rowCount
      } catch (e) {
        // Уникальные ограничения/самоссылки — записи дубля просто не переносим.
        console.warn(`    ! ${table_name}.${column_name}: ${e.message.split('\n')[0]}`)
      }
    }

    // 4. Удаляем дубль ДО переноса oidc_sub: на telegram_oidc_sub висит
    //    уникальный индекс, и записать тот же sub основному, пока дубль жив,
    //    нельзя.
    await client.query('DELETE FROM users WHERE id = $1', [oidc_id])

    // 5. Переносим OIDC-идентификатор на основной аккаунт, чтобы браузерный
    //    вход теперь попадал именно в него.
    if (!bot_sub) {
      await client.query('UPDATE users SET telegram_oidc_sub = $1 WHERE id = $2', [oidc_sub, bot_id])
    }

    await client.query('COMMIT')
    return { ok: true, moved }
  } catch (e) {
    await client.query('ROLLBACK')
    return { ok: false, error: e.message }
  } finally {
    client.release()
  }
}

;(async () => {
  const refs = await fkTables()
  const pairs = await findPairs()

  console.log(`\n=== Дубли Telegram-аккаунтов: найдено пар — ${pairs.length} ===\n`)
  if (pairs.length === 0) {
    console.log('Дублей нет. Ничего делать не нужно.')
    process.exit(0)
  }

  for (const p of pairs) {
    console.log(`@${p.username}`)
    console.log(`  ОСНОВНОЙ (останется): id=${p.bot_id} "${p.bot_login}" telegram_id=${p.telegram_id}${p.bot_admin ? ' [админ]' : ''}`)
    console.log(`  ДУБЛЬ  (будет удалён): id=${p.oidc_id} "${p.oidc_login}" oidc_sub=${p.oidc_sub}${p.oidc_admin ? ' [админ]' : ''}`)

    const mainRefs = await countRefs(p.bot_id, refs)
    const dupRefs = await countRefs(p.oidc_id, refs)
    console.log(`  данные основного: ${Object.keys(mainRefs).length ? JSON.stringify(mainRefs) : '—'}`)
    console.log(`  данные дубля:     ${Object.keys(dupRefs).length ? JSON.stringify(dupRefs) : '—'}  ← будут перенесены`)
    if (p.oidc_admin && !p.bot_admin) {
      console.log('  ! ВНИМАНИЕ: права админа есть у дубля, но не у основного — после слияния их нужно выдать основному.')
    }
    console.log('')
  }

  if (!APPLY) {
    console.log('Это разбор без изменений. Проверьте пары выше и, если всё верно, запустите:')
    console.log('  docker compose exec backend node scripts/merge-telegram-duplicates.js --apply\n')
    process.exit(0)
  }

  console.log('=== Слияние ===\n')
  for (const p of pairs) {
    process.stdout.write(`@${p.username}: id=${p.oidc_id} → id=${p.bot_id} … `)
    const r = await mergePair(p, refs)
    if (r.ok) {
      console.log('OK')
      const moved = Object.entries(r.moved)
      if (moved.length) console.log('    перенесено: ' + moved.map(([k, v]) => `${k}=${v}`).join(', '))
    } else {
      console.log('ОШИБКА (изменения откачены): ' + r.error)
    }
  }
  console.log('\nГотово. Оба способа входа теперь ведут в один кабинет.')
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
