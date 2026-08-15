#!/usr/bin/env node
/**
 * Сверка «повисших» платежей с Platega.
 *
 * Зачем. Единственный путь зачисления денег — webhook. Если колбэк не дошёл
 * (не задан Callback URL в кабинете, сеть, перезапуск, режим обслуживания),
 * платёж остаётся в pending/expired навсегда и никто об этом не узнаёт:
 * пользователь видит «оплачено» на стороне провайдера, а баланс пуст.
 * Скрипт спрашивает у Platega реальный статус и добивает то, что она уже
 * подтвердила.
 *
 * Запрос статуса — GET, повторять безопасно. Изменения применяются той же
 * функцией, что обрабатывает webhook (processPlategaWebhook): транзакция,
 * SELECT ... FOR UPDATE, машина состояний, идемпотентность. Повторный запуск
 * ничего не задвоит — платёж уже будет в completed.
 *
 * Использование (по умолчанию — разбор без изменений):
 *   docker compose exec backend node scripts/reconcile-payments.js
 *   docker compose exec backend node scripts/reconcile-payments.js --apply
 *   docker compose exec backend node scripts/reconcile-payments.js --id 14 --apply
 *   docker compose exec backend node scripts/reconcile-payments.js --days 30
 */
require('dotenv').config();

const axios = require('axios');
const db = require('../db');
const paymentSettings = require('../services/paymentSettings');
const payments = require('../routes/payments');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const readArg = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1 || i === args.length - 1) return def;
  return args[i + 1];
};
const ONLY_ID = readArg('--id', null);
const DAYS = Number(readArg('--days', 14));

// Статусы, из которых платёж ещё может стать оплаченным. Совпадают с
// UNPAID_STATUSES в routes/payments.js.
const UNPAID = ['pending', 'expired'];

const log = (...a) => console.log(...a);

async function fetchStatus(platega, transactionId) {
  const url = `${platega.apiUrl}/transaction/${transactionId}`;
  const r = await axios.get(url, {
    headers: { 'X-MerchantId': platega.merchantId, 'X-Secret': platega.secret },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (r.status === 404) return { notFound: true };
  if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return { data: r.data };
}

async function main() {
  const { platega } = await paymentSettings.get();
  if (!platega.configured) {
    console.error('Platega не настроена: нет Merchant ID или Secret.');
    process.exit(1);
  }

  await payments.ensureWalletSchema();

  const params = [UNPAID];
  let where = `status = ANY($1) AND provider_payment_id IS NOT NULL
               AND payment_provider = 'platega'`;
  if (ONLY_ID) {
    params.push(Number(ONLY_ID));
    where += ` AND id = $${params.length}`;
  } else {
    params.push(DAYS);
    where += ` AND created_at > NOW() - ($${params.length} || ' days')::interval`;
  }

  const { rows } = await db.query(
    `SELECT id, user_id, amount, currency, status, payment_type, provider_payment_id, created_at
       FROM payments WHERE ${where} ORDER BY id`,
    params
  );

  log(APPLY ? '=== РЕЖИМ ПРИМЕНЕНИЯ ===' : '=== РАЗБОР БЕЗ ИЗМЕНЕНИЙ (--apply чтобы применить) ===');
  log(`Незакрытых платежей к проверке: ${rows.length}\n`);
  if (!rows.length) return;

  const stat = { confirmed: 0, applied: 0, still_pending: 0, canceled: 0, not_found: 0, errors: 0 };

  for (const p of rows) {
    const head = `#${p.id} user=${p.user_id} ${p.amount} ${p.currency} ${p.payment_type} (${p.status}, ${p.created_at.toISOString().slice(0, 16)})`;
    let res;
    try {
      res = await fetchStatus(platega, p.provider_payment_id);
    } catch (e) {
      stat.errors++;
      log(`${head}\n   ✗ ошибка запроса: ${e.message}`);
      continue;
    }

    if (res.notFound) {
      stat.not_found++;
      log(`${head}\n   ? Platega не знает такой транзакции`);
      continue;
    }

    const remote = res.data.status;
    const paid = Number(res.data.paymentDetails?.amount ?? NaN);

    if (remote !== 'CONFIRMED') {
      if (remote === 'CANCELED') stat.canceled++; else stat.still_pending++;
      log(`${head}\n   — у Platega ${remote}, ничего не делаем`);
      continue;
    }

    stat.confirmed++;
    // Комиссия может добавляться сверх суммы счёта, поэтому у провайдера
    // сумма бывает больше нашей. На баланс всё равно идёт payment.amount.
    const note = Number.isFinite(paid) && Math.abs(paid - Number(p.amount)) > 0.01
      ? ` (у провайдера ${paid} ${res.data.paymentDetails?.currency} — с комиссией)`
      : '';
    log(`${head}\n   ✓ CONFIRMED${note}`);

    if (!APPLY) {
      log(`     → будет зачислено ${p.amount} ${p.currency}`);
      continue;
    }

    // Синтетический колбэк — ровно та же форма, что шлёт Platega.
    const body = {
      id: p.provider_payment_id,
      amount: Number.isFinite(paid) ? paid : Number(p.amount),
      currency: res.data.paymentDetails?.currency || p.currency,
      status: 'CONFIRMED',
      paymentMethod: res.data.paymentMethod || null,
    };

    try {
      const out = await payments.processPlategaWebhook(body);
      if (out.outcome === 'applied') {
        stat.applied++;
        log(`     → зачислено, платёж переведён в completed`);
        // Подписки активируются вне транзакции — как и в webhook-роуте.
        if (out.activateSubscription) {
          const svc = require('../services/payment');
          const pay = out.payment;
          if (pay.payment_type === 'subscription_change') await svc.activateSubscriptionChange(pay);
          else if (pay.payment_type === 'squad_traffic_topup') await svc.activateSquadTrafficTopup(pay);
          else await svc.activateSubscription(pay);
          log(`     → подписка активирована`);
        }
      } else {
        log(`     → без изменений: ${out.outcome}`);
      }
    } catch (e) {
      stat.errors++;
      log(`     ✗ применить не удалось: ${e.message}`);
    }
  }

  log('\n--- Итог ---');
  log(`подтверждено у Platega: ${stat.confirmed}`);
  log(`зачислено сейчас:       ${stat.applied}`);
  log(`ещё не оплачено:        ${stat.still_pending}`);
  log(`отменено:               ${stat.canceled}`);
  log(`не найдено у Platega:   ${stat.not_found}`);
  log(`ошибок:                 ${stat.errors}`);
  if (!APPLY && stat.confirmed) {
    log('\nЭто был разбор. Повторите с --apply, чтобы зачислить.');
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Сбой:', e); process.exit(1); });
