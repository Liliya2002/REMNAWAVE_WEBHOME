import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AdminUsers() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('id')
  const [order, setOrder] = useState('DESC')
  const [editingId, setEditingId] = useState(null)
  const [editEmail, setEditEmail] = useState('')

  const limit = 20

  const loadUsers = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const params = new URLSearchParams({
        page,
        limit,
        search,
        sort,
        order
      })

      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/users?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!res.ok) throw new Error('Failed to load users')
      const data = await res.json()
      setUsers(data.users || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [page, search, sort, order])

  const handleToggleAdmin = async (userId, isAdmin) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/admin/users/${userId}/toggle-admin`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (res.ok) {
        loadUsers()
      }
    } catch (err) {
      console.error('Error toggling admin:', err)
    }
  }

  const handleToggleActive = async (userId, isActive) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/admin/users/${userId}/toggle-active`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (res.ok) {
        loadUsers()
      }
    } catch (err) {
      console.error('Error toggling active:', err)
    }
  }

  const handleUpdateEmail = async (userId) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/admin/users/${userId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ email: editEmail })
        }
      )

      if (res.ok) {
        setEditingId(null)
        setEditEmail('')
        loadUsers()
      }
    } catch (err) {
      console.error('Error updating email:', err)
    }
  }

  const handleDelete = async (userId) => {
    if (!confirm('Вы уверены? Это действие нельзя отменить.')) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/admin/users/${userId}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      )

      if (res.ok) {
        loadUsers()
      }
    } catch (err) {
      console.error('Error deleting user:', err)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-slate-700 rounded-xl p-4 sm:p-6">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">👥 Управление пользователями</h2>

        {/* Фильтры */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <input
            type="text"
            placeholder="Поиск по логину или email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-primary"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-primary"
          >
            <option value="id">По ID</option>
            <option value="login">По логину</option>
            <option value="created_at">По дате</option>
          </select>
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-primary"
          >
            <option value="DESC">Новые первыми</option>
            <option value="ASC">Старые первыми</option>
          </select>
        </div>

        {/* Таблица */}
        {loading ? (
          <div className="text-center py-8 text-slate-400">Загрузка...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">{error}</div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-slate-400">Пользователей не найдено</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">ID</th>
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">Логин</th>
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">Email</th>
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">Роль</th>
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">Статус</th>
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">Дата</th>
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} onClick={() => navigate(`/admin/users/${user.id}`)} className="border-b border-slate-700 hover:bg-slate-800 transition cursor-pointer">
                    <td className="py-3 px-4 text-slate-300">{user.id}</td>
                    <td className="py-3 px-4 text-white font-medium">
                      <span className="text-blue-400 hover:text-blue-300 underline underline-offset-2">{user.login}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-300" onClick={e => e.stopPropagation()}>
                      {editingId === user.id ? (
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            className="px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm flex-1"
                          />
                          <button
                            onClick={() => handleUpdateEmail(user.id)}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-white text-sm"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 bg-slate-600 hover:bg-slate-700 rounded text-white text-sm"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {user.email}
                          <button
                            onClick={() => {
                              setEditingId(user.id)
                              setEditEmail(user.email)
                            }}
                            className="text-blue-400 hover:text-blue-300 text-xs"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {user.is_admin ? (
                        <span className="px-3 py-1 bg-purple-600 text-white rounded-full text-xs font-medium">Admin</span>
                      ) : (
                        <span className="px-3 py-1 bg-slate-600 text-slate-300 rounded-full text-xs font-medium">User</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {user.is_active ? (
                        <span className="px-3 py-1 bg-green-600 text-white rounded-full text-xs font-medium">Активен</span>
                      ) : (
                        <span className="px-3 py-1 bg-red-600 text-white rounded-full text-xs font-medium">Заблокирован</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-xs">
                      {new Date(user.created_at).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleAdmin(user.id, user.is_admin)}
                          className={`px-2 py-1 rounded text-white text-xs font-medium transition ${
                            user.is_admin
                              ? 'bg-slate-600 hover:bg-slate-700'
                              : 'bg-purple-600 hover:bg-purple-700'
                          }`}
                        >
                          {user.is_admin ? 'Убрать админ' : 'Сделать админ'}
                        </button>
                        <button
                          onClick={() => handleToggleActive(user.id, user.is_active)}
                          className={`px-2 py-1 rounded text-white text-xs font-medium transition ${
                            user.is_active
                              ? 'bg-red-600 hover:bg-red-700'
                              : 'bg-green-600 hover:bg-green-700'
                          }`}
                        >
                          {user.is_active ? 'Заблокировать' : 'Активировать'}
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="px-2 py-1 bg-red-700 hover:bg-red-800 rounded text-white text-xs font-medium transition"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Пагинация */}
        {!loading && users.length > 0 && (
          <div className="flex justify-center gap-2 mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded text-white transition"
            >
              ← Назад
            </button>
            <span className="px-4 py-2 text-slate-400">Страница {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={users.length < limit}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded text-white transition"
            >
              Вперед →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
