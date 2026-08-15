import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'

/**
 * Главная страница для гостей, кабинет — для своих.
 *
 * Ярлык с домашнего экрана открывает start_url, то есть «/». Авторизованному
 * пользователю там показывать нечего: он ждёт свой кабинет, а не витрину с
 * тарифами. Поэтому при наличии токена «/» сразу уводит на /dashboard.
 *
 * `?home` оставляет главную открытой — чтобы админ мог посмотреть лендинг,
 * не выходя из аккаунта: /?home
 */
export default function HomeRoute({ children }) {
  const { search } = useLocation()

  const stay = new URLSearchParams(search).has('home')
  if (!stay && localStorage.getItem('token')) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}
