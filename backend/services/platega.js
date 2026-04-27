const axios = require('axios');

const PLATEGA_API_URL = 'https://app.platega.io';
const MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID;
const SECRET = process.env.PLATEGA_SECRET;
const PAYMENT_METHOD = 2; // Default payment method ID (usually SBP/QR)
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Create payment link via Platega.io API
 * @param {number} amount - Payment amount
 * @param {string} currency - Currency code (RUB, USD, etc.)
 * @param {string} description - Payment description
 * @param {string} payload - Custom data (e.g., userId|planId|period)
 * @returns {Promise<Object>} Payment data with transactionId and redirect URL
 */
async function createPayment(amount, currency, description, payload) {
  try {
    if (!MERCHANT_ID || !SECRET) {
      throw new Error('Platega credentials not configured. Set PLATEGA_MERCHANT_ID and PLATEGA_SECRET in environment');
    }

    const requestData = {
      paymentMethod: PAYMENT_METHOD,
      paymentDetails: {
        amount: parseFloat(amount),
        currency: currency.toUpperCase()
      },
      description: description,
      return: `${FRONTEND_URL}/payment/success`,
      failedUrl: `${FRONTEND_URL}/payment/failed`,
      payload: payload
    };

    console.log('Creating Platega payment:', requestData);

    const response = await axios.post(
      `${PLATEGA_API_URL}/transaction/process`,
      requestData,
      {
        headers: {
          'X-MerchantId': MERCHANT_ID,
          'X-Secret': SECRET,
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
    throw new Error(error.response?.data?.message || 'Failed to create payment');
  }
}

/**
 * Verify webhook signature from Platega
 * Platega отправляет credentials в заголовках - проверяем через timing-safe сравнение
 * @param {Object} headers - Request headers
 * @returns {boolean} True if signature is valid
 */
function verifyWebhookSignature(headers) {
  const crypto = require('crypto');
  const merchantId = headers['x-merchantid'] || '';
  const secret = headers['x-secret'] || '';

  if (!MERCHANT_ID || !SECRET) return false;

  try {
    const merchantMatch = crypto.timingSafeEqual(
      Buffer.from(merchantId, 'utf8'),
      Buffer.from(MERCHANT_ID, 'utf8')
    );
    const secretMatch = crypto.timingSafeEqual(
      Buffer.from(secret, 'utf8'),
      Buffer.from(SECRET, 'utf8')
    );
    return merchantMatch && secretMatch;
  } catch {
    return false;
  }
}

module.exports = {
  createPayment,
  verifyWebhookSignature
};
