import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function ProtectedAdminRoute({ children }) {
  const navigate = useNavigate()
  const [isAdmin, setIsAdmin] = useState(null)

  useEffect(() => {
    const checkAdmin = async () => {
      const token = localStorage.getItem('token')
      if (!token) {
        navigate('/login')
        return
      }

      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })

        if (!res.ok) {
          navigate('/login')
          return
        }

        const data = await res.json()
        if (!data.user?.is_admin) {
          navigate('/dashboard')
          return
        }

        setIsAdmin(true)
      } catch (error) {
        navigate('/login')
      }
    }

    checkAdmin()
  }, [navigate])

  if (isAdmin === null) {
    return <div className="text-center py-8 text-slate-400">Проверка доступа...</div>
  }

  if (!isAdmin) {
    return null
  }

  return children
}
