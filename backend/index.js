const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const dotenv = require('dotenv')

dotenv.config()

// Проверка критичных переменных окружения
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'devsecret') {
  console.error('\x1b[31m[SECURITY] JWT_SECRET не задан или используется значение по умолчанию! Задайте надёжный JWT_SECRET в .env\x1b[0m')
  if (process.env.NODE_ENV === 'production') process.exit(1)
}

const app = express()

// Доверяем X-Forwarded-* заголовкам от nginx/reverse-proxy.
// 1 = один прокси перед нами. Нужно для корректной работы rate-limit и логирования IP.
app.set('trust proxy', 1)

// Security headers + CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", ...(process.env.REMNWAVE_API_URL ? [process.env.REMNWAVE_API_URL] : [])],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))

// Permissions-Policy — запретить ненужные API браузера
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
  next()
})

// CORS — ограничить origin
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim())
app.use(cors({
  origin: (origin, callback) => {
    // Разрешить запросы без origin (curl, серверные вызовы)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(null, false)
    }
  },
  credentials: true
}))

// Лимит размера тела запроса
app.use(express.json({ limit: '100kb' }))

// Rate limiting — общий
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
})
app.use(globalLimiter)

// Rate limiting — auth (строгий)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' }
})

// Rate limiting — платежи
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again later' }
})

const authRoutes = require('./routes/auth')
const apiRoutes = require('./routes/api')
const serversRoutes = require('./routes/servers')
const subsRoutes = require('./routes/subscriptions')
const webhooksRoutes = require('./routes/webhooks')
const plansRoutes = require('./routes/plans')
const paymentsRoutes = require('./routes/payments')
const referralsRoutes = require('./routes/referrals')
const adminUsersRoutes = require('./routes/admin-users')
const adminStatsRoutes = require('./routes/admin-stats')
const adminServersRoutes = require('./routes/admin-servers')
const adminVpsRoutes = require('./routes/admin-vps')
const adminHostingRoutes = require('./routes/admin-hosting')
const adminSquadsRoutes = require('./routes/admin-squads')
const adminTemplatesRoutes = require('./routes/admin-templates')
const adminLandingsRoutes = require('./routes/admin-landings')
const adminRwUsersRoutes = require('./routes/admin-rwusers')
const adminUploadsRoutes = require('./routes/admin-uploads')
const adminAuditRoutes = require('./routes/admin-audit')
const adminSystemRoutes = require('./routes/admin-system')
const adminDocsRoutes = require('./routes/admin-docs')
const adminTrafficRoutes = require('./routes/admin-traffic')
const adminTrafficGuardRoutes = require('./routes/admin-traffic-guard')
const healthRoutes = require('./routes/health')
const maintenanceRoutes = require('./routes/maintenance')
const maintenanceGuard = require('./middleware/maintenance')
const landingsRoutes = require('./routes/landings')
const seoRoutes = require('./routes/seo')
const { landingSsrMiddleware } = require('./middleware/landingSsr')
const path = require('path')
const notificationsRoutes = require('./routes/notifications')
const sessionsRoutes = require('./routes/sessions')

// Maintenance status — публичный, БЕЗ guard (фронт его пингует чтобы понять что делать)
app.use('/api/maintenance', maintenanceRoutes)

// Guard срабатывает на всех остальных роутах: блокирует не-админов когда maintenance ON
app.use(maintenanceGuard)

app.use('/auth', authLimiter, authRoutes)
app.use('/api', apiRoutes)
app.use('/servers', serversRoutes)
app.use('/api/subscriptions', subsRoutes)
app.use('/api/sessions', sessionsRoutes)
app.use('/api/webhooks', webhooksRoutes)
app.use('/api/plans', plansRoutes)
app.use('/api/payments', paymentLimiter, paymentsRoutes)
app.use('/api/referrals', referralsRoutes)
// Rate limiting — админ-эндпоинты
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please try again later' }
})

app.use('/api/admin/users', adminLimiter, adminUsersRoutes)
app.use('/api/admin/stats', adminLimiter, adminStatsRoutes)
app.use('/api/admin/servers', adminLimiter, adminServersRoutes)
app.use('/api/admin/vps', adminLimiter, adminVpsRoutes)
app.use('/api/admin/hosting', adminLimiter, adminHostingRoutes)
app.use('/api/admin/squads', adminLimiter, adminSquadsRoutes)
app.use('/api/admin/landings', adminLimiter, adminLandingsRoutes)
app.use('/api/admin/rwusers', adminLimiter, adminRwUsersRoutes)
app.use('/api/admin/uploads', adminLimiter, adminUploadsRoutes)
app.use('/api/admin/audit', adminLimiter, adminAuditRoutes)
app.use('/api/admin/system', adminLimiter, adminSystemRoutes)
app.use('/api/admin/docs', adminLimiter, adminDocsRoutes)
app.use('/api/admin/traffic', adminLimiter, adminTrafficRoutes)
app.use('/api/admin/traffic-guard', adminLimiter, adminTrafficGuardRoutes)
// /api/health — публичный, без auth/limiter (для health-check'ов)
app.use('/api/health', healthRoutes)
app.use('/api/landings', landingsRoutes)
app.use('/api/admin', adminLimiter, adminTemplatesRoutes)
app.use('/api/notifications', notificationsRoutes)

// Статика для загруженных файлов (картинки лендингов)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}))

// SEO: sitemap.xml и robots.txt — на корне
app.use('/', seoRoutes)

// SSR-lite для /p/:slug — подмена meta-тегов в production-сборке + CSP для лендингов
app.get('/p/:slug', landingSsrMiddleware)

// Cron: деактивация истёкших подписок и уведомления "скоро истечёт"
require('./cron/expireSubscriptions').start()

// Cron: ежедневные снимки потребления трафика подписок (для графиков)
require('./cron/trafficSnapshots').start()

// Cron: Traffic Guard — проверка превышений per-node лимитов и автоблокировка
require('./cron/trafficGuard').start()

const PORT = process.env.PORT || 4000
app.listen(PORT, ()=> console.log(`Backend running on port ${PORT}`))
