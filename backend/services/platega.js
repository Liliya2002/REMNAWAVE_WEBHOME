const axios = require('axios');
const paymentSettings = require('./paymentSettings');

/**
 * Клиент Platega.io.
 *
 * Ключи и URL берутся из настроек (админка → Платёжки), с откатом на .env —
 * см. services/paymentSettings.js. Читаются при каждом вызове (значения
 * кэшируются в сервисе настроек), поэтому смена ключей в админке применяется
 * без перезапуска backend.
 */

/**
 * Create payment link via Platega.io API
 * @param {number} amount - Payment amount
 * @param {string} currency - Currency code (RUB, USD, etc.)
 * @param {string} description - Payment description
 * @param {string} payload - Custom data (e.g., userId|planId|period)
 * @returns {Promise<Object>} Payment data with transactionId and redirect URL
 */
async function createPayment(amount, currency, description, payload) {
  return createTransaction({ amount, currency, description, payload });
}

/**
 * Создание транзакции с необязательными адресами возврата.
 *
 * Существовать обязана: смена тарифа (services/payment.js) и докупка трафика
 * (routes/subscriptions.js) вызывали platega.createTransaction, которой в
 * модуле не было — оба потока падали с TypeError, оплата картой там не
 * работала вовсе. Сигнатура подогнана под эти вызовы: orderId, successUrl и
 * failUrl приходят именно так.
 *
 * Адреса возврата поддерживаются самим API (поля return и failedUrl в теле),
 * поэтому пер-платёжные значения имеют смысл: они ведут обратно на страницу
 * конкретного платежа. Не переданы — берутся общие из настроек.
 */
async function createTransaction({
  amount,
  currency = 'RUB',
  description,
  payload,
  orderId,
  successUrl,
  returnUrl,
  failUrl,
  failedUrl,
}) {
  const { platega } = await paymentSettings.get();

  try {
    if (!platega.configured) {
      throw new Error('Platega не настроена. Задайте Merchant ID и Secret в админке → Настройки → Платёжки');
    }
    if (!platega.enabled) {
      throw new Error('Приём платежей через Platega отключён в настройках');
    }

    const requestData = {
      paymentMethod: platega.paymentMethod,
      paymentDetails: {
        amount: parseFloat(amount),
        currency: currency.toUpperCase()
      },
      description: description,
      return: successUrl || returnUrl || platega.successUrl,
      failedUrl: failUrl || failedUrl || platega.failedUrl,
      payload: payload || orderId
    };

    console.log('Creating Platega payment:', requestData);

    const response = await axios.post(
      `${platega.apiUrl}/transaction/process`,
      requestData,
      {
        headers: {
          'X-MerchantId': platega.merchantId,
          'X-Secret': platega.secret,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Platega payment created:', response.data);

    return {
      success: true,
      transactionId: response.data.transactionId,
      redirectUrl: response.data.redirect,
      status: response.data.status,
      expiresIn: response.data.expiresIn
    };

  } catch (error) {
    console.error('Platega payment creation error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'Failed to create payment');
  }
}

/**
 * Verify webhook signature from Platega
 * Platega отправляет credentials в заголовках - проверяем через timing-safe сравнение
 * @param {Object} headers - Request headers
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyWebhookSignature(headers) {
  const crypto = require('crypto');
  const { platega } = await paymentSettings.get();

  const merchantId = headers['x-merchantid'] || '';
  const secret = headers['x-secret'] || '';

  if (!platega.configured) return false;

  try {
    // timingSafeEqual требует одинаковую длину буферов — иначе бросает.
    const a = Buffer.from(merchantId, 'utf8');
    const b = Buffer.from(platega.merchantId, 'utf8');
    const c = Buffer.from(secret, 'utf8');
    const d = Buffer.from(platega.secret, 'utf8');
    if (a.length !== b.length || c.length !== d.length) return false;
    return crypto.timingSafeEqual(a, b) && crypto.timingSafeEqual(c, d);
  } catch {
    return false;
  }
}

module.exports = {
  createPayment,
  createTransaction,
  verifyWebhookSignature
};
