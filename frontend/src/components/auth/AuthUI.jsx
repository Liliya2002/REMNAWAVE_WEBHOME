import React from 'react'
import { Shield } from 'lucide-react'

/**
 * Общие элементы страниц входа и регистрации — футуристический glassmorphism.
 * Формы гранёные (clip-path), поля pill-образные, фон со светящимися «схемами».
 * Сами эффекты в index.css: там многослойные тени, clip-path и маски, которые
 * в утилитарных классах превратились бы в нечитаемую строку.
 */

/* Фильтр преломления фона за стеклом. Турбулентность намеренно мелкая:
   при большом scale текст под панелью «плывёт» и падает читаемость.
   Работает в Chromium; Safari/Firefox проигнорируют и оставят blur. */
function RefractionFilter() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <filter id="refract" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="9" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="1.2" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="14" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

/* Пути волокон вынесены, чтобы по ним же пустить частицы данных */
const FIBERS = [
  { d: 'M300 0 C 300 90, 246 150, 232 292', w: 2.2, o: 1 },
  { d: 'M300 0 C 300 80, 270 160, 266 292', w: 1.6, o: .85 },
  { d: 'M300 0 C 300 84, 300 170, 300 292', w: 2.6, o: 1 },
  { d: 'M300 0 C 300 80, 330 160, 334 292', w: 1.6, o: .85 },
  { d: 'M300 0 C 300 90, 354 150, 368 292', w: 2.2, o: 1 },
  { d: 'M300 0 C 300 70, 210 130, 186 292', w: 1.2, o: .5 },
  { d: 'M300 0 C 300 70, 390 130, 414 292', w: 1.2, o: .5 },
]

/* «Световые волосы» — пучки оптоволокна от шапки к панели */
function LightFibers() {
  return (
    <svg className="auth-fibers-svg" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden
      style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
               width: 'min(620px, 96%)', height: 230, pointerEvents: 'none', zIndex: 2 }}>
      <defs>
        <linearGradient id="fiber" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0f8ff" stopOpacity=".95" />
          <stop offset="55%" stopColor="#67e8f9" stopOpacity=".55" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#fiber)">
        {FIBERS.map((d, i) => (
          <path key={i} d={d.d} strokeWidth={d.w} opacity={d.o} />
        ))}
      </g>
      {/* Частицы данных, бегущие внутри волокон */}
      <g>
        {FIBERS.map((f, i) => (
          <circle key={i} className="fiber-particle" r={f.w > 2 ? 2.4 : 1.6} fill="#e0f8ff">
            <animateMotion dur={`${2.6 + i * 0.45}s`} repeatCount="indefinite" path={f.d} begin={`${i * 0.3}s`} />
            <animate attributeName="opacity" values="0;1;1;0" dur={`${2.6 + i * 0.45}s`}
              repeatCount="indefinite" begin={`${i * 0.3}s`} />
          </circle>
        ))}
      </g>
    </svg>
  )
}

/* Космическая пыль — медленно всплывает вверх */
function Dust() {
  const bits = []
  let seed = 21
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let i = 0; i < 26; i++) {
    bits.push({
      top: `${20 + rnd() * 70}%`, left: `${rnd() * 100}%`,
      size: rnd() < 0.7 ? 1.5 : 2.5,
      dur: `${9 + rnd() * 10}s`, delay: `${rnd() * 9}s`,
    })
  }
  return (
    <div className="auth-dust" aria-hidden>
      {bits.map((b, i) => (
        <i key={i} style={{ top: b.top, left: b.left, width: b.size, height: b.size,
                            animationDuration: b.dur, animationDelay: b.delay }} />
      ))}
    </div>
  )
}

