import React, { useEffect, useState, useMemo, useRef } from 'react'
import {
  Server, MapPin, Globe2, Cpu, MemoryStick, HardDrive, Disc3,
  Wallet, Calendar, Hash, Tag, Link2, StickyNote, Terminal,
  Eye, EyeOff, X, Pencil, Plus, CheckCircle2, Power, AlertCircle,
  Network, Bot, LayoutGrid, Box, MinusCircle,
  BarChart3, AlertTriangle, Send, Activity, RefreshCcw, ChevronDown,
  Copy, Radio, Trash2, Search, FileCode2, RotateCw, Square, Zap,
  PauseCircle, PlayCircle, History, Filter, Database, Coins, Rocket,
  ShieldCheck, Wifi, WifiOff, Shield, FileText
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

const CURRENCIES = ['RUB', 'USD', 'EUR', 'USDT']
const PROVIDERS = ['TimeWEB', 'OVH', 'Hetzner', 'Yandex Cloud', 'VK Cloud', 'Selectel', 'Play2Go', 'AdminVPS', 'Mhost', 'WarpX', 'DoubleServers', 'UFO', 'Vultr', 'Aeza', 'Другой']

function daysLeft(dateStr) {
  if (!dateStr) return null
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  return diff
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatCost(cost, currency) {
  const symbols = { RUB: '₽', USD: '$', EUR: '€', USDT: '₮' }
  const n = Number(cost) || 0
  return `${n.toLocaleString('ru-RU')} ${symbols[currency] || currency}`
}

// Полоса прогресса до истечения оплаты
function PaymentBar({ paidUntil, paidMonths }) {
  const days = daysLeft(paidUntil)
  if (days === null) return <span className="text-xs text-slate-600 italic">Дата не указана</span>
  const totalDays = (paidMonths || 1) * 30
  const elapsed = totalDays - days
  const pct = Math.max(0, Math.min(100, (elapsed / totalDays) * 100))

  let color = 'from-emerald-500 to-teal-400'
  let textColor = 'text-emerald-400'
  let label = `${days} дн. осталось`

  if (days <= 0) {
    color = 'from-red-600 to-red-400'
    textColor = 'text-red-400'
    label = 'Просрочено!'
  } else if (days <= 7) {
    color = 'from-red-500 to-orange-400'
    textColor = 'text-red-400'
    label = `${days} дн. — скоро!`
  } else if (days <= 14) {
    color = 'from-amber-500 to-yellow-400'
    textColor = 'text-amber-400'
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-500">Оплачено до: <span className="text-slate-300 font-medium">{formatDate(paidUntil)}</span></span>
        <span className={`font-bold ${textColor}`}>{label}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const emptyForm = {
  name: '', hosting_provider: '', ip_address: '', location: '',
  monthly_cost: '', currency: 'RUB', paid_months: 1, paid_until: '',
  node_uuid: '', node_name: '', notes: '', status: 'active',
  specs: { cpu: '', ram: '', disk: '', os: '' },
  ssh_user: 'root', ssh_port: 22, ssh_password: '', ssh_key: '',
  service_type: ''
}

const SERVICE_TYPES = [
  { value: '',      label: 'Не указано',      Icon: MinusCircle, color: 'slate' },
  { value: 'node',  label: 'Remnawave Нода',  Icon: Network,     color: 'teal' },
  { value: 'panel', label: 'Remnawave Panel', Icon: LayoutGrid,  color: 'violet' },
  { value: 'bot',   label: 'Telegram Бот',    Icon: Bot,         color: 'blue' },
  { value: 'other', label: 'Другое',          Icon: Box,         color: 'amber' },
]

export default function AdminVPS() {
  const [vpsList, setVpsList] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [filter, setFilter] = useState('all') // all, active, expiring, expired
  const [expandedId, setExpandedId] = useState(null)
  const [customProvider, setCustomProvider] = useState(false)
  const [sshOpen, setSshOpen] = useState(null) // vps id with SSH open
  const [sshResult, setSshResult] = useState({}) // { [vpsId]: { output, error, loading, cmd } }
  const [sshHistory, setSshHistory] = useState({}) // { [vpsId]: [{ cmd, output, time }] }
  const [renewModal, setRenewModal] = useState(null) // { vpsId, name, months: 1, note: '' }
  const [renewSaving, setRenewSaving] = useState(false)
  const [paymentHistory, setPaymentHistory] = useState({}) // { [vpsId]: [...] }
  const [historyOpen, setHistoryOpen] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [tgSending, setTgSending] = useState(false)
  const [tgResult, setTgResult] = useState(null)
  const [filterProvider, setFilterProvider] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [pingStatus, setPingStatus] = useState({}) // { [vpsId]: { alive, ms, loading } }
  const [copiedIp, setCopiedIp] = useState(null)
  const [installModal, setInstallModal] = useState(null) // { vpsId, name }
  const [installForm, setInstallForm] = useState({ projectDir: '/opt/remnanode', installDocker: true, composeContent: '' })
  const [installState, setInstallState] = useState({}) // { [vpsId]: { loading, output, error } }
  const [installProgress, setInstallProgress] = useState({}) // { [vpsId]: 0..100 }
  // Traffic Agent
  const [taState, setTaState] = useState({}) // { [vpsId]: { loading, error, message, healthOk, steps } }
  const [taManualOpen, setTaManualOpen] = useState(null) // { vpsId, name, healthMessage }
  const [taResultOpen, setTaResultOpen] = useState(null) // { vpsId, name, action, result }
  const [taHistoryOpen, setTaHistoryOpen] = useState(null) // { vpsId, name, entries, loading }
  const [panelPublicKey, setPanelPublicKey] = useState('')
  const [syncNodeState, setSyncNodeState] = useState({}) // { [vpsId]: { loading, message, error } }
  const [composeEditor, setComposeEditor] = useState(null) // { vpsId, name, path }
  const [composeContent, setComposeContent] = useState('')
  const [composeLoading, setComposeLoading] = useState(false)
  const [composeSaving, setComposeSaving] = useState(false)
  const [composeRestart, setComposeRestart] = useState(true)
  const [composeCreateMode, setComposeCreateMode] = useState(false)
  const [composeError, setComposeError] = useState(null)
  const [composeOutput, setComposeOutput] = useState('')
  const installTimersRef = useRef({})

  const token = localStorage.getItem('token')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  async function fetchData() {
    try {
      const res = await fetch(`${API}/api/admin/vps`, { headers })
      if (!res.ok) throw new Error('Ошибка загрузки')
      const data = await res.json()
      setVpsList(data.vps || [])
      setNodes(data.nodes || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // Авто-обновление каждые 30 секунд
  useEffect(() => {
    if (!autoRefresh) return
    const iv = setInterval(fetchData, 30000)
    return () => clearInterval(iv)
  }, [autoRefresh])

  useEffect(() => {
    return () => {
      Object.values(installTimersRef.current).forEach(clearInterval)
    }
  }, [])

  function openAdd() {
    setForm({ ...emptyForm })
    setEditId(null)
    setCustomProvider(false)
    setShowForm(true)
  }

  function openEdit(vps) {
    const specs = typeof vps.specs === 'string' ? JSON.parse(vps.specs) : (vps.specs || {})
    setForm({
      name: vps.name || '',
      hosting_provider: vps.hosting_provider || '',
      ip_address: vps.ip_address || '',
      location: vps.location || '',
      monthly_cost: vps.monthly_cost || '',
      currency: vps.currency || 'RUB',
      paid_months: vps.paid_months || 1,
      paid_until: vps.paid_until ? vps.paid_until.split('T')[0] : '',
      node_uuid: vps.node_uuid || '',
      node_name: vps.node_name || '',
      notes: vps.notes || '',
      status: vps.status || 'active',
      specs: { cpu: specs.cpu || '', ram: specs.ram || '', disk: specs.disk || '', os: specs.os || '' },
      ssh_user: vps.ssh_user || 'root',
      ssh_port: vps.ssh_port || 22,
      ssh_password: vps.ssh_password || '',
      ssh_key: vps.ssh_key || '',
      service_type: vps.service_type || ''
    })
    setEditId(vps.id)
    setCustomProvider(vps.hosting_provider && !PROVIDERS.filter(p => p !== 'Другой').includes(vps.hosting_provider))
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const body = { ...form, monthly_cost: Number(form.monthly_cost) || 0, paid_until: form.paid_until || null }
      const url = editId ? `${API}/api/admin/vps/${editId}` : `${API}/api/admin/vps`
      const method = editId ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) })
      if (res.ok) {
        setShowForm(false)
        setEditId(null)
        fetchData()
      }
    } catch {} finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await fetch(`${API}/api/admin/vps/${id}`, { method: 'DELETE', headers })
      setDeleteConfirm(null)
      fetchData()
    } catch {}
  }

  function setField(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  function setSpec(key, val) {
    setForm(prev => ({ ...prev, specs: { ...prev.specs, [key]: val } }))
  }

  function handleNodeLink(uuid) {
    const node = nodes.find(n => n.uuid === uuid)
    setField('node_uuid', uuid)
    setField('node_name', node ? node.name : '')
  }

  async function runSshCommand(vpsId, commandKey, commandLabel) {
    setSshResult(prev => ({ ...prev, [vpsId]: { loading: true, cmd: commandLabel } }))
    try {
      const res = await fetch(`${API}/api/admin/vps/${vpsId}/ssh`, {
        method: 'POST', headers, body: JSON.stringify({ commandKey })
      })
      const data = await res.json()
      if (res.ok) {
        setSshResult(prev => ({ ...prev, [vpsId]: { output: data.output, cmd: data.command } }))
        setSshHistory(prev => ({
          ...prev,
          [vpsId]: [...(prev[vpsId] || []), { cmd: data.command, output: data.output, time: new Date().toLocaleTimeString('ru-RU') }]
        }))
        if (data.flagsUpdated) {
          fetchData()
        }
      } else {
        setSshResult(prev => ({ ...prev, [vpsId]: { error: data.error, cmd: commandLabel } }))
      }
    } catch {
      setSshResult(prev => ({ ...prev, [vpsId]: { error: 'Ошибка сети', cmd: commandLabel } }))
    }
  }

  async function handleRenew() {
    if (!renewModal) return
    setRenewSaving(true)
    try {
      const res = await fetch(`${API}/api/admin/vps/${renewModal.vpsId}/renew`, {
        method: 'POST', headers,
        body: JSON.stringify({ months: renewModal.months, note: renewModal.note })
      })
      if (res.ok) {
        setRenewModal(null)
        fetchData()
        // Обновить историю если была открыта
        fetchHistory(renewModal.vpsId)
      }
    } catch {} finally { setRenewSaving(false) }
  }

  async function fetchHistory(vpsId) {
    try {
      const res = await fetch(`${API}/api/admin/vps/${vpsId}/history`, { headers })
      const data = await res.json()
      setPaymentHistory(prev => ({ ...prev, [vpsId]: data.history || [] }))
    } catch {}
  }

  async function fetchAnalytics() {
    try {
      const res = await fetch(`${API}/api/admin/vps/analytics`, { headers })
      const data = await res.json()
      setAnalytics(data)
    } catch {}
  }

  async function sendTelegramNotify() {
    setTgSending(true)
    setTgResult(null)
    try {
      const res = await fetch(`${API}/api/admin/vps/notify-expiring`, { method: 'POST', headers })
      const data = await res.json()
      if (res.ok) {
        setTgResult(data.sent ? `✅ Отправлено (${data.count} серверов)` : `ℹ️ ${data.message}`)
      } else {
        setTgResult(`❌ ${data.error}`)
      }
    } catch {
      setTgResult('❌ Ошибка сети')
    } finally { setTgSending(false) }
  }

  async function pingVps(vpsId) {
    setPingStatus(prev => ({ ...prev, [vpsId]: { loading: true } }))
    try {
      const res = await fetch(`${API}/api/admin/vps/ping/${vpsId}`, { method: 'POST', headers })
      const data = await res.json()
      if (res.ok) {
        setPingStatus(prev => ({ ...prev, [vpsId]: { alive: data.alive, ms: data.ms } }))
      } else {
        setPingStatus(prev => ({ ...prev, [vpsId]: { alive: false, error: data.error } }))
      }
    } catch {
      setPingStatus(prev => ({ ...prev, [vpsId]: { alive: false, error: 'Ошибка сети' } }))
    }
  }

  function copyIp(ip) {
    navigator.clipboard.writeText(ip)
    setCopiedIp(ip)
    setTimeout(() => setCopiedIp(null), 1500)
  }

  function openInstallWizard(vps) {
    setInstallModal({ vpsId: vps.id, name: vps.name })
    setInstallForm({ projectDir: '/opt/remnanode', installDocker: true, composeContent: '' })
  }

  // ─── Traffic Agent handlers ────────────────────────────────────────────────
  async function installTrafficAgent(vps) {
    if (!confirm(
      `Установить traffic-agent на «${vps.name}»?\n\n` +
      `На ноде будет:\n` +
      `• создан системный пользователь traffic-agent\n` +
      `• положен скрипт /usr/local/bin/access-log-query.sh\n` +
      `• docker-compose ноды получит volume для xray-логов (с бэкапом)\n` +
      `• нода будет ненадолго перезапущена для применения volume\n\n` +
      `Продолжить?`
    )) return

    setTaState(prev => ({ ...prev, [vps.id]: { loading: true } }))
    try {
      const res = await fetch(`${API}/api/admin/vps/${vps.id}/traffic-agent/install`, {
        method: 'POST', headers,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка установки')

      setTaState(prev => ({
        ...prev,
        [vps.id]: {
          loading: false,
          ok: data.ok,
          healthOk: data.healthOk,
          message: data.healthMessage,
          steps: data.steps,
        }
      }))

      // Перезагрузим список чтобы увидеть свежий traffic_agent_installed_at
      fetchData()

      // Всегда показываем модалку с результатом — там видны все шаги и ошибки
      setTaResultOpen({ vpsId: vps.id, name: vps.name, action: 'install', result: data })
    } catch (e) {
      setTaState(prev => ({ ...prev, [vps.id]: { loading: false, error: e.message } }))
      setTaResultOpen({
        vpsId: vps.id, name: vps.name, action: 'install',
        result: { ok: false, error: { code: 'network_error', hint: 'Не удалось связаться с backend. Проверь что бекенд запущен.' }, healthMessage: e.message },
      })
    }
  }

  async function openTrafficAgentHistory(vps) {
    setTaHistoryOpen({ vpsId: vps.id, name: vps.name, entries: [], loading: true })
    try {
      const res = await fetch(`${API}/api/admin/vps/${vps.id}/traffic-agent/log?limit=20`, { headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      setTaHistoryOpen(prev => prev && prev.vpsId === vps.id
        ? { ...prev, entries: data.entries || [], loading: false }
        : prev
      )
    } catch (e) {
      setTaHistoryOpen(prev => prev && prev.vpsId === vps.id
        ? { ...prev, entries: [], loading: false, error: e.message }
        : prev
      )
    }
  }

  async function checkTrafficAgent(vpsId) {
    setTaState(prev => ({ ...prev, [vpsId]: { ...(prev[vpsId] || {}), loading: true } }))
    try {
      const res = await fetch(`${API}/api/admin/vps/${vpsId}/traffic-agent/check`, {
        method: 'POST', headers,
      })
      const data = await res.json()
      setTaState(prev => ({
        ...prev,
        [vpsId]: { loading: false, healthOk: data.ok, message: data.message }
      }))
      fetchData()
    } catch (e) {
      setTaState(prev => ({ ...prev, [vpsId]: { loading: false, error: e.message } }))
    }
  }

  async function uninstallTrafficAgent(vps) {
    if (!confirm(`Удалить traffic-agent с «${vps.name}»? На ноде будут удалены пользователь traffic-agent, его SSH-ключи и agent-скрипт.`)) return
    setTaState(prev => ({ ...prev, [vps.id]: { loading: true } }))
    try {
      const res = await fetch(`${API}/api/admin/vps/${vps.id}/traffic-agent`, {
        method: 'DELETE', headers,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка удаления')
      setTaState(prev => {
        const next = { ...prev }
        delete next[vps.id]
        return next
      })
      fetchData()
    } catch (e) {
      setTaState(prev => ({ ...prev, [vps.id]: { loading: false, error: e.message } }))
    }
  }

  async function loadPanelKey() {
    if (panelPublicKey) return panelPublicKey
    try {
      const res = await fetch(`${API}/api/admin/vps/traffic-agent/public-key`, { headers })
      const data = await res.json()
      if (res.ok && data.publicKey) {
        setPanelPublicKey(data.publicKey)
        return data.publicKey
      }
    } catch {}
    return ''
  }

  function startInstallProgress(vpsId) {
    if (installTimersRef.current[vpsId]) clearInterval(installTimersRef.current[vpsId])
    setInstallProgress(prev => ({ ...prev, [vpsId]: 8 }))
    installTimersRef.current[vpsId] = setInterval(() => {
      setInstallProgress(prev => {
        const current = prev[vpsId] || 8
        const step = current < 40 ? 8 : current < 70 ? 5 : 2
        const next = Math.min(92, current + step)
        return { ...prev, [vpsId]: next }
      })
    }, 1200)
  }

  function finishInstallProgress(vpsId) {
    if (installTimersRef.current[vpsId]) {
      clearInterval(installTimersRef.current[vpsId])
      delete installTimersRef.current[vpsId]
    }
    setInstallProgress(prev => ({ ...prev, [vpsId]: 100 }))
    setTimeout(() => {
      setInstallProgress(prev => {
        const next = { ...prev }
        delete next[vpsId]
        return next
      })
    }, 1200)
  }

  async function runInstallRemnaNode() {
    if (!installModal) return
    if (!installForm.composeContent.trim()) return

    const vpsId = installModal.vpsId
    setInstallState(prev => ({ ...prev, [vpsId]: { loading: true } }))
    startInstallProgress(vpsId)

    try {
      const res = await fetch(`${API}/api/admin/vps/${vpsId}/install-remnanode`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectDir: installForm.projectDir,
          installDocker: installForm.installDocker,
          composeContent: installForm.composeContent,
        })
      })
      const data = await res.json()
      if (res.ok) {
        // Fallback: дополнительно фиксируем тип сервиса как node через PATCH,
        // даже если backend-обновление статуса по каким-то причинам не сработало.
        await fetch(`${API}/api/admin/vps/${vpsId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ service_type: 'node' })
        })

        setInstallState(prev => ({
          ...prev,
          [vpsId]: {
            loading: false,
            output: `${data.output || ''}\n\n${data.nextStep ? `NEXT: ${data.nextStep}` : ''}`.trim(),
            error: null,
          }
        }))
        finishInstallProgress(vpsId)
        fetchData()
        setInstallModal(null)
      } else {
        setInstallState(prev => ({ ...prev, [vpsId]: { loading: false, error: data.error || 'Ошибка установки' } }))
        finishInstallProgress(vpsId)
      }
    } catch {
      setInstallState(prev => ({ ...prev, [vpsId]: { loading: false, error: 'Ошибка сети' } }))
      finishInstallProgress(vpsId)
    }
  }

  async function syncNodeStatus(vpsId) {
    setSyncNodeState(prev => ({ ...prev, [vpsId]: { loading: true } }))
    try {
      const res = await fetch(`${API}/api/admin/vps/${vpsId}/sync-node-status`, {
        method: 'POST',
        headers,
      })
      const data = await res.json()
      if (res.ok) {
        setSyncNodeState(prev => ({
          ...prev,
          [vpsId]: {
            loading: false,
            message: `✅ Нода подтверждена (${data.detectedPath})`,
            error: null,
          }
        }))
        fetchData()
      } else {
        setSyncNodeState(prev => ({
          ...prev,
          [vpsId]: {
            loading: false,
            message: null,
            error: data.error || 'Нода не найдена',
          }
        }))
      }
    } catch {
      setSyncNodeState(prev => ({
        ...prev,
        [vpsId]: {
          loading: false,
          message: null,
          error: 'Ошибка сети при проверке ноды',
        }
      }))
    }
  }

  async function openComposeEditor(vps) {
    setComposeEditor({ vpsId: vps.id, name: vps.name, path: '' })
    setComposeContent('')
    setComposeOutput('')
    setComposeError(null)
    setComposeCreateMode(false)
    setComposeLoading(true)

    try {
      const res = await fetch(`${API}/api/admin/vps/${vps.id}/node-compose`, { headers })
      const data = await res.json()
      if (!res.ok) {
        const details = [
          data.error || 'Ошибка загрузки docker-compose.yml',
          data.attemptedPath ? `Путь: ${data.attemptedPath}` : null,
          data.output ? `Детали: ${data.output}` : null,
        ].filter(Boolean).join('\n')
        setComposeError(details)
        return
      }
      setComposeEditor(prev => ({ ...prev, path: data.path || '' }))
      setComposeContent(data.content || '')
      setComposeCreateMode(!!data.createMode)
    } catch {
      setComposeError('Ошибка сети при загрузке docker-compose.yml')
    } finally {
      setComposeLoading(false)
    }
  }

  async function saveComposeEditor() {
    if (!composeEditor) return
    if (!composeContent.trim()) {
      setComposeError('Файл не может быть пустым')
      return
    }
    setComposeSaving(true)
    setComposeError(null)
    setComposeOutput('')
    try {
      const res = await fetch(`${API}/api/admin/vps/${composeEditor.vpsId}/node-compose`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          composeContent,
          restart: composeRestart,
          ...(composeCreateMode ? { targetPath: composeEditor.path } : {}),
        })
      })
      const data = await res.json()
      if (!res.ok) {
        const details = [
          data.error || 'Ошибка сохранения docker-compose.yml',
          data.attemptedPath ? `Путь: ${data.attemptedPath}` : null,
          data.output ? `Детали: ${data.output}` : null,
        ].filter(Boolean).join('\n')
        setComposeError(details)
        return
      }
      setComposeOutput(data.output || 'Обновлено')
      fetchData()
    } catch {
      setComposeError('Ошибка сети при сохранении')
    } finally {
      setComposeSaving(false)
    }
  }

  const filtered = useMemo(() => {
    let list = vpsList
    // По статусу оплаты
    if (filter === 'active') list = list.filter(v => { const d = daysLeft(v.paid_until); return d === null || d > 14 })
    if (filter === 'expiring') list = list.filter(v => { const d = daysLeft(v.paid_until); return d !== null && d > 0 && d <= 14 })
    if (filter === 'expired') list = list.filter(v => { const d = daysLeft(v.paid_until); return d !== null && d <= 0 })
    // По провайдеру
    if (filterProvider !== 'all') list = list.filter(v => v.hosting_provider === filterProvider)
    // По типу сервиса
    if (filterType !== 'all') list = list.filter(v => (v.service_type || '') === filterType)
    return list
  }, [vpsList, filter, filterProvider, filterType])

  // Мультивалютная статистика
  const costByCurrency = useMemo(() => {
    const map = {}
    vpsList.forEach(v => {
      const c = v.currency || 'RUB'
      map[c] = (map[c] || 0) + (Number(v.monthly_cost) || 0)
    })
    return Object.entries(map).filter(([, v]) => v > 0)
  }, [vpsList])

  const uniqueProviders = useMemo(() => [...new Set(vpsList.map(v => v.hosting_provider).filter(Boolean))].sort(), [vpsList])

  const totalMonthlyCost = vpsList.reduce((s, v) => s + (Number(v.monthly_cost) || 0), 0)
  const expiringCount = vpsList.filter(v => { const d = daysLeft(v.paid_until); return d !== null && d > 0 && d <= 14 }).length
  const expiredCount = vpsList.filter(v => { const d = daysLeft(v.paid_until); return d !== null && d <= 0 }).length
  const alertServers = vpsList.filter(v => { const d = daysLeft(v.paid_until); return d !== null && d <= 7 && d >= -3 })
  const linkedCount = vpsList.filter(v => v.node_uuid).length
  const serviceCount = {
    node: vpsList.filter(v => v.service_type === 'node').length,
    panel: vpsList.filter(v => v.service_type === 'panel').length,
    bot: vpsList.filter(v => v.service_type === 'bot').length,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Загрузка...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ===== Page Header ===== */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-700/50 bg-gradient-to-br from-violet-500/10 via-slate-900/60 to-slate-900/80 p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 w-48 h-48 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
            <Database className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl sm:text-2xl font-bold text-white">Управление VPS</h3>
            <p className="text-sm text-slate-400 mt-1">Учёт арендованных серверов и привязка нод RemnaWave</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? 'Выключить авто-обновление' : 'Включить авто-обновление каждые 30с'}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all border ${
                autoRefresh ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-500/10' : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-emerald-500/40'
              }`}>
              {autoRefresh ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
              <span className="hidden sm:inline">Авто</span>
            </button>
            <button onClick={() => { setShowAnalytics(!showAnalytics); if (!analytics) fetchAnalytics() }}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border ${
                showAnalytics ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-lg shadow-amber-500/10' : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-amber-500/40'
              }`}>
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">Аналитика</span>
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 transition-all active:scale-95">
              <Plus className="w-4 h-4" />
              Добавить VPS
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/40 rounded-2xl text-red-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Alert banner — expiring servers */}
      {alertServers.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-red-500/10 p-5">
          <div className="absolute -left-4 -top-4 w-24 h-24 bg-amber-500/20 rounded-full blur-2xl pointer-events-none" />
          <div className="relative flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <div className="text-amber-300 font-bold text-sm">
                    {alertServers.length} {alertServers.length === 1 ? 'сервер истекает' : alertServers.length < 5 ? 'сервера истекают' : 'серверов истекают'} в ближайшие 7 дней
                  </div>
                  <div className="text-[11px] text-amber-200/70">Не забудьте продлить аренду</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {alertServers.map(v => {
                  const d = daysLeft(v.paid_until)
                  return (
                    <span key={v.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                      d <= 0 ? 'bg-red-500/15 border-red-500/30 text-red-300'
                        : d <= 3 ? 'bg-orange-500/15 border-orange-500/30 text-orange-300'
                        : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${d <= 0 ? 'bg-red-400' : d <= 3 ? 'bg-orange-400' : 'bg-amber-400'} animate-pulse`} />
                      {v.name} — {d <= 0 ? 'просрочен' : `${d} дн.`}
                    </span>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={sendTelegramNotify} disabled={tgSending}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-500/15 border border-blue-500/40 hover:bg-blue-500/25 rounded-xl text-xs font-bold text-blue-300 transition-all disabled:opacity-50">
                {tgSending ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {tgSending ? 'Отправка...' : 'Уведомить в Telegram'}
              </button>
              {tgResult && <span className="text-[10px] text-center text-slate-400">{tgResult}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ===== Stats strip ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          Icon={Database}
          label="Всего VPS"
          value={vpsList.length}
          accent="slate"
        />
        <StatCard
          Icon={Coins}
          label="Расход / мес"
          accent="violet"
          renderValue={() => (
            <div className="space-y-0.5">
              {costByCurrency.length === 0 && <div className="text-lg font-bold text-slate-500">0</div>}
              {costByCurrency.map(([cur, total]) => (
                <div key={cur} className="text-sm font-bold text-violet-300 leading-tight">{formatCost(total, cur)}</div>
              ))}
            </div>
          )}
        />
        <StatCard
          Icon={AlertTriangle}
          label="Истекают"
          value={expiringCount}
          accent={expiringCount > 0 ? 'amber' : 'slate'}
          subtitle={expiredCount > 0 ? `${expiredCount} уже просрочено` : undefined}
        />
        <StatCard
          Icon={Activity}
          label="Сервисы"
          accent="teal"
          renderValue={() => (
            <div className="flex items-center gap-2.5 text-sm">
              <span className="flex items-center gap-1 text-teal-300 font-bold" title="Remnawave Ноды">
                <Network className="w-3.5 h-3.5" /> {serviceCount.node}
              </span>
              <span className="flex items-center gap-1 text-violet-300 font-bold" title="Панели">
                <LayoutGrid className="w-3.5 h-3.5" /> {serviceCount.panel}
              </span>
              <span className="flex items-center gap-1 text-blue-300 font-bold" title="Telegram Боты">
                <Bot className="w-3.5 h-3.5" /> {serviceCount.bot}
              </span>
            </div>
          )}
        />
      </div>

      {/* Analytics section */}
      {showAnalytics && analytics && (
        <div className="p-5 bg-gradient-to-br from-slate-800/60 via-slate-900/60 to-slate-900/80 border border-slate-700/40 rounded-2xl space-y-5">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-400" /> Аналитика расходов
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* By Provider */}
            <div>
              <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">По провайдерам</h5>
              <div className="space-y-2">
                {analytics.byProvider.length === 0 && <span className="text-xs text-slate-600">Нет данных</span>}
                {(() => {
                  const maxVal = Math.max(...analytics.byProvider.map(p => p.total), 1)
                  return analytics.byProvider.map((p, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400 font-medium truncate">{p.provider || 'Без провайдера'}</span>
                        <span className="text-violet-400 font-bold shrink-0 ml-2">{formatCost(p.total, p.currency)}</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all" style={{ width: `${(p.total / maxVal) * 100}%` }} />
                      </div>
                      <div className="text-[10px] text-slate-600 mt-0.5">{p.count} серв.</div>
                    </div>
                  ))
                })()}
              </div>
            </div>

            {/* By Currency */}
            <div>
              <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">По валютам</h5>
              <div className="space-y-2">
                {analytics.byCurrency.length === 0 && <span className="text-xs text-slate-600">Нет данных</span>}
                {(() => {
                  const maxVal = Math.max(...analytics.byCurrency.map(c => c.total), 1)
                  const colors = { RUB: 'from-emerald-500 to-teal-500', USD: 'from-blue-500 to-cyan-500', EUR: 'from-amber-500 to-yellow-500', USDT: 'from-green-500 to-lime-500' }
                  return analytics.byCurrency.map((c, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400 font-medium">{c.currency}</span>
                        <span className="text-teal-400 font-bold">{formatCost(c.total, c.currency)}</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full bg-gradient-to-r ${colors[c.currency] || 'from-slate-500 to-slate-400'} rounded-full transition-all`} style={{ width: `${(c.total / maxVal) * 100}%` }} />
                      </div>
                      <div className="text-[10px] text-slate-600 mt-0.5">{c.count} серв.</div>
                    </div>
                  ))
                })()}
              </div>
            </div>

            {/* By Month */}
            <div>
              <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">По месяцам (оплаты)</h5>
              <div className="space-y-2">
                {(!analytics.byMonth || analytics.byMonth.length === 0) && <span className="text-xs text-slate-600">Нет истории оплат</span>}
                {(() => {
                  const maxVal = Math.max(...(analytics.byMonth || []).map(m => m.total), 1)
                  return (analytics.byMonth || []).map((m, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400 font-medium">{m.month}</span>
                        <span className="text-amber-400 font-bold">{formatCost(m.total, m.currency)}</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all" style={{ width: `${(m.total / maxVal) * 100}%` }} />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            </div>
          </div>

          {/* Total TCO */}
          <div className="flex items-center gap-4 pt-3 border-t border-slate-700/40">
            <span className="text-xs text-slate-500">Общая стоимость владения (активные, /мес):</span>
            <span className="text-lg font-bold text-violet-400">{formatCost(totalMonthlyCost, 'RUB')}</span>
            <span className="text-xs text-slate-600">≈ {formatCost(totalMonthlyCost * 12, 'RUB')} / год</span>
          </div>
        </div>
      )}

      {/* ===== Filters ===== */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-900/40 border border-slate-700/40 rounded-2xl">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-1 pl-1.5">
          <Filter className="w-3.5 h-3.5" />
          Фильтр:
        </div>
        {[
          { v: 'all',      l: 'Все',         dot: 'bg-slate-500' },
          { v: 'active',   l: 'Оплачены',    dot: 'bg-emerald-400' },
          { v: 'expiring', l: 'Истекают',    dot: 'bg-amber-400' },
          { v: 'expired',  l: 'Просрочены',  dot: 'bg-red-400' },
        ].map(f => (
          <button key={f.v} onClick={() => setFilter(f.v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              filter === f.v
                ? 'bg-violet-500/20 border-violet-500/50 text-violet-200 shadow-md shadow-violet-500/10'
                : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-200'
            }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />
            {f.l}
          </button>
        ))}

        <span className="w-px h-5 bg-slate-700/60 mx-1" />

        {/* Provider filter */}
        <select value={filterProvider} onChange={e => setFilterProvider(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/60 border border-slate-700/50 text-slate-300 focus:outline-none focus:border-violet-500/50 cursor-pointer">
          <option value="all">Все провайдеры</option>
          {uniqueProviders.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {/* Service type filter */}
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/60 border border-slate-700/50 text-slate-300 focus:outline-none focus:border-violet-500/50 cursor-pointer">
          <option value="all">Все типы</option>
          {SERVICE_TYPES.filter(s => s.value).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <span className="ml-auto text-xs text-slate-500">
          Найдено: <span className="text-slate-300 font-semibold">{filtered.length}</span>
          {filtered.length !== vpsList.length && <span className="text-slate-600"> из {vpsList.length}</span>}
        </span>
      </div>

      {/* ===== VPS Cards ===== */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center mb-4">
              <Database className="w-7 h-7 text-slate-600" />
            </div>
            <p className="text-slate-400 font-medium">
              {vpsList.length === 0 ? 'Пока нет ни одного VPS' : 'Нет VPS по выбранному фильтру'}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              {vpsList.length === 0 ? 'Нажмите кнопку «Добавить VPS» чтобы начать' : 'Попробуйте сбросить фильтры'}
            </p>
            {vpsList.length === 0 && (
              <button onClick={openAdd}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-violet-500/30 transition-all">
                <Plus className="w-4 h-4" /> Добавить первый VPS
              </button>
            )}
          </div>
        )}

        {filtered.map(vps => {
          const days = daysLeft(vps.paid_until)
          const isExpanded = expandedId === vps.id
          const specs = typeof vps.specs === 'string' ? JSON.parse(vps.specs) : (vps.specs || {})
          const linkedNode = vps.node_uuid ? nodes.find(n => n.uuid === vps.node_uuid) : null

          // Цветной акцент-бар слева в зависимости от срока
          let accentBar = 'bg-slate-700'
          let borderAccent = 'border-slate-700/40'
          if (days !== null && days <= 0) { accentBar = 'bg-gradient-to-b from-red-500 to-rose-600'; borderAccent = 'border-red-500/30' }
          else if (days !== null && days <= 7) { accentBar = 'bg-gradient-to-b from-amber-400 to-orange-500'; borderAccent = 'border-amber-500/30' }
          else if (days !== null && days <= 14) { accentBar = 'bg-gradient-to-b from-yellow-400 to-amber-500'; borderAccent = 'border-yellow-500/25' }
          else if (days !== null) { accentBar = 'bg-gradient-to-b from-emerald-400 to-teal-500'; borderAccent = 'border-emerald-500/20' }

          // Иконка и цвет под service_type
          const st = SERVICE_TYPES.find(s => s.value === (vps.service_type || ''))
          const stColorMap = {
            teal:   { wrap: 'bg-teal-500/10 border-teal-500/30 text-teal-300',     icon: 'bg-teal-500/15 text-teal-300' },
            violet: { wrap: 'bg-violet-500/10 border-violet-500/30 text-violet-300', icon: 'bg-violet-500/15 text-violet-300' },
            blue:   { wrap: 'bg-blue-500/10 border-blue-500/30 text-blue-300',     icon: 'bg-blue-500/15 text-blue-300' },
            amber:  { wrap: 'bg-amber-500/10 border-amber-500/30 text-amber-300', icon: 'bg-amber-500/15 text-amber-300' },
            slate:  { wrap: 'bg-slate-500/10 border-slate-500/30 text-slate-300', icon: 'bg-slate-700 text-slate-400' },
          }
          const stColor = stColorMap[st?.color || 'slate'] || stColorMap.slate
          const StIcon = st?.Icon || Server

          return (
            <div key={vps.id} className={`group relative border ${borderAccent} rounded-2xl bg-gradient-to-br from-slate-800/50 via-slate-900/60 to-slate-900/80 overflow-hidden transition-all hover:border-slate-600/60 hover:shadow-xl hover:shadow-violet-500/5`}>
              {/* Левая цветная полоса-индикатор */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBar}`} />

              {/* Card header — always visible */}
              <div className="pl-5 pr-4 sm:pl-6 sm:pr-5 py-4 sm:py-5 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : vps.id)}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Avatar + info */}
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${stColor.icon}`}>
                    <StIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-lg font-bold text-white truncate">{vps.name}</h4>
                      {vps.hosting_provider && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-violet-500/15 border border-violet-500/30 rounded-full text-[11px] font-semibold text-violet-300">
                          <Globe2 className="w-3 h-3" /> {vps.hosting_provider}
                        </span>
                      )}
                      {vps.status === 'inactive' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-700/80 border border-slate-600/50 rounded-full text-[11px] text-slate-400">
                          <PauseCircle className="w-3 h-3" /> Неактивен
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
                      {vps.ip_address && (
                        <span className="inline-flex items-center gap-1">
                          <Hash className="w-3 h-3 text-slate-600" />
                          <span className="font-mono text-slate-300">{vps.ip_address}</span>
                          <button onClick={(e) => { e.stopPropagation(); copyIp(vps.ip_address) }}
                            className="ml-0.5 p-1 rounded bg-slate-800/80 hover:bg-violet-500/20 border border-slate-700/50 hover:border-violet-500/40 text-slate-500 hover:text-violet-300 transition-all"
                            title="Скопировать IP">
                            {copiedIp === vps.ip_address ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); pingVps(vps.id) }}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold transition-all ${
                              pingStatus[vps.id]?.loading ? 'bg-blue-500/10 border-blue-500/30 text-blue-300 animate-pulse'
                              : pingStatus[vps.id]?.alive === true ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : pingStatus[vps.id]?.alive === false ? 'bg-red-500/10 border-red-500/30 text-red-300'
                              : 'bg-slate-800/80 border-slate-700/50 text-slate-400 hover:border-blue-500/40 hover:text-blue-300'
                            }`}
                            title="Проверить доступность">
                            {pingStatus[vps.id]?.loading ? <RefreshCcw className="w-3 h-3 animate-spin" />
                              : pingStatus[vps.id]?.alive === true ? <><Wifi className="w-3 h-3" /> {pingStatus[vps.id].ms}ms</>
                              : pingStatus[vps.id]?.alive === false ? <><WifiOff className="w-3 h-3" /> offline</>
                              : <Radio className="w-3 h-3" />}
                          </button>
                        </span>
                      )}
                      {vps.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-600" /> {vps.location}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 font-bold text-violet-300">
                        <Wallet className="w-3 h-3" /> {formatCost(vps.monthly_cost, vps.currency)}/мес
                      </span>
                    </div>

                    {/* Payment bar */}
                    <PaymentBar paidUntil={vps.paid_until} paidMonths={vps.paid_months} />
                  </div>

                  {/* Right: service type + expand */}
                  <div className="flex items-center gap-3 shrink-0">
                    {st && st.value ? (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs border ${stColor.wrap}`}>
                        <StIcon className="w-4 h-4 shrink-0" />
                        <div>
                          <div className="font-bold leading-tight">{st.label}</div>
                          {vps.service_type === 'node' && linkedNode && (
                            <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${linkedNode.isConnected ? 'bg-teal-400 animate-pulse' : 'bg-slate-600'}`} />
                              {linkedNode.name} · {linkedNode.isConnected ? 'Онлайн' : 'Офф'}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600 italic">Сервис не указан</span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-slate-700/40 p-4 sm:p-5 bg-slate-950/30 space-y-5 animate-in fade-in slide-in-from-top-2 duration-200">
                  {/* Specs grid */}
                  {(specs.cpu || specs.ram || specs.disk || specs.os) && (
                    <SectionTitle Icon={Cpu} title="Характеристики" accent="emerald">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {specs.cpu && <SpecBadge Icon={Cpu} label="CPU" value={specs.cpu} />}
                        {specs.ram && <SpecBadge Icon={MemoryStick} label="RAM" value={specs.ram} />}
                        {specs.disk && <SpecBadge Icon={HardDrive} label="Диск" value={specs.disk} />}
                        {specs.os && <SpecBadge Icon={Disc3} label="ОС" value={specs.os} />}
                      </div>
                    </SectionTitle>
                  )}

                  {/* Payment details */}
                  <SectionTitle Icon={Wallet} title="Оплата" accent="amber">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <SpecBadge Icon={Wallet} label="Стоимость" value={formatCost(vps.monthly_cost, vps.currency)} />
                      <SpecBadge Icon={Calendar} label="Куплено мес." value={vps.paid_months || '—'} />
                      <SpecBadge Icon={Calendar} label="Оплачено до" value={formatDate(vps.paid_until)} />
                    </div>
                  </SectionTitle>

                  <SectionTitle Icon={ShieldCheck} title="Сетевые статусы" accent="blue">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <SpecBadge
                        Icon={Rocket}
                        label="BBR"
                        value={vps.bbr_enabled === true ? 'Включен' : vps.bbr_enabled === false ? 'Выключен' : 'Неизвестно'}
                        valueColor={vps.bbr_enabled === true ? 'text-emerald-300' : vps.bbr_enabled === false ? 'text-amber-300' : undefined}
                      />
                      <SpecBadge
                        Icon={Globe2}
                        label="IPv6"
                        value={vps.ipv6_disabled === true ? 'Выключен' : vps.ipv6_disabled === false ? 'Включен' : 'Неизвестно'}
                        valueColor={vps.ipv6_disabled === true ? 'text-emerald-300' : undefined}
                      />
                      <SpecBadge
                        Icon={ShieldCheck}
                        label="Порты"
                        value={vps.firewall_ssh_only === true ? 'Только 22 открыт' : vps.firewall_ssh_only === false ? 'Не ограничены' : 'Неизвестно'}
                        valueColor={vps.firewall_ssh_only === true ? 'text-emerald-300' : undefined}
                      />
                    </div>
                  </SectionTitle>

                  {/* Linked node info (only for node service type) */}
                  {vps.service_type === 'node' && linkedNode && (
                    <SectionTitle Icon={Network} title="Привязанная нода" accent="teal">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <SpecBadge Icon={Tag} label="Имя" value={linkedNode.name} />
                        <SpecBadge Icon={Globe2} label="Адрес" value={linkedNode.address || '—'} />
                        <SpecBadge Icon={Activity} label="Онлайн" value={linkedNode.usersOnline || 0} />
                        <SpecBadge Icon={Zap} label="Xray" value={linkedNode.xrayVersion || '—'} />
                      </div>
                    </SectionTitle>
                  )}

                  {/* Notes */}
                  {vps.notes && (
                    <SectionTitle Icon={StickyNote} title="Заметки" accent="violet">
                      <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-900/60 rounded-xl p-3 border border-slate-700/40">{vps.notes}</p>
                    </SectionTitle>
                  )}

                  {/* SSH Terminal */}
                  {vps.ip_address && (vps.ssh_password || vps.ssh_key) && (
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setSshOpen(sshOpen === vps.id ? null : vps.id) }}
                          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                            sshOpen === vps.id
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-md shadow-emerald-500/10'
                              : 'bg-slate-800/60 border-slate-700/50 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300'
                          }`}>
                          <Terminal className="w-3.5 h-3.5" />
                          {sshOpen === vps.id ? 'Скрыть SSH-терминал' : 'SSH-терминал'}
                        </button>
                        {vps.service_type === 'node' && (
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border bg-emerald-500/10 border-emerald-500/25 text-emerald-300/80 cursor-not-allowed opacity-85"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Нода установлена
                          </button>
                        )}
                        {vps.service_type === 'node' && (
                          <TrafficAgentButton
                            vps={vps}
                            state={taState[vps.id]}
                            onInstall={(e) => { e.stopPropagation(); installTrafficAgent(vps) }}
                            onCheck={(e) => { e.stopPropagation(); checkTrafficAgent(vps.id) }}
                            onUninstall={(e) => { e.stopPropagation(); uninstallTrafficAgent(vps) }}
                            onHistory={(e) => { e.stopPropagation(); openTrafficAgentHistory(vps) }}
                            onShowManual={async (e) => {
                              e.stopPropagation()
                              await loadPanelKey()
                              setTaManualOpen({ vpsId: vps.id, name: vps.name, healthMessage: vps.traffic_agent_last_health })
                            }}
                          />
                        )}
                        {(vps.service_type === '' || vps.service_type === 'other') && (
                          <button onClick={(e) => { e.stopPropagation(); openInstallWizard(vps) }}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20">
                            <Rocket className="w-3.5 h-3.5" /> Установить RemnaWave Node
                          </button>
                        )}
                      </div>

                      {sshOpen === vps.id && (
                        <div className="mt-3 rounded-xl border border-emerald-500/20 overflow-hidden">
                          {/* Terminal header */}
                          <div className="bg-slate-950 px-4 py-2.5 flex items-center gap-2 border-b border-slate-800">
                            <div className="flex gap-1.5">
                              <span className="w-3 h-3 rounded-full bg-red-500/80" />
                              <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
                              <span className="w-3 h-3 rounded-full bg-green-500/80" />
                            </div>
                            <span className="text-xs font-mono text-slate-500 ml-2">{vps.ssh_user || 'root'}@{vps.ip_address}:{vps.ssh_port || 22}</span>
                          </div>

                          {/* Command buttons */}
                          <div className="bg-slate-950/80 px-4 py-3 border-b border-slate-800/50">
                            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Доступные команды</div>
                            <div className="flex flex-wrap gap-1.5">
                              {vps.service_type === 'node' ? (
                                <>
                                  <SshBtn Icon={Activity} label="Статус BBR/IPv6" onClick={() => runSshCommand(vps.id, 'runtime-status', 'Статус BBR/IPv6')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Rocket} label="Включить BBR" onClick={() => runSshCommand(vps.id, 'enable-bbr', 'Включение BBR')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Globe2} label="Отключить IPv6" onClick={() => runSshCommand(vps.id, 'disable-ipv6', 'Отключение IPv6')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={ShieldCheck} label="Статус ноды" onClick={() => runSshCommand(vps.id, 'node-status', 'Статус RemnaWave Node')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={FileCode2} label="docker-compose.yml" onClick={() => openComposeEditor(vps)} loading={composeLoading && composeEditor?.vpsId === vps.id} />
                                  <SshBtn Icon={PlayCircle} label="Старт ноды" onClick={() => runSshCommand(vps.id, 'node-start', 'Запуск RemnaWave Node')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Square} label="Стоп ноды" onClick={() => runSshCommand(vps.id, 'node-stop', 'Остановка RemnaWave Node')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={RotateCw} label="Рестарт ноды" onClick={() => runSshCommand(vps.id, 'node-restart', 'Перезапуск RemnaWave Node')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={RefreshCcw} label="Перезапуск сервера" onClick={() => runSshCommand(vps.id, 'server-reboot', 'Перезапуск сервера')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Box} label="Docker" onClick={() => runSshCommand(vps.id, 'docker-ps', 'Docker контейнеры')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Server} label="Система" onClick={() => runSshCommand(vps.id, 'system-info', 'Информация о системе')} loading={sshResult[vps.id]?.loading} />
                                </>
                              ) : (
                                <>
                                  <SshBtn Icon={Server} label="Система" onClick={() => runSshCommand(vps.id, 'system-info', 'Информация о системе')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Box} label="Docker" onClick={() => runSshCommand(vps.id, 'docker-ps', 'Docker контейнеры')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Activity} label="Статус BBR/IPv6" onClick={() => runSshCommand(vps.id, 'runtime-status', 'Статус BBR/IPv6')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Rocket} label="Включить BBR" onClick={() => runSshCommand(vps.id, 'enable-bbr', 'Включение BBR')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={Globe2} label="Отключить IPv6" onClick={() => runSshCommand(vps.id, 'disable-ipv6', 'Отключение IPv6')} loading={sshResult[vps.id]?.loading} />
                                  <SshBtn Icon={ShieldCheck} label="Закрыть порты кроме 22" onClick={() => runSshCommand(vps.id, 'close-ports-ssh-only', 'Закрытие портов кроме 22')} loading={sshResult[vps.id]?.loading} />
                                </>
                              )}
                            </div>
                          </div>

                          {/* Output area */}
                          <div className="bg-[#0d1117] min-h-[120px] max-h-[400px] overflow-y-auto">
                            {sshResult[vps.id]?.loading ? (
                              <div className="flex items-center gap-2 px-4 py-6 text-emerald-400 text-sm font-mono">
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Выполняется: {sshResult[vps.id]?.cmd}...
                              </div>
                            ) : sshResult[vps.id]?.error ? (
                              <div className="px-4 py-4">
                                <div className="text-xs text-red-500 font-mono mb-1">$ {sshResult[vps.id]?.cmd}</div>
                                <div className="flex items-start gap-2 text-red-400 text-sm font-mono">
                                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                  {sshResult[vps.id].error}
                                </div>
                              </div>
                            ) : sshResult[vps.id]?.output ? (
                              <div className="px-4 py-4">
                                <div className="text-xs text-emerald-600 font-mono mb-2">$ {sshResult[vps.id]?.cmd}</div>
                                <pre className="text-sm text-emerald-300 font-mono whitespace-pre-wrap break-all leading-relaxed">{sshResult[vps.id].output}</pre>
                              </div>
                            ) : (
                              <div className="px-4 py-6 text-slate-600 text-sm font-mono">
                                <span className="text-emerald-700">$</span> Выберите команду выше для выполнения на сервере
                              </div>
                            )}
                          </div>

                          {/* History */}
                          {sshHistory[vps.id]?.length > 0 && (
                            <div className="bg-slate-950/50 border-t border-slate-800/50 px-4 py-2">
                              <details className="group">
                                <summary className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider cursor-pointer hover:text-slate-400 transition-colors">
                                  <History className="w-3 h-3" /> История ({sshHistory[vps.id].length})
                                </summary>
                                <div className="mt-2 max-h-60 overflow-y-auto space-y-2">
                                  {[...sshHistory[vps.id]].reverse().map((h, i) => (
                                    <div key={i} className="bg-[#0d1117] rounded-lg p-2.5 border border-slate-800/50">
                                      <div className="flex justify-between text-[10px] font-mono mb-1">
                                        <span className="text-emerald-600">$ {h.cmd}</span>
                                        <span className="text-slate-700">{h.time}</span>
                                      </div>
                                      <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">{h.output}</pre>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </div>
                          )}

                          {(installState[vps.id]?.output || installState[vps.id]?.error || installState[vps.id]?.loading) && (
                            <div className="bg-slate-950/50 border-t border-slate-800/50 px-4 py-3">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                                <Rocket className="w-3 h-3" /> RemnaWave Node Install
                              </div>
                              {installState[vps.id]?.loading ? (
                                <div className="flex items-center gap-1.5 text-xs text-cyan-300 font-mono">
                                  <RefreshCcw className="w-3 h-3 animate-spin" /> Выполняется установка...
                                </div>
                              ) : installState[vps.id]?.error ? (
                                <div className="flex items-start gap-1.5 text-xs text-red-400 font-mono">
                                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {installState[vps.id].error}
                                </div>
                              ) : (
                                <pre className="text-xs text-cyan-200 font-mono whitespace-pre-wrap break-all max-h-52 overflow-y-auto">{installState[vps.id]?.output}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SSH not configured notice */}
                  {vps.ip_address && !vps.ssh_password && !vps.ssh_key && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-200/80">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      SSH не настроен — укажите пароль или ключ в настройках VPS
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-800/50">
                    {vps.service_type !== 'node' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); syncNodeStatus(vps.id) }}
                        disabled={syncNodeState[vps.id]?.loading}
                        className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 rounded-xl text-xs font-bold text-cyan-300 transition-all disabled:opacity-50"
                      >
                        {syncNodeState[vps.id]?.loading ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        {syncNodeState[vps.id]?.loading ? 'Проверка...' : 'Проверить Node на сервере'}
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setRenewModal({ vpsId: vps.id, name: vps.name, months: 1, note: '' }) }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-xl text-xs font-bold text-emerald-300 transition-all">
                      <RefreshCcw className="w-3.5 h-3.5" /> Продлить
                    </button>
                    <button onClick={(e) => {
                      e.stopPropagation()
                      if (historyOpen === vps.id) { setHistoryOpen(null) } else { setHistoryOpen(vps.id); fetchHistory(vps.id) }
                    }}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${
                        historyOpen === vps.id
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                          : 'bg-slate-800/60 border-slate-700/50 text-slate-300 hover:border-amber-500/40 hover:text-amber-300'
                      }`}>
                      <History className="w-3.5 h-3.5" /> История оплат
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(vps) }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-slate-800/60 border border-slate-700/50 hover:border-violet-500/50 hover:bg-violet-500/10 rounded-xl text-xs font-semibold text-slate-300 hover:text-violet-300 transition-all">
                      <Pencil className="w-3.5 h-3.5" /> Редактировать
                    </button>
                    {deleteConfirm === vps.id ? (
                      <div className="flex items-center gap-1.5 px-2 rounded-xl bg-red-500/10 border border-red-500/40">
                        <span className="text-xs text-red-300 font-medium">Удалить?</span>
                        <button onClick={() => handleDelete(vps.id)}
                          className="px-2.5 py-1.5 bg-red-500/20 border border-red-500/50 rounded-lg text-xs font-bold text-red-300 hover:bg-red-500/30 transition-all">Да, удалить</button>
                        <button onClick={() => setDeleteConfirm(null)}
                          className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 hover:text-white transition-all">Отмена</button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(vps.id) }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-800/60 border border-slate-700/50 hover:border-red-500/50 hover:bg-red-500/10 rounded-xl text-xs font-semibold text-slate-300 hover:text-red-300 transition-all">
                        <Trash2 className="w-3.5 h-3.5" /> Удалить
                      </button>
                    )}
                    <span className="ml-auto text-xs text-slate-600 font-mono self-center">id:{vps.id}</span>
                  </div>

                  {(syncNodeState[vps.id]?.message || syncNodeState[vps.id]?.error) && (
                    <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs ${
                      syncNodeState[vps.id]?.error
                        ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                        : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    }`}>
                      {syncNodeState[vps.id]?.error
                        ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                      {syncNodeState[vps.id]?.error || syncNodeState[vps.id]?.message}
                    </div>
                  )}

                  {/* Payment History */}
                  {historyOpen === vps.id && (
                    <div className="bg-slate-950/40 rounded-xl border border-amber-500/20 p-4">
                      <h5 className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                        <History className="w-3.5 h-3.5 text-amber-400" /> История оплат / продлений
                      </h5>
                      {!paymentHistory[vps.id] || paymentHistory[vps.id].length === 0 ? (
                        <p className="text-xs text-slate-600 italic">Нет записей</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {paymentHistory[vps.id].map(h => (
                            <div key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 bg-slate-800/40 border border-slate-700/30 rounded-xl text-xs">
                              <span className="inline-flex items-center gap-1 text-emerald-300 font-bold">
                                <Plus className="w-3 h-3" /> {h.months} мес.
                              </span>
                              <span className="text-slate-500">{formatDate(h.old_paid_until)} → <span className="text-slate-200 font-medium">{formatDate(h.new_paid_until)}</span></span>
                              <span className="inline-flex items-center gap-1 text-violet-300 font-semibold">
                                <Wallet className="w-3 h-3" /> {formatCost(h.amount, h.currency)}
                              </span>
                              {h.admin_user && (
                                <span className="inline-flex items-center gap-1 text-slate-500">
                                  <span className="text-slate-600">·</span> {h.admin_user}
                                </span>
                              )}
                              {h.note && <span className="text-slate-500 italic">«{h.note}»</span>}
                              <span className="text-slate-600 ml-auto">{new Date(h.created_at).toLocaleString('ru-RU')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ===== Renew Modal ===== */}
      {renewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setRenewModal(null)} />
          <div className="relative w-full max-w-md bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-2xl shadow-2xl shadow-emerald-500/10 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-800/60 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 shrink-0">
                <RefreshCcw className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white truncate">Продлить аренду</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate">«{renewModal.name}»</p>
              </div>
              <button onClick={() => setRenewModal(null)}
                className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-2">
                  <Calendar className="w-3.5 h-3.5" /> На сколько месяцев
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 3, 6, 12].map(m => (
                    <button key={m} type="button"
                      onClick={() => setRenewModal(prev => ({ ...prev, months: m }))}
                      className={`py-3 rounded-xl text-sm font-bold border transition-all ${
                        renewModal.months === m
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200 shadow-md shadow-emerald-500/10'
                          : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-emerald-500/30 hover:text-slate-200'
                      }`}>
                      {m} мес
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
                  <StickyNote className="w-3.5 h-3.5" /> Заметка (необязательно)
                </label>
                <input type="text" value={renewModal.note} onChange={e => setRenewModal(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="Например: оплачено картой ****1234"
                  className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800/60 bg-slate-900/40 flex justify-end gap-3">
              <button onClick={() => setRenewModal(null)}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-all">
                Отмена
              </button>
              <button onClick={handleRenew} disabled={renewSaving}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 disabled:opacity-50 transition-all active:scale-95">
                {renewSaving ? (
                  <>
                    <RefreshCcw className="w-4 h-4 animate-spin" /> Продление...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Продлить на {renewModal.months} мес
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== RemnaWave Node Install Wizard ===== */}
      {installModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setInstallModal(null)} />
          <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-3xl shadow-2xl shadow-cyan-500/10 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-800/60 bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-transparent flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/30 shrink-0">
                <Rocket className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white truncate">Установка RemnaWave Node</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{installModal.name}</p>
              </div>
              <button onClick={() => setInstallModal(null)}
                className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="flex gap-3 p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-xs text-cyan-100 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-cyan-300" />
                <div>В панели RemnaWave создайте Node и нажмите <span className="font-bold">Copy docker-compose.yml</span>, затем вставьте его ниже.
                  После запуска установка выполнится на сервере через SSH автоматически.</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
                    <HardDrive className="w-3.5 h-3.5" /> Папка проекта
                  </label>
                  <input
                    value={installForm.projectDir}
                    onChange={e => setInstallForm(prev => ({ ...prev, projectDir: e.target.value }))}
                    placeholder="/opt/remnanode"
                    className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>
                <label className="flex items-center gap-2.5 px-3 py-2.5 mt-6 rounded-xl bg-slate-800/60 border border-slate-700/50 text-sm text-slate-200 cursor-pointer hover:border-cyan-500/40 transition">
                  <input
                    type="checkbox"
                    checked={installForm.installDocker}
                    onChange={e => setInstallForm(prev => ({ ...prev, installDocker: e.target.checked }))}
                    className="accent-cyan-500"
                  />
                  <Box className="w-4 h-4 text-cyan-400" />
                  Установить Docker автоматически
                </label>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
                  <FileCode2 className="w-3.5 h-3.5" /> docker-compose.yml из RemnaWave
                </label>
                <textarea
                  value={installForm.composeContent}
                  onChange={e => setInstallForm(prev => ({ ...prev, composeContent: e.target.value }))}
                  placeholder="Вставьте полный docker-compose.yml..."
                  rows={12}
                  className="w-full px-3 py-2 bg-[#0d1117] border border-slate-700/60 rounded-xl text-xs text-emerald-200 font-mono focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              {installState[installModal.vpsId]?.loading && (
                <div className="space-y-2 p-3 rounded-xl bg-slate-900/60 border border-cyan-500/30">
                  <div className="flex items-center justify-between text-xs text-cyan-300">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> Установка ноды выполняется...
                    </span>
                    <span className="font-mono font-bold">{installProgress[installModal.vpsId] || 0}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                      style={{ width: `${installProgress[installModal.vpsId] || 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/60 bg-slate-900/40 flex justify-end gap-3">
              <button
                onClick={() => setInstallModal(null)}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-all"
              >
                Отмена
              </button>
              <button
                onClick={runInstallRemnaNode}
                disabled={!installForm.composeContent.trim() || installState[installModal.vpsId]?.loading}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {installState[installModal.vpsId]?.loading ? (
                  <><RefreshCcw className="w-4 h-4 animate-spin" /> Установка...</>
                ) : (
                  <><Rocket className="w-4 h-4" /> Запустить установку</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Node docker-compose Editor ===== */}
      {composeEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => { setComposeEditor(null); setComposeCreateMode(false) }} />
          <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-3xl shadow-2xl shadow-cyan-500/10 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-800/60 bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-transparent flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/30 shrink-0">
                <FileCode2 className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white truncate">docker-compose.yml</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{composeEditor.name}</p>
              </div>
              <button onClick={() => { setComposeEditor(null); setComposeCreateMode(false) }}
                className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {composeCreateMode ? (
                <div className="flex gap-3 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
                  <div className="text-sm text-amber-200">
                    Файл не найден на сервере. Будет создан по пути: <span className="font-mono text-amber-100">{composeEditor.path}</span>
                  </div>
                </div>
              ) : (
                composeEditor.path && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40">
                    <HardDrive className="w-3 h-3 text-slate-500" /> {composeEditor.path}
                  </div>
                )
              )}

              <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-sm text-slate-200 cursor-pointer hover:border-cyan-500/40 transition">
                <input type="checkbox" checked={composeRestart} onChange={e => setComposeRestart(e.target.checked)} className="accent-cyan-500" />
                <RotateCw className="w-4 h-4 text-cyan-400" />
                После сохранения применить изменения (<code className="text-xs text-cyan-300 bg-slate-900/80 px-1.5 py-0.5 rounded">docker compose up -d</code>)
              </label>

              {composeLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 rounded-xl bg-slate-900/60 border border-cyan-500/30 text-sm text-cyan-300">
                  <RefreshCcw className="w-4 h-4 animate-spin" /> Загрузка docker-compose.yml...
                </div>
              ) : (
                <textarea
                  value={composeContent}
                  onChange={e => setComposeContent(e.target.value)}
                  rows={18}
                  placeholder={composeCreateMode ? 'Введите содержимое docker-compose.yml...' : ''}
                  className="w-full px-3 py-2 bg-[#0d1117] border border-slate-700/60 rounded-xl text-xs text-emerald-200 font-mono focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
                />
              )}

              {composeError && (
                <div className="flex gap-3 p-3.5 rounded-xl border border-red-500/40 bg-red-500/10">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-300" />
                  <div className="text-sm text-red-200 whitespace-pre-wrap">{composeError}</div>
                </div>
              )}
              {composeOutput && (
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs text-cyan-300 mb-2 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Результат применения
                  </div>
                  <pre className="text-xs text-cyan-100 font-mono whitespace-pre-wrap break-all max-h-52 overflow-y-auto">{composeOutput}</pre>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/60 bg-slate-900/40 flex justify-end gap-3">
              <button
                onClick={() => { setComposeEditor(null); setComposeCreateMode(false) }}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-all"
              >
                Отмена
              </button>
              <button
                onClick={saveComposeEditor}
                disabled={composeLoading || composeSaving || !composeContent.trim()}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {composeSaving ? (
                  <><RefreshCcw className="w-4 h-4 animate-spin" /> {composeCreateMode ? 'Создание...' : 'Сохранение...'}</>
                ) : composeCreateMode ? (
                  <><Plus className="w-4 h-4" /> Создать файл</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4" /> Сохранить</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Form Modal — VPS create/edit ===== */}
      {showForm && (
        <VpsFormModal
          editId={editId}
          form={form}
          setField={setField}
          setSpec={setSpec}
          customProvider={customProvider}
          setCustomProvider={setCustomProvider}
          nodes={nodes}
          handleNodeLink={handleNodeLink}
          saving={saving}
          onClose={() => setShowForm(false)}
          onSave={handleSave}
        />
      )}

      {/* Traffic Agent — manual step modal */}
      {taManualOpen && (
        <TrafficAgentManualModal
          vpsName={taManualOpen.name}
          healthMessage={taManualOpen.healthMessage}
          publicKey={panelPublicKey}
          onClose={() => setTaManualOpen(null)}
          onRecheck={async () => {
            await checkTrafficAgent(taManualOpen.vpsId)
          }}
        />
      )}

      {/* Traffic Agent — result modal */}
      {taResultOpen && (
        <TrafficAgentResultModal
          vpsName={taResultOpen.name}
          action={taResultOpen.action}
          result={taResultOpen.result}
          onClose={() => setTaResultOpen(null)}
          onShowManual={async () => {
            await loadPanelKey()
            setTaResultOpen(null)
            setTaManualOpen({
              vpsId: taResultOpen.vpsId,
              name: taResultOpen.name,
              healthMessage: taResultOpen.result?.healthMessage,
            })
          }}
        />
      )}

      {/* Traffic Agent — history modal */}
      {taHistoryOpen && (
        <TrafficAgentHistoryModal
          vpsName={taHistoryOpen.name}
          entries={taHistoryOpen.entries}
          loading={taHistoryOpen.loading}
          error={taHistoryOpen.error}
          onClose={() => setTaHistoryOpen(null)}
        />
      )}
    </div>
  )
}

/* ─── Sub-components ─── */

// Большая статистическая карточка для верхней панели (с иконкой в кружке + цветной акцент)
function StatCard({ Icon, label, value, subtitle, accent = 'slate', renderValue }) {
  const accentMap = {
    slate:   { box: 'from-slate-800/60 to-slate-900/60 border-slate-700/40',     icon: 'bg-slate-700/60 text-slate-300',  text: 'text-slate-100' },
    violet:  { box: 'from-violet-900/40 to-slate-900/60 border-violet-500/20',   icon: 'bg-violet-500/20 text-violet-300', text: 'text-violet-200' },
    amber:   { box: 'from-amber-900/30 to-slate-900/60 border-amber-500/20',     icon: 'bg-amber-500/20 text-amber-300',   text: 'text-amber-200' },
    emerald: { box: 'from-emerald-900/30 to-slate-900/60 border-emerald-500/20', icon: 'bg-emerald-500/20 text-emerald-300', text: 'text-emerald-200' },
    teal:    { box: 'from-teal-900/30 to-slate-900/60 border-teal-500/20',       icon: 'bg-teal-500/20 text-teal-300',     text: 'text-teal-200' },
  }
  const a = accentMap[accent] || accentMap.slate
  return (
    <div className={`relative overflow-hidden p-4 bg-gradient-to-br ${a.box} border rounded-2xl`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${a.icon} flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{label}</div>
          {renderValue ? renderValue() : <div className={`text-2xl font-extrabold ${a.text} mt-0.5 leading-tight`}>{value}</div>}
          {subtitle && <div className="text-[10px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
      </div>
    </div>
  )
}

function SpecBadge({ Icon, label, value, valueColor }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-800/60 border border-slate-700/40 rounded-xl hover:border-slate-600/50 transition-colors">
      {Icon && (
        <div className="w-7 h-7 rounded-lg bg-slate-900/60 border border-slate-700/40 flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-slate-400" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-slate-500 font-semibold leading-none uppercase tracking-wider">{label}</div>
        <div className={`text-sm font-medium truncate mt-1 ${valueColor || 'text-slate-200'}`}>{value}</div>
      </div>
    </div>
  )
}

// Подзаголовок секции в раскрытой карточке VPS
function SectionTitle({ Icon, title, accent = 'slate', children }) {
  const accentMap = {
    slate:   'text-slate-400',
    emerald: 'text-emerald-400',
    amber:   'text-amber-400',
    blue:    'text-blue-400',
    teal:    'text-teal-400',
    violet:  'text-violet-400',
  }
  return (
    <div>
      <h5 className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-2.5 ${accentMap[accent] || accentMap.slate}`}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </h5>
      {children}
    </div>
  )
}

function FormField({ label, value, onChange, placeholder, type = 'text', mini, Icon, hint, required, autoFocus }) {
  const [showSecret, setShowSecret] = useState(false)
  const isPassword = type === 'password'
  const inputType = isPassword ? (showSecret ? 'text' : 'password') : type
  return (
    <div>
      {label && (
        <label className={`flex items-center gap-1.5 ${mini ? 'text-[10px]' : 'text-xs'} font-semibold ${mini ? 'text-slate-500' : 'text-slate-400'} ${mini ? 'mb-1' : 'mb-1.5'}`}>
          {Icon && <Icon className={mini ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
          {label}
          {required && <span className="text-rose-400">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`w-full ${isPassword ? 'pr-10' : ''} px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowSecret(s => !s)}
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label={showSecret ? 'Скрыть' : 'Показать'}
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {hint && <div className="mt-1 text-[10px] text-slate-500">{hint}</div>}
    </div>
  )
}

function SshBtn({ label, onClick, loading, Icon }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800/80 border border-slate-700/50 hover:border-emerald-500/40 hover:bg-emerald-500/10 rounded-lg text-[11px] font-medium text-slate-300 hover:text-emerald-300 transition-all disabled:opacity-40 disabled:pointer-events-none">
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </button>
  )
}

// === Карточка-секция формы ===
function Section({ id, Icon, title, subtitle, accent = 'violet', children }) {
  const accentMap = {
    violet: 'from-violet-500/10 to-transparent border-violet-500/20 text-violet-300',
    cyan:   'from-cyan-500/10 to-transparent border-cyan-500/20 text-cyan-300',
    emerald: 'from-emerald-500/10 to-transparent border-emerald-500/20 text-emerald-300',
    amber:  'from-amber-500/10 to-transparent border-amber-500/20 text-amber-300',
    blue:   'from-blue-500/10 to-transparent border-blue-500/20 text-blue-300',
    rose:   'from-rose-500/10 to-transparent border-rose-500/20 text-rose-300',
  }
  const cls = accentMap[accent] || accentMap.violet
  return (
    <section id={id} className={`rounded-2xl border bg-gradient-to-br ${cls} bg-slate-900/40 p-5 scroll-mt-24`}>
      <header className="flex items-start gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl bg-slate-900/60 border border-slate-700/40 flex items-center justify-center shrink-0`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-white">{title}</h4>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

// Компактный nav-табик (anchor scroll)
function FormNav({ items, scrollerRef }) {
  const scrollTo = (id) => {
    const el = scrollerRef.current?.querySelector('#' + id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <nav className="flex gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          onClick={() => scrollTo(it.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/40 border border-slate-700/40 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition shrink-0"
        >
          <it.Icon className="w-3.5 h-3.5" />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  )
}

function VpsFormModal({ editId, form, setField, setSpec, customProvider, setCustomProvider, nodes, handleNodeLink, saving, onClose, onSave }) {
  const scrollerRef = useRef(null)

  // Прогресс заполнения — отслеживаем "ключевые" поля
  const trackedFields = [
    !!form.name, !!form.hosting_provider, !!form.ip_address, !!form.location,
    !!form.specs.cpu, !!form.specs.ram, !!form.specs.disk, !!form.specs.os,
    !!form.monthly_cost, !!form.paid_until,
    !!form.ssh_user, (form.ssh_password || form.ssh_key) ? true : false,
  ]
  const filled = trackedFields.filter(Boolean).length
  const total = trackedFields.length
  const pct = Math.round((filled / total) * 100)

  const navItems = [
    { id: 'sec-main',    label: 'Основное',         Icon: Tag },
    { id: 'sec-host',    label: 'Хостинг',          Icon: Globe2 },
    { id: 'sec-specs',   label: 'Характеристики',   Icon: Cpu },
    { id: 'sec-payment', label: 'Оплата',           Icon: Wallet },
    { id: 'sec-ssh',     label: 'SSH',              Icon: Terminal },
    { id: 'sec-extra',   label: 'Дополнительно',    Icon: StickyNote },
  ]

  const isActive = form.status === 'active'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-4xl sm:max-h-[92vh] flex flex-col bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-700/60 sm:rounded-3xl shadow-2xl shadow-violet-500/10 overflow-hidden">

        {/* ===== Header ===== */}
        <div className="relative px-6 py-5 border-b border-slate-800/60 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-transparent">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
              {editId ? <Pencil className="w-5 h-5 text-white" /> : <Plus className="w-5 h-5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-white truncate">
                {editId ? 'Редактирование VPS' : 'Новый VPS'}
                {form.name && <span className="text-slate-500 font-normal"> · {form.name}</span>}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {editId ? 'Изменения вступят в силу после сохранения' : 'Заполните характеристики и SSH-доступ — сервер появится в списке'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                isActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-700/60 border-slate-600/50 text-slate-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                {isActive ? 'Активен' : 'Неактивен'}
              </span>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 hover:bg-slate-700 hover:border-slate-600 text-slate-400 hover:text-white flex items-center justify-center transition-all"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sticky nav */}
          <div className="mt-4">
            <FormNav items={navItems} scrollerRef={scrollerRef} />
          </div>
        </div>

        {/* ===== Body (scrollable) ===== */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

          {/* === SECTION: Основное === */}
          <Section id="sec-main" Icon={Tag} title="Основное" subtitle="Имя сервера, статус, тип сервиса" accent="violet">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Название" required Icon={Server}
                value={form.name} onChange={v => setField('name', v)}
                placeholder="Например: Frankfurt-Node-1"
              />
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
                  <Power className="w-3.5 h-3.5" /> Статус
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: 'active',   label: 'Активен',    Icon: CheckCircle2, color: 'emerald' },
                    { v: 'inactive', label: 'Неактивен',  Icon: AlertCircle,  color: 'slate' },
                  ].map(opt => {
                    const sel = form.status === opt.v
                    const colorMap = {
                      emerald: sel ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : '',
                      slate:   sel ? 'border-slate-500/60 bg-slate-700/40 text-slate-300' : '',
                    }
                    return (
                      <button
                        key={opt.v} type="button"
                        onClick={() => setField('status', opt.v)}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                          sel ? colorMap[opt.color] : 'border-slate-700/50 bg-slate-800/40 text-slate-500 hover:border-slate-600'
                        }`}
                      >
                        <opt.Icon className="w-3.5 h-3.5" /> {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-2">
                <Tag className="w-3.5 h-3.5" /> Тип сервиса
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {SERVICE_TYPES.map(st => {
                  const selected = (form.service_type || '') === st.value
                  const colorMap = {
                    slate: 'border-slate-500/50 bg-slate-700/40 text-slate-300',
                    teal: 'border-teal-500/50 bg-teal-500/10 text-teal-300',
                    violet: 'border-violet-500/50 bg-violet-500/10 text-violet-300',
                    blue: 'border-blue-500/50 bg-blue-500/10 text-blue-300',
                    amber: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
                  }
                  return (
                    <button key={st.value} type="button"
                      onClick={() => {
                        setField('service_type', st.value)
                        if (st.value !== 'node') {
                          setField('node_uuid', '')
                          setField('node_name', '')
                        }
                      }}
                      className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-xl text-[11px] font-bold border transition-all ${
                        selected ? colorMap[st.color] : 'border-slate-700/50 bg-slate-800/40 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                      }`}>
                      <st.Icon className="w-4 h-4" /> {st.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {form.service_type === 'node' && (
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
                  <Link2 className="w-3.5 h-3.5" /> Привязать ноду Remnawave
                </label>
                <select value={form.node_uuid} onChange={e => handleNodeLink(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all">
                  <option value="">— Не привязана —</option>
                  {nodes.map(n => (
                    <option key={n.uuid} value={n.uuid}>
                      {n.name} ({n.address || n.uuid.slice(0, 8)}) {n.isConnected ? '🟢' : '🔴'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Section>

          {/* === SECTION: Хостинг === */}
          <Section id="sec-host" Icon={Globe2} title="Хостинг" subtitle="Где физически расположен сервер" accent="cyan">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
                  <Globe2 className="w-3.5 h-3.5" /> Провайдер
                </label>
                <select
                  value={customProvider ? 'Другой' : (PROVIDERS.includes(form.hosting_provider) ? form.hosting_provider : form.hosting_provider ? 'Другой' : '')}
                  onChange={e => {
                    if (e.target.value === 'Другой') {
                      setCustomProvider(true)
                      setField('hosting_provider', '')
                    } else {
                      setCustomProvider(false)
                      setField('hosting_provider', e.target.value)
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all">
                  <option value="">— Выбрать —</option>
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                {customProvider && (
                  <input value={form.hosting_provider}
                    onChange={e => setField('hosting_provider', e.target.value)}
                    className="mt-2 w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20"
                    placeholder="Введите название провайдера" autoFocus />
                )}
              </div>
              <FormField
                label="Расположение" Icon={MapPin}
                value={form.location} onChange={v => setField('location', v)}
                placeholder="Frankfurt, DE"
              />
            </div>
            <FormField
              label="IP-адрес" Icon={Hash}
              value={form.ip_address} onChange={v => setField('ip_address', v)}
              placeholder="185.123.45.67"
              hint="Используется для SSH-подключения"
            />
          </Section>

          {/* === SECTION: Характеристики === */}
          <Section id="sec-specs" Icon={Cpu} title="Характеристики" subtitle="Технические параметры сервера" accent="emerald">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FormField mini label="CPU" Icon={Cpu} value={form.specs.cpu} onChange={v => setSpec('cpu', v)} placeholder="2 vCPU" />
              <FormField mini label="RAM" Icon={MemoryStick} value={form.specs.ram} onChange={v => setSpec('ram', v)} placeholder="4 GB" />
              <FormField mini label="Диск" Icon={HardDrive} value={form.specs.disk} onChange={v => setSpec('disk', v)} placeholder="80 GB SSD" />
              <FormField mini label="ОС" Icon={Disc3} value={form.specs.os} onChange={v => setSpec('os', v)} placeholder="Ubuntu 22" />
            </div>
          </Section>

          {/* === SECTION: Оплата === */}
          <Section id="sec-payment" Icon={Wallet} title="Оплата" subtitle="Стоимость и срок действия" accent="amber">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField mini label="Стоимость / мес" Icon={Wallet} value={form.monthly_cost} onChange={v => setField('monthly_cost', v)} placeholder="500" type="number" />
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Валюта</label>
                <select value={form.currency} onChange={e => setField('currency', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <FormField mini label="Куплено месяцев" value={form.paid_months} onChange={v => setField('paid_months', Number(v) || 1)} placeholder="1" type="number" />
            </div>
            <FormField label="Оплачено до" Icon={Calendar} value={form.paid_until} onChange={v => setField('paid_until', v)} type="date" />
            {form.paid_until && form.paid_months && (
              <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-3">
                <PaymentBar paidUntil={form.paid_until} paidMonths={form.paid_months} />
              </div>
            )}
          </Section>

          {/* === SECTION: SSH === */}
          <Section id="sec-ssh" Icon={Terminal} title="SSH-подключение" subtitle="Логин и доступ к серверу. Хранится в зашифрованном виде." accent="rose">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField mini label="Пользователь" value={form.ssh_user} onChange={v => setField('ssh_user', v)} placeholder="root" />
              <FormField mini label="Порт" value={form.ssh_port} onChange={v => setField('ssh_port', Number(v) || 22)} placeholder="22" type="number" />
              <FormField mini label="Пароль" value={form.ssh_password} onChange={v => setField('ssh_password', v)} placeholder="••••••••" type="password" />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 mb-1">
                <Terminal className="w-3 h-3" /> SSH ключ (приватный, PEM)
              </label>
              <textarea value={form.ssh_key} onChange={e => setField('ssh_key', e.target.value)} rows={4}
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 resize-none"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
              <div className="mt-1 text-[10px] text-slate-500">
                Можно использовать пароль <em>или</em> ключ. Ключ имеет приоритет.
              </div>
            </div>
          </Section>

          {/* === SECTION: Дополнительно === */}
          <Section id="sec-extra" Icon={StickyNote} title="Дополнительно" subtitle="Заметки для команды" accent="blue">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-1.5">
                <StickyNote className="w-3.5 h-3.5" /> Заметки
              </label>
              <textarea value={form.notes} onChange={e => setField('notes', e.target.value)} rows={3}
                className="w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 resize-none"
                placeholder="Например: используется только для тестов, отключить через месяц..." />
            </div>
          </Section>
        </div>

        {/* ===== Footer ===== */}
        <div className="border-t border-slate-800/60 bg-slate-900/95 backdrop-blur-xl px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1.5">
                <span className="font-semibold">Заполнено</span>
                <span className="font-mono text-slate-300">{filled}/{total}</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-500 truncate">
                  {form.name || 'без названия'}
                  {form.hosting_provider && ` · ${form.hosting_provider}`}
                  {form.monthly_cost && ` · ${formatCost(form.monthly_cost, form.currency)}`}
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="flex gap-2 sm:ml-4">
              <button onClick={onClose}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-all">
                Отмена
              </button>
              <button onClick={onSave} disabled={saving || !form.name.trim()}
                className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center gap-1.5">
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Сохраняем...
                  </>
                ) : editId ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Сохранить
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" /> Создать VPS
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Traffic Agent UI ───────────────────────────────────────────────────────

function TrafficAgentButton({ vps, state, onInstall, onCheck, onUninstall, onShowManual, onHistory }) {
  const installed = !!vps.traffic_agent_installed_at
  const lastHealth = vps.traffic_agent_last_health
  const isOk = lastHealth === 'ok'
  const loading = state?.loading

  if (!installed) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={onInstall}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
          title="Установить traffic-agent для Traffic Guard и P2P-детекции"
        >
          {loading ? (
            <span className="w-3.5 h-3.5 border-2 border-blue-300/40 border-t-blue-300 rounded-full animate-spin" />
          ) : (
            <Shield className="w-3.5 h-3.5" />
          )}
          {loading ? 'Установка...' : 'Установить traffic-agent'}
        </button>
        <button
          onClick={onHistory}
          title="История попыток установки"
          className="flex items-center justify-center w-8 h-8 rounded-xl border bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-blue-300 hover:border-blue-500/40 transition-all"
        >
          <History className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={isOk ? onCheck : onShowManual}
        disabled={loading}
        title={isOk ? 'Перепроверить агент' : `Последняя проверка: ${lastHealth || 'не пройдена'}. Открыть инструкцию по последнему шагу`}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
          isOk
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
        } disabled:opacity-50`}
      >
        {loading ? (
          <span className={`w-3.5 h-3.5 border-2 ${isOk ? 'border-emerald-300/40 border-t-emerald-300' : 'border-amber-300/40 border-t-amber-300'} rounded-full animate-spin`} />
        ) : (
          <Shield className="w-3.5 h-3.5" />
        )}
        {isOk ? 'Агент: ok' : 'Агент: требует настройки'}
      </button>
      <button
        onClick={onHistory}
        title="История попыток установки и проверок"
        className="flex items-center justify-center w-8 h-8 rounded-xl border bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-blue-300 hover:border-blue-500/40 transition-all"
      >
        <History className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onUninstall}
        disabled={loading}
        title="Удалить traffic-agent с ноды"
        className="flex items-center justify-center w-8 h-8 rounded-xl text-xs border bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-red-300 hover:border-red-500/40 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function TrafficAgentManualModal({ vpsName, healthMessage, publicKey, onClose, onRecheck }) {
  const [copied, setCopied] = useState(null)
  const [rechecking, setRechecking] = useState(false)

  const xrayBlock = `"log": {
  "loglevel": "warning",
  "access": "/var/log/xray/access.log",
  "error": "/var/log/xray/error.log"
}`

  function copy(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  async function handleRecheck() {
    setRechecking(true)
    try { await onRecheck() } finally { setRechecking(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800 px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-amber-300" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Последний шаг — настройка Xray на «{vpsName}»</div>
            <div className="text-[11px] text-slate-500">Агент установлен, но access.log пока недоступен</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {healthMessage && healthMessage !== 'ok' && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><span className="font-mono">{healthMessage}</span> — это нормально на этом шаге</span>
            </div>
          )}

          <div>
            <div className="text-sm font-semibold text-white mb-2">1. Открой RemnaWave-панель</div>
            <p className="text-xs text-slate-400">
              Зайди в админку RemnaWave → <span className="text-slate-200">Config Profiles</span> →
              открой профиль, который прикреплён к этой ноде.
            </p>
          </div>

          <div>
            <div className="text-sm font-semibold text-white mb-2">
              2. Добавь блок <code className="text-cyan-300 font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">"log"</code> в JSON-конфиг
            </div>
            <p className="text-xs text-slate-400 mb-2">
              Если блок <code className="text-cyan-300 font-mono">"log"</code> уже есть — добавь только поле <code className="text-cyan-300 font-mono">"access"</code>.
            </p>
            <div className="relative">
              <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-emerald-300 overflow-x-auto">{xrayBlock}</pre>
              <button
                onClick={() => copy(xrayBlock, 'log')}
                className="absolute top-2 right-2 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-[11px] font-medium text-slate-300 flex items-center gap-1.5"
              >
                <Copy className="w-3 h-3" />
                {copied === 'log' ? 'Скопировано!' : 'Копировать'}
              </button>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-white mb-2">3. Сохрани профиль</div>
            <p className="text-xs text-slate-400">
              RemnaWave автоматически перезальёт config на ноду — Xray начнёт писать{' '}
              <code className="text-cyan-300 font-mono">/var/log/xray/access.log</code> в течение нескольких секунд.
            </p>
          </div>

          <div>
            <div className="text-sm font-semibold text-white mb-2">4. Нажми «Перепроверить» ниже</div>
            <p className="text-xs text-slate-400">
              Если health-check вернёт <code className="text-emerald-300 font-mono">ok</code> — агент готов к работе.
            </p>
          </div>

          {publicKey && (
            <details className="bg-slate-900/60 border border-slate-800 rounded-xl">
              <summary className="px-4 py-2.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
                Публичный ключ панели (на случай ручной установки)
              </summary>
              <div className="border-t border-slate-800 p-3 relative">
                <pre className="text-[10px] font-mono text-slate-300 break-all whitespace-pre-wrap">{publicKey}</pre>
                <button
                  onClick={() => copy(publicKey, 'pub')}
                  className="absolute top-2 right-2 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[10px] text-slate-300 flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  {copied === 'pub' ? '✓' : 'Copy'}
                </button>
              </div>
            </details>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-6 py-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
          >
            Закрыть
          </button>
          <button
            onClick={handleRecheck}
            disabled={rechecking}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-bold rounded-lg hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 flex items-center gap-1.5"
          >
            {rechecking ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Проверка...
              </>
            ) : (
              <>
                <ShieldCheck className="w-3.5 h-3.5" /> Перепроверить
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// Метки шагов установки — синхронизированы с backend STEP_LABELS
const TA_STEP_LABELS = {
  node_dir:                    'Найдена установка ноды',
  no_node_found:               'Нода не найдена в стандартных путях',
  compose_patched:             'Volume xray-логов добавлен в docker-compose',
  compose_already_has_volume:  'Volume xray-логов уже был в docker-compose',
  key_added:                   'SSH-ключ панели добавлен в authorized_keys',
  key_already_present:         'SSH-ключ панели уже был в authorized_keys',
  log_readable_by_agent:       'Доступ к access.log из под traffic-agent',
  log_NOT_readable_by_agent:   'Нет доступа к access.log (нужен последний шаг)',
}

const TA_ACTION_LABELS = {
  install: 'Установка',
  check: 'Проверка',
  uninstall: 'Удаление',
}

const TA_STATUS_META = {
  ok:             { label: 'Успех',                    color: 'emerald', icon: CheckCircle2 },
  health_failed:  { label: 'Установлено, но health не ok', color: 'amber',   icon: AlertCircle },
  partial:        { label: 'Частично',                  color: 'amber',   icon: AlertCircle },
  failed:         { label: 'Ошибка',                    color: 'red',     icon: AlertCircle },
}

function TrafficAgentResultModal({ vpsName, action, result, onClose, onShowManual }) {
  const status = result.ok && result.healthOk ? 'ok'
               : result.ok && !result.healthOk ? 'health_failed'
               : (result.steps && result.steps.length > 0) ? 'partial'
               : 'failed'
  const meta = TA_STATUS_META[status]
  const StatusIcon = meta.icon
  const colorClasses = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    amber:   'bg-amber-500/10 border-amber-500/30 text-amber-300',
    red:     'bg-red-500/10 border-red-500/30 text-red-300',
  }[meta.color]

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800 px-6 py-4 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${colorClasses}`}>
            <StatusIcon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">
              {TA_ACTION_LABELS[action] || action} • {vpsName}
            </div>
            <div className="text-[11px] text-slate-500">
              {meta.label}
              {result.durationMs != null && ` • ${(result.durationMs / 1000).toFixed(1)}s`}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Error / hint */}
          {result.error && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center gap-2 text-amber-200 text-sm font-semibold mb-1">
                <AlertCircle className="w-4 h-4" />
                {result.error.code}
              </div>
              <div className="text-xs text-amber-100/90 leading-relaxed">{result.error.hint}</div>
            </div>
          )}
          {!result.error && result.healthOk && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Агент полностью установлен и отвечает <span className="font-mono">ok</span> — Traffic Guard готов к работе на этой ноде.
            </div>
          )}

          {/* Steps */}
          {result.steps && result.steps.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">Шаги установки</div>
              <div className="space-y-1.5">
                {result.steps.map((s, i) => {
                  const label = TA_STEP_LABELS[s.key] || s.label || s.key
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {s.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className={s.ok ? 'text-slate-200' : 'text-amber-200'}>{label}</span>
                        {s.detail && <span className="text-slate-500 font-mono ml-2">{s.detail}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Health message */}
          {result.healthMessage && !result.healthOk && (
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">Сообщение от агента</div>
              <div className="text-xs font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-3 break-all">
                {result.healthMessage}
              </div>
            </div>
          )}

          {/* Raw output — collapsible */}
          {(result.raw?.stdout || result.raw?.stderr) && (
            <details className="bg-slate-900/60 border border-slate-800 rounded-xl">
              <summary className="px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-200 cursor-pointer flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5" />
                Подробности (raw stdout/stderr)
              </summary>
              <div className="border-t border-slate-800">
                {result.raw.stdout && (
                  <div className="p-3 border-b border-slate-800">
                    <div className="text-[10px] font-bold text-emerald-500 uppercase mb-1">stdout</div>
                    <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{result.raw.stdout}</pre>
                  </div>
                )}
                {result.raw.stderr && (
                  <div className="p-3">
                    <div className="text-[10px] font-bold text-red-500 uppercase mb-1">stderr</div>
                    <pre className="text-[11px] font-mono text-red-300/80 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{result.raw.stderr}</pre>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-6 py-4 flex items-center justify-end gap-2">
          {status === 'health_failed' && (
            <button
              onClick={onShowManual}
              className="px-4 py-2 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 rounded-lg text-xs font-bold flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" /> Открыть инструкцию
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-bold hover:bg-slate-700"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

function TrafficAgentHistoryModal({ vpsName, entries, loading, error, onClose }) {
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800 px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 flex items-center justify-center">
            <History className="w-4 h-4 text-blue-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">История traffic-agent — {vpsName}</div>
            <div className="text-[11px] text-slate-500">Последние 20 попыток установки/проверки</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCcw className="w-5 h-5 animate-spin mr-2" />
              Загрузка истории...
            </div>
          )}
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">Истории пока нет — установка ещё не запускалась</div>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="space-y-2">
              {entries.map(e => {
                const meta = TA_STATUS_META[e.status] || { label: e.status, color: 'slate', icon: AlertCircle }
                const StatusIcon = meta.icon
                const colorClasses = {
                  emerald: 'border-emerald-500/30 bg-emerald-500/5',
                  amber:   'border-amber-500/30 bg-amber-500/5',
                  red:     'border-red-500/30 bg-red-500/5',
                  slate:   'border-slate-700 bg-slate-900/40',
                }[meta.color]
                const iconColor = {
                  emerald: 'text-emerald-400',
                  amber: 'text-amber-400',
                  red: 'text-red-400',
                  slate: 'text-slate-400',
                }[meta.color]
                const isExpanded = expanded === e.id

                return (
                  <div key={e.id} className={`rounded-xl border ${colorClasses} overflow-hidden`}>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : e.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-800/30 transition"
                    >
                      <StatusIcon className={`w-4 h-4 shrink-0 ${iconColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-semibold flex items-center gap-2">
                          {TA_ACTION_LABELS[e.action] || e.action}
                          <span className="text-[11px] font-normal text-slate-400">{meta.label}</span>
                          {e.error_code && (
                            <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">{e.error_code}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                          <span>{new Date(e.started_at).toLocaleString('ru-RU')}</span>
                          {e.duration_ms != null && <span>• {(e.duration_ms / 1000).toFixed(1)}s</span>}
                          {e.admin_login && <span>• {e.admin_login}</span>}
                        </div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-800 bg-slate-950/60 p-4 space-y-3">
                        {e.error_hint && (
                          <div className="text-xs text-amber-200/90 leading-relaxed">
                            <span className="font-semibold">💡 Подсказка:</span> {e.error_hint}
                          </div>
                        )}
                        {e.health_msg && (
                          <div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Health</div>
                            <div className="text-xs font-mono text-slate-300 break-all">{e.health_msg}</div>
                          </div>
                        )}
                        {Array.isArray(e.steps) && e.steps.length > 0 && (
                          <div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Шаги</div>
                            <div className="space-y-1">
                              {e.steps.map((s, i) => (
                                <div key={i} className="flex items-start gap-2 text-[11px]">
                                  {s.ok ? <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" /> : <AlertCircle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />}
                                  <div className="flex-1">
                                    <span className={s.ok ? 'text-slate-300' : 'text-amber-200'}>{TA_STEP_LABELS[s.key] || s.label || s.key}</span>
                                    {s.detail && <span className="text-slate-500 font-mono ml-2">{s.detail}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {e.stderr_tail && (
                          <details>
                            <summary className="text-[10px] font-bold text-red-400 uppercase cursor-pointer">stderr ({e.stderr_tail.length} симв.)</summary>
                            <pre className="text-[10px] font-mono text-red-300/80 whitespace-pre-wrap break-all mt-1 max-h-40 overflow-y-auto">{e.stderr_tail}</pre>
                          </details>
                        )}
                        {e.stdout_tail && (
                          <details>
                            <summary className="text-[10px] font-bold text-emerald-500 uppercase cursor-pointer">stdout ({e.stdout_tail.length} симв.)</summary>
                            <pre className="text-[10px] font-mono text-slate-400 whitespace-pre-wrap break-all mt-1 max-h-40 overflow-y-auto">{e.stdout_tail}</pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-bold hover:bg-slate-700">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
