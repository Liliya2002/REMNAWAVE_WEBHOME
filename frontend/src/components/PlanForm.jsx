import React, { useState } from 'react'
import { CalendarDays, Check, Circle, CreditCard, Plus, Server, Sparkles, Ticket, Trash2, X } from 'lucide-react'

export default function PlanForm({ plan, squads, onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    is_trial: plan?.is_trial || false,
    traffic_gb: plan?.traffic_gb || '',
    price_monthly: plan?.price_monthly || '',
    price_quarterly: plan?.price_quarterly || '',
    price_yearly: plan?.price_yearly || '',
    squad_uuids: plan?.squad_uuids || [],
    features: plan?.features || []
  })
  const [newFeature, setNewFeature] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const token = localStorage.getItem('token')
    
    const payload = {
      ...formData,
      traffic_gb: parseInt(formData.traffic_gb) || 0,
      price_monthly: formData.price_monthly ? parseFloat(formData.price_monthly) : null,
      price_quarterly: formData.price_quarterly ? parseFloat(formData.price_quarterly) : null,
      price_yearly: formData.price_yearly ? parseFloat(formData.price_yearly) : null
    }

    try {
      setSaving(true)
      const url = plan 
        ? `${import.meta.env.VITE_API_URL || ''}/api/plans/${plan.id}`
        : `${import.meta.env.VITE_API_URL || ''}/api/plans`
      
      const res = await fetch(url, {
        method: plan ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        onSave()
      } else {
        const data = await res.json()
        alert(data.error || 'Ошибка сохранения тарифа')
      }
    } catch (err) {
      console.error('Error saving plan:', err)
      alert('Ошибка сохранения тарифа')
    } finally {
      setSaving(false)
    }
  }

  function toggleSquad(uuid) {
    setFormData(prev => ({
      ...prev,
      squad_uuids: prev.squad_uuids.includes(uuid)
        ? prev.squad_uuids.filter(id => id !== uuid)
        : [...prev.squad_uuids, uuid]
    }))
  }

  function addFeature() {
    if (newFeature.trim()) {
      setFormData(prev => ({
        ...prev,
        features: [...prev.features, newFeature.trim()]
      }))
      setNewFeature('')
    }
  }

  function removeFeature(index) {
    setFormData(prev => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== index)
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.08),transparent_40%),rgba(2,6,23,0.92)] shadow-2xl shadow-black/60">
        <div className="sticky top-0 z-10 px-4 sm:px-6 py-4 border-b border-slate-700/60 bg-slate-950/80 backdrop-blur">
          <div className="flex justify-between items-center gap-3">
            <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-300" />
              <span>{plan ? 'Редактирование тарифа' : 'Создание тарифа'}</span>
            </h3>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg border border-slate-700/70 bg-slate-900/70 text-slate-400 hover:text-white hover:border-slate-500 transition-colors flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-5 p-4 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Название *</label>
              <input
                type="text"
                className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none transition-colors"
                placeholder="Напр: Pro Plus"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Трафик (GB) *</label>
              <input
                type="number"
                className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none transition-colors"
                placeholder="100"
                value={formData.traffic_gb}
                onChange={(e) => setFormData({...formData, traffic_gb: e.target.value})}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Описание</label>
            <textarea
              className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none transition-colors"
              rows="2"
              placeholder="Описание тарифа..."
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
            />
          </div>

          <div className="flex items-center gap-4 p-3 bg-slate-950/55 rounded-xl border border-slate-700/40">
            <label className="flex items-center gap-3 cursor-pointer flex-1">
              <div className="relative inline-block w-12 h-7 bg-slate-700 rounded-full transition-colors" style={{backgroundColor: formData.is_trial ? '#0ea5e9' : '#334155'}}>
                <div className={`absolute w-5 h-5 bg-white rounded-full top-1 transition-transform ${formData.is_trial ? 'translate-x-6' : 'translate-x-1'}`}/>
              </div>
              <span className="text-sm text-slate-300 font-semibold inline-flex items-center gap-2">
                {formData.is_trial ? <Ticket className="w-4 h-4 text-cyan-300" /> : <CreditCard className="w-4 h-4 text-cyan-300" />}
                <span>{formData.is_trial ? 'Пробный (бесплатный)' : 'Платный тариф'}</span>
              </span>
              <input
                type="checkbox"
                checked={formData.is_trial}
                onChange={(e) => setFormData({...formData, is_trial: e.target.checked})}
                className="hidden"
              />
            </label>
          </div>

          {!formData.is_trial && (
            <div>
              <h4 className="text-base font-bold text-white mb-3 inline-flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-cyan-300" />
                <span>Ценообразование</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">1 месяц ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none transition-colors"
                    placeholder="9.99"
                    value={formData.price_monthly}
                    onChange={(e) => setFormData({...formData, price_monthly: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">3 месяца ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none transition-colors"
                    placeholder="24.99"
                    value={formData.price_quarterly}
                    onChange={(e) => setFormData({...formData, price_quarterly: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">1 год ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none transition-colors"
                    placeholder="79.99"
                    value={formData.price_yearly}
                    onChange={(e) => setFormData({...formData, price_yearly: e.target.value})}
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-base font-bold text-white mb-3 inline-flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-300" />
              <span>Серверные группы</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {squads.map(squad => (
                <button
                  key={squad.uuid}
                  type="button"
                  onClick={() => toggleSquad(squad.uuid)}
                  className={`px-3 py-2.5 rounded-lg border transition-all text-sm font-semibold ${
                    formData.squad_uuids.includes(squad.uuid)
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                      : 'bg-slate-900/50 border-slate-700/50 text-slate-400 hover:border-blue-500/30'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {formData.squad_uuids.includes(squad.uuid) ? <Check className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                    <span>{squad.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-base font-bold text-white mb-3 inline-flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-300" />
              <span>Возможности</span>
            </h4>
            <div className="space-y-3 mb-3">
              {formData.features.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-700/50 rounded-lg text-slate-300 text-sm">
                    {feature}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFeature(index)}
                    className="px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg hover:bg-red-500/30 transition-all text-red-400 font-bold hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-3.5 py-2.5 bg-slate-900/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none transition-colors text-sm"
                placeholder="Напр: Поддержка P2P, Шифрование AES-256..."
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
              />
              <button
                type="button"
                onClick={addFeature}
                className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all font-bold"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-700/50 sticky bottom-0 bg-slate-950/85 backdrop-blur py-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/50 transition-all font-bold disabled:opacity-60"
            >
              {saving ? 'Сохранение...' : `${plan ? 'Обновить' : 'Добавить'} тариф`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-700 text-slate-300 rounded-lg hover:border-slate-600 transition-all font-bold"
            >
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
