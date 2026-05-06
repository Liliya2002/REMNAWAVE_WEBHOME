const express = require('express')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../db')
const referralService = require('../services/referral')
const { notifyWelcome } = require('../services/notifications')
const emailService = require('../services/email')
const { createSession } = require('./sessions')
const { checkBannedIp } = require('../middleware/ipBan')

const router = express.Router()

// Нормализаторы — login и email хранятся и сравниваются case-insensitive.
// Применяются ВЕЗДЕ перед SELECT/INSERT/UPDATE по login или email.
const normLogin = (s) => String(s || '').trim().toLowerCase()
const normEmail = (s) => String(s || '').trim().toLowerCase()

// Блокировка после неудачных попыток входа (in-memory)
const loginAttempts = new Map()
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 минут

function checkLoginLockout(login) {
  const attempts = loginAttempts.get(login)
  if (!attempts) return false
  if (Date.now() > attempts.lockedUntil) {
    loginAttempts.delete(login)
    return false
  }
  return attempts.count >= MAX_LOGIN_ATTEMPTS
}

function recordFailedLogin(login) {
  const attempts = loginAttempts.get(login) || { count: 0, lockedUntil: 0 }
  attempts.count++
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + LOCKOUT_DURATION
  }
  loginAttempts.set(login, attempts)
}

function clearLoginAttempts(login) {
  loginAttempts.delete(login)
}

// Вспомогательная функция: проверяем настройку require_email_confirmation
async function isEmailConfirmationRequired() {
  try {
    const r = await db.query('SELECT require_email_confirmation FROM site_config LIMIT 1')
    return r.rows.length > 0 && r.rows[0].require_email_confirmation === true
  } catch {
    return false
  }
}

// Отправка кода подтверждения на email
router.post('/send-code', async (req, res) => {
  const email = normEmail(req.body.email)
  if (!email) return res.status(400).json({ error: 'Email обязателен' })

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Некорректный формат email' })
  }

  try {
    // Проверяем, включено ли подтверждение email
    const required = await isEmailConfirmationRequired()
    if (!required) {
      return res.status(400).json({ error: 'Подтверждение email отключено' })
    }

    // Проверяем, не занят ли email
    const exists = await db.query('SELECT 1 FROM users WHERE email=$1', [email])
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован' })
    }

    const result = await emailService.sendVerificationCode(email)
    if (!result.ok) {
      return res.status(429).json({ error: result.error })
    }

    res.json({ ok: true, message: 'Код отправлен на email' })
  } catch (e) {
    console.error('Send code error:', e)
    res.status(500).json({ error: 'Не удалось отправить код' })
  }
})

// ─── Re-confirmation flow (для уже зарегистрированных юзеров) ───────────────
// POST /auth/send-confirmation-code — отправить код на email текущего юзера
router.post('/send-confirmation-code', require('../middleware').verifyToken, async (req, res) => {
  try {
    const r = await db.query('SELECT email, email_confirmed FROM users WHERE id=$1', [req.userId])
    const u = r.rows[0]
    if (!u) return res.status(404).json({ error: 'User not found' })
    if (u.email_confirmed) return res.status(400).json({ error: 'Email уже подтверждён' })

    const result = await emailService.sendVerificationCode(u.email)
    if (!result.ok) return res.status(429).json({ error: result.error })
    res.json({ ok: true, message: 'Код отправлен на email' })
  } catch (e) {
    console.error('send-confirmation-code error:', e)
    res.status(500).json({ error: 'Не удалось отправить код' })
  }
})

