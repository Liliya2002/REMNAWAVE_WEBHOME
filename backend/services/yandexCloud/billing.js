/**
 * Yandex.Cloud Billing API — баланс, billing accounts, статус автоплатежа.
 * Документация: https://yandex.cloud/ru/docs/billing/api-ref/BillingAccount/
 */
const BILLING_BASE = 'https://billing.api.cloud.yandex.net/billing/v1'

/**
 * Список billing-аккаунтов, к которым у юзера есть доступ.
 */
async function listBillingAccounts(yc, { pageSize = 50, pageToken } = {}) {
  const r = await yc.get(`${BILLING_BASE}/billingAccounts`, {
    params: { pageSize, pageToken },
  })
  return {
    accounts: (r.data?.billingAccounts || []).map(simplifyBillingAccount),
    nextPageToken: r.data?.nextPageToken || null,
  }
}

/**
 * Один billing-аккаунт с деталями (баланс, тип контракта, paymentMethod).
 */
async function getBillingAccount(yc, billingAccountId) {
  const r = await yc.get(`${BILLING_BASE}/billingAccounts/${billingAccountId}`)
  return simplifyBillingAccount(r.data)
}

function simplifyBillingAccount(b) {
  if (!b) return null
  // Вариант наличия автоплатежа определяем эвристически — YC по факту не публикует
  // явное поле "autoPayEnabled". Если есть paymentMethodId / paymentCycleType / activePaymentTypeId — считаем что есть способ оплаты.
  const hasPaymentMethod = !!(
    b.paymentMethodId || b.activePaymentTypeId || b.paymentType ||
    (b.paymentCycleType && b.paymentCycleType !== 'INDIVIDUAL_PAYMENT_CYCLE_TYPE_UNSPECIFIED')
  )

  return {
    id: b.id,
    name: b.name,
    countryCode: b.countryCode,
    currency: b.currency,                  // RUB | USD
    balance: b.balance ? Number(b.balance) : null,
    billingThreshold: b.billingThreshold ? Number(b.billingThreshold) : null,
    active: !!b.active,
    usageStatus: b.usageStatus,            // PAYMENT_REQUIRED | PAID | DISABLED | TRIAL
    contractType: b.contractType,          // PERSON | COMPANY | INDIVIDUAL_ENTREPRENEUR | UNSPECIFIED
    personType: b.personType,
    masterAccountId: b.masterAccountId,
    createdAt: b.createdAt,
    paymentType: b.paymentType,
    hasPaymentMethod,
    // Сырые поля для отладки если автоплатёж определился неверно
    _raw: {
      paymentMethodId: b.paymentMethodId,
      activePaymentTypeId: b.activePaymentTypeId,
      paymentCycleType: b.paymentCycleType,
    },
  }
}

/**
 * Deep-link на страницу пополнения в YC-консоли (вариант A).
 * Открывается в новой вкладке — браузер пользователя авторизован в YC.
 */
function buildTopUpUrl({ billingAccountId, sum, currency = 'RUB' }) {
  if (!billingAccountId) return null
  // Параметр amount поддерживается консолью YC для предзаполнения суммы.
  const params = new URLSearchParams()
  if (sum) params.set('amount', String(sum))
  if (currency) params.set('currency', currency)
  const qs = params.toString()
  return `https://console.cloud.yandex.ru/billing/accounts/${billingAccountId}/payments${qs ? '?' + qs : ''}`
}

module.exports = {
  listBillingAccounts,
  getBillingAccount,
  simplifyBillingAccount,
  buildTopUpUrl,
}
