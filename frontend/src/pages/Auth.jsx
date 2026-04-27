import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../services/auth'

export default function Auth(){
  const [loginField, setLoginField] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  async function handleLogin(e){
    e.preventDefault()
    setError(null)
    const res = await login(loginField, password)
    if (res.ok) navigate('/dashboard')
    else setError(res.error)
  }

  async function handleRegister(e){
    e.preventDefault()
    setError(null)
    const res = await register(loginField, email, password)
    if (res.ok) {
      // auto-login after register
      const l = await login(loginField, password)
      if (l.ok) navigate('/dashboard')
      else setError('Регистрация успешна, но вход не выполнен')
    } else setError(res.error)
  }

  return (
    <section className="max-w-md">
      <h2 className="text-2xl font-bold">Вход / Регистрация</h2>
      <form className="mt-4 space-y-4">
        {error && <div className="text-red-400">{error}</div>}
        <input value={loginField} onChange={e=>setLoginField(e.target.value)} className="w-full p-3 bg-slate-800 rounded" placeholder="Логин" />
        <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full p-3 bg-slate-800 rounded" placeholder="Email" />
        <input value={password} onChange={e=>setPassword(e.target.value)} className="w-full p-3 bg-slate-800 rounded" placeholder="Пароль" type="password" />
        <div className="flex gap-2">
          <button onClick={handleLogin} className="px-4 py-2 bg-indigo-600 rounded">Войти</button>
          <button onClick={handleRegister} className="px-4 py-2 border border-slate-700 rounded">Зарегистрироваться</button>
        </div>
      </form>
    </section>
  )
}
