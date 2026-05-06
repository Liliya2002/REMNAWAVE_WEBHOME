const API = import.meta.env.VITE_API_URL || ''

export async function login(login, password){
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  })
  const data = await res.json()
  if (res.ok && data.token){
    localStorage.setItem('token', data.token)
    return { ok: true }
  }
  return { ok: false, error: data.error || 'Ошибка' }
}

export async function sendEmailCode(email) {
  const res = await fetch(`${API}/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  const data = await res.json()
  if (res.ok) return { ok: true }
  return { ok: false, error: data.error || 'Ошибка отправки кода' }
}

export async function register(login, email, password, emailCode, referralCode = null){
  const body = { login, email, password, emailCode }
  if (referralCode) {
    body.referralCode = referralCode
  }
  
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  if (res.ok) return { ok: true }
  return { ok: false, error: data.error || 'Ошибка' }
}

export function logout(){
  localStorage.removeItem('token')
}
