import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useSiteConfig } from './contexts/SiteConfigContext'
import Home from './pages/Home'
import Pricing from './pages/Pricing'
import Dashboard from './pages/Dashboard'
import Servers from './pages/Servers'
import Login from './pages/Login'
import Register from './pages/Register'
import PaymentSuccess from './pages/PaymentSuccess'
import PaymentFailed from './pages/PaymentFailed'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Connect from './pages/Connect'
import ProtectedRoute from './components/ProtectedRoute'
import ProtectedAdminRoute from './components/ProtectedAdminRoute'
import AdminLayout from './components/AdminLayout'
import AdminOverview from './pages/AdminOverview'
import AdminStats from './pages/AdminStats'
import AdminUsers from './pages/AdminUsers'
import AdminUserCard from './pages/AdminUserCard'
import AdminPlans from './pages/AdminPlans'
import AdminReferrals from './pages/AdminReferrals'
import AdminServers from './pages/AdminServers'
import AdminVPS from './pages/AdminVPS'
import AdminHostingOrder from './pages/AdminHostingOrder'
import AdminLandings from './pages/AdminLandings'
import AdminLandingEdit from './pages/AdminLandingEdit'
import AdminAudit from './pages/AdminAudit'
import AdminSystem from './pages/AdminSystem'
import AdminInstructions from './pages/AdminInstructions'
import AdminTrafficTracking from './pages/AdminTrafficTracking'
import AdminTrafficGuard from './pages/AdminTrafficGuard'
import AdminYandexCloud from './pages/AdminYandexCloud'
import LandingPage from './pages/LandingPage'
import PaymentHistory from './pages/PaymentHistory'
import AdminNotifications from './components/AdminNotifications'
import TemplateBuilder from './components/TemplateBuilder'
import NotificationBell from './components/NotificationBell'
import MaintenanceGate from './components/MaintenanceGate'
import ThemeToggle from './components/ThemeToggle'

