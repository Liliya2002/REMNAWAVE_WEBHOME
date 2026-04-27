import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { RefreshCw } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export default function LandingPage() {
  const { slug } = useParams()
  const [landing, setLanding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    setLanding(null)
    fetch(`${API}/api/landings/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return null }
        if (!res.ok) throw new Error('Failed')
        return res.json()
      })
      .then(data => {
        if (data?.landing) setLanding(data.landing)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <RefreshCw className="w-10 h-10 text-blue-400 animate-spin" />
      </div>
    )
  }

  if (notFound || !landing) {
    return (
      <div className="text-center py-32 px-4">
        <h1 className="text-4xl font-bold text-white mb-3">404</h1>
        <p className="text-slate-400">Страница не найдена</p>
      </div>
    )
  }

  const title = landing.meta_title || landing.title
  const description = landing.meta_description || ''
  const canonical = landing.canonical_url || `${window.location.origin}/p/${landing.slug}`
  const schemaType = landing.schema_type || 'WebPage'

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: title,
    headline: title,
    url: canonical,
    ...(description ? { description } : {}),
    ...(landing.og_image ? { image: landing.og_image } : {}),
    ...(landing.published_at ? { datePublished: new Date(landing.published_at).toISOString() } : {}),
    ...(landing.updated_at ? { dateModified: new Date(landing.updated_at).toISOString() } : {}),
  }

  return (
    <>
      <Helmet>
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        {landing.meta_keywords && <meta name="keywords" content={landing.meta_keywords} />}
        <link rel="canonical" href={canonical} />
        {/* Open Graph */}
        <meta property="og:title" content={title} />
        {description && <meta property="og:description" content={description} />}
        {landing.og_image && <meta property="og:image" content={landing.og_image} />}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        {/* Twitter */}
        <meta name="twitter:card" content={landing.og_image ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={title} />
        {description && <meta name="twitter:description" content={description} />}
        {landing.og_image && <meta name="twitter:image" content={landing.og_image} />}
        {/* Schema.org JSON-LD */}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      {/* Контент уже очищен на сервере sanitize-html. Рендерим как есть. */}
      <article
        className="landing-content"
        dangerouslySetInnerHTML={{ __html: landing.content }}
      />
    </>
  )
}
