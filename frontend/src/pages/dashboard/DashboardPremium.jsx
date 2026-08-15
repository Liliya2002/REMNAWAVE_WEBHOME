import React, { useState } from 'react'
import { User, Mail, Calendar, Wallet, Ticket, Check, X, Pencil, Star } from 'lucide-react'
import { authFetch } from '../../services/api'

/* Дорожки «печатной платы» по верхним углам. Держим их только у краёв:
   в центре они спорят с текстом карточек. */
function Traces() {
  return (
    <svg className="dp-traces" viewBox="0 0 1200 320" preserveAspectRatio="xMidYMin meet" aria-hidden>
      <g fill="none" stroke="rgba(0,240,255,.16)" strokeWidth="1.2">
        <path d="M0 40 H120 L150 70 H250" /><path d="M0 90 H90 L130 130 H210" />
        <path d="M60 0 V60 L90 90 V160" /><path d="M170 0 V40 L200 70 V120" />
        <path d="M1200 40 H1080 L1050 70 H950" /><path d="M1200 100 H1110 L1070 140 H990" />
        <path d="M1140 0 V60 L1110 90 V170" /><path d="M1030 0 V40 L1000 70 V130" />
      </g>
      <g fill="rgba(0,240,255,.35)">
        {[[150,70],[130,130],[90,90],[1050,70],[1070,140],[1110,90]]
          .map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="2.5" />)}
      </g>
    </svg>
  )
}

/**
 * Тема кабинета «Digital Premium» — плоский тёмный дизайн с высоким
 * контрастом, без стекла и преломлений (в отличие от страниц входа).
 *
 * Оболочка: узкий сайдбар только с навигацией + контент справа. Секции
 * (профиль, подписка, баланс и т.д.) переиспользуются как есть — тема
 * меняет обрамление, а не логику.
 */