// POST /auth/confirm-email — подтвердить email кодом для уже зарегистрированного юзера
router.post('/confirm-email', require('../middleware').verifyToken, async (req, res) => {
  try {
    const { code } = req.body || {}
    if (!code || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({ error: 'Введите 6-значный код' })
    }

    const r = await db.query('SELECT email, email_confirmed FROM users WHERE id=$1', [req.userId])
    const u = r.rows[0]
    if (!u) return res.status(404).json({ error: 'User not found' })
    if (u.email_confirmed) return res.status(400).json({ error: 'Email уже подтверждён' })

    const check = await emailService.verifyCode(u.email, String(code))
    if (!check.ok) return res.status(400).json({ error: check.error })

    await db.query('UPDATE users SET email_confirmed=true, updated_at=NOW() WHERE id=$1', [req.userId])

    // Синхронизируем email во все активные подписки юзера в RemnaWave
    try {
      const subs = await db.query(
        `SELECT remnwave_user_uuid FROM subscriptions
         WHERE user_id = $1 AND is_active = true AND remnwave_user_uuid IS NOT NULL`,
        [req.userId]
      )
      if (subs.rows.length > 0) {
        const remnwave = require('../services/remnwave')
        for (const s of subs.rows) {
          remnwave.updateRemnwaveUser(s.remnwave_user_uuid, { email: u.email })
            .catch(err => console.error('[confirm-email] RW sync failed:', err.message))
        }
      }
    } catch {}

    res.json({ ok: true, message: 'Email подтверждён' })
  } catch (e) {
    console.error('confirm-email error:', e)
    res.status(500).json({ error: 'Не удалось подтвердить email' })
  }
})