// Светящиеся кривые, сходящиеся к центру — «провода» из референса
function CircuitLines() {
  return (
    <svg className="auth-lines" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset="50%" stopColor="#67e8f9" stopOpacity=".9" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lg2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0" />
          <stop offset="50%" stopColor="#38bdf8" stopOpacity=".75" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" strokeWidth="1.2">
        {/* Пучок слева — как жгут проводов, уходящий к форме */}
        <path d="M-40 250 C 220 250, 300 380, 520 400" stroke="url(#lg1)" />
        <path d="M-40 300 C 240 300, 320 400, 520 415" stroke="url(#lg1)" opacity=".8" />
        <path d="M-40 350 C 260 350, 340 420, 520 430" stroke="url(#lg1)" opacity=".6" />
        <path d="M-40 480 C 200 480, 330 450, 520 440" stroke="url(#lg2)" opacity=".7" />
        <path d="M-40 560 C 220 560, 340 470, 520 450" stroke="url(#lg2)" opacity=".5" />
        {/* Правая сторона */}
        <path d="M1240 260 C 980 260, 900 380, 680 400" stroke="url(#lg2)" />
        <path d="M1240 330 C 960 330, 880 405, 680 418" stroke="url(#lg2)" opacity=".75" />
        <path d="M1240 520 C 980 520, 860 460, 680 442" stroke="url(#lg1)" opacity=".6" />
        {/* Вертикальные — «питание» сверху */}
        <path d="M600 -30 C 600 90, 570 150, 590 240" stroke="url(#lg1)" opacity=".7" />
        <path d="M640 -30 C 640 100, 670 160, 650 240" stroke="url(#lg2)" opacity=".55" />
        {/* Горизонтальные шины снизу */}
        <path d="M300 700 L 900 700" stroke="url(#lg1)" opacity=".35" />
        <path d="M380 730 L 820 730" stroke="url(#lg2)" opacity=".25" />
      </g>
      {/* Импульсы данных, бегущие по дорожкам */}
      <g fill="none" stroke="#e0f8ff" strokeWidth="2.4" strokeLinecap="round">
        <path className="data-flow" d="M-40 250 C 220 250, 300 380, 520 400" style={{ animationDelay: '0s' }} />
        <path className="data-flow" d="M-40 480 C 200 480, 330 450, 520 440" style={{ animationDelay: '1.4s' }} />
        <path className="data-flow" d="M1240 260 C 980 260, 900 380, 680 400" style={{ animationDelay: '.7s' }} />
        <path className="data-flow" d="M1240 520 C 980 520, 860 460, 680 442" style={{ animationDelay: '2.1s' }} />
        <path className="data-flow" d="M600 -30 C 600 90, 570 150, 590 240" style={{ animationDelay: '1.1s' }} />
      </g>
    </svg>
  )
}

// Звёздное поле в правой туманности — как на референсе
function StarField() {
  const stars = []
  // Детерминированная псевдослучайность: одинаковая картинка при каждом рендере
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let i = 0; i < 46; i++) {
    const size = rnd() < 0.82 ? 1.5 : 2.5
    stars.push({
      top: `${8 + rnd() * 70}%`,
      left: `${52 + rnd() * 46}%`,   // держим в правой части, где туманность
      size,
      delay: `${rnd() * 4}s`,
    })
  }
  return (
    <div className="auth-stars" aria-hidden>
      {stars.map((st, i) => (
        <i key={i} style={{ top: st.top, left: st.left, width: st.size, height: st.size, animationDelay: st.delay }} />
      ))}
    </div>
  )
}

// Волновые линии-топография слева снизу
function Waves() {
  return (
    <svg className="auth-waves" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke="rgba(34,211,238,.30)" strokeWidth="1">
        <path d="M-50 640 C 180 600, 340 690, 560 660 S 900 590, 1250 640" />
        <path d="M-50 680 C 190 640, 350 730, 570 700 S 910 630, 1250 680" opacity=".75" />
        <path d="M-50 720 C 200 680, 360 770, 580 740 S 920 670, 1250 720" opacity=".5" />
        <path d="M-50 590 C 170 560, 330 645, 550 615 S 890 550, 1250 595" opacity=".55" />
      </g>
    </svg>
  )
}

/**
 * @param phase — 'launching' проигрывает коллапс ядра при входе,
 *   'materialize' — появление формы после выхода из аккаунта.
 */
export function AuthBackground({ children, phase }) {
  // Точки-искры расставлены по траекториям линий
  const sparks = [
    { top: '31%', left: '12%', s: 4, d: '0s' },
    { top: '38%', left: '24%', s: 3, d: '.8s' },
    { top: '52%', left: '18%', s: 3, d: '1.6s' },
    { top: '29%', right: '14%', s: 4, d: '.4s' },
    { top: '44%', right: '22%', s: 3, d: '2.1s' },
    { top: '18%', left: '49%', s: 3, d: '1.2s' },
    { top: '12%', left: '53%', s: 4, d: '2.6s' },
  ]
  return (
    <div className={`auth-bg flex items-center justify-center py-14 sm:py-20 px-4 ${
      phase === 'launching' ? 'auth-launching' : phase === 'materialize' ? 'auth-materialize' : ''}`}>
      {phase === 'launching' && <span className="auth-flash" aria-hidden />}
      {phase === 'materialize' && <span className="shockwave" aria-hidden />}
      <RefractionFilter />
      {/* Слои от дальнего к ближнему: космос → перспектива → платы → волны → пыль */}
      <div className="auth-deep" aria-hidden />
      {/* Завихрения и плотные скопления звёзд в ядре туманности */}
      <svg className="auth-swirl" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g fill="none" strokeWidth="26" strokeLinecap="round">
          <path d="M1080 120 C 900 200, 860 320, 960 420" stroke="rgba(232,121,249,.20)" />
          <path d="M1150 220 C 980 300, 940 420, 1040 520" stroke="rgba(167,139,250,.16)" />
          <path d="M900 180 C 820 260, 840 380, 940 440" stroke="rgba(217,70,239,.14)" />
        </g>
      </svg>
      <span className="auth-cluster" aria-hidden style={{ top: '22%', right: '12%', width: 180, height: 140 }} />
      <span className="auth-cluster" aria-hidden style={{ top: '38%', right: '22%', width: 120, height: 96 }} />
      <div className="auth-persp" aria-hidden><i /></div>
      <CircuitLines />
      <Waves />
      <StarField />
      <Dust />
      <div className="auth-topglow" aria-hidden />
      <LightFibers />
      {sparks.map((sp, i) => (
        <span key={i} className="auth-spark" aria-hidden
          style={{ top: sp.top, left: sp.left, right: sp.right, width: sp.s, height: sp.s, animationDelay: sp.d }} />
      ))}
      <div className="auth-orb" aria-hidden
        style={{ width: 460, height: 460, top: '-8%', right: '4%', background: 'rgba(139,92,246,.34)' }} />
      <div className="auth-orb" aria-hidden
        style={{ width: 380, height: 380, bottom: '-10%', left: '6%', background: 'rgba(34,211,238,.26)', animationDelay: '5s' }} />

      <div className="relative w-full max-w-[400px] z-20">{children}</div>
    </div>
  )
}

