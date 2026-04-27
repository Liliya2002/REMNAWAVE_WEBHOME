import React from 'react'
import Button from './Button'

export default function Hero(){
  return (
    <section className="py-12">
      <div className="max-w-4xl">
        <h1 className="text-5xl font-extrabold neon">Защитите свои соединения. Быстро и анонимно.</h1>
        <p className="mt-4 text-slate-300">Футуристический VPN с корпоративными стандартами безопасности и высокой скоростью.</p>
        <div className="mt-6 flex gap-4">
          <Button>Начать</Button>
          <Button variant="ghost">Узнать подробнее</Button>
        </div>
      </div>
    </section>
  )
}
