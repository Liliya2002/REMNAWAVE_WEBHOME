/**
 * Пользовательские эндпоинты промокодов.
 *
 * Пока здесь только активация кодов, которые не привязаны к оплате: «дни» и
 * «на баланс». Скидки подключаются к платёжным потокам отдельно.
 *
 * Клиент присылает ТОЛЬКО строку кода. Ни сумма, ни размер скидки снаружи не
 * принимаются — всё считает сервер.
 */
const express = require('express')
const rateLimit = require('express-rate-limit')
const router = express.Router()
const { verifyToken, verifyActive } = require('../middleware')
const promoService = require('../services/promoCodes')
const { getPlanAndAmount, PERIODS } = require('../services/pricing')
const planChange = require('../services/planChange')

router.use(verifyToken, verifyActive)

/**
 * Защита от перебора кодов.
 *
 * Глобальный лимитер — 1000 запросов за 15 минут, этого с запасом хватает,
 * чтобы прогнать словарь вида SALE20 / NEWYEAR / PROMO10 и найти рабочий код.
 *
 * Считаем ИМЕННО неудачные попытки: skipSuccessfulRequests пропускает ответы
 * со статусом < 400, поэтому неверный код обязан отдавать 400, а не 200 с
 * флагом внутри. Иначе перебор не штрафуется вовсе.
 *
 * Ключ — идентификатор пользователя, а не IP: за одним адресом сидит целый
 * дом, и блокировать всех из-за одного перебиральщика нельзя. Лимитер стоит
 * после verifyToken, так что req.userId уже заполнен.
 */
const promoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: req => String(req.userId),
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
})

/**
 * POST /api/promo/redeem
 * Body: { code }
 *
 * Активирует код типов days и balance. Скидочные коды сюда не проходят —
 * они применяются при оплате.
 */
router.post('/redeem', promoLimiter, async (req, res) => {
  const code = req.body?.code
  if (!code || typeof code !== 'string' || code.length > 64) {
    return res.status(400).json({ error: 'Введите промокод' })
  }

  try {
    const result = await promoService.redeem(req.userId, code)

    // 400 на отказ — не косметика: от статуса зависит, засчитает ли лимитер
    // попытку (см. комментарий к promoLimiter).
    if (!result.ok) {
      return res.status(400).json({ error: result.message, reason: result.reason })
    }

    const { granted, promo } = result

    // Пуш в Telegram. Только отсюда, не из сервиса: команда /promo в боте уже
    // отвечает пользователю сама, и уведомление продублировало бы ответ.
    // setImmediate — чтобы ответ HTTP не ждал Telegram.
    setImmediate(() => {
      const reward = granted.days
        ? `${granted.days} дн. подписки`
        : `${granted.balance} ₽ на баланс`
      require('../services/telegramBot/notify')
        .notifyUser(req.userId, 'user_promo_applied', { code: promo.code, reward })
        .catch(e => console.warn('[promo] уведомление не ушло:', e.message))
    })

    res.json({
      ok: true,
      type: promo.type,
      granted_days: granted.days || 0,
      granted_balance: granted.balance || 0,
      message: granted.days
        ? `Начислено ${granted.days} дн. подписки`
        : `Баланс пополнен на ${granted.balance} ₽`,
    })
  } catch (err) {
    console.error('[promo] redeem error:', err.message)
    res.status(500).json({ error: 'Не удалось активировать промокод' })
  }
})

/**
 * POST /api/promo/preview
 * Body покупки:      { code, plan_id, period }
 * Body смены тарифа: { code, subscription_id?, target_plan_id, period }
 *
 * Считает скидку, НИЧЕГО не резервируя — для подсказки в форме оплаты.
 * Сумма приходит не от клиента, а из тарифа: иначе подобранным телом запроса
 * можно было бы выманить любую «скидку».
 *
 * Под тем же лимитером, что и redeem: предпросмотр — это тоже проверка кода,
 * и именно через него удобнее всего перебирать словарь.
 */
router.post('/preview', promoLimiter, async (req, res) => {
  const { code, plan_id, period, subscription_id, target_plan_id } = req.body || {}

  if (!code || typeof code !== 'string' || code.length > 64) {
    return res.status(400).json({ error: 'Введите промокод' })
  }
  // Два режима. Покупка: база — цена тарифа за период. Смена тарифа: база —
  // ДОПЛАТА, посчитанная calculateChange. В обоих случаях сумму считает
  // сервер: приди она от клиента, подобранным телом запроса можно было бы
  // выманить любую «скидку».
  const isChange = !!target_plan_id

  if (!isChange && (!plan_id || !PERIODS.includes(period))) {
    return res.status(400).json({ error: 'Укажите тариф и период' })
  }

  try {
    let amount, effectivePlanId

    if (isChange) {
      const loaded = await planChange.loadSubAndPlans(req.userId, subscription_id, target_plan_id)
      if (loaded.error) return res.status(400).json({ error: loaded.error })

      const calc = planChange.calculateChange({
        subscription: loaded.sub,
        currentPlan: loaded.currentPlan,
        targetPlan: loaded.targetPlan,
        period,
      })
      if (!calc.ok) return res.status(400).json({ error: calc.error || 'Смена тарифа недоступна' })
      if (!(calc.payDifference > 0)) {
        return res.status(400).json({ error: 'Доплаты нет — промокод не нужен', reason: 'nothing_to_pay' })
      }
      amount = calc.payDifference
      // Ограничения кода по тарифу считаем от ЦЕЛЕВОГО: на него переходят.
      effectivePlanId = loaded.targetPlan.id
    } else {
      try {
        ({ amount } = await getPlanAndAmount(plan_id, period))
      } catch {
        return res.status(400).json({ error: 'Тариф недоступен для этого периода' })
      }
      effectivePlanId = plan_id
    }

    const check = await promoService.validate(code, {
      userId: req.userId,
      planId: effectivePlanId,
      period,
      amount,
      allowTypes: promoService.DISCOUNT_TYPES,
    })

    if (!check.ok) {
      return res.status(400).json({ error: check.message, reason: check.reason })
    }

    res.json({
      ok: true,
      code: check.promo.code,
      type: check.promo.type,
      original_amount: check.originalAmount,
      discount: check.discount,
      final_amount: check.finalAmount,
    })
  } catch (err) {
    console.error('[promo] preview error:', err.message)
    res.status(500).json({ error: 'Не удалось проверить промокод' })
  }
})

module.exports = router
