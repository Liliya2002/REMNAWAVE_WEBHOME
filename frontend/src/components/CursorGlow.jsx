import React, { useEffect, useRef } from 'react'
import { useEffects } from '../contexts/EffectsContext'

// Интерактивное свечение под курсором для админки:
//   • cursor-spot — большое мягкое пятно-«прожектор», лениво тянется за мышью
//   • cursor-rays — вращающиеся световые лучи (conic-gradient), лаг средний
//   • cursor-ring — тонкое кольцо с инерцией
//   • cursor-dot  — яркая свеча-точка, следует вплотную
//
// Всё чисто декоративно: pointer-events:none, нативный курсор остаётся (для
// точных кликов). Управляем трансформами напрямую через rAF — без ре-рендеров.
// Отключается на тач-устройствах и при prefers-reduced-motion.

export default function CursorGlow() {
  const { cursorMode } = useEffects()
  const spotRef = useRef(null)
  const raysRef = useRef(null)
  const ringRef = useRef(null)
  const dotRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (cursorMode === 'off') return
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (coarse || reduced) return

    let tx = window.innerWidth / 2, ty = window.innerHeight / 2 // цель (курсор)
    let sx = tx, sy = ty   // spot (сильный лаг)
    let rx = tx, ry = ty   // rays (средний лаг)
    let gx = tx, gy = ty   // ring (лёгкий лаг)
    let deg = 0
    let visible = false
    let raf

    const setVis = (v) => {
      visible = v
      const o = v ? '1' : '0'
      for (const el of [spotRef, raysRef, ringRef, dotRef]) {
        if (el.current) el.current.style.opacity = o
      }
    }

    const onMove = (e) => {
      tx = e.clientX; ty = e.clientY
      if (!visible) setVis(true)
      // точка — вплотную, без лага, сразу в rAF ниже
    }
    const onLeave = () => setVis(false)
    const onEnter = () => setVis(true)

    const loop = () => {
      // интерполяция (lerp) для «инерции»
      sx += (tx - sx) * 0.08; sy += (ty - sy) * 0.08
      rx += (tx - rx) * 0.13; ry += (ty - ry) * 0.13
      gx += (tx - gx) * 0.22; gy += (ty - gy) * 0.22
      deg = (deg + 0.6) % 360

      if (spotRef.current) spotRef.current.style.transform = `translate(${sx}px, ${sy}px)`
      if (raysRef.current) raysRef.current.style.transform = `translate(${rx}px, ${ry}px) rotate(${deg}deg)`
      if (ringRef.current) ringRef.current.style.transform = `translate(${gx}px, ${gy}px)`
      if (dotRef.current) dotRef.current.style.transform = `translate(${tx}px, ${ty}px)`
      raf = requestAnimationFrame(loop)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('mouseenter', onEnter)
    raf = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('mouseenter', onEnter)
      cancelAnimationFrame(raf)
    }
  }, [cursorMode])

  if (cursorMode === 'off') return null

  return (
    <>
      <div ref={spotRef} className="cursor-spot" style={{ opacity: 0 }} />
      <div ref={raysRef} className="cursor-rays" style={{ opacity: 0 }} />
      <div ref={ringRef} className="cursor-ring" style={{ opacity: 0 }} />
      <div ref={dotRef} className="cursor-dot" style={{ opacity: 0 }} />
    </>
  )
}