const fmtDate = v => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
const fmtShort = v => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU')
}
// Валюту берём из проекта (рубли), а не из макета — иначе разойдётся с платежами
const fmtMoney = v => (Number(v) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'

export default function DashboardPremium({
  user, subscriptions = [], menuItems, activeSection, setActiveSection,
  onUpdate, children, banner,
}) {
  const active = subscriptions.find(s => s.is_active)
  const isProfile = activeSection === 'profile'

  // Баланс приходит отдельным эндпоинтом — в объекте user его нет
  const [balance, setBalance] = useState(0)
  React.useEffect(() => {
    authFetch('/api/payments/balance')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setBalance(Number(d.balance || 0)))
      .catch(() => {})
  }, [])

  // Редактирование email прямо в виджете — раньше жило в ProfileSection,
  // которая на этой вкладке больше не рендерится (иначе данные дублируются)
  const [editEmail, setEditEmail] = useState(false)
  const [newEmail, setNewEmail] = useState(user?.email || '')
  const [emailMsg, setEmailMsg] = useState(null)
  const [emailErr, setEmailErr] = useState(null)

  async function saveEmail() {
    setEmailMsg(null); setEmailErr(null)
    try {
      const res = await authFetch('/api/profile/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      })
      const data = await res.json()
      if (res.ok) { setEmailMsg('Email успешно обновлен'); setEditEmail(false); onUpdate && onUpdate() }
      else setEmailErr(data.error || 'Ошибка обновления email')
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') setEmailErr('Ошибка сети')
    }
  }

  return (
    <div className="dp">
      <Traces />
      <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {banner}

        <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] gap-5">
          {/* ── Сайдбар: отдельная панель, только навигация ── */}
          <aside className="hidden lg:block">
            <nav className="dp-sidebar space-y-0.5 sticky top-20">
              {menuItems.map(item => (
                <button key={item.id} onClick={() => setActiveSection(item.id)}
                  className={`dp-nav-item ${activeSection === item.id ? 'is-active' : ''}`}>
                  <item.Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge > 0 && <span className="dp-count">{item.badge > 99 ? '99+' : item.badge}</span>}
                </button>
              ))}

            </nav>
          </aside>

          {/* ── Контент ── */}
          <main className="min-w-0">
            <header className="mb-6">
              <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight">
                Добро пожаловать, {user?.login || '—'}!
              </h1>
              <p className="dp-muted text-sm mt-1">
                Управляйте своим аккаунтом, подписками и заработками
              </p>
            </header>

            {/* Виджеты показываем только на «Профиле»: на других вкладках
                они дублировали бы содержимое секции. */}
            {isProfile && user && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* 1. Пользователь */}
                <div className="dp-card p-5">
                  <div className="flex items-center gap-3.5">
                    <div className="dp-avatar">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold truncate">{user.login}</div>
                      <div className="dp-muted text-[13px] truncate">{user.email}</div>
                      <div className="mt-2">
                        <span className={`dp-badge ${user.is_admin ? '' : 'dp-badge--muted'}`}>
                          <Star className="w-2.5 h-2.5" />
                          {user.is_admin ? 'АДМИНИСТРАТОР' : 'ПОЛЬЗОВАТЕЛЬ'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Подписка */}
                <div className="dp-card dp-card--action p-5" onClick={() => setActiveSection('subscriptions')}>
                  <div className="flex items-center gap-2 mb-3">
                    <Ticket className="w-4 h-4 dp-muted" />
                    <span className="dp-label">Статус подписки</span>
                  </div>
                  {active ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="dp-check"><Check className="w-3 h-3" strokeWidth={3.5} /></span>
                        <span className="text-[15px] font-semibold text-emerald-400">Активна</span>
                      </div>
                      <div className="dp-muted text-[13px] mt-2">Истекает: {fmtShort(active.expires_at)}</div>
                      <div className="dp-muted text-[13px]">Тариф: {active.plan_name || '—'}</div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="dp-dot dp-dot--off" />
                        <span className="text-[15px] font-semibold dp-muted">Нет подписки</span>
                      </div>
                      <a href="/pricing" className="dp-accent text-[13px] font-semibold inline-block mt-2 hover:underline">
                        Выбрать тариф →
                      </a>
                    </>
                  )}
                </div>

                {/* 3. Баланс */}
                <div className="dp-card dp-card--action p-5" onClick={() => setActiveSection('balance')}>
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="w-4 h-4 dp-muted" />
                    <span className="dp-label">Баланс аккаунта</span>
                  </div>
                  <div className="text-[26px] font-bold tracking-tight">{fmtMoney(balance)}</div>
                  <div className="dp-muted text-[12px] mt-1">Нажмите, чтобы пополнить…</div>
                </div>

                {/* 4. Email */}
                <div className="dp-card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Mail className="w-4 h-4 dp-muted" />
                    <span className="text-[13px] dp-muted">Email адрес</span>
                  </div>
                  {editEmail ? (
                    <div className="flex items-center gap-2">
                      <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                        type="email" autoComplete="email"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#0b1219] border border-[#1c2936]
                                   text-[14px] text-white focus:border-[#00f0ff] focus:outline-none" />
                      <button className="dp-btn shrink-0 !px-3" onClick={saveEmail} title="Сохранить">
                        <Check className="w-4 h-4" />
                      </button>
                      <button className="dp-btn dp-btn--ghost shrink-0 !px-3"
                        onClick={() => { setEditEmail(false); setNewEmail(user.email || ''); setEmailErr(null) }}
                        title="Отмена">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="dp-field truncate flex-1">{user.email}</span>
                      <button className="dp-btn dp-btn--outline shrink-0" onClick={() => setEditEmail(true)}>
                        <Pencil className="w-3 h-3" /> Изменить
                      </button>
                    </div>
                  )}
                  {emailMsg && <p className="text-[12px] text-emerald-400 mt-2">{emailMsg}</p>}
                  {emailErr && <p className="text-[12px] text-rose-400 mt-2">{emailErr}</p>}
                </div>

                {/* 5. Дата регистрации — на всю ширину */}
                <div className="dp-card p-5 md:col-span-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 dp-muted" />
                    <span className="text-[13px] dp-muted">Дата регистрации</span>
                  </div>
                  <div className="text-[15px] font-semibold">{fmtDate(user.created_at)}</div>
                </div>
              </div>
            )}

            {/* На «Профиле» секцию не рендерим: её данные уже показаны
                виджетами выше, иначе email/баланс/дата дублируются. */}
            {!isProfile && <div className="dp-section">{children}</div>}
          </main>
        </div>
      </div>

      {/* Мобильная навигация — закреплённая полоса внизу экрана.
          Была sticky с горизонтальным скроллом: уезжала вместе с контентом, а
          до дальних разделов приходилось долистывать. Теперь fixed, а пункты
          разложены в равные колонки — видно все сразу. */}
      <nav className="dp-tabbar lg:hidden" aria-label="Разделы кабинета">
        <div className="dp-tabbar-grid">
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => {
                setActiveSection(item.id)
                // Иначе после переключения пользователь остаётся в середине
                // прежней секции и думает, что ничего не произошло.
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              aria-current={activeSection === item.id ? 'page' : undefined}
              className={`dp-tab ${activeSection === item.id ? 'is-active' : ''}`}
            >
              <span className="dp-tab-icon">
                <item.Icon className="w-[18px] h-[18px]" />
                {item.badge > 0 && (
                  <i className="dp-tab-badge">{item.badge > 9 ? '9+' : item.badge}</i>
                )}
              </span>
              <span className="dp-tab-label">{item.short || item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
