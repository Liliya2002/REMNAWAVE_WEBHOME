import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gift, Zap, MailOpen, Ban, Clipboard, ClipboardCheck, Link2, Smartphone, Server } from 'lucide-react'
import { authFetch } from '../../services/api'
import TrafficChart from '../../components/TrafficChart'

export default function SubscriptionsSection({ subscriptions, copySuccess, setCopySuccess, pendingBonusDays, onBonusActivated }) {
  const API_URL = import.meta.env.VITE_API_URL || ''
  const [squads, setSquads] = useState([])
  const [activatingBonus, setActivatingBonus] = useState(false)
  const [bonusResult, setBonusResult] = useState(null)
  const [bonusError, setBonusError] = useState(null)

  useEffect(() => {
    if (subscriptions.filter(s => s.is_active).length > 0) {
      fetchSquads()
    }
  }, [subscriptions])

  const fetchSquads = async () => {
    try {
      const res = await fetch(`${API_URL}/api/subscriptions/squads`)
      if (res.ok) {
        const data = await res.json()
        setSquads(data.squads || [])
      }
    } catch (err) {
      console.error('Error fetching squads:', err)
    }
  }

  const getSquadName = (uuid) => {
    const squad = squads.find(s => s.uuid === uuid)
    return squad ? squad.name : uuid || 'Не назначена'
  }

  async function handleActivateBonus() {
    setActivatingBonus(true)
    setBonusResult(null)
    setBonusError(null)
    try {
      const res = await authFetch('/api/subscriptions/apply-bonus', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setBonusResult(data)
        if (onBonusActivated) onBonusActivated()
      } else {
        setBonusError(data.error || 'Ошибка активации')
      }
    } catch (err) {
      if (err.message !== 'Unauthorized' && err.message !== 'No token') {
        setBonusError('Ошибка сети')
      }
    } finally {
      setActivatingBonus(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Баннер бонусных дней */}
      {pendingBonusDays > 0 && (
        <div className="p-4 sm:p-5 bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/40 rounded-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="text-3xl"><Gift className="w-8 h-8 text-green-400" /></div>
              <div>
                <div className="text-sm font-bold text-green-300">+{pendingBonusDays} бонусных дней от рефералов</div>
                <div className="text-xs text-slate-400">Нажмите кнопку, чтобы продлить подписку</div>
              </div>
            </div>
            <button
              onClick={handleActivateBonus}
              disabled={activatingBonus}
              className="px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-green-500/30 transition-all disabled:opacity-50 whitespace-nowrap text-sm"
            >
              {activatingBonus ? 'Активация…' : <><Zap className="w-4 h-4" /> Активировать</>}
            </button>
          </div>
          {bonusResult && (
            <div className="mt-3 p-3 bg-green-500/10 border border-green-500/40 rounded-xl text-sm text-green-400">
              ✓ {bonusResult.message} — подписка до {new Date(bonusResult.newExpiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              {bonusResult.wasReactivated && <span className="text-green-300 font-semibold"> (подписка реактивирована!)</span>}
            </div>
          )}
          {bonusError && (
            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-sm text-red-400">
              ✕ {bonusError}
            </div>
          )}
        </div>
      )}

      {/* График трафика — показываем если есть хотя бы одна подписка */}
      {subscriptions.length > 0 && subscriptions.some(s => s.is_active) && (
        <TrafficChart />
      )}

      {subscriptions.length === 0 ? (
        <div className="p-6 sm:p-12 bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl text-center">
          <div className="text-5xl sm:text-6xl mb-4"><MailOpen className="w-14 h-14 sm:w-16 sm:h-16 text-slate-500 mx-auto" /></div>
          <h3 className="text-xl sm:text-2xl font-bold text-slate-300 mb-2">Нет подписок</h3>
          <p className="text-slate-400 mb-6">Активируйте тестовый период или комбинеру платный тариф</p>
          <a href="/pricing" className="inline-block px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all">
            Выбрать тариф →
          </a>
        </div>
      ) : (
        subscriptions.map(sub => {
          const trafficPercent = sub.traffic_limit_gb > 0 
            ? Math.round((sub.traffic_used_gb / sub.traffic_limit_gb) * 100)
            : 0
          const daysLeft = sub.expires_at 
            ? Math.ceil((new Date(sub.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
            : null
          const isExpired = !sub.is_active && daysLeft && daysLeft <= 0
          
          return (
            <div key={sub.id} className="space-y-4">
              {/* Статус истечения подписки */}
              {isExpired && (
                <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-3">
                  <span className="text-2xl"><Ban className="w-6 h-6 text-red-400" /></span>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-red-400">Подписка истекла</div>
                    <div className="text-xs text-red-300/80">Истекла {new Date(sub.expires_at).toLocaleDateString('ru-RU')}</div>
                  </div>
                  <a href="/pricing" className="px-4 py-2 bg-blue-500/20 border border-blue-500/50 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all text-sm font-medium whitespace-nowrap">
                    Продлить →
                  </a>
                </div>
              )}
              
              {/* Основная информация подписки */}
              <div className={`p-4 sm:p-8 rounded-2xl border ${
                sub.is_active
                  ? 'bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border-blue-500/30'
                  : 'bg-gradient-to-br from-slate-900/30 to-slate-950/40 border-slate-700/30 opacity-70'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
                  <div className="min-w-0">
                    <h3 className="text-xl sm:text-3xl font-bold text-white mb-2">
                      {sub.plan_name === 'FREE_TRIAL' ? <><Gift className="w-5 h-5 inline" /> Тестовый период</> : sub.plan_name}
                    </h3>
                    <p className="text-slate-300 flex flex-wrap items-center gap-2">
                      <span className="text-sm">Username:</span>
                      <span className="font-mono text-blue-400 font-semibold text-sm break-all">{sub.remnwave_username}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(sub.remnwave_username)
                          setCopySuccess(sub.id)
                          setTimeout(() => setCopySuccess(null), 2000)
                        }}
                        className="text-xs text-slate-400 hover:text-slate-200"
                      >
                        {copySuccess === sub.id ? '✓' : <Clipboard className="w-3.5 h-3.5" />}
                      </button>
                    </p>
                  </div>
                  {daysLeft !== null && (
                    <div className={`text-right rounded-xl px-4 py-3 sm:px-6 sm:py-4 border shrink-0 ${
                      sub.is_active
                        ? daysLeft <= 7
                          ? 'bg-orange-500/20 border-orange-500/50'
                          : 'bg-blue-500/20 border-blue-500/50'
                        : 'bg-red-500/20 border-red-500/50'
                    }`}>
                      <div className={`text-2xl sm:text-4xl font-extrabold ${
                        sub.is_active
                          ? daysLeft <= 7
                            ? 'text-orange-400'
                            : 'text-blue-400'
                          : 'text-red-400'
                      }`}>
                        {daysLeft > 0 ? daysLeft : '0'}
                      </div>
                      <div className={`text-xs ${
                        sub.is_active
                          ? daysLeft <= 7
                            ? 'text-orange-300/80'
                            : 'text-slate-400'
                          : 'text-red-300/80'
                      } mt-1`}>
                        {sub.is_active ? 'дней осталось' : 'подписка истекла'}
                      </div>
                    </div>
                  )}
                </div>

                {/* Прогресс трафика */}
                {sub.is_active && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-300">Использование трафика</label>
                      <span className="text-sm font-mono text-slate-400">
                        {(sub.traffic_used_gb || 0).toFixed(2)} / {sub.traffic_limit_gb} GB
                      </span>
                    </div>
                    <div className="w-full h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                      <div 
                        className={`h-full transition-all rounded-full ${
                          trafficPercent > 80 ? 'bg-gradient-to-r from-red-500 to-red-400' : 
                          trafficPercent > 50 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' : 
                          'bg-gradient-to-r from-blue-500 to-cyan-400'
                        }`}
                        style={{ width: `${Math.min(trafficPercent, 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-400">
                      {trafficPercent}% использовано
                    </div>
                  </div>
                )}
              </div>

              {/* Subscription URL + Connect button */}
              {sub.subscription_url && sub.is_active && (
                <div className="p-4 sm:p-6 bg-slate-900/50 border border-slate-700/50 rounded-xl">
                  <div className="text-sm text-slate-400 mb-3 sm:mb-4 font-medium flex items-center gap-1.5"><Link2 className="w-4 h-4" /> Ссылка подписки для клиента VPN</div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg overflow-x-auto">
                      <code className="text-xs text-blue-400 font-mono whitespace-nowrap">
                        {sub.subscription_url}
                      </code>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(sub.subscription_url)
                        setCopySuccess(sub.id)
                        setTimeout(() => setCopySuccess(null), 2000)
                      }}
                      className="px-4 py-3 bg-blue-500/20 border border-blue-500/50 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all whitespace-nowrap font-medium"
                    >
                      {copySuccess === sub.id ? '✓ Скопирована' : <><ClipboardCheck className="w-4 h-4 inline" /> Копировать</>}
                    </button>
                  </div>
                  <Link
                    to="/connect"
                    className="mt-4 flex items-center justify-center gap-2 w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-blue-500/30 transition-all"
                  >
                    <Smartphone className="w-5 h-5" /> Подключить VPN
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
                  </Link>
                </div>
              )}

              {/* Серверная группа (только отображение) */}
              {sub.is_active && sub.squad_uuid && (
                <div className="p-4 sm:p-6 bg-slate-900/50 border border-slate-700/50 rounded-xl">
                  <h4 className="text-base sm:text-lg font-bold text-white flex items-center gap-1.5"><Server className="w-4 h-4" /> Серверная группа</h4>
                  <p className="text-sm text-slate-400 mt-2">
                    Текущая: <span className="text-blue-400 font-semibold">{getSquadName(sub.squad_uuid)}</span>
                  </p>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
