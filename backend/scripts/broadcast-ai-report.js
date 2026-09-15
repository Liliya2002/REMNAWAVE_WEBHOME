#!/usr/bin/env node
/**
 * Отчёт о работе ИИ-планировщика рассылок.
 *
 * Зачем. Понять, что с ним происходит, по логам контейнера почти нельзя: в
 * stdout уходит одна строка на прогон, а прогон бывает раз в сутки — за неделю
 * это семь строк, и те теряются после ротации. Вся содержательная история
 * лежит в базе: broadcast_ai_runs (каждое решение с причиной) и
 * broadcast_proposals (что предложил и чем кончилось). Скрипт собирает их в
 * один разбор и заодно проверяет настройки, из-за которых планировщик может
 * молчать, ничего при этом не ломая.
 *
 * Только чтение: ни одного INSERT/UPDATE, ни одного обращения к API бота.
 * Запускать можно когда угодно и сколько угодно раз.
 *
 * Использование:
 *   docker compose exec backend node scripts/broadcast-ai-report.js
 *   docker compose exec backend node scripts/broadcast-ai-report.js --days 30
 *   docker compose exec backend node scripts/broadcast-ai-report.js --full
 */
require('dotenv').config()
const db = require('../db')

const args = process.argv.slice(2)
const DAYS = Number((args.find(a => a.startsWith('--days')) || '').split('=')[1]
  || args[args.indexOf('--days') + 1]) || 14
const FULL = args.includes('--full')

const C = {
  h: s => `\x1b[1m\x1b[36m${s}\x1b[0m`,
  ok: s => `\x1b[32m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  err: s => `\x1b[31m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
}

const fmtDT = v => v ? new Date(v).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/** Склонение: 1 предложение, 2 предложения, 5 предложений. */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}
const ago = v => {
  if (!v) return 'никогда'
  const h = (Date.now() - new Date(v).getTime()) / 3600000
  if (h < 1) return `${Math.round(h * 60)} мин назад`
  if (h < 48) return `${Math.round(h)} ч назад`
  return `${Math.round(h / 24)} дн. назад`
}

/** Технические коды исходов — словами. */
const OUTCOME = {
  proposed:  ['предложение создано', 'ok'],
  scheduled: ['поставлено в очередь автопилота', 'ok'],
  sent:      ['отправлено автопилотом', 'ok'],
  dry_run:   ['холостой прогон, карточка не создана', 'dim'],
  skipped:   ['решил не отправлять', 'dim'],
  blocked:   ['заблокировано проверками', 'warn'],
  error:     ['ошибка', 'err'],
}

const problems = []
const note = (level, text, fix) => problems.push({ level, text, fix })

