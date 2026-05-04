import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Save, Eye, Code, Search, ExternalLink,
  CheckCircle, Ban, FileText, RefreshCw, Image as ImageIcon, History,
  BarChart2, Home as HomeIcon
} from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { html as cmHtml } from '@codemirror/lang-html'
import { oneDark } from '@codemirror/theme-one-dark'
import DOMPurify from 'dompurify'
import OgPreview from '../components/OgPreview'
import LandingAuditPanel from '../components/LandingAuditPanel'
import LandingViewsPanel from '../components/LandingViewsPanel'

const API = import.meta.env.VITE_API_URL || ''

function authHeaders() {
  return {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }
}

async function apiFetch(url, opts = {}) {
  return fetch(`${API}${url}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } })
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ё]/g, 'e').replace(/[а]/g, 'a').replace(/[б]/g, 'b').replace(/[в]/g, 'v').replace(/[г]/g, 'g')
    .replace(/[д]/g, 'd').replace(/[е]/g, 'e').replace(/[ж]/g, 'zh').replace(/[з]/g, 'z').replace(/[и]/g, 'i')
    .replace(/[й]/g, 'i').replace(/[к]/g, 'k').replace(/[л]/g, 'l').replace(/[м]/g, 'm').replace(/[н]/g, 'n')
    .replace(/[о]/g, 'o').replace(/[п]/g, 'p').replace(/[р]/g, 'r').replace(/[с]/g, 's').replace(/[т]/g, 't')
    .replace(/[у]/g, 'u').replace(/[ф]/g, 'f').replace(/[х]/g, 'h').replace(/[ц]/g, 'c').replace(/[ч]/g, 'ch')
    .replace(/[ш]/g, 'sh').replace(/[щ]/g, 'sch').replace(/[ъь]/g, '').replace(/[ы]/g, 'y').replace(/[э]/g, 'e')
    .replace(/[ю]/g, 'yu').replace(/[я]/g, 'ya')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120)
}

const STARTER_HTML = `<section style="padding: 40px 20px; max-width: 960px; margin: 0 auto;">
  <h1>Заголовок страницы</h1>
  <p>Описание страницы. Используйте любые HTML-теги: <strong>жирный</strong>, <em>курсив</em>, <a href="https://example.com">ссылки</a>.</p>
  <h2>Подзаголовок</h2>
  <ul>
    <li>Первый пункт</li>
    <li>Второй пункт</li>
  </ul>
</section>`

export default function AdminLandingEdit() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isNew = id === 'new'

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [view, setView] = useState('split') // split / code / preview / seo / stats / history
  const [autoSlug, setAutoSlug] = useState(isNew)
  const [uploading, setUploading] = useState(false)
  const cmRef = useRef(null)
  const fileInputRef = useRef(null)

  const [form, setForm] = useState({
    slug: '',
    title: '',
    content: isNew ? STARTER_HTML : '',
    is_published: false,
    show_in_menu: false,
    menu_order: 0,
    schema_type: 'WebPage',
    meta_title: '',
    meta_description: '',
    meta_keywords: '',
    og_image: '',
    canonical_url: '',
  })
  const [isHome, setIsHome] = useState(false)
  const [homeBusy, setHomeBusy] = useState(false)

  useEffect(() => {
    if (isNew) return
    ;(async () => {
      try {
        setLoading(true)
        const res = await apiFetch(`/api/admin/landings/${id}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Не удалось загрузить')
        setForm({
          slug: data.landing.slug || '',
          title: data.landing.title || '',
          content: data.landing.content || '',
          is_published: !!data.landing.is_published,
          show_in_menu: !!data.landing.show_in_menu,
          menu_order: Number(data.landing.menu_order) || 0,
          schema_type: data.landing.schema_type || 'WebPage',
          meta_title: data.landing.meta_title || '',
          meta_description: data.landing.meta_description || '',
          meta_keywords: data.landing.meta_keywords || '',
          og_image: data.landing.og_image || '',
          canonical_url: data.landing.canonical_url || '',
        })
        setIsHome(!!data.landing.is_home)
        setAutoSlug(false)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [id, isNew])

  function setField(k, v) {
    setForm(prev => {
      const next = { ...prev, [k]: v }
      if (k === 'title' && autoSlug) next.slug = slugify(v)
      return next
    })
  }

  async function save() {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)
      const url = isNew ? '/api/admin/landings' : `/api/admin/landings/${id}`
      const method = isNew ? 'POST' : 'PUT'
      const res = await apiFetch(url, { method, body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      setSuccess('Сохранено')
      setTimeout(() => setSuccess(null), 2500)
      if (isNew) {
        navigate(`/admin/landings/${data.landing.id}`, { replace: true })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleHome() {
    if (isNew) {
      setError('Сначала сохраните лендинг — назначить его главной можно только после создания')
      return
    }
    if (!form.is_published && !isHome) {
      setError('Сначала опубликуйте лендинг — иначе на главной покажется дефолтная страница')
      return
    }
    try {
      setHomeBusy(true)
      setError(null)
      const url = isHome ? '/api/admin/landings/clear-home' : `/api/admin/landings/${id}/set-as-home`
      const res = await apiFetch(url, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не удалось обновить главную')
      setIsHome(!isHome)
      setSuccess(isHome ? 'Снят с главной' : 'Назначен главной страницей')
      setTimeout(() => setSuccess(null), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setHomeBusy(false)
    }
  }

  // === Image upload ===
  async function uploadImage(file, { intoEditor = false, intoOg = false } = {}) {
    if (!file) return null
    try {
      setUploading(true)
      setError(null)
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch(`${API}/api/admin/uploads/landing-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')

      if (intoEditor) insertAtCursor(`<img src="${data.url}" alt="">`)
      if (intoOg) setField('og_image', data.url)
      return data.url
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setUploading(false)
    }
  }

  function insertAtCursor(text) {
    const cm = cmRef.current?.view
    if (!cm) {
      // Fallback — добавляем в конец
      setField('content', (form.content || '') + '\n' + text)
      return
    }
    const { from, to } = cm.state.selection.main
    cm.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    cm.focus()
  }

  function onImageButtonClick() {
    fileInputRef.current?.click()
  }

  function onImageFileChange(e) {
    const file = e.target.files?.[0]
    if (file) uploadImage(file, { intoEditor: true })
    e.target.value = '' // сброс чтобы можно было загрузить тот же файл повторно
  }

  // Live preview — DOMPurify на клиенте (на бэке тот же контент будет очищен повторно)
  const previewHtml = useMemo(() => {
    return DOMPurify.sanitize(form.content || '', {
      ADD_TAGS: ['iframe'],
      ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder', 'srcset'],
    })
  }, [form.content])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <button
          onClick={() => navigate('/admin/landings')}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition text-sm self-start"
        >
          <ArrowLeft className="w-4 h-4" /> К списку
        </button>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex bg-slate-800/60 border border-slate-700/50 rounded-lg p-0.5 flex-wrap">
            {[
              { id: 'split', label: 'Split', icon: FileText },
              { id: 'code', label: 'Код', icon: Code },
              { id: 'preview', label: 'Превью', icon: Eye },
              { id: 'seo', label: 'SEO', icon: Search },
              ...(isNew ? [] : [
                { id: 'stats', label: 'Статистика', icon: BarChart2 },
                { id: 'history', label: 'История', icon: History },
              ]),
            ].map(v => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
                  view === v.id ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <v.icon className="w-3.5 h-3.5" /> {v.label}
              </button>
            ))}
          </div>

          {!isNew && (
            <a
              href={`/p/${form.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs bg-slate-700/60 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-600 transition flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Открыть
            </a>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-semibold text-sm hover:shadow-lg hover:shadow-blue-500/30 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>

      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> {success}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <Ban className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Top form row: title, slug, published toggle */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 mb-1.5">Название</label>
            <input
              value={form.title}
              onChange={e => setField('title', e.target.value)}
              placeholder="Например: О нас"
              className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 mb-1.5 flex items-center justify-between">
              <span>Slug (URL)</span>
              <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer">
                <input type="checkbox" checked={autoSlug} onChange={e => setAutoSlug(e.target.checked)} className="accent-blue-500" />
                авто
              </label>
            </label>
            <div className="flex items-stretch">
              <span className="px-3 py-2 bg-slate-900/40 border border-slate-700 border-r-0 rounded-l-lg text-slate-500 text-sm font-mono">/p/</span>
              <input
                value={form.slug}
                onChange={e => { setField('slug', slugify(e.target.value)); setAutoSlug(false) }}
                placeholder="about-us"
                className="flex-1 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-r-lg text-white text-sm font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="md:col-span-2 flex items-end">
            <label className="flex items-center gap-2 px-3 py-2 w-full rounded-lg bg-slate-900/40 border border-slate-700/50 cursor-pointer hover:border-emerald-500/40 transition">
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={e => setField('is_published', e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
              <span className="text-sm text-white font-medium">Опубликован</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-4 pt-4 border-t border-slate-700/40">
          <div className="md:col-span-7">
            <label className="flex items-start gap-2 px-3 py-2.5 w-full rounded-lg bg-slate-900/40 border border-slate-700/50 cursor-pointer hover:border-blue-500/40 transition">
              <input
                type="checkbox"
                checked={form.show_in_menu}
                onChange={e => setField('show_in_menu', e.target.checked)}
                disabled={!form.is_published}
                className="w-4 h-4 accent-blue-500 mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm text-white font-medium">Показывать в верхнем меню сайта</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {form.is_published
                    ? 'Появится в навигации перед «Личный кабинет»'
                    : 'Сначала опубликуйте страницу'}
                </div>
              </div>
            </label>
          </div>
          <div className="md:col-span-5">
            <label className="block text-xs text-slate-400 mb-1.5">Порядок в меню</label>
            <input
              type="number"
              value={form.menu_order}
              onChange={e => setField('menu_order', parseInt(e.target.value) || 0)}
              disabled={!form.show_in_menu}
              className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
              placeholder="0"
            />
            <div className="text-[10px] text-slate-500 mt-1">Меньше — левее. При равных — по дате создания.</div>
          </div>
        </div>

        {/* Homepage toggle */}
        <div className="grid grid-cols-1 gap-3 mt-4 pt-4 border-t border-slate-700/40">
          <button
            type="button"
            onClick={toggleHome}
            disabled={homeBusy || isNew}
            className={`flex items-start gap-3 px-3 py-2.5 w-full rounded-lg border text-left transition disabled:opacity-50 disabled:cursor-not-allowed ${
              isHome
                ? 'bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/15'
                : 'bg-slate-900/40 border-slate-700/50 hover:border-amber-500/40'
            }`}
            title={isNew ? 'Сначала сохраните лендинг' : isHome ? 'Снять с главной' : 'Назначить главной'}
          >
            <HomeIcon className={`w-5 h-5 mt-0.5 ${isHome ? 'text-amber-300' : 'text-slate-400'}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${isHome ? 'text-amber-200' : 'text-white'}`}>
                {isHome ? 'Этот лендинг — главная страница сайта' : 'Сделать главной страницей сайта'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {isHome
                  ? 'Открывается по адресу «/». Нажмите, чтобы снять — главная вернётся к стандартной.'
                  : isNew
                    ? 'Доступно после первого сохранения'
                    : !form.is_published
                      ? 'Сначала опубликуйте лендинг'
                      : 'Заменит стандартную главную страницу — посетители увидят содержимое этого лендинга'}
              </div>
            </div>
            {homeBusy && <RefreshCw className="w-4 h-4 text-amber-300 animate-spin" />}
          </button>
        </div>
      </div>

      {/* SEO panel */}
      {view === 'seo' && (
        <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/50 border border-slate-700/50 rounded-2xl p-5 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-400" /> SEO настройки
          </h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Meta Title (отображается в браузере и Google)</label>
            <input
              value={form.meta_title}
              onChange={e => setField('meta_title', e.target.value)}
              maxLength={255}
              placeholder={form.title || 'Заголовок для поисковиков'}
              className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm"
            />
            <div className="text-[10px] text-slate-500 mt-1">{form.meta_title.length}/255 (рекомендуется 50–60)</div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Meta Description</label>
            <textarea
              value={form.meta_description}
              onChange={e => setField('meta_description', e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Краткое описание страницы для Google"
              className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm resize-none"
            />
            <div className="text-[10px] text-slate-500 mt-1">{form.meta_description.length}/500 (рекомендуется 150–160)</div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Keywords (через запятую)</label>
            <input
              value={form.meta_keywords}
              onChange={e => setField('meta_keywords', e.target.value)}
              maxLength={500}
              placeholder="vpn, безопасность, конфиденциальность"
              className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">OG Image (URL картинки для соцсетей)</label>
              <div className="flex gap-2">
                <input
                  value={form.og_image}
                  onChange={e => setField('og_image', e.target.value)}
                  placeholder="https://example.com/og.jpg или /uploads/..."
                  className="flex-1 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm font-mono"
                />
                <label className="px-3 py-2 bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-lg text-xs cursor-pointer hover:bg-cyan-500/25 transition flex items-center gap-1">
                  <ImageIcon className="w-3.5 h-3.5" />
                  {uploading ? '...' : 'Загрузить'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadImage(f, { intoOg: true })
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Рекомендуется 1200×630px. Формат: jpg/png/webp.</div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Canonical URL</label>
              <input
                value={form.canonical_url}
                onChange={e => setField('canonical_url', e.target.value)}
                placeholder="https://yoursite.com/p/about-us"
                className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Schema.org type (для rich results в Google)</label>
            <select
              value={form.schema_type}
              onChange={e => setField('schema_type', e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-white text-sm"
            >
              <option value="WebPage">WebPage — обычная страница</option>
              <option value="Article">Article — статья / блог</option>
              <option value="AboutPage">AboutPage — о компании</option>
              <option value="ContactPage">ContactPage — контакты</option>
              <option value="FAQPage">FAQPage — FAQ страница</option>
            </select>
          </div>

          {/* OG Preview */}
          <div className="border-t border-slate-700/40 pt-5 mt-2">
            <div className="text-sm font-semibold text-white mb-3">Превью карточек в соцсетях</div>
            <OgPreview
              title={form.meta_title || form.title}
              description={form.meta_description}
              ogImage={form.og_image}
              slug={form.slug}
            />
          </div>
        </div>
      )}

      {/* Stats / History */}
      {view === 'stats' && !isNew && <LandingViewsPanel landingId={id} />}
      {view === 'history' && !isNew && <LandingAuditPanel landingId={id} />}

      {/* Editor + Preview */}
      {view !== 'seo' && (
        <div className={`grid gap-4 ${view === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          {(view === 'split' || view === 'code') && (
            <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl overflow-hidden flex flex-col">
              <div className="px-4 py-2 border-b border-slate-700/50 flex items-center gap-2 bg-slate-800/50">
                <Code className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-slate-200 font-medium">HTML</span>
                <button
                  type="button"
                  onClick={onImageButtonClick}
                  disabled={uploading}
                  className="ml-2 px-2.5 py-1 text-xs bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded-md hover:bg-cyan-500/25 transition disabled:opacity-50 flex items-center gap-1"
                  title="Загрузить картинку и вставить тег <img>"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  {uploading ? 'Загрузка...' : 'Картинка'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  onChange={onImageFileChange}
                  className="hidden"
                />
                <span className="ml-auto text-[10px] text-slate-500">{(form.content || '').length} симв.</span>
              </div>
              <CodeMirror
                ref={cmRef}
                value={form.content}
                onChange={(v) => setField('content', v)}
                height={view === 'code' ? '70vh' : '65vh'}
                theme={oneDark}
                extensions={[cmHtml()]}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: true,
                  indentOnInput: true,
                }}
              />
            </div>
          )}
          {(view === 'split' || view === 'preview') && (
            <div className="bg-white border border-slate-700/50 rounded-2xl overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-2 bg-slate-100">
                <Eye className="w-4 h-4 text-slate-700" />
                <span className="text-sm text-slate-800 font-medium">Превью</span>
                <span className="ml-auto text-[10px] text-slate-500">очищено DOMPurify</span>
              </div>
              <div
                className="overflow-auto"
                style={{ height: view === 'preview' ? '70vh' : '65vh' }}
              >
                <div
                  className="landing-preview p-4 text-slate-900"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
