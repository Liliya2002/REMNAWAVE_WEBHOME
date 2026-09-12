/**
 * Повторная выдача доступа в RemnaWave для оплаченных подписок.
 *
 * Забирает из очереди те подписки, у которых provisioning_status = 'pending' и
 * подошло время следующей попытки. Очередь пополняет activateSubscription,
 * когда панель не ответила или у тарифа не оказалось серверной группы.
 *
 * Тик частый (минута), потому что типичный сбой проходит за минуты, а человек
 * в это время сидит без доступа к тому, за что заплатил. Нагрузки это не даёт:
 * в спокойном состоянии очередь пуста, и запрос по частичному индексу ничего
 * не находит.
 */
const provisioning = require('../services/provisioning')
const log = require('../services/logger').for('Выдача доступа')

const TICK_MS = 60 * 1000
const BATCH = 5

let timer = null
let running = false

async function tick() {
  if (running) return          // прошлый тик ещё идёт — панель медленная
  running = true
  try {
    const r = await provisioning.retryDue({ limit: BATCH })
    if (r.picked) {
      log.info(`Повтор выдачи: взято ${r.picked}, выдано ${r.fixed}`)
    }
  } catch (err) {
    log.error('Тик повторов упал', err)
  } finally {
    running = false
  }
}

function start() {
  if (timer) return
  // Первый прогон с задержкой: на старте базе и панели дают подняться.
  setTimeout(() => {
    tick().catch(() => {})
    timer = setInterval(() => tick().catch(() => {}), TICK_MS)
    if (timer.unref) timer.unref()
  }, 20000)
  log.info(`Повтор выдачи доступа запущен, тик ${TICK_MS / 1000} с`)
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { start, stop, tick }
