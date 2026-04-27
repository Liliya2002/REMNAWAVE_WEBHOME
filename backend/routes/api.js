const express = require('express')
const bcrypt = require('bcryptjs')
const db = require('../db')
const { verifyToken, verifyActive } = require('../middleware')

const router = express.Router()

router.get('/status', (req,res)=>{
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.get('/me', verifyToken, verifyActive, async (req,res)=>{
  try {
    const userResult = await db.query('SELECT id, login, email, is_admin, telegram_id, telegram_username, created_at FROM users WHERE id=$1', [req.userId])
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    
    const user = userResult.rows[0]
    
    // Получаем статус активной подписки
    const subResult = await db.query(
      `SELECT id, plan_name, expires_at, is_active FROM subscriptions 
       WHERE user_id = $1 AND is_active = true
       ORDER BY expires_at DESC
       LIMIT 1`,
      [req.userId]
    )
    
    const subscription = subResult.rows[0] || null
    
    res.json({ 
      user: {
        ...user,
        hasActiveSubscription: !!subscription,
        subscriptionExpiresAt: subscription?.expires_at || null,
        subscriptionPlan: subscription?.plan_name || null
      }
    })
  } catch (e) {
    console.error('Error fetching user:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Обновление email
router.put('/profile/email', verifyToken, verifyActive, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email required' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Некорректный формат email' })
  }
  if (email.length > 255) {
    return res.status(400).json({ error: 'Email слишком длинный' })
  }
  
  try {
    // Проверить что email не занят
    const exists = await db.query('SELECT 1 FROM users WHERE email=$1 AND id!=$2', [email, req.userId])
    if (exists.rows.length > 0) return res.status(409).json({ error: 'Email already in use' })
    
    await db.query('UPDATE users SET email=$1, updated_at=NOW() WHERE id=$2', [email, req.userId])
    res.json({ ok: true, message: 'Email updated' })
  } catch (e) {
    console.error('Error updating email:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Смена пароля
router.put('/profile/password', verifyToken, verifyActive, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' })
  
  try {
    const result = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    
    const user = result.rows[0]
    const match = await bcrypt.compare(currentPassword, user.password_hash)
    if (!match) return res.status(401).json({ error: 'Current password incorrect' })
    
    if (newPassword.length < 8) return res.status(400).json({ error: 'Пароль должен быть минимум 8 символов' })
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Пароль должен содержать буквы и цифры' })
    }
    
    const newHash = await bcrypt.hash(newPassword, 12)
    await db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [newHash, req.userId])
    res.json({ ok: true, message: 'Password updated' })
  } catch (e) {
    console.error('Error changing password:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
