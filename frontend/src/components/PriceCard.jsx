import React from 'react'

export default function PriceCard({ title, price, features, popular }){
  return (
    <div className={`p-6 rounded-xl border ${popular ? 'border-brand bg-gradient-to-br from-surface/60 to-surface/40 shadow-lg' : 'border-slate-800 bg-surface'}`}>
      {popular && <div className="text-xs text-brand uppercase mb-2">Популярно</div>}
      <h3 className="text-xl font-semibold">{title}</h3>
      <div className="mt-4 text-3xl font-extrabold">{price}</div>
      <ul className="mt-4 space-y-2 text-slate-300">
        {features.map((f,i)=>(<li key={i}>• {f}</li>))}
      </ul>
      <div className="mt-6">
        <button className="w-full px-4 py-2 bg-brand text-white rounded">Выбрать</button>
      </div>
    </div>
  )
}
