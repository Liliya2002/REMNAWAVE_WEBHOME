/**
 * Yandex.Cloud Operations API — асинхронные операции (create/delete/etc возвращают Operation,
 * по которому надо периодически поллить пока done:true.
 * Документация: https://yandex.cloud/ru/docs/api-design-guide/concepts/operation
 */
const OPERATION_BASE = 'https://operation.api.cloud.yandex.net/operations'

/**
 * Поллит операцию пока не завершится.
 * @param {object} yc — ycClient
 * @param {object} operation — объект operation возвращённый из POST/PATCH/DELETE
 * @param {{ maxWaitMs?: number, pollMs?: number }} opts
 * @returns {object} финальный operation { id, done: true, response | error, ... }
 */
async function waitForOperation(yc, operation, { maxWaitMs = 60000, pollMs = 1000 } = {}) {
  if (!operation || !operation.id) throw new Error('waitForOperation: operation.id отсутствует')
  if (operation.done) return operation

  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollMs))
    const r = await yc.get(`${OPERATION_BASE}/${operation.id}`)
    const op = r.data
    if (op.done) {
      if (op.error) {
        const e = new Error(`Operation ${operation.id} failed: ${op.error.message || JSON.stringify(op.error)}`)
        e.operationError = op.error
        throw e
      }
      return op
    }
  }
  throw new Error(`Operation ${operation.id} timeout after ${maxWaitMs}ms`)
}

module.exports = { waitForOperation }
