const API_URL = import.meta.env.VITE_API_URL || ''

/**
 * Обёртка над fetch для авторизованных запросов.
 * - Автоматически добавляет Authorization header
 * - При 401 — очищает токен и перенаправляет на /auth
 * - При сетевой ошибке — повторяет запрос (до maxRetries раз)
 */
export async function authFetch(path, options = {}, { maxRetries = 2, retryDelay = 3000 } = {}) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const token = localStorage.getItem('token')
    if (!token) {
      window.location.href = '/login'
      throw new Error('No token')
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${token}`,
        }
      })

      if (res.status === 401) {
        localStorage.removeItem('token')
        window.location.href = '/login'
        throw new Error('Unauthorized')
      }

      return res
    } catch (err) {
      if (err.message === 'Unauthorized' || err.message === 'No token') {
        throw err
      }
      // Сетевая ошибка — повторяем
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelay))
        continue
      }
      throw err
    }
  }
}
