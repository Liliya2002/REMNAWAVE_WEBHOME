import React from 'react'

export default function Button({ children, variant = 'primary', onClick, className = '' }){
  const base = 'px-4 py-2 rounded-md font-medium transition'
  const styles = variant === 'primary'
    ? 'bg-brand text-white shadow-[0_8px_24px_rgba(99,102,241,0.12)] hover:brightness-110'
    : 'bg-transparent border border-slate-700 text-slate-200 hover:bg-white/2'

  return (
    <button onClick={onClick} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  )
}
