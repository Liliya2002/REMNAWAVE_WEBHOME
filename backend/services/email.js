const nodemailer = require('nodemailer')
const crypto = require('crypto')
const db = require('../db')

// SMTP-транспорт из переменных окружения
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

const FROM_EMAIL = process.env.SMTP_FROM || process.env.SMTP_USER

/**
 * Генерация 6-значного кода
 */
function generateCode() {
  return crypto.randomInt(100000, 999999).toString()
}

/**
 * Отправка кода подтверждения на email
 * Rate-limit: 1 код / 60 сек на один email
 */
async function sendVerificationCode(email) {
  // Проверяем rate-limit: не отправлять чаще раза в минуту
  const recent = await db.query(
    `SELECT id FROM email_verifications 
     WHERE email = $1 AND created_at > NOW() - INTERVAL '60 seconds'`,
    [email]
  )
  if (recent.rows.length > 0) {
    return { ok: false, error: 'Подождите 60 секунд перед повторной отправкой' }
  }

  // Удаляем старые коды для этого email
  await db.query('DELETE FROM email_verifications WHERE email = $1', [email])

  const code = generateCode()

  // Сохраняем в БД
  await db.query(
    `INSERT INTO email_verifications (email, code) VALUES ($1, $2)`,
    [email, code]
  )

  // Отправляем письмо
  await transporter.sendMail({
    from: `"Guard VPN" <${FROM_EMAIL}>`,
    to: email,
    subject: 'Код подтверждения — Guard VPN',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0f172a; color: #e2e8f0; border-radius: 16px;">
        <h2 style="color: #60a5fa; margin-bottom: 8px;">Guard VPN</h2>
        <p style="margin-bottom: 24px;">Ваш код подтверждения:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #1e293b; border-radius: 12px; color: #38bdf8;">
          ${code}
        </div>
        <p style="margin-top: 24px; font-size: 14px; color: #94a3b8;">
          Код действителен 10 минут. Если вы не запрашивали регистрацию — проигнорируйте это письмо.
        </p>
      </div>
    `
  })

  return { ok: true }
}

/**
 * Проверка кода
 * Макс. 5 попыток, после — код аннулируется
 */
async function verifyCode(email, code) {
  const result = await db.query(
    `SELECT id, code, attempts FROM email_verifications 
     WHERE email = $1 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  )

  if (result.rows.length === 0) {
    return { ok: false, error: 'Код не найден или истёк. Запросите новый' }
  }

  const record = result.rows[0]

  if (record.attempts >= 5) {
    await db.query('DELETE FROM email_verifications WHERE id = $1', [record.id])
    return { ok: false, error: 'Превышено количество попыток. Запросите новый код' }
  }

  if (record.code !== code) {
    await db.query(
      'UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1',
      [record.id]
    )
    return { ok: false, error: 'Неверный код' }
  }

  // Код верный — удаляем
  await db.query('DELETE FROM email_verifications WHERE id = $1', [record.id])
  return { ok: true }
}

/**
 * Отправка ссылки сброса пароля
 */
async function sendPasswordResetEmail(email, token, frontendUrl) {
  const resetLink = `${frontendUrl}/reset-password?token=${token}`

  await transporter.sendMail({
    from: `"Guard VPN" <${FROM_EMAIL}>`,
    to: email,
    subject: 'Сброс пароля — Guard VPN',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0f172a; color: #e2e8f0; border-radius: 16px;">
        <h2 style="color: #60a5fa; margin-bottom: 8px;">Guard VPN</h2>
        <p style="margin-bottom: 24px;">Вы запросили сброс пароля. Нажмите кнопку ниже:</p>
        <div style="text-align: center; padding: 20px;">
          <a href="${resetLink}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(90deg, #3b82f6, #06b6d4); color: #fff; font-weight: bold; font-size: 16px; border-radius: 12px; text-decoration: none;">
            Сбросить пароль
          </a>
        </div>
        <p style="margin-top: 24px; font-size: 14px; color: #94a3b8;">
          Ссылка действительна 30 минут. Если вы не запрашивали сброс — проигнорируйте это письмо.
        </p>
      </div>
    `
  })

  return { ok: true }
}

/**
 * Универсальная отправка письма с заголовком + сообщением.
 * Используется системой Traffic Guard и т.п. для системных уведомлений.
 */
async function sendNotificationEmail(toEmail, { subject, heading, body, ctaText, ctaUrl, accent = '#38bdf8' }) {
  if (!toEmail) return { ok: false, error: 'No recipient' }
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px; background: #0f172a; color: #e2e8f0; border-radius: 16px;">
      <h2 style="color: #60a5fa; margin: 0 0 8px 0;">Guard VPN</h2>
      <h3 style="color: ${accent}; margin: 16px 0;">${heading}</h3>
      <div style="margin: 16px 0; line-height: 1.6; color: #cbd5e1;">${body}</div>
      ${ctaUrl && ctaText ? `
        <div style="text-align: center; padding: 20px;">
          <a href="${ctaUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(90deg, #3b82f6, #06b6d4); color: #fff; font-weight: bold; font-size: 15px; border-radius: 12px; text-decoration: none;">
            ${ctaText}
          </a>
        </div>` : ''}
      <p style="margin-top: 24px; font-size: 13px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 16px;">
        Это автоматическое уведомление. Если у вас вопросы — свяжитесь с поддержкой.
      </p>
    </div>
  `
  try {
    await transporter.sendMail({
      from: `"Guard VPN" <${FROM_EMAIL}>`,
      to: toEmail,
      subject,
      html,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { sendVerificationCode, verifyCode, sendPasswordResetEmail, sendNotificationEmail }
