import React, { useState, useMemo, useEffect } from 'react'
import {
  Check, Plus, Server, Sparkles, Ticket, Trash2, X, Save, Eye,
  ChevronDown, Layers, DollarSign, Database, Tag, Palette, Gauge,
} from 'lucide-react'

const TIER_PRESETS = [
  { tier: 0, label: 'Trial',     color: '#94a3b8' },
  { tier: 1, label: 'Basic',     color: '#06b6d4' },
  { tier: 2, label: 'Pro',       color: '#3b82f6' },
  { tier: 3, label: 'Premium',   color: '#8b5cf6' },
  { tier: 4, label: 'Ultimate',  color: '#f59e0b' },
]

const COLOR_OPTIONS = [
  { value: '', label: 'Авто' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#10b981', label: 'Emerald' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#ec4899', label: 'Pink' },
]

export default function PlanForm({ plan, squads, onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    is_trial: plan?.is_trial || false,
    traffic_gb: plan?.traffic_gb ?? '',
    price_monthly: plan?.price_monthly ?? '',
    price_quarterly: plan?.price_quarterly ?? '',
    price_yearly: plan?.price_yearly ?? '',
    squad_uuids: plan?.squad_uuids || [],
    features: plan?.features || [],
    tier: plan?.tier ?? 1,
    tier_label: plan?.tier_label || '',
    sort_order: plan?.sort_order ?? 0,
    color: plan?.color || '',
    hwid_device_limit: plan?.hwid_device_limit ?? '',
  })
  const [newFeature, setNewFeature] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Per-squad limits: Map<squad_uuid, {limit_gb, topup_enabled, topup_price_per_gb}>
  const [squadLimits, setSquadLimits] = useState({})

  // Загружаем squad-limits для существующего плана
  useEffect(() => {
    if (!plan?.id) return
    ;(async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans/${plan.id}/squad-limits`)
        if (res.ok) {
          const data = await res.json()
          const map = {}
          for (const it of (data.items || [])) {
            map[it.squad_uuid] = {
              limit_gb: Number(it.limit_gb || 0),
              topup_enabled: !!it.topup_enabled,
              topup_price_per_gb: it.topup_price_per_gb !== null ? Number(it.topup_price_per_gb) : '',
            }
          }
          setSquadLimits(map)
        }
      } catch {}
    })()
  }, [plan?.id])

  function updateSquadLimit(uuid, key, value) {
    setSquadLimits(prev => ({
      ...prev,
      [uuid]: {
        limit_gb: prev[uuid]?.limit_gb ?? 0,
        topup_enabled: prev[uuid]?.topup_enabled ?? true,
        topup_price_per_gb: prev[uuid]?.topup_price_per_gb ?? '',
        [key]: value,
      },
    }))
  }

  const update = (k, v) => setFormData(p => ({ ...p, [k]: v }))

  const computedDiscounts = useMemo(() => {
    const m = Number(formData.price_monthly) || 0
    const q = Number(formData.price_quarterly) || 0
    const y = Number(formData.price_yearly) || 0
    const qDiscount = (m && q) ? Math.round((1 - q / (m * 3)) * 100) : 0
    const yDiscount = (m && y) ? Math.round((1 - y / (m * 12)) * 100) : 0
    return { qDiscount, yDiscount }
  }, [formData.price_monthly, formData.price_quarterly, formData.price_yearly])

  async function handleSubmit(e) {
    e?.preventDefault()
    setError(null)
    const token = localStorage.getItem('token')
    const payload = {
      ...formData,
      traffic_gb: parseInt(formData.traffic_gb) || 0,
      price_monthly: formData.price_monthly ? parseFloat(formData.price_monthly) : null,
      price_quarterly: formData.price_quarterly ? parseFloat(formData.price_quarterly) : null,
      price_yearly: formData.price_yearly ? parseFloat(formData.price_yearly) : null,
      tier: parseInt(formData.tier) || 0,
      sort_order: parseInt(formData.sort_order) || 0,
      hwid_device_limit: formData.hwid_device_limit === '' || formData.hwid_device_limit == null
        ? null
        : parseInt(formData.hwid_device_limit, 10),
    }
    try {
      setSaving(true)
      const url = plan
        ? `${import.meta.env.VITE_API_URL || ''}/api/plans/${plan.id}`
        : `${import.meta.env.VITE_API_URL || ''}/api/plans`
      const res = await fetch(url, {
        method: plan ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения тарифа')

      // После сохранения plan'а — синхронизируем plan_squad_limits (только для выбранных squad'ов)
      const planId = data.plan?.id || plan?.id
      if (planId) {
        const items = formData.squad_uuids.map(uuid => {
          const sl = squadLimits[uuid] || {}
          return {
            squad_uuid: uuid,
            limit_gb: Number(sl.limit_gb || 0),
            topup_enabled: sl.topup_enabled !== false,
            topup_price_per_gb: sl.topup_price_per_gb === '' || sl.topup_price_per_gb == null
              ? null : Number(sl.topup_price_per_gb),
          }
        })
        await fetch(`${import.meta.env.VITE_API_URL || ''}/api/plans/${planId}/squad-limits`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ items }),
        })
      }

      onSave()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function toggleSquad(uuid) {
    update('squad_uuids', formData.squad_uuids.includes(uuid)
      ? formData.squad_uuids.filter(id => id !== uuid)
      : [...formData.squad_uuids, uuid])
  }

  function addFeature() {
    const v = newFeature.trim()
    if (!v) return
    update('features', [...formData.features, v])
    setNewFeature('')
  }

  function removeFeature(idx) {
    update('features', formData.features.filter((_, i) => i !== idx))
  }

  const tierPreset = TIER_PRESETS.find(t => t.tier === Number(formData.tier)) || TIER_PRESETS[1]
  const accentColor = formData.color || tierPreset.color

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-6xl max-h-[94vh] flex flex-col bg-slate-900 border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-500/10 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)` }}>
              {formData.is_trial ? <Ticket className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="font-semibold text-white">{plan ? 'Редактирование тарифа' : 'Новый тариф'}</h3>
              <p className="text-xs text-slate-400">Изменения применяются после «Сохранить»</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-800/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-[1fr_360px]">
          {/* LEFT: form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-5 border-r border-slate-800/60">
            {/* Group: Основное */}
            <Section icon={Tag} title="Основное">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Название тарифа">
                  <input value={formData.name} onChange={e => update('name', e.target.value)} required maxLength={100} className={inputClass} placeholder="Базовый" />
                </Field>
                <Field label="Подметка (для UI)">
                  <input value={formData.tier_label} onChange={e => update('tier_label', e.target.value)} maxLength={64} className={inputClass} placeholder="Basic / Pro / Premium" />
                </Field>
              </div>
              <Field label="Описание">
                <textarea value={formData.description} onChange={e => update('description', e.target.value)} rows={2} maxLength={500} className={inputClass + ' resize-none'} placeholder="Краткое описание тарифа" />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={formData.is_trial} onChange={e => update('is_trial', e.target.checked)} className="accent-cyan-500" />
                  <Ticket className="w-4 h-4 text-cyan-400" /> Пробный тариф
                </label>
              </div>
            </Section>

            {/* Group: Tier */}
            <Section icon={Layers} title="Уровень тарифа">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {TIER_PRESETS.map(p => (
                  <button
                    key={p.tier}
                    type="button"
                    onClick={() => {
                      update('tier', p.tier)
                      if (!formData.tier_label) update('tier_label', p.label)
                      if (!formData.color) update('color', p.color)
                    }}
                    className={`p-3 rounded-xl border-2 transition-all text-center ${
                      Number(formData.tier) === p.tier
                        ? 'border-cyan-500 bg-cyan-500/10'
                        : 'border-slate-700/60 bg-slate-800/30 hover:border-slate-600'
                    }`}
                  >
                    <div className="w-8 h-8 mx-auto mb-1 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}aa)` }}>
                      {p.tier}
                    </div>
                    <div className="text-[11px] text-slate-300">{p.label}</div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Tier (число)" hint="Ручное значение, если пресет не подходит">
                  <input type="number" min="0" max="99" value={formData.tier} onChange={e => update('tier', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Sort order" hint="Порядок внутри уровня">
                  <input type="number" value={formData.sort_order} onChange={e => update('sort_order', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Цвет" hint="Для бейджей и подсветки">
                  <select value={formData.color} onChange={e => update('color', e.target.value)} className={inputClass}>
                    {COLOR_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
              </div>
            </Section>

            {/* Group: Цены */}
            <Section icon={DollarSign} title="Цены">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="1 месяц (₽)">
                  <input type="number" min="0" step="0.01" value={formData.price_monthly} onChange={e => update('price_monthly', e.target.value)} className={inputClass} placeholder="299" disabled={formData.is_trial} />
                </Field>
                <Field label="3 месяца (₽)" hint={computedDiscounts.qDiscount > 0 ? `Скидка ${computedDiscounts.qDiscount}%` : 'Введите для квартала'}>
                  <input type="number" min="0" step="0.01" value={formData.price_quarterly} onChange={e => update('price_quarterly', e.target.value)} className={inputClass} placeholder="800" disabled={formData.is_trial} />
                </Field>
                <Field label="1 год (₽)" hint={computedDiscounts.yDiscount > 0 ? `Скидка ${computedDiscounts.yDiscount}%` : 'Введите для года'}>
                  <input type="number" min="0" step="0.01" value={formData.price_yearly} onChange={e => update('price_yearly', e.target.value)} className={inputClass} placeholder="2999" disabled={formData.is_trial} />
                </Field>
              </div>
            </Section>

            {/* Group: Лимиты */}
            <Section icon={Database} title="Лимиты">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Трафик (ГБ)">
                  <input type="number" min="0" value={formData.traffic_gb} onChange={e => update('traffic_gb', e.target.value)} required className={inputClass} placeholder="100" />
                </Field>
                <Field label="Лимит устройств (HWID)" hint="Сколько устройств одновременно. Пусто = без лимита">
                  <input
                    type="number"
                    min="0"
                    value={formData.hwid_device_limit}
                    onChange={e => update('hwid_device_limit', e.target.value)}
                    className={inputClass}
                    placeholder="например: 5"
                  />
                </Field>
              </div>
            </Section>

            {/* Group: Серверы */}
            <Section icon={Server} title={`Сервера / Squads (${formData.squad_uuids.length} выбрано)`}>
              {squads.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-500 bg-slate-800/30 rounded-lg">Нет доступных squad'ов в RemnaWave</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {squads.map(s => {
                    const active = formData.squad_uuids.includes(s.uuid)
                    return (
                      <button
                        type="button"
                        key={s.uuid}
                        onClick={() => toggleSquad(s.uuid)}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
                          active
                            ? 'border-cyan-500 bg-cyan-500/10'
                            : 'border-slate-700/60 bg-slate-800/30 hover:border-slate-600'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-cyan-500 border-cyan-500' : 'border-slate-600'}`}>
                          {active && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-200 truncate">{s.name || s.uuid}</div>
                          <div className="text-[10px] text-slate-500 font-mono truncate">{s.uuid}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* Group: Per-squad лимиты */}
            {formData.squad_uuids.length > 0 && (
              <Section icon={Gauge} title="Лимиты per-squad (опционально)">
                <p className="text-[11px] text-slate-500 -mt-1 mb-2">
                  Если задано — система Squad Quotas автоматически отключит сервер при превышении и восстановит в новом периоде. 0 = без per-squad лимита.
                </p>
                <div className="space-y-2">
                  {formData.squad_uuids.map(uuid => {
                    const sq = squads.find(s => s.uuid === uuid)
                    const sl = squadLimits[uuid] || { limit_gb: 0, topup_enabled: true, topup_price_per_gb: '' }
                    return (
                      <div key={uuid} className="p-3 rounded-lg border border-slate-700/50 bg-slate-800/30">
                        <div className="flex items-center gap-2 mb-2">
                          <Server className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="text-sm font-medium text-slate-200 truncate flex-1">{sq?.name || uuid.slice(0, 12) + '…'}</span>
                          <code className="text-[10px] text-slate-500 font-mono truncate">{uuid.slice(0, 8)}</code>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">Лимит ГБ</label>
                            <input
                              type="number" min="0" step="0.01"
                              value={sl.limit_gb}
                              onChange={e => updateSquadLimit(uuid, 'limit_gb', e.target.value === '' ? 0 : Number(e.target.value))}
                              className={inputClass + ' text-sm'}
                              placeholder="0 = без лимита"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">Цена ₽/ГБ override</label>
                            <input
                              type="number" min="0" step="0.01"
                              value={sl.topup_price_per_gb}
                              onChange={e => updateSquadLimit(uuid, 'topup_price_per_gb', e.target.value)}
                              className={inputClass + ' text-sm'}
                              placeholder="из settings"
                            />
                          </div>
                          <div className="flex items-end">
                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pb-2">
                              <input
                                type="checkbox"
                                checked={sl.topup_enabled !== false}
                                onChange={e => updateSquadLimit(uuid, 'topup_enabled', e.target.checked)}
                                className="accent-cyan-500"
                              />
                              Разрешить покупку доп.
                            </label>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Group: Возможности */}
            <Section icon={Sparkles} title={`Возможности (${formData.features.length})`}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFeature}
                  onChange={e => setNewFeature(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature() } }}
                  placeholder="например: Безлимитные подключения"
                  className={inputClass + ' flex-1'}
                />
                <button type="button" onClick={addFeature} className="px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 text-sm inline-flex items-center gap-1">
                  <Plus className="w-4 h-4" /> Добавить
                </button>
              </div>
              <div className="space-y-1.5">
                {formData.features.length === 0 && (
                  <div className="text-[11px] text-slate-500 italic">Нет возможностей</div>
                )}
                {formData.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="flex-1 text-sm text-slate-200 truncate">{f}</span>
                    <button type="button" onClick={() => removeFeature(i)} className="text-slate-500 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </Section>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/40 text-sm text-red-300">
                {error}
              </div>
            )}
          </form>

          {/* RIGHT: live-preview */}
          <div className="p-5 bg-slate-950/40">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-1.5">
              <Eye className="w-3 h-3" /> Превью карточки
            </div>
            <PlanPreviewCard form={formData} accentColor={accentColor} tierPreset={tierPreset} squadsAll={squads} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800/60 flex justify-end gap-2 bg-slate-900/80">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60">
            Отмена
          </button>
          <button onClick={handleSubmit} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? 'Сохранение…' : (plan ? 'Сохранить изменения' : 'Создать тариф')}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputClass = 'w-full px-3 py-2 bg-slate-800/50 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:bg-slate-800/80 transition-all'

function Section({ icon: Icon, title, children }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
        {Icon && <Icon className="w-4 h-4 text-cyan-400" />} {title}
      </h4>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

function PlanPreviewCard({ form, accentColor, tierPreset, squadsAll }) {
  const squadCount = form.squad_uuids.length
  const squadNames = (form.squad_uuids || []).map(uuid => {
    const s = squadsAll.find(sq => sq.uuid === uuid)
    return s?.name || uuid.slice(0, 8)
  })
  return (
    <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: `${accentColor}66` }}>
      <div className="p-4" style={{ background: `linear-gradient(135deg, ${accentColor}11, transparent)` }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: accentColor }}>
            {form.tier_label || tierPreset.label} · tier {form.tier}
          </div>
          {form.is_trial && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/30 text-amber-200">trial</span>}
        </div>
        <div className="font-bold text-lg text-white mb-0.5">{form.name || '(без названия)'}</div>
        {form.description && <div className="text-xs text-slate-400 line-clamp-2">{form.description}</div>}

        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-3xl font-bold" style={{ color: accentColor }}>
            {form.price_monthly ? Number(form.price_monthly).toFixed(0) : (form.is_trial ? 'Бесплатно' : '—')}
          </span>
          {!form.is_trial && form.price_monthly && <span className="text-xs text-slate-500">₽ / мес</span>}
        </div>
        {(form.price_quarterly || form.price_yearly) && (
          <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
            {form.price_quarterly && <span>{Number(form.price_quarterly).toFixed(0)} ₽ / 3 мес</span>}
            {form.price_yearly && <span>{Number(form.price_yearly).toFixed(0)} ₽ / год</span>}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-800/60 space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Database className="w-3.5 h-3.5 text-cyan-400" />
          <span><b>{form.traffic_gb || 0} ГБ</b> трафика</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Server className="w-3.5 h-3.5 text-violet-400" />
          <span><b>{squadCount}</b> сервер{squadCount === 1 ? '' : 'ов'}{squadNames.length > 0 ? `: ${squadNames.slice(0, 2).join(', ')}${squadNames.length > 2 ? ` +${squadNames.length - 2}` : ''}` : ''}</span>
        </div>
        {form.features.length > 0 && (
          <div className="pt-2 border-t border-slate-800/40 space-y-1">
            {form.features.slice(0, 4).map((f, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                <span>{f}</span>
              </div>
            ))}
            {form.features.length > 4 && <div className="text-[10px] text-slate-500">+ ещё {form.features.length - 4}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
