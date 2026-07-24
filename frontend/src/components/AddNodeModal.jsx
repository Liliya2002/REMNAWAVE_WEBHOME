import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Server, Globe, Settings2, AlertCircle, ChevronLeft, ChevronRight,
  Loader2, Check, Layers, Plug, Info, HardDrive, Cloud, Terminal,
  CheckCircle2, XCircle,
} from 'lucide-react'
import CountrySelect from './CountrySelect'
import TagInput from './TagInput'

const API = import.meta.env.VITE_API_URL || ''

/**
 * Модалка создания Remnawave-ноды.
 *
 * Четыре шага:
 *   1. Привязка к VPS  — выбираем существующий наш VPS или «без привязки»
 *   2. Config Profile  — профиль + активные inbounds
 *   3. Параметры       — name, port, страна (упрощённо если VPS выбран — адрес из VPS)
 *   4. Установка       — live-логи SSH-установки (только если VPS выбран); иначе сразу close
 *
 * Шаг 4 показывается только когда юзер выбрал «Установить на VPS» в Шаге 1.
 * В режиме «без привязки» после Шага 3 модалка закрывается с success-toast'ом.
 */
export default function AddNodeModal({ open, onClose, onCreated }) {
  const [step, setStep] = useState(1)

  // Step 1
  const [attachMode, setAttachMode] = useState('vps')   // 'vps' | 'standalone'
  const [availableVps, setAvailableVps] = useState(null) // null=loading
  const [vpsError, setVpsError] = useState(null)
  const [selectedVpsId, setSelectedVpsId] = useState('')

  // Step 2
  const [profiles, setProfiles] = useState(null)
  const [profilesError, setProfilesError] = useState(null)
  const [selectedProfileUuid, setSelectedProfileUuid] = useState('')
  const [selectedInbounds, setSelectedInbounds] = useState([])

  // Step 3
  const [providers, setProviders] = useState([])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('2222')
  const [countryCode, setCountryCode] = useState('XX')
  const [providerUuid, setProviderUuid] = useState('')
  const [tags, setTags] = useState([])
  const [consumptionMultiplier, setConsumptionMultiplier] = useState('1')
  const [trackTraffic, setTrackTraffic] = useState(false)
  const [trafficLimitGb, setTrafficLimitGb] = useState('')
  const [trafficResetDay, setTrafficResetDay] = useState('1')
  const [notifyPercent, setNotifyPercent] = useState('80')

  // Submit + Step 4
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [createdNode, setCreatedNode] = useState(null)         // { uuid, ... }
  const [installJobId, setInstallJobId] = useState(null)
  const [installLogs, setInstallLogs] = useState([])           // [{ ts, level, line }]
  const [installStatus, setInstallStatus] = useState('idle')   // idle|running|success|failed
  const [installError, setInstallError] = useState(null)

  const sseAbortRef = useRef(null)
  const logsEndRef = useRef(null)

  // Reset на каждое открытие
  useEffect(() => {
    if (!open) {
      // Закрываем активный SSE-стрим если был
      try { sseAbortRef.current?.abort() } catch {}
      return
    }
    setStep(1)
    setAttachMode('vps')
    setAvailableVps(null); setVpsError(null); setSelectedVpsId('')
    setProfiles(null); setProfilesError(null); setSelectedProfileUuid(''); setSelectedInbounds([])
    setProviders([])
    setName(''); setAddress(''); setPort('2222'); setCountryCode('XX')
    setProviderUuid(''); setTags([])
    setConsumptionMultiplier('1')
    setTrackTraffic(false); setTrafficLimitGb(''); setTrafficResetDay('1'); setNotifyPercent('80')
    setSubmitting(false); setSubmitError(null)
    setCreatedNode(null); setInstallJobId(null); setInstallLogs([]); setInstallStatus('idle'); setInstallError(null)

    const token = localStorage.getItem('token')
    const headers = { 'Authorization': `Bearer ${token}` }

    // Параллельно грузим всё что нужно
    fetch(`${API}/api/admin/servers/available-vps`, { headers })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
        return d
      })
      .then(d => setAvailableVps(d.vps || []))
      .catch(err => setVpsError(err.message))

    fetch(`${API}/api/admin/servers/config-profiles`, { headers })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
        return d
      })
      .then(d => setProfiles(d.profiles || []))
      .catch(err => setProfilesError(err.message))

    fetch(`${API}/api/admin/servers/infra-providers`, { headers })
      .then(r => r.ok ? r.json() : { providers: [] })
      .then(d => setProviders(d.providers || []))
      .catch(() => setProviders([]))
  }, [open])

  // Auto-fill адреса/страны/имени когда юзер выбирает VPS
  useEffect(() => {
    if (!selectedVpsId || !availableVps) return
    const v = availableVps.find(x => x.id === Number(selectedVpsId))
    if (!v) return
    setAddress(v.ip || '')
    if (!name) setName(v.name?.slice(0, 30) || '')
    // location у VPS — текст ('Falkenstein, DE'); страна не выводится автоматически
  }, [selectedVpsId, availableVps]) // eslint-disable-line react-hooks/exhaustive-deps

  // Когда сменился профиль — сбрасываем выбранные inbounds
  useEffect(() => { setSelectedInbounds([]) }, [selectedProfileUuid])

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight
  }, [installLogs])

  // ─── Validation ─────────────────────────────────────────────────────────────
  const step1Valid = useMemo(() => {
    if (attachMode === 'standalone') return true
    if (attachMode === 'vps') return !!selectedVpsId
    return false
  }, [attachMode, selectedVpsId])

  const step2Valid = useMemo(() => {
    return !!selectedProfileUuid && selectedInbounds.length > 0
  }, [selectedProfileUuid, selectedInbounds])

  const step3Errors = useMemo(() => {
    const errs = {}
    const nm = name.trim()
    if (nm.length < 3 || nm.length > 30) errs.name = '3-30 символов'
    // Address обязателен только в standalone (для vps он берётся из БД)
    if (attachMode === 'standalone' && !address.trim()) errs.address = 'Обязательно'
    if (port !== '') {
      const p = Number(port)
      if (!Number.isInteger(p) || p < 1 || p > 65535) errs.port = '1-65535'
    } else if (attachMode === 'vps') {
      errs.port = 'Обязательно для установки на VPS'
    }
    const cm = Number(consumptionMultiplier)
    if (Number.isNaN(cm) || cm < 0 || cm > 100) errs.consumption = '0-100'
    if (trackTraffic) {
      const lim = Number(trafficLimitGb)
      if (!(lim > 0)) errs.trafficLimit = '> 0 GB'
      const day = Number(trafficResetDay)
      if (!Number.isInteger(day) || day < 1 || day > 31) errs.trafficResetDay = '1-31'
      const np = Number(notifyPercent)
      if (!Number.isInteger(np) || np < 0 || np > 100) errs.notifyPercent = '0-100'
    }
    return errs
  }, [name, address, port, attachMode, consumptionMultiplier, trackTraffic, trafficLimitGb, trafficResetDay, notifyPercent])

  const step3Valid = Object.keys(step3Errors).length === 0

  // ─── Submit ─────────────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!step1Valid || !step2Valid || !step3Valid) return
    setSubmitting(true); setSubmitError(null)

    const payload = {
      name: name.trim(),
      address: address.trim(),
      configProfile: {
        activeConfigProfileUuid: selectedProfileUuid,
        activeInbounds: selectedInbounds,
      },
      countryCode: countryCode || 'XX',
      consumptionMultiplier: Number(consumptionMultiplier) || 1,
    }
    if (port !== '') payload.port = Number(port)
    if (providerUuid) payload.providerUuid = providerUuid
    if (tags.length > 0) payload.tags = tags
    if (trackTraffic) {
      payload.isTrafficTrackingActive = true
      payload.trafficLimitBytes = Math.round(Number(trafficLimitGb) * 1024 * 1024 * 1024)
      payload.trafficResetDay = Number(trafficResetDay)
      payload.notifyPercent = Number(notifyPercent)
    }

    try {
      const token = localStorage.getItem('token')

      // 1. Создаём ноду в Remnawave
      const r1 = await fetch(`${API}/api/admin/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const d1 = await r1.json().catch(() => ({}))
      if (!r1.ok) throw new Error(d1.error || `HTTP ${r1.status}`)
      const node = d1.node
      setCreatedNode(node)

      // 2. Если standalone — закрываем модалку
      if (attachMode === 'standalone') {
        onCreated?.(node)
        onClose?.()
        return
      }

      // 3. Если VPS — стартуем install job и переключаемся на Шаг 4
      const r2 = await fetch(`${API}/api/admin/servers/${node.uuid}/install-on-vps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ vpsId: Number(selectedVpsId), appPort: Number(port) }),
      })
      const d2 = await r2.json().catch(() => ({}))
      if (!r2.ok) throw new Error(d2.error || `HTTP ${r2.status}`)

      setInstallJobId(d2.jobId)
      setInstallStatus('running')
      setSubmitting(false)
      setStep(4)
      // Стрим логов запустится в useEffect ниже
    } catch (err) {
      setSubmitError(err.message)
      setSubmitting(false)
    }
  }

  // ─── SSE-стрим (через fetch+ReadableStream — поддерживает Auth header) ─────
  useEffect(() => {
    if (step !== 4 || !installJobId) return

    const token = localStorage.getItem('token')
    const ctrl = new AbortController()
    sseAbortRef.current = ctrl

    fetch(`${API}/api/admin/servers/install-jobs/${installJobId}/stream`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          throw new Error(`SSE HTTP ${res.status}`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          // SSE-формат: события разделены \n\n, внутри события строки event:/data:
          let nlIdx
          while ((nlIdx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, nlIdx)
            buf = buf.slice(nlIdx + 2)
            handleSseEvent(raw)
          }
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        setInstallStatus('failed')
        setInstallError(`Поток логов оборван: ${err.message}`)
      })

    function handleSseEvent(raw) {
      // Парсим event: и data:
      const lines = raw.split('\n')
      let event = 'message', data = ''
      for (const ln of lines) {
        if (ln.startsWith('event: ')) event = ln.slice(7).trim()
        else if (ln.startsWith('data: ')) data += ln.slice(6)
        else if (ln.startsWith(':')) continue // comment / heartbeat
      }
      if (!data) return
      let payload
      try { payload = JSON.parse(data) } catch { return }

      if (event === 'snapshot') {
        setInstallLogs(payload.logs || [])
        if (payload.status && payload.status !== 'running') {
          setInstallStatus(payload.status)
        }
      } else if (event === 'log') {
        setInstallLogs(prev => [...prev, payload])
      } else if (event === 'done') {
        setInstallStatus(payload.status || 'success')
        if (payload.error) setInstallError(payload.error)
      }
    }

    return () => { ctrl.abort() }
  }, [step, installJobId])

  if (!open) return null

  // ─── Render ────────────────────────────────────────────────────────────────
  // Скрываем кнопку «Назад» в Step 4: установка идёт, прерывать нельзя
  const canGoBack = step > 1 && step !== 4
  const hasInstallStep = attachMode === 'vps'
  const totalSteps = hasInstallStep ? 4 : 3

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !submitting && step !== 4 && onClose?.()}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-500/15 border border-violet-500/40 flex items-center justify-center">
              <Server className="w-4 h-4 text-violet-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Добавить Remnawave-ноду</h2>
              <p className="text-xs text-slate-400">Шаг {step} из {totalSteps} · {STEP_TITLES[step]}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !submitting && step !== 4 && onClose?.()}
            disabled={submitting || (step === 4 && installStatus === 'running')}
            className="text-slate-400 hover:text-white disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-5 pt-3">
          {[1, 2, 3, ...(hasInstallStep ? [4] : [])].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-full ${step >= s ? 'bg-violet-500' : 'bg-slate-800'}`} />
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          {step === 1 && (
            <Step1
              attachMode={attachMode} setAttachMode={setAttachMode}
              availableVps={availableVps} vpsError={vpsError}
              selectedVpsId={selectedVpsId} setSelectedVpsId={setSelectedVpsId}
            />
          )}
          {step === 2 && (
            <Step2
              profiles={profiles} profilesError={profilesError}
              selectedProfileUuid={selectedProfileUuid} setSelectedProfileUuid={setSelectedProfileUuid}
              selectedInbounds={selectedInbounds} setSelectedInbounds={setSelectedInbounds}
            />
          )}
          {step === 3 && (
            <Step3
              attachMode={attachMode}
              selectedVps={availableVps?.find(v => v.id === Number(selectedVpsId))}
              name={name} setName={setName}
              address={address} setAddress={setAddress}
              port={port} setPort={setPort}
              countryCode={countryCode} setCountryCode={setCountryCode}
              providerUuid={providerUuid} setProviderUuid={setProviderUuid}
              providers={providers}
              tags={tags} setTags={setTags}
              consumptionMultiplier={consumptionMultiplier} setConsumptionMultiplier={setConsumptionMultiplier}
              trackTraffic={trackTraffic} setTrackTraffic={setTrackTraffic}
              trafficLimitGb={trafficLimitGb} setTrafficLimitGb={setTrafficLimitGb}
              trafficResetDay={trafficResetDay} setTrafficResetDay={setTrafficResetDay}
              notifyPercent={notifyPercent} setNotifyPercent={setNotifyPercent}
              errors={step3Errors}
            />
          )}
          {step === 4 && (
            <Step4
              logs={installLogs}
              status={installStatus}
              error={installError}
              logsRef={logsEndRef}
            />
          )}

          {submitError && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-sm text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>{submitError}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-slate-800">
          {step === 4 ? (
            <>
              <div className="text-xs text-slate-500">
                {installStatus === 'running' && 'Установка идёт... не закрывай вкладку'}
                {installStatus === 'success' && '✅ Установка завершена'}
                {installStatus === 'failed' && '❌ Установка не удалась'}
              </div>
              <button
                type="button"
                onClick={() => { onCreated?.(createdNode); onClose?.() }}
                disabled={installStatus === 'running'}
                className={`px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed ${
                  installStatus === 'failed'
                    ? 'bg-slate-700 hover:bg-slate-600 text-white'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
              >
                {installStatus === 'failed' ? 'Закрыть' : 'Готово'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => canGoBack ? setStep(step - 1) : onClose?.()}
                disabled={submitting}
                className="px-4 py-2 text-slate-300 hover:text-white text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {canGoBack ? <ChevronLeft className="w-4 h-4" /> : <X className="w-4 h-4" />}
                {canGoBack ? 'Назад' : 'Отмена'}
              </button>
              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => setStep(step + 1)}
                  disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                  className="px-5 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold flex items-center gap-1"
                >
                  Далее <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!step3Valid || submitting}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {submitting
                    ? (attachMode === 'vps' ? 'Создаю и устанавливаю…' : 'Создание…')
                    : (attachMode === 'vps' ? 'Создать и установить' : 'Создать ноду')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const STEP_TITLES = { 1: 'Привязка', 2: 'Конфигурация', 3: 'Параметры', 4: 'Установка' }

// ─── Step 1: Привязка к VPS ──────────────────────────────────────────────────

function Step1({ attachMode, setAttachMode, availableVps, vpsError, selectedVpsId, setSelectedVpsId }) {
  return (
    <div className="space-y-4">
      <ModeRadio
        value="vps"
        current={attachMode}
        onSelect={() => setAttachMode('vps')}
        icon={<HardDrive className="w-5 h-5" />}
        title="Установить на VPS из админки"
        recommended
        description="Выбирешь VPS — мы автоматически поставим на него Remnawave Node через SSH (docker, compose, firewall)."
      />

      {attachMode === 'vps' && (
        <div className="ml-2 pl-5 border-l-2 border-violet-500/40">
          {vpsError && (
            <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-sm text-red-300 mb-3">
              Ошибка загрузки VPS: {vpsError}
            </div>
          )}
          {availableVps === null && !vpsError && (
            <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Загрузка списка VPS…
            </div>
          )}
          {availableVps !== null && availableVps.length === 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-300">
              Нет свободных VPS. В <code className="text-cyan-300">/admin/vps</code> должны быть серверы со статусом «active»,
              без привязанной ноды и с заполненным SSH-доступом (пароль или ключ).
            </div>
          )}
          {availableVps !== null && availableVps.length > 0 && (
            <div className="space-y-1.5">
              {availableVps.map(v => (
                <button
                  key={v.id}
                  type="button"
                  disabled={!v.hasSshCredentials}
                  onClick={() => setSelectedVpsId(String(v.id))}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition ${
                    Number(selectedVpsId) === v.id
                      ? 'bg-violet-500/15 border-violet-500/50'
                      : v.hasSshCredentials
                        ? 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                        : 'bg-slate-950/40 border-slate-800 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 transition ${
                    Number(selectedVpsId) === v.id ? 'border-violet-400 bg-violet-400' : 'border-slate-600'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-100">{v.name}</span>
                      {v.provider && <span className="text-[10px] text-slate-500 uppercase">{v.provider}</span>}
                    </div>
                    <div className="text-xs text-slate-500 font-mono truncate">
                      {v.ip} · {v.sshUser}@{v.sshPort}
                      {v.location && <> · {v.location}</>}
                      {v.monthlyCost > 0 && <> · {v.monthlyCost} {v.currency}/мес</>}
                    </div>
                    {!v.hasSshCredentials && (
                      <div className="text-[11px] text-amber-400 mt-0.5">⚠ Нет SSH-доступа — настрой в /admin/vps</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ModeRadio
        value="standalone"
        current={attachMode}
        onSelect={() => setAttachMode('standalone')}
        icon={<Cloud className="w-5 h-5" />}
        title="Только зарегистрировать в Remnawave"
        description="Нода уже установлена вручную или поставишь её отдельно. Просто создаём запись на панели."
      />
    </div>
  )
}

function ModeRadio({ value, current, onSelect, icon, title, description, recommended }) {
  const active = value === current
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left transition ${
        active
          ? 'bg-violet-500/15 border-violet-500/50'
          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className={`w-4 h-4 rounded-full border-2 mt-1 shrink-0 transition ${
        active ? 'border-violet-400 bg-violet-400' : 'border-slate-600'
      }`} />
      <div className={`shrink-0 ${active ? 'text-violet-300' : 'text-slate-400'}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-white">{title}</span>
          {recommended && (
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded uppercase font-semibold">
              Recommended
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
    </button>
  )
}

// ─── Step 2: Config Profile + Inbounds ───────────────────────────────────────

function Step2({ profiles, profilesError, selectedProfileUuid, setSelectedProfileUuid, selectedInbounds, setSelectedInbounds }) {
  if (profiles === null && !profilesError) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 text-violet-400 animate-spin" /></div>
  }
  if (profilesError) {
    return <div className="p-4 bg-red-500/10 border border-red-500/40 rounded-lg text-sm text-red-300">Ошибка загрузки config-профилей: {profilesError}</div>
  }
  if (profiles.length === 0) {
    return (
      <div className="p-5 bg-amber-500/10 border border-amber-500/40 rounded-lg space-y-2">
        <div className="flex items-center gap-2 text-amber-300 font-bold">
          <AlertCircle className="w-5 h-5" /> Нет config-профилей
        </div>
        <p className="text-sm text-slate-300">
          Создай Config Profile в Remnawave-админке и вернись сюда.
        </p>
      </div>
    )
  }

  const selectedProfile = profiles.find(p => p.uuid === selectedProfileUuid)

  function toggleInbound(uuid) {
    setSelectedInbounds(arr => arr.includes(uuid) ? arr.filter(u => u !== uuid) : [...arr, uuid])
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-slate-200">Config Profile</h3>
        </div>
        <div className="space-y-1.5">
          {profiles.map(p => (
            <button key={p.uuid} type="button" onClick={() => setSelectedProfileUuid(p.uuid)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition ${
                selectedProfileUuid === p.uuid
                  ? 'bg-violet-500/15 border-violet-500/50'
                  : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 transition ${
                selectedProfileUuid === p.uuid ? 'border-violet-400 bg-violet-400' : 'border-slate-600'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-100 truncate">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {(p.inbounds?.length || 0)} inbound{(p.inbounds?.length || 0) === 1 ? '' : 's'}
                  {(p.nodes?.length || 0) > 0 && ` · ${p.nodes.length} нод${p.nodes.length === 1 ? 'а' : ''}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedProfile && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Plug className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              Активные inbounds <span className="text-xs text-slate-500 font-normal">(минимум 1)</span>
            </h3>
          </div>
          {selectedProfile.inbounds?.length === 0 ? (
            <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-300">
              В этом профиле нет inbound'ов.
            </div>
          ) : (
            <div className="space-y-1.5">
              {selectedProfile.inbounds.map(inb => (
                <label key={inb.uuid}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition ${
                    selectedInbounds.includes(inb.uuid)
                      ? 'bg-cyan-500/10 border-cyan-500/40'
                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <input autoComplete="off" type="checkbox" checked={selectedInbounds.includes(inb.uuid)}
                    onChange={() => toggleInbound(inb.uuid)}
                    className="w-4 h-4 accent-cyan-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono text-slate-100 truncate">{inb.tag}</div>
                    <div className="text-[11px] text-slate-500">
                      {inb.type}{inb.network ? ` · ${inb.network}` : ''}{inb.security ? ` · ${inb.security}` : ''}
                      {inb.port ? ` · :${inb.port}` : ''}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Параметры ──────────────────────────────────────────────────────

function Step3(p) {
  const {
    attachMode, selectedVps,
    name, setName, address, setAddress, port, setPort,
    countryCode, setCountryCode, providerUuid, setProviderUuid, providers,
    tags, setTags, consumptionMultiplier, setConsumptionMultiplier,
    trackTraffic, setTrackTraffic,
    trafficLimitGb, setTrafficLimitGb,
    trafficResetDay, setTrafficResetDay,
    notifyPercent, setNotifyPercent, errors,
  } = p

  const isVps = attachMode === 'vps'
  const [advancedOpen, setAdvancedOpen] = useState(false)

  return (
    <div className="space-y-4">
      {isVps && selectedVps && (
        <div className="p-3 bg-violet-500/10 border border-violet-500/40 rounded-lg flex items-start gap-2 text-xs text-slate-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-violet-300" />
          <div>
            Установка на <b className="text-violet-200">{selectedVps.name}</b> ({selectedVps.ip}).
            Адрес ноды берётся автоматически из VPS — поле адреса заблокировано.
          </div>
        </div>
      )}

      <FieldRow label="Имя ноды" error={errors.name} hint="3-30 символов">
        <input autoComplete="off" type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Hetzner-de1" maxLength={30}
          className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60 font-mono" />
      </FieldRow>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <FieldRow label="Адрес" error={errors.address} hint={isVps ? 'из VPS, read-only' : 'IP или домен'}>
            <input autoComplete="off" type="text" value={address} onChange={e => setAddress(e.target.value)}
              placeholder="95.217.1.2 или node.example.com"
              disabled={isVps}
              className={`w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60 font-mono ${isVps ? 'opacity-60 cursor-not-allowed' : ''}`} />
          </FieldRow>
        </div>
        <FieldRow label="Порт" error={errors.port} hint="node-агент">
          <input autoComplete="off" type="number" value={port} onChange={e => setPort(e.target.value)}
            placeholder="2222" min={1} max={65535}
            className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60 font-mono" />
        </FieldRow>
      </div>

      <FieldRow label="Страна" hint={isVps && selectedVps?.location ? `из VPS: ${selectedVps.location}` : null}>
        <CountrySelect value={countryCode} onChange={setCountryCode} />
      </FieldRow>

      <div className="border-t border-slate-800 pt-3">
        <button type="button" onClick={() => setAdvancedOpen(o => !o)}
          className="flex items-center gap-2 text-sm text-slate-300 hover:text-white">
          <Settings2 className="w-4 h-4" /> Дополнительно
          <ChevronRight className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-90' : ''}`} />
        </button>

        {advancedOpen && (
          <div className="mt-3 space-y-4 pl-1">
            {providers.length > 0 && (
              <FieldRow label="Provider (биллинг)" hint="Опционально, для отслеживания оплаты">
                <select value={providerUuid} onChange={e => setProviderUuid(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60">
                  <option value="">— не выбран —</option>
                  {providers.map(pr => <option key={pr.uuid} value={pr.uuid}>{pr.name}</option>)}
                </select>
              </FieldRow>
            )}

            <FieldRow label="Теги" hint="до 10 шт, A-Z 0-9 _ : (заглавные)">
              <TagInput value={tags} onChange={setTags} maxTags={10} />
            </FieldRow>

            <FieldRow label="Множитель потребления" error={errors.consumption}
              hint="GB трафика списывается за каждый реальный GB. Default 1.0">
              <input autoComplete="off" type="number" value={consumptionMultiplier} onChange={e => setConsumptionMultiplier(e.target.value)}
                step="0.1" min={0} max={100}
                className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60 font-mono" />
            </FieldRow>

            <div className="border-t border-slate-800 pt-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input autoComplete="off" type="checkbox" checked={trackTraffic} onChange={e => setTrackTraffic(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-violet-500" />
                <div>
                  <div className="text-sm font-semibold text-slate-200">Отслеживать трафик ноды</div>
                  <div className="text-xs text-slate-500">Лимит, день сброса, уведомление</div>
                </div>
              </label>
              {trackTraffic && (
                <div className="mt-3 grid grid-cols-3 gap-3 pl-6">
                  <FieldRow label="Лимит (GB)" error={errors.trafficLimit}>
                    <input autoComplete="off" type="number" value={trafficLimitGb} onChange={e => setTrafficLimitGb(e.target.value)}
                      min={1} placeholder="500"
                      className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60 font-mono" />
                  </FieldRow>
                  <FieldRow label="День сброса" error={errors.trafficResetDay} hint="1-31">
                    <input autoComplete="off" type="number" value={trafficResetDay} onChange={e => setTrafficResetDay(e.target.value)}
                      min={1} max={31}
                      className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60 font-mono" />
                  </FieldRow>
                  <FieldRow label="Уведомить %" error={errors.notifyPercent} hint="0-100">
                    <input autoComplete="off" type="number" value={notifyPercent} onChange={e => setNotifyPercent(e.target.value)}
                      min={0} max={100}
                      className="w-full px-3 py-2 bg-slate-950/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-violet-500/60 font-mono" />
                  </FieldRow>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Step 4: Установка через SSH ────────────────────────────────────────────

function Step4({ logs, status, error, logsRef }) {
  const StatusBadge = () => {
    if (status === 'running') return (
      <div className="flex items-center gap-2 text-violet-300">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-bold">Установка идёт…</span>
      </div>
    )
    if (status === 'success') return (
      <div className="flex items-center gap-2 text-emerald-300">
        <CheckCircle2 className="w-5 h-5" />
        <span className="text-sm font-bold">Готово!</span>
      </div>
    )
    if (status === 'failed') return (
      <div className="flex items-center gap-2 text-red-300">
        <XCircle className="w-5 h-5" />
        <span className="text-sm font-bold">Ошибка установки</span>
      </div>
    )
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <StatusBadge />
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Terminal className="w-3.5 h-3.5" />
          {logs.length} строк
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      <div
        ref={logsRef}
        className="bg-slate-950 border border-slate-800 rounded-lg p-3 h-80 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 italic">Подключаюсь…</div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className={`whitespace-pre-wrap ${LOG_LEVEL_CLASS[entry.level] || 'text-slate-300'}`}>
              <span className="text-slate-600 mr-1">{fmtTs(entry.ts)}</span>
              {entry.level === 'step' && <span className="text-violet-400 mr-1">▸</span>}
              {entry.level === 'success' && <span className="text-emerald-400 mr-1">✓</span>}
              {entry.level === 'error' && <span className="text-red-400 mr-1">✗</span>}
              {entry.line}
            </div>
          ))
        )}
      </div>

      {status === 'success' && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 rounded-lg text-sm text-emerald-200">
          Нода установлена. В админке Remnawave она появится онлайн в течение ~30 секунд после первого хендшейка с панелью.
        </div>
      )}
    </div>
  )
}

const LOG_LEVEL_CLASS = {
  info:    'text-slate-300',
  warn:    'text-amber-300',
  error:   'text-red-300',
  step:    'text-violet-200',
  success: 'text-emerald-300',
}

function fmtTs(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

// ─── Универсальная обёртка для поля формы ────────────────────────────────────

function FieldRow({ label, hint, error, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-300 mb-1.5">{label}</label>
      {children}
      <div className="flex items-center justify-between mt-1 min-h-[14px]">
        <p className="text-[11px] text-red-400">{error || ''}</p>
        {hint && !error && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
    </div>
  )
}