async function main() {
  console.log(C.h(`\n══ ИИ-планировщик рассылок: разбор за ${DAYS} дн. ══\n`))

  // ── Настройки ──
  const s = (await db.query('SELECT * FROM broadcast_settings WHERE id = 1')).rows[0]
  if (!s) {
    console.log(C.err('Настроек нет вовсе — таблица broadcast_settings пуста.'))
    process.exit(1)
  }

  const MODES = { off: 'выключен', prepare: 'готовит предложения, не отправляет', auto: 'автопилот — отправляет сам' }
  console.log(C.h('Настройки'))
  console.log(`  режим:            ${s.ai_mode === 'off' ? C.warn(MODES[s.ai_mode]) : C.ok(MODES[s.ai_mode] || s.ai_mode)}`)
  console.log(`  холостой режим:   ${s.ai_dry_run ? C.warn('да — ничего не создаётся и не шлётся') : 'нет'}`)
  console.log(`  интервал:         раз в ${s.ai_interval_hours} ч`)
  console.log(`  порог уверенности:${String(s.ai_min_confidence).padStart(5)}`)
  console.log(`  сегменты для ИИ:  ${(s.ai_allowed_targets || []).join(', ') || C.dim('не заданы — берутся общие')}`)
  console.log(`  общие сегменты:   ${(s.allowed_targets || []).join(', ') || C.dim('не заданы — разрешены все')}`)
  console.log(`  тихие часы:       ${s.quiet_from_hour == null ? C.dim('не заданы') : `${s.quiet_from_hour}:00 — ${s.quiet_to_hour}:00`}`)
  console.log(`  доп. указания:    ${s.ai_prompt ? `${String(s.ai_prompt).length} симв.` : C.dim('пусто')}`)
  console.log(`  последний прогон: ${fmtDT(s.ai_last_run_at)} ${C.dim('(' + ago(s.ai_last_run_at) + ')')}`)

  if (s.ai_mode === 'off') note('warn', 'Режим ИИ выключен — планировщик не запускается вовсе.', 'Админка → Рассылка сообщений → ИИ → режим')
  if (s.ai_dry_run && s.ai_mode !== 'off') note('warn', 'Включён холостой режим: решения принимаются, но предложения не создаются.', 'Снять галочку «холостой режим», когда наглядитесь на решения')

  // ── Ключ ИИ ──
  const ai = (await db.query('SELECT api_key, model, enabled FROM ai_assistant_settings LIMIT 1')).rows[0]
  const hasKey = !!(ai && ai.api_key)
  console.log(`  ключ ИИ:          ${hasKey ? C.ok('задан') : C.err('НЕ ЗАДАН — модель не вызывается')} ${C.dim('модель: ' + (ai?.model || '—'))}`)
  if (!hasKey) note('err', 'Ключ ИИ не задан — каждый прогон падает с «не задан ключ ИИ».', 'Админка → ИИ-ассистент → Подключение')

  // ── Прогоны ──
  const runs = await db.query(
    `SELECT * FROM broadcast_ai_runs WHERE created_at > NOW() - ($1 || ' days')::interval ORDER BY created_at DESC`,
    [DAYS]
  )
  console.log(C.h(`\nПрогоны (${runs.rows.length} за ${DAYS} дн.)`))

  if (!runs.rows.length) {
    console.log(C.warn('  Ни одного прогона.'))
    note('warn', 'За период нет ни одного прогона — крон не доходит до модели.',
      'Проверьте, что режим не off и контейнер backend не перезапускается чаще интервала')
  } else {
    const byOutcome = {}
    for (const r of runs.rows) byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1
    for (const [k, n] of Object.entries(byOutcome).sort((a, b) => b[1] - a[1])) {
      const [label, tone] = OUTCOME[k] || [k, 'dim']
      console.log(`  ${String(n).padStart(4)}  ${C[tone](label)}`)
    }

    const tok = runs.rows.reduce((a, r) => a + (r.input_tokens || 0) + (r.output_tokens || 0), 0)
    if (tok) console.log(C.dim(`  токенов израсходовано: ${tok.toLocaleString('ru-RU')}`))

    // Ошибки — главное, ради чего сюда смотрят
    const errs = runs.rows.filter(r => r.outcome === 'error')
    if (errs.length) {
      console.log(C.h('\nОшибки'))
      const byDetail = {}
      for (const e of errs) {
        const key = String(e.detail || 'без описания').slice(0, 140)
        byDetail[key] = byDetail[key] || { n: 0, last: e.created_at }
        byDetail[key].n++
      }
      for (const [d, v] of Object.entries(byDetail).sort((a, b) => b[1].n - a[1].n)) {
        console.log(`  ${C.err('×' + v.n)}  ${d}`)
        console.log(C.dim(`        последняя: ${fmtDT(v.last)}`))
      }
      note('err', `${errs.length} ${plural(errs.length, 'ошибка', 'ошибки', 'ошибок')} за период. Разбор причин — выше.`, null)
    }

    // Почему молчит
    const skipped = runs.rows.filter(r => r.outcome === 'skipped')
    if (skipped.length) {
      console.log(C.h('\nПочему решил не отправлять'))
      const byReason = {}
      for (const r of skipped) {
        const key = String(r.detail || r.reason || 'без причины').slice(0, 120)
        byReason[key] = (byReason[key] || 0) + 1
      }
      for (const [d, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        console.log(`  ${String(n).padStart(4)}  ${d}`)
      }
    }

    const blocked = runs.rows.filter(r => r.outcome === 'blocked')
    if (blocked.length) {
      console.log(C.h('\nЧто заблокировали проверки'))
      const byReason = {}
      for (const r of blocked) {
        const key = String(r.detail || 'без причины').slice(0, 120)
        byReason[key] = (byReason[key] || 0) + 1
      }
      for (const [d, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${C.warn(String(n).padStart(4))}  ${d}`)
      }
    }

    if (FULL) {
      console.log(C.h('\nВсе прогоны подряд'))
      for (const r of runs.rows) {
        const [label, tone] = OUTCOME[r.outcome] || [r.outcome, 'dim']
        console.log(`  ${fmtDT(r.created_at)}  ${C[tone](label.padEnd(36))} ${r.target || ''} ${C.dim(r.detail || '')}`)
      }
    }
  }

  // ── Предложения ──
  const props = await db.query(
    `SELECT * FROM broadcast_proposals WHERE created_at > NOW() - ($1 || ' days')::interval ORDER BY created_at DESC`,
    [DAYS]
  )
  console.log(C.h(`\nПредложения (${props.rows.length} за ${DAYS} дн.)`))

  const STATUS = {
    pending:   ['ждут решения человека', 'warn'],
    scheduled: ['стоят в очереди на отправку', 'warn'],
    approved:  ['одобрены', 'ok'],
    rejected:  ['отклонены', 'dim'],
    cancelled: ['сняты', 'dim'],
  }
  if (!props.rows.length) {
    console.log(C.dim('  Пусто.'))
  } else {
    const byStatus = {}
    for (const p of props.rows) byStatus[p.status] = (byStatus[p.status] || 0) + 1
    for (const [k, n] of Object.entries(byStatus)) {
      const [label, tone] = STATUS[k] || [k, 'dim']
      console.log(`  ${String(n).padStart(4)}  ${C[tone](label)}`)
    }

    const stuck = props.rows.filter(p => p.status === 'pending')
    if (stuck.length) {
      note('warn',
        `${stuck.length} ${plural(stuck.length, 'предложение ждёт', 'предложения ждут', 'предложений ждут')} ` +
        'решения — пока они висят, новые не создаются.',
        'Админка → Рассылка сообщений → ИИ: одобрить или отклонить')
      for (const p of stuck.slice(0, 5)) {
        console.log(`        ${C.warn('#' + p.id)} ${p.target}, ${ago(p.created_at)}: ${String(p.message_text || '').replace(/\s+/g, ' ').slice(0, 70)}…`)
      }
    }

    const failed = props.rows.filter(p => p.fail_reason)
    if (failed.length) {
      console.log(C.h('\nНе ушли при отправке'))
      for (const p of failed.slice(0, 10)) {
        console.log(`  ${C.err('#' + p.id)} ${p.target} ${C.dim(fmtDT(p.created_at))}: ${p.fail_reason}`)
      }
      note('err',
        `${failed.length} ${plural(failed.length, 'предложение не удалось', 'предложения не удалось', 'предложений не удалось')} отправить.`,
        null)
    }

    // Отказы человека — по ним модель учится
    const rejected = props.rows.filter(p => p.status === 'rejected' && p.reject_reason)
    if (rejected.length) {
      console.log(C.h('\nПричины отказов (уходят в промпт, чтобы не повторялся)'))
      for (const p of rejected.slice(0, 8)) {
        console.log(`  ${C.dim('#' + p.id)} ${p.target}: ${p.reject_reason}`)
      }
    }
  }

  // ── Итог ──
  console.log(C.h('\n══ Итог ══'))
  if (!problems.length) {
    console.log(C.ok('  Замечаний нет.'))
  } else {
    for (const p of problems) {
      const mark = p.level === 'err' ? C.err('✗') : C.warn('!')
      console.log(`  ${mark} ${p.text}`)
      if (p.fix) console.log(C.dim(`      где чинить: ${p.fix}`))
    }
  }
  console.log(C.dim('\n  Подробный список прогонов: добавьте --full'))
  console.log(C.dim('  Другой период:              --days 30\n'))
  process.exit(0)
}

main().catch(e => {
  console.error(C.err('Скрипт упал: ' + e.message))
  process.exit(1)
})