/** Гранёная карточка. Обёртка даёт светящуюся кромку и внешнее свечение —
 *  из-за clip-path сама карточка их отобразить не может. */
export function GlassCard({ children, className = '', spec = true, tray = false }) {
  return (
    <div className={`glass-oct-wrap ${tray ? 'tray' : ''}`}>
      <div className={`glass-oct relative z-10 ${className}`}>{children}</div>
      {/* Направленные блики на рёбрах — оживляют материал */}
      {spec && <>
        <span className="spec spec-tr" aria-hidden />
        <span className="spec spec-bl" aria-hidden />
        {/* Резкие ювелирные блики на фасках */}
        <span className="facet facet-t" aria-hidden />
        <span className="facet facet-b" aria-hidden />
        <span className="facet facet-corner facet-tl" aria-hidden />
        <span className="facet facet-corner facet-tr" aria-hidden />
      </>}
    </div>
  )
}

export function AuthHeader({ title, subtitle }) {
  return (
    <div className="text-center mb-6">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3
                      bg-gradient-to-br from-cyan-400/25 to-violet-500/20
                      border border-cyan-400/40 shadow-[0_0_28px_rgba(34,211,238,.35)]">
        <Shield className="w-6 h-6 text-cyan-300" />
      </div>
      <h1 className="neon-title text-2xl sm:text-[28px] font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
        {title}
      </h1>
      {subtitle && <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">{subtitle}</p>}
    </div>
  )
}

export function GlassField({ icon: Icon, label, hint, error, children, right }) {
  return (
    <div>
      {label && (
        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1.5 ml-3">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="w-4 h-4 text-cyan-400/90 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10"
            style={{ filter: 'drop-shadow(0 0 6px rgba(34,211,238,.6))' }} />
        )}
        {children}
        {right && <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10">{right}</div>}
      </div>
      {hint && !error && <p className="text-[10px] text-slate-500 mt-1 ml-3">{hint}</p>}
      {error && <p className="text-[10px] text-amber-400 mt-1 ml-3 font-medium">{error}</p>}
    </div>
  )
}

// Поля компактнее, чем раньше — ближе к пропорциям референса
export const glassInput = (hasIcon = true, hasRight = false) =>
  `glass-input w-full ${hasIcon ? 'pl-11' : 'pl-5'} ${hasRight ? 'pr-11' : 'pr-5'} py-2.5 text-sm`

export function NeonButton({ children, loading, className = '', ...props }) {
  return (
    <div className="neon-btn-wrap">
      <button
        {...props}
        disabled={loading || props.disabled}
        className={`neon-btn w-full py-3 font-bold text-[15px] text-white
                    disabled:cursor-not-allowed tracking-wide ${className}`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {typeof loading === 'string' ? loading : 'Загрузка…'}
          </span>
        ) : children}
      </button>
    </div>
  )
}

export function AuthDivider({ label = 'или' }) {
  return (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent" />
      </div>
      <div className="relative flex justify-center">
        <span className="px-3 text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</span>
      </div>
    </div>
  )
}

export function FeatureList({ title, items }) {
  return (
    <GlassCard tray className="mt-5 px-6 py-5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-3">{title}</p>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item} className="flex items-center gap-2.5 text-[13px] text-slate-700 dark:text-slate-300">
            <span className="w-4 h-4 rounded-full bg-cyan-400/15 border border-cyan-400/50 flex items-center justify-center shrink-0
                             shadow-[0_0_10px_rgba(34,211,238,.4)]">
              <svg className="w-2.5 h-2.5 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {item}
          </li>
        ))}
      </ul>
    </GlassCard>
  )
}

export function AuthError({ children }) {
  if (!children) return null
  return (
    <div className="mb-4 px-4 py-3 rounded-2xl text-[13px]
                    bg-rose-500/10 border border-rose-500/40 text-rose-600 dark:text-rose-300
                    shadow-[0_0_20px_rgba(244,63,94,.18)]">
      {children}
    </div>
  )
}