// Регистрация пользователя
router.post('/register', checkBannedIp, async (req, res) => {
  const { password, emailCode, referralCode } = req.body
  // Логин и email нормализуем сразу — case-insensitive унификация.
  const login = normLogin(req.body.login)
  const email = normEmail(req.body.email)
  if (!login || !email || !password) return res.status(400).json({ error: 'Missing fields' })

  // Валидация логина
  if (login.length < 3 || login.length > 30) {
    return res.status(400).json({ error: 'Логин должен быть от 3 до 30 символов' })
  }
  if (!/^[a-z0-9_-]+$/.test(login)) {
    return res.status(400).json({ error: 'Логин может содержать только латиницу, цифры, _ и -' })
  }

  // Валидация пароля
  if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть минимум 8 символов' })
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: 'Пароль должен содержать буквы и цифры' })
  }

  // Валидация email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Некорректный формат email' })
  }
  
  try {
    // Проверяем, нужно ли подтверждение email
    const emailRequired = await isEmailConfirmationRequired()
    let emailConfirmed = false

    if (emailRequired) {
      if (!emailCode) {
        return res.status(400).json({ error: 'Требуется код подтверждения email' })
      }
      const codeCheck = await emailService.verifyCode(email, emailCode)
      if (!codeCheck.ok) {
        return res.status(400).json({ error: codeCheck.error })
      }
      emailConfirmed = true
    }

    const exists = await db.query('SELECT 1 FROM users WHERE login=$1 OR email=$2', [login, email])
    if (exists.rows.length > 0) return res.status(409).json({ error: 'User already exists' })
    
    const hash = await bcrypt.hash(password, 12)
    const result = await db.query(
      'INSERT INTO users (login, email, password_hash, email_confirmed, registration_ip) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [login, email, hash, emailConfirmed, req.ip || null]
    )
    
    const newUserId = result.rows[0].id
    
    // Обработка реферального кода
    let referralBonus = null
    if (referralCode) {
      try {
        const referrerId = await referralService.getUserByReferralCode(referralCode)
        if (!referrerId) {
          // Код невалиден — сообщаем пользователю, но не блокируем регистрацию
          console.warn(`[Auth] Invalid referral code: ${referralCode}`)
        } else {
          // Создаем связь реферала
          await referralService.createReferral(referrerId, newUserId, referralCode)
          // Начисляем бонус за регистрацию
          referralBonus = await referralService.processSignupBonus(referrerId, newUserId)
        }
      } catch (error) {
        console.error('Error processing referral code:', error)
        // Не прерываем регистрацию, если ошибка в обработке реферального кода
      }
    }
    
    // Создаем реферальную ссылку для нового пользователя
    try {
      await referralService.createReferralLink(newUserId)
    } catch (error) {
      console.error('Error creating referral link for new user:', error)
    }

    // Приветственное уведомление
    notifyWelcome(newUserId).catch(err => console.error('Welcome notification error:', err))
    
    res.json({ ok: true, referralBonus })
  } catch (e) {
    console.error('Registration error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Вход пользователя
router.post('/login', async (req, res) => {
  // login принимаем case-insensitive — нормализуем перед всем (lockout-cache, query, recordFailedLogin).
  // Юзер может ввести email вместо логина (кстати нормально что email тоже в нижнем регистре после норм).
  const login = normLogin(req.body.login)
  const { password } = req.body
  if (!login || !password) return res.status(400).json({ error: 'Missing fields' })
  try {
    // Проверяем блокировку аккаунта
    if (checkLoginLockout(login)) {
      return res.status(429).json({ error: 'Слишком много попыток входа. Попробуйте через 15 минут' })
    }

    const q = await db.query('SELECT * FROM users WHERE login=$1', [login])
    if (q.rows.length === 0) {
      recordFailedLogin(login)
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const user = q.rows[0]
    
    // Проверяем, активен ли пользователь
    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account is disabled' })
    }
    
    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) {
      recordFailedLogin(login)
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    clearLoginAttempts(login)
    const token = jwt.sign({ id: user.id, login: user.login, is_admin: user.is_admin }, process.env.JWT_SECRET, { expiresIn: '8h' })
    // Сохраняем сессию
    createSession(user.id, token, req).catch(err => console.error('Session create error:', err))
    res.json({ token })
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Верификация данных Telegram Login Widget.
//
// Алгоритм по docs (https://core.telegram.org/widgets/login):
//   data_check_string = sort(keys) → "key=value" → join("\n")
//   secret_key = SHA256(bot_token)
//   hash должен совпасть с hex(HMAC_SHA256(data_check_string, secret_key))
//
// Токен берём из telegram_settings (приоритет — настраивается через админку
// /admin/telegram), fallback на process.env.TELEGRAM_BOT_TOKEN (legacy).
//
// Возвращает { ok, reason } — reason полезен для диагностики "почему упало".
async function verifyTelegramData(data) {
  let botToken = process.env.TELEGRAM_BOT_TOKEN
  try {
    const tgSettings = require('../services/telegramBot/settings')
    const s = await tgSettings.getSettings()
    if (s.bot_token) botToken = s.bot_token
  } catch {}
  if (!botToken) return { ok: false, reason: 'no_bot_token' }

  const { hash, ...rest } = data
  if (!hash) return { ok: false, reason: 'no_hash' }

  // auth_date не старше 24 часов — защита от replay-атак.
  // Telegram в docs не указывает лимит, оставляет на наше усмотрение.
  const authDate = parseInt(rest.auth_date, 10)
  if (isNaN(authDate)) return { ok: false, reason: 'bad_auth_date' }
  const ageSec = Date.now() / 1000 - authDate
  if (ageSec > 86400) return { ok: false, reason: 'auth_date_expired', ageSec }
  if (ageSec < -300) return { ok: false, reason: 'auth_date_future' }  // часы сервера расходятся

  // data_check_string — отсортированные key=value через \n
  const checkString = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join('\n')

  const secretKey = crypto.createHash('sha256').update(botToken).digest()
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex')

  if (hmac.length !== hash.length) return { ok: false, reason: 'hash_length_mismatch' }
  const match = crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(hash))
  if (!match) return { ok: false, reason: 'hash_mismatch' }
  return { ok: true }
}

// Авторизация через Telegram
router.post('/telegram', async (req, res) => {
  const tgData = req.body
  if (!tgData || !tgData.id) {
    return res.status(400).json({ error: 'Некорректные данные Telegram' })
  }

  const verif = await verifyTelegramData(tgData)
  if (!verif.ok) {
    const hints = {
      no_bot_token:        'Bot token не настроен. Открой /admin/telegram → Подключение и сохрани токен от @BotFather.',
      hash_mismatch:       'HMAC не сошёлся. Скорее всего bot token в админке не совпадает с тем что у @BotFather, или /setdomain не сделан для этого домена.',
      auth_date_expired:   'Сессия аутентификации устарела (24+ часов). Перезагрузи страницу и попробуй снова.',
      auth_date_future:    'Расхождение часов между сервером и Telegram. Проверь NTP на сервере.',
      no_hash:             'В payload нет поля hash — возможно виджет загрузился неправильно.',
      bad_auth_date:       'В payload невалидный auth_date.',
      hash_length_mismatch:'Длина hash отличается от ожидаемой — payload повреждён.',
    }
    return res.status(401).json({
      error: 'Невалидная подпись Telegram',
      reason: verif.reason,
      hint: hints[verif.reason] || null,
    })
  }

  const telegramId = parseInt(tgData.id, 10)
  const tgUsername = tgData.username || null

  try {
    // Ищем пользователя с таким telegram_id
    const existing = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId])
    
    if (existing.rows.length > 0) {
      const user = existing.rows[0]
      if (!user.is_active) {
        return res.status(403).json({ error: 'Ваш аккаунт заблокирован' })
      }
      // Обновляем telegram_username если изменился
      if (tgUsername && tgUsername !== user.telegram_username) {
        await db.query('UPDATE users SET telegram_username = $1 WHERE id = $2', [tgUsername, user.id])
      }
      const token = jwt.sign(
        { id: user.id, login: user.login, is_admin: user.is_admin },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      )
      // Сохраняем сессию
      createSession(user.id, token, req).catch(err => console.error('Session create error:', err))
      return res.json({ token, isNew: false })
    }

    // Новый пользователь — регистрация через Telegram
    // tg_username может быть с заглавными — нормализуем для нашей системы
    const login = normLogin(tgUsername) || `tg_${telegramId}`
    // Проверяем, не занят ли логин
    const loginCheck = await db.query('SELECT 1 FROM users WHERE login = $1', [login])
    const finalLogin = loginCheck.rows.length > 0 ? `tg_${telegramId}` : login

    // Генерируем случайный пароль (пользователь входит через Telegram, пароль не используется)
    const randomPass = crypto.randomBytes(32).toString('hex')
    const hash = await bcrypt.hash(randomPass, 12)

    const result = await db.query(
      'INSERT INTO users (login, email, password_hash, telegram_id, telegram_username) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [finalLogin, `${telegramId}@telegram.user`, hash, telegramId, tgUsername]
    )
    const newUserId = result.rows[0].id

    // Создаем реферальную ссылку
    try {
      await referralService.createReferralLink(newUserId)
    } catch (err) {
      console.error('Error creating referral link for telegram user:', err)
    }

    // Обработка реферального кода
    const referralCode = tgData.referralCode || null
    if (referralCode) {
      try {
        const referrerId = await referralService.getUserByReferralCode(referralCode)
        if (referrerId) {
          await referralService.createReferral(referrerId, newUserId, referralCode)
          await referralService.processSignupBonus(referrerId, newUserId)
        }
      } catch (err) {
        console.error('Error processing referral for telegram user:', err)
      }
    }

    notifyWelcome(newUserId).catch(err => console.error('Welcome notification error:', err))

    const token = jwt.sign(
      { id: newUserId, login: finalLogin, is_admin: false },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )
    // Сохраняем сессию
    createSession(newUserId, token, req).catch(err => console.error('Session create error:', err))
    return res.json({ token, isNew: true })
  } catch (e) {
    console.error('Telegram auth error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Привязка Telegram к существующему аккаунту (требует авторизации)
router.post('/telegram/link', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Не авторизован' })

  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Невалидный токен' })
  }

  const tgData = req.body
  if (!tgData || !tgData.id) {
    return res.status(400).json({ error: 'Некорректные данные Telegram' })
  }

  const verif = await verifyTelegramData(tgData)
  if (!verif.ok) {
    const hints = {
      no_bot_token:        'Bot token не настроен. Открой /admin/telegram → Подключение и сохрани токен от @BotFather.',
      hash_mismatch:       'HMAC не сошёлся. Скорее всего bot token в админке не совпадает с тем что у @BotFather, или /setdomain не сделан для этого домена.',
      auth_date_expired:   'Сессия аутентификации устарела (24+ часов). Перезагрузи страницу и попробуй снова.',
      auth_date_future:    'Расхождение часов между сервером и Telegram. Проверь NTP на сервере.',
      no_hash:             'В payload нет поля hash — возможно виджет загрузился неправильно.',
      bad_auth_date:       'В payload невалидный auth_date.',
      hash_length_mismatch:'Длина hash отличается от ожидаемой — payload повреждён.',
    }
    return res.status(401).json({
      error: 'Невалидная подпись Telegram',
      reason: verif.reason,
      hint: hints[verif.reason] || null,
    })
  }

  const telegramId = parseInt(tgData.id, 10)
  const tgUsername = tgData.username || null

  try {
    // Проверяем, не привязан ли уже этот telegram_id к другому аккаунту
    const alreadyLinked = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId])
    if (alreadyLinked.rows.length > 0 && alreadyLinked.rows[0].id !== decoded.id) {
      return res.status(409).json({ error: 'Этот Telegram аккаунт уже привязан к другому пользователю' })
    }

    await db.query('UPDATE users SET telegram_id = $1, telegram_username = $2 WHERE id = $3', [telegramId, tgUsername, decoded.id])

    // Синхронизируем telegramId во все активные подписки юзера в RemnaWave
    try {
      const subs = await db.query(
        `SELECT remnwave_user_uuid FROM subscriptions
         WHERE user_id = $1 AND is_active = true AND remnwave_user_uuid IS NOT NULL`,
        [decoded.id]
      )
      if (subs.rows.length > 0) {
        const remnwave = require('../services/remnwave')
        for (const s of subs.rows) {
          remnwave.updateRemnwaveUser(s.remnwave_user_uuid, { telegramId })
            .catch(err => console.error('[telegram-link] RW sync failed:', err.message))
        }
      }
    } catch {}

    res.json({ ok: true })
  } catch (e) {
    console.error('Telegram link error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Сброс пароля ───────────────────────────────────────────

/**
 * POST /auth/forgot-password
 * Отправляет ссылку сброса на email
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const email = normEmail(req.body.email)
    if (!email) return res.status(400).json({ error: 'Email обязателен' })

    // Всегда отвечаем 200 — чтобы не палить наличие аккаунта
    const user = await db.query('SELECT id, email FROM users WHERE email = $1', [email])
    if (user.rows.length === 0) {
      return res.json({ ok: true, message: 'Если аккаунт с таким email существует, ссылка отправлена' })
    }

    const userId = user.rows[0].id

    // Rate-limit: 1 запрос на сброс / 60 сек
    const recent = await db.query(
      `SELECT id FROM password_reset_tokens WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'`,
      [userId]
    )
    if (recent.rows.length > 0) {
      return res.status(429).json({ error: 'Подождите 60 секунд перед повторной отправкой' })
    }

    // Удаляем старые токены
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId])

    // Генерируем токен
    const token = crypto.randomBytes(32).toString('hex')
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token) VALUES ($1, $2)',
      [userId, token]
    )

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    await emailService.sendPasswordResetEmail(user.rows[0].email, token, frontendUrl)

    res.json({ ok: true, message: 'Если аккаунт с таким email существует, ссылка отправлена' })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

/**
 * POST /auth/reset-password
 * Сброс пароля по токену
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ error: 'Токен и пароль обязательны' })
    if (password.length < 6) return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' })

    const result = await db.query(
      `SELECT id, user_id FROM password_reset_tokens 
       WHERE token = $1 AND expires_at > NOW() AND used = false`,
      [token]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ссылка недействительна или истекла' })
    }

    const { id: tokenId, user_id } = result.rows[0]

    const hash = await bcrypt.hash(password, 10)
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hash, user_id])

    // Помечаем токен использованным
    await db.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [tokenId])

    res.json({ ok: true, message: 'Пароль успешно изменён' })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ─── Telegram OAuth 2.0 / OpenID Connect ─────────────────────────────────
//
// В отличие от Login Widget (HMAC поверх данных от @<bot>), OIDC — это
// стандартный flow `authorization_code + PKCE`:
//
//   1. Юзер жмёт «Войти через Telegram (OIDC)»
//   2. GET /auth/telegram/oidc/start
//        — генерим state + PKCE verifier
//        — кладём { state, verifier } в подписанную httpOnly-cookie на 5 мин
//        — 302 → https://oauth.telegram.org/auth?response_type=code&…
//   3. Юзер логинится на стороне Telegram, оттуда 302 → наш redirect_uri
//        с ?code=…&state=…
//   4. GET /auth/telegram/callback
//        — сверяем state с cookie
//        — POST /token (code + code_verifier + client_id + client_secret)
//        — валидируем id_token через JWKS (RS256, iss, aud, exp)
//        — sub = telegram_id → ищем/создаём юзера
//        — выдаём одноразовый auto-login токен и редиректим на /tg-login?t=<token>
//          (TgLogin.jsx уже умеет конвертить такой токен в JWT в localStorage)
//
// Регистрация в @BotFather:  /newoauth + /setoauthredirects.
//
// Cookie tg_oidc_session — это подписанный JWT { state, verifier },
// мы парсим её руками, чтобы не тащить cookie-parser ради одной точки.

function parseCookies(s) {
  const out = {}
  if (!s) return out
  for (const part of s.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

// Публичный endpoint — чтобы фронт мог решить, показывать ли кнопку «Войти через Telegram (OIDC)».
// Не светим client_id/secret, только факт «доступно/нет».
router.get('/telegram/oidc/info', async (req, res) => {
  try {
    const tgSettings = require('../services/telegramBot/settings')
    const s = await tgSettings.getSettings()
    const ready = !!(s.oidc_enabled && s.oidc_client_id && s.oidc_client_secret && s.oidc_redirect_uri)
    res.json({ available: ready })
  } catch {
    res.json({ available: false })
  }
})

router.get('/telegram/oidc/start', async (req, res) => {
  try {
    const tgSettings = require('../services/telegramBot/settings')
    const oidcSvc    = require('../services/telegramBot/oidc')
    const s = await tgSettings.getSettings()
    if (!s.oidc_enabled) {
      return res.status(503).send('Telegram OIDC отключён в админке. Включи в /admin/telegram → Подключение.')
    }
    if (!s.oidc_client_id || !s.oidc_client_secret || !s.oidc_redirect_uri) {
      return res.status(503).send('Telegram OIDC: не заполнены client_id / client_secret / redirect_uri в админке.')
    }

    const state = oidcSvc.genState()
    const { verifier, challenge } = oidcSvc.genPkce()

    const sessionToken = jwt.sign({ s: state, v: verifier }, process.env.JWT_SECRET, { expiresIn: '5m' })
    const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'
    res.setHeader('Set-Cookie',
      `tg_oidc_session=${sessionToken}; Path=/; Max-Age=300; HttpOnly; SameSite=Lax${isHttps ? '; Secure' : ''}`
    )

    const url = oidcSvc.buildAuthUrl({
      clientId:      s.oidc_client_id,
      redirectUri:   s.oidc_redirect_uri,
      state,
      codeChallenge: challenge,
    })
    return res.redirect(302, url)
  } catch (err) {
    console.error('[oidc-start]', err.message)
    return res.status(500).send(`Ошибка OIDC: ${err.message}`)
  }
})

router.get('/telegram/callback', async (req, res) => {
  // Финальный URL для редиректа на фронт — оба ветка, success и error, ведут в одно место.
  const frontendUrl = process.env.FRONTEND_URL || ''

  try {
    const { code, state, error: oauthError, error_description } = req.query
    if (oauthError) {
      return res.status(400).send(`Telegram OIDC отказ: ${oauthError} ${error_description || ''}`)
    }
    if (!code || !state) {
      return res.status(400).send('Не передан code/state')
    }

    const cookie = parseCookies(req.headers.cookie || '')
    const sessionToken = cookie.tg_oidc_session
    if (!sessionToken) {
      return res.status(400).send('Сессия OIDC потеряна (cookie не пришла). Попробуй ещё раз.')
    }

    let session
    try {
      session = jwt.verify(sessionToken, process.env.JWT_SECRET)
    } catch {
      return res.status(400).send('Сессия OIDC просрочена. Попробуй ещё раз.')
    }
    if (session.s !== state) {
      return res.status(400).send('state не совпадает (возможна CSRF-атака).')
    }

    // Очищаем cookie сразу
    res.setHeader('Set-Cookie', 'tg_oidc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')

    const tgSettings = require('../services/telegramBot/settings')
    const oidcSvc    = require('../services/telegramBot/oidc')
    const s = await tgSettings.getSettings()
    if (!s.oidc_client_id || !s.oidc_client_secret || !s.oidc_redirect_uri) {
      return res.status(503).send('Telegram OIDC настроен неполно (нет client_id/secret/redirect_uri).')
    }

    const tokens = await oidcSvc.exchangeCode({
      clientId:     s.oidc_client_id,
      clientSecret: s.oidc_client_secret,
      redirectUri:  s.oidc_redirect_uri,
      code:         String(code),
      codeVerifier: session.v,
    })

    const claims = await oidcSvc.verifyIdToken(tokens.id_token, { clientId: s.oidc_client_id })

    const telegramId = parseInt(claims.sub, 10)
    if (!telegramId) {
      return res.status(400).send('OIDC: невалидный sub claim (не telegram_id).')
    }
    const tgUsername = claims.preferred_username || null

    // Найти или создать юзера — та же логика что в POST /telegram (Login Widget).
    let userId
    const existing = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId])
    if (existing.rows.length > 0) {
      const u = existing.rows[0]
      if (!u.is_active) return res.status(403).send('Аккаунт заблокирован.')
      if (tgUsername && tgUsername !== u.telegram_username) {
        await db.query('UPDATE users SET telegram_username = $1 WHERE id = $2', [tgUsername, u.id])
      }
      userId = u.id
    } else {
      const login = normLogin(tgUsername) || `tg_${telegramId}`
      const lc = await db.query('SELECT 1 FROM users WHERE login = $1', [login])
      const finalLogin = lc.rows.length > 0 ? `tg_${telegramId}` : login
      const randomPass = crypto.randomBytes(32).toString('hex')
      const hash = await bcrypt.hash(randomPass, 12)
      const r = await db.query(
        'INSERT INTO users (login, email, password_hash, telegram_id, telegram_username) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [finalLogin, `${telegramId}@telegram.user`, hash, telegramId, tgUsername]
      )
      userId = r.rows[0].id
      try { await referralService.createReferralLink(userId) } catch (err) {
        console.error('Error creating referral link for OIDC user:', err)
      }
      notifyWelcome(userId).catch(err => console.error('Welcome notification error:', err))
    }

    // Выдаём одноразовый auto-login токен и редиректим на фронт /tg-login?t=<token>.
    // TgLogin.jsx это уже умеет — обменяет на JWT и кладёт в localStorage.
    const { createAutoLoginToken } = require('../services/telegramBot/tokens')
    const { token: oneTime } = await createAutoLoginToken(userId)

    const redirectTo = `${frontendUrl}/tg-login?t=${encodeURIComponent(oneTime)}`
    return res.redirect(302, redirectTo)
  } catch (err) {
    console.error('[oidc-callback]', err.message)
    return res.status(500).send(`Ошибка OIDC callback: ${err.message}`)
  }
})

/**
 * GET /auth/tg-login?t=<token>
 * Авто-логин из Telegram-бота. Юзер тапает в боте «🌐 Веб-Панель»,
 * бот выдаёт ссылку с одноразовым токеном — фронт открывает её и шлёт сюда.
 *
 * Возвращает { token: <jwt> } если ОК, либо 400/410 если токен невалидный/протух.
 */
router.get('/tg-login', async (req, res) => {
  try {
    const t = String(req.query.t || '').trim()
    if (!t) return res.status(400).json({ error: 'Токен не передан' })

    const { consumeAutoLoginToken } = require('../services/telegramBot/tokens')
    const consumed = await consumeAutoLoginToken(t)
    if (!consumed) {
      return res.status(410).json({ error: 'Токен невалиден или истёк. Запроси новую ссылку в боте.' })
    }

    const userRes = await db.query('SELECT id, login, is_admin, is_active FROM users WHERE id = $1', [consumed.userId])
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Юзер не найден' })
    const user = userRes.rows[0]
    if (!user.is_active) return res.status(403).json({ error: 'Аккаунт заблокирован' })

    const token = jwt.sign(
      { id: user.id, login: user.login, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )
    createSession(user.id, token, req).catch(err => console.error('Session create error:', err))
    res.json({ token, login: user.login })
  } catch (err) {
    console.error('[tg-login]', err.message)
    res.status(500).json({ error: 'Ошибка авторизации' })
  }
})

module.exports = router