function Navigation(){
  const [isAuth, setIsAuth] = useState(!!localStorage.getItem('token'))
  const [isAdmin, setIsAdmin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [landingMenu, setLandingMenu] = useState([])
  const navigate = useNavigate()
  const location = useLocation()

  // Грузим лендинги для меню один раз при монтировании
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/landings/menu`)
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setLandingMenu(d.items || []))
      .catch(() => setLandingMenu([]))
  }, [])

  useEffect(() => {
    const checkStatus = async () => {
      const token = localStorage.getItem('token')
      if (!token) {
        setIsAuth(false)
        setIsAdmin(false)
        return
      }

      setIsAuth(true)

      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.status === 401) {
          localStorage.removeItem('token')
          setIsAuth(false)
          setIsAdmin(false)
          return
        }
        if (res.ok) {
          const data = await res.json()
          setIsAdmin(data.user?.is_admin || false)
        }
      } catch (err) {
        setIsAdmin(false)
      }
    }

    checkStatus()
  }, [location])

  function handleLogout(){
    localStorage.removeItem('token')
    setIsAuth(false)
    setIsAdmin(false)
    navigate('/')
  }

  const navLinkClass = ({isActive}) => `transition-colors ${
    isActive
      ? 'text-blue-600 dark:text-blue-400 font-semibold'
      : 'text-sky-700 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
  }`

  const navLinks = (
    <>
      <NavLink to="/" className={navLinkClass} onClick={() => setMenuOpen(false)}>Главная</NavLink>
      <NavLink to="/pricing" className={navLinkClass} onClick={() => setMenuOpen(false)}>Тарифы</NavLink>
      <NavLink to="/servers" className={navLinkClass} onClick={() => setMenuOpen(false)}>Серверы</NavLink>
      {landingMenu.map(l => (
        <NavLink key={l.slug} to={`/p/${l.slug}`} className={navLinkClass} onClick={() => setMenuOpen(false)}>
          {l.title}
        </NavLink>
      ))}
      {isAuth && (
        <>
          <NavLink to="/dashboard" className={navLinkClass} onClick={() => setMenuOpen(false)}>Личный кабинет</NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={({isActive}) => `transition-colors font-bold ${isActive ? 'text-amber-600 dark:text-amber-400' : 'text-amber-700 dark:text-amber-300 hover:text-amber-200'}`} onClick={() => setMenuOpen(false)}>Админ</NavLink>
          )}
        </>
      )}
    </>
  )

  return (
    <div className="flex items-center gap-4">
      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-6">
        {navLinks}
      </nav>

      {/* Auth buttons */}
      <div className="hidden md:flex items-center gap-2">
        <ThemeToggle />
        {isAuth && <NotificationBell />}
        {isAuth ? (
          <button onClick={handleLogout} className="px-4 py-2 rounded-lg text-sky-700 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50 transition-all">Выйти</button>
        ) : (
          <>
            <NavLink to="/login" className={({isActive}) => `px-4 py-2 transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-sky-700 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}>Войти</NavLink>
            <NavLink to="/register" className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all">Регистрация</NavLink>
          </>
        )}
      </div>

      {/* Mobile: theme + bell + hamburger */}
      <div className="md:hidden flex items-center gap-1">
        <ThemeToggle />
        {isAuth && <NotificationBell />}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="relative w-10 h-10 flex flex-col items-center justify-center gap-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800/50 transition-colors"
          aria-label="Меню"
        >
        <span className={`block w-5 h-0.5 bg-slate-700 dark:bg-slate-300 transition-all duration-300 ${menuOpen ? 'rotate-45 translate-y-1' : ''}`} />
        <span className={`block w-5 h-0.5 bg-slate-700 dark:bg-slate-300 transition-all duration-300 ${menuOpen ? 'opacity-0' : ''}`} />
        <span className={`block w-5 h-0.5 bg-slate-700 dark:bg-slate-300 transition-all duration-300 ${menuOpen ? '-rotate-45 -translate-y-1' : ''}`} />
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 top-[65px] z-50">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          {/* Menu */}
          <nav className="relative bg-sky-50/95 dark:bg-slate-900/95 border-b border-sky-200 dark:border-slate-800/50 backdrop-blur-xl p-6 flex flex-col gap-4 text-lg animate-in slide-in-from-top">
            {navLinks}
            <div className="border-t border-sky-200 dark:border-slate-800/50 pt-4 mt-2 flex flex-col gap-3">
              {isAuth ? (
                <button onClick={() => { handleLogout(); setMenuOpen(false) }} className="w-full py-3 rounded-lg text-sky-700 hover:text-slate-900 bg-sky-100 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:bg-slate-800/50 transition-all">Выйти</button>
              ) : (
                <>
                  <NavLink to="/login" onClick={() => setMenuOpen(false)} className="w-full py-3 text-center rounded-lg text-sky-700 bg-sky-100 hover:bg-slate-200 dark:text-slate-300 dark:bg-slate-800/50 dark:hover:bg-slate-700/50 transition-all">Войти</NavLink>
                  <NavLink to="/register" onClick={() => setMenuOpen(false)} className="w-full py-3 text-center rounded-lg text-white bg-gradient-to-r from-blue-500 to-cyan-500 hover:shadow-lg hover:shadow-blue-500/50 transition-all">Регистрация</NavLink>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}

export default function App(){
  const { config } = useSiteConfig()

  // Динамические значения из конфигурации
  const siteTitle = config?.site_title || 'VPN Webhome'
  const siteDesc = config?.site_description || 'Ваш личный VPN для полной свободы интернета'
  const socialTelegram = config?.social_telegram || ''
  const supportEmail = config?.support_email || ''
  const supportTelegram = config?.support_telegram || ''
  const logoUrl = config?.site_logo_url || '/logo.svg'

  return (
    <BrowserRouter>
      <MaintenanceGate>
      <div className="relative min-h-screen overflow-x-hidden bg-sky-100 text-sky-900 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-200 font-sans">
        {/* Декоративные blur-пятна — только в светлой теме для "живого" эффекта */}
        <div aria-hidden className="dark:hidden pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-20 -left-32 w-[40rem] h-[40rem] bg-sky-300/30 rounded-full blur-3xl" />
          <div className="absolute top-[20%] -right-32 w-[36rem] h-[36rem] bg-cyan-300/25 rounded-full blur-3xl" />
          <div className="absolute top-[60%] left-[10%] w-[32rem] h-[32rem] bg-blue-300/25 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-sky-200 bg-sky-50/80 dark:border-slate-800/50 dark:bg-slate-950/80 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div
              onClick={() => window.location.href = '/'}
              className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent cursor-pointer hover:scale-105 transition-transform flex items-center gap-2 truncate max-w-[180px] sm:max-w-none"
            >
              {logoUrl && <img src={logoUrl} alt="" className="w-6 h-6 sm:w-8 sm:h-8 rounded flex-shrink-0" />}
              <span className="truncate">{siteTitle}</span>
            </div>
            <Navigation />
          </div>
        </header>

        {/* Main Content */}
        <main className="w-full">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/servers" element={<Servers />} />
            <Route path="/auth" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/connect" element={<ProtectedRoute><Connect /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedAdminRoute><AdminLayout /></ProtectedAdminRoute>}>
              <Route index element={<AdminOverview />} />
              <Route path="stats" element={<AdminStats />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:id" element={<AdminUserCard />} />
              <Route path="payments" element={<PaymentHistory />} />
              <Route path="plans" element={<AdminPlans />} />
              <Route path="referrals" element={<AdminReferrals />} />
              <Route path="servers" element={<AdminServers />} />
              <Route path="vps" element={<AdminVPS />} />
              <Route path="yandex-cloud" element={<AdminYandexCloud />} />
              <Route path="hosting-order" element={<AdminHostingOrder />} />
              <Route path="landings" element={<AdminLandings />} />
              <Route path="landings/:id" element={<AdminLandingEdit />} />
              <Route path="notifications" element={<AdminNotifications />} />
              <Route path="audit" element={<AdminAudit />} />
              <Route path="system" element={<AdminSystem />} />
              <Route path="instructions" element={<AdminInstructions />} />
              <Route path="traffic" element={<AdminTrafficTracking />} />
              <Route path="traffic-guard" element={<AdminTrafficGuard />} />
              <Route path="settings" element={<TemplateBuilder />} />
              <Route path="templates" element={<Navigate to="/admin/settings" replace />} />
            </Route>
            <Route path="/payment/success" element={<PaymentSuccess />} />
            <Route path="/payment/failed" element={<PaymentFailed />} />
            <Route path="/p/:slug" element={<LandingPage />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="border-t border-sky-200 bg-sky-50 dark:border-slate-800/50 dark:bg-slate-950/50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 mt-12 sm:mt-24">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 mb-8">
              <div className="col-span-2 md:col-span-1">
                <h3 className="text-lg font-bold mb-4">{siteTitle}</h3>
                <p className="text-sky-700 dark:text-slate-400 text-sm">{siteDesc}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Продукт</h4>
                <ul className="space-y-2 text-sm text-sky-700 dark:text-slate-400">
                  <li><a href="/pricing" className="hover:text-slate-900 dark:hover:text-slate-200">Тарифы</a></li>
                  <li><a href="/servers" className="hover:text-slate-900 dark:hover:text-slate-200">Серверы</a></li>
                  <li><a href="#" className="hover:text-slate-900 dark:hover:text-slate-200">Приложения</a></li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Информация</h4>
                <ul className="space-y-2 text-sm text-sky-700 dark:text-slate-400">
                  <li><a href="#" className="hover:text-slate-900 dark:hover:text-slate-200">О нас</a></li>
                  <li><a href="#" className="hover:text-slate-900 dark:hover:text-slate-200">Политика</a></li>
                  <li><a href="#" className="hover:text-slate-900 dark:hover:text-slate-200">Условия</a></li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Контакты</h4>
                <ul className="space-y-2 text-sm text-sky-700 dark:text-slate-400">
                  {supportEmail && (
                    <li>
                      <a href={`mailto:${supportEmail}`} className="hover:text-slate-900 dark:hover:text-slate-200 break-all">
                        {supportEmail}
                      </a>
                    </li>
                  )}
                  {supportTelegram && (
                    <li>
                      <a href={supportTelegram} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-slate-200">
                        Поддержка в Telegram
                      </a>
                    </li>
                  )}
                  {socialTelegram && socialTelegram !== supportTelegram && (
                    <li><a href={socialTelegram} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-slate-200">Telegram-канал</a></li>
                  )}
                  {config?.social_discord && <li><a href={config.social_discord} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-slate-200">Discord</a></li>}
                  {config?.social_twitter && <li><a href={config.social_twitter} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-slate-200">Twitter</a></li>}
                  {config?.social_github && <li><a href={config.social_github} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-slate-200">GitHub</a></li>}
                </ul>
              </div>
            </div>
            <div className="border-t border-sky-200 dark:border-slate-800/50 pt-8 flex flex-col sm:flex-row justify-between items-center gap-2">
              <p className="text-sm text-sky-700 dark:text-slate-400">© {new Date().getFullYear()} {siteTitle}. Все права защищены.</p>
              <p className="text-sm text-sky-700 dark:text-slate-400">Made with ❤ for privacy</p>
            </div>
          </div>
        </footer>
        </div>
      </div>
      </MaintenanceGate>
    </BrowserRouter>
  )
}
