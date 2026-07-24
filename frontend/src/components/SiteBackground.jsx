import React, { useEffect, useMemo, useRef } from 'react'
import { useSiteConfig } from '../contexts/SiteConfigContext'
import { useEffects } from '../contexts/EffectsContext'

// Анимированный фон всего сайта: мерцающие звёзды + периодический звездопад.
//
// Управление:
//   • Глобально (site_config): enable_starfield, starfield_density,
//     starfield_light (показывать и в светлой теме), starfield_parallax.
//   • Локально (браузер): bgMode 'auto'|'on'|'off' переопределяет вкл/выкл.
//
// Декоративно, pointer-events:none. Уважает prefers-reduced-motion (метеоры и
// параллакс отключаются).

const DENSITY = {
  low:    { stars: 45,  meteors: 4 },
  medium: { stars: 90,  meteors: 8 },
  high:   { stars: 160, meteors: 14 },
}

export default function SiteBackground() {
  const { config } = useSiteConfig()
  const { bgMode } = useEffects()
  const starsRef = useRef(null)

  const globalEnabled = config?.enable_starfield !== false // дефолт: включено
  const enabled = bgMode === 'off' ? false : bgMode === 'on' ? true : globalEnabled
  const lightTheme = !!config?.starfield_light
  const parallax = config?.starfield_parallax !== false
  const density = DENSITY[config?.starfield_density] || DENSITY.medium

  const stars = useMemo(() => {
    const rnd = (a, b) => a + Math.random() * (b - a)
    return Array.from({ length: density.stars }, () => {
      const size = rnd(1, 2.6)
      return {
        left: `${rnd(0, 100)}%`, top: `${rnd(0, 100)}%`,
        width: `${size}px`, height: `${size}px`,
        '--dur': `${rnd(2.2, 5.5).toFixed(2)}s`,
        '--delay': `${rnd(0, 5).toFixed(2)}s`,
        opacity: rnd(0.3, 1),
      }
    })
  }, [density.stars])

  const meteors = useMemo(() => {
    const rnd = (a, b) => a + Math.random() * (b - a)
    return Array.from({ length: density.meteors }, () => ({
      left: `${rnd(10, 100)}%`, top: `${rnd(-5, 40)}%`,
      '--m-dur': `${rnd(2.6, 5).toFixed(2)}s`,
      '--m-delay': `${rnd(0, 12).toFixed(2)}s`,
    }))
  }, [density.meteors])

  // Параллакс: слой звёзд слегка смещается за курсором.
  useEffect(() => {
    if (!enabled || !parallax) return
    if (window.matchMedia?.('(pointer: coarse)').matches) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let tx = 0, ty = 0, cx = 0, cy = 0, raf
    const onMove = (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 24   // амплитуда px
      ty = (e.clientY / window.innerHeight - 0.5) * 24
    }
    const loop = () => {
      cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06
      if (starsRef.current) starsRef.current.style.transform = `translate(${cx}px, ${cy}px)`
      raf = requestAnimationFrame(loop)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(loop)
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf) }
  }, [enabled, parallax])

  if (!enabled) return null

  const visClass = lightTheme ? 'block' : 'hidden dark:block'

  return (
    <div className={`${visClass} fixed inset-0 z-0 overflow-hidden pointer-events-none site-bg`} aria-hidden="true">
      {/* слой звёзд (параллакс на нём) — чуть крупнее вьюпорта, чтобы края не оголялись */}
      <div ref={starsRef} className="absolute" style={{ inset: '-24px' }}>
        {stars.map((s, i) => <span key={i} className="star" style={s} />)}
      </div>
      {meteors.map((m, i) => <span key={i} className="meteor" style={m} />)}
    </div>
  )
}
