import React, { useEffect, useRef } from 'react'

/**
 * Оболочка «командный мостик» для страницы настроек.
 *
 * Оборачивает существующую страницу, ничего в ней не меняя: вся разметка,
 * поля и обработчики приходят через children. Тема — это фон, рама кокпита
 * и CSS-слой .bridge поверх; логика настроек её не касается.
 *
 * Космос рисуем процедурно на Canvas, а не картинкой: внешних ассетов в
 * проекте нет, и тянуть их ради фона не хочется. Three.js/GSAP не подключаем
 * по той же причине — весь эффект достижим Canvas 2D и CSS-анимациями,
 * а лишние зависимости пришлось бы тащить в сборку.
 */

/* Глубокий космос: звёзды в три слоя + туманность. Слои двигаются с разной
   скоростью — это и даёт параллакс при движении мыши. */
function Starfield() {
  const canvasRef = useRef(null)
  const pointer = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf = 0
    let stars = []
    let w = 0, h = 0

    // Детерминированный генератор: картинка одинаковая между перерисовками,
    // иначе звёзды прыгали бы при каждом ресайзе.
    let seed = 1337
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

    function build() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      seed = 1337
      const count = Math.round((w * h) / 6000)
      stars = Array.from({ length: count }, () => {
        const depth = rnd()                       // 0 — далеко, 1 — близко
        return {
          x: rnd() * w,
          y: rnd() * h,
          r: 0.4 + depth * 1.4,
          depth,
          tw: rnd() * Math.PI * 2,                // фаза мерцания
          sp: 0.6 + rnd() * 1.6,                  // скорость мерцания
        }
      })
    }

    let t = 0
    function frame() {
      t += 0.016
      ctx.clearRect(0, 0, w, h)

      // Туманность: несколько радиальных пятен в палитре темы
      const clouds = [
        { x: 0.18, y: 0.22, r: 0.55, c: '176,38,255' },   // пурпур
        { x: 0.82, y: 0.30, r: 0.50, c: '0,240,255' },    // циан
        { x: 0.60, y: 0.85, r: 0.45, c: '0,255,170' },    // квантовый зелёный
        { x: 0.35, y: 0.65, r: 0.40, c: '120,20,180' },
      ]
      for (const cl of clouds) {
        const cx = cl.x * w, cy = cl.y * h, cr = cl.r * Math.max(w, h)
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr)
        g.addColorStop(0, `rgba(${cl.c},0.10)`)
        g.addColorStop(0.5, `rgba(${cl.c},0.035)`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }

      // Звёзды. Смещение зависит от глубины — дальние почти не двигаются.
      const px = pointer.current.x, py = pointer.current.y
      for (const s of stars) {
        const shift = 6 + s.depth * 26
        const x = s.x + px * shift
        const y = s.y + py * shift
        const alpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * s.sp + s.tw))
        ctx.beginPath()
        ctx.arc(x, y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(226,241,255,${alpha * (0.35 + s.depth * 0.65)})`
        ctx.fill()

        // Ближние звёзды дают ореол — добавляет ощущение глубины
        if (s.depth > 0.82) {
          ctx.beginPath()
          ctx.arc(x, y, s.r * 3.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(0,240,255,${alpha * 0.10})`
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(frame)
    }

    function onMove(e) {
      // Нормализуем в [-1, 1] от центра окна
      pointer.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      pointer.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }

    const ro = new ResizeObserver(build)
    ro.observe(canvas)
    build()

    // Уважаем системную настройку: при «уменьшить движение» рисуем один кадр
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) { frame(); cancelAnimationFrame(raf) }
    else { raf = requestAnimationFrame(frame); window.addEventListener('mousemove', onMove) }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="bridge-stars" aria-hidden />
}

/* Рама кокпита: стойки остекления и блик по канопи. Чистый SVG поверх космоса. */
function Canopy() {
  return (
    <svg className="bridge-canopy" viewBox="0 0 1400 900" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="strut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(120,150,180,.30)" />
          <stop offset="50%" stopColor="rgba(60,80,105,.16)" />
          <stop offset="100%" stopColor="rgba(120,150,180,.26)" />
        </linearGradient>
        <linearGradient id="glare" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(0,240,255,.10)" />
          <stop offset="45%" stopColor="rgba(255,255,255,.03)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      {/* Скруглённые углы остекления */}
      <path d="M0 0 H1400 V900 H0 Z M0 0 C 240 26, 1160 26, 1400 0 L1400 0 H0 Z" fill="url(#strut)" opacity=".7" />
      <path d="M0 900 C 240 874, 1160 874, 1400 900 L1400 900 H0 Z" fill="url(#strut)" opacity=".55" />
      {/* Боковые стойки */}
      <path d="M0 0 C 46 220, 46 680, 0 900 Z" fill="url(#strut)" opacity=".65" />
      <path d="M1400 0 C 1354 220, 1354 680, 1400 900 Z" fill="url(#strut)" opacity=".65" />
      {/* Блик по стеклу */}
      <path d="M0 0 L620 0 L120 900 L0 900 Z" fill="url(#glare)" />
    </svg>
  )
}

/* Нижняя консоль: тактильные клавиши и статусные индикаторы. */
function Console() {
  const leds = [
    { label: 'PWR', tone: 'ok' }, { label: 'NET', tone: 'ok' },
    { label: 'DB',  tone: 'ok' }, { label: 'SYNC', tone: 'warn' },
  ]
  return (
    <div className="bridge-console" aria-hidden>
      <div className="bridge-console-leds">
        {leds.map(l => (
          <span key={l.label} className={`bridge-led bridge-led--${l.tone}`}>
            <i /> {l.label}
          </span>
        ))}
      </div>
      <div className="bridge-console-keys">
        {Array.from({ length: 14 }, (_, i) => <span key={i} className="bridge-key" />)}
      </div>
    </div>
  )
}

export default function CommandBridge({ children }) {
  return (
    <div className="bridge">
      <Starfield />
      <div className="bridge-nebula" aria-hidden />
      <Canopy />
      <span className="bridge-scanline" aria-hidden />

      {/* Контент страницы — ровно тот же, что в классическом виде */}
      <div className="bridge-content">{children}</div>

      <Console />
    </div>
  )
}
