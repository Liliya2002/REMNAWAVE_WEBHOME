import React, { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { RefreshCw } from 'lucide-react'
import Landing from './Landing'

const API = import.meta.env.VITE_API_URL || ''

export default function Home() {
  const [landing, setLanding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [useFallback, setUseFallback] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/api/landings/home`)
      .then(async (res) => {
        if (res.status === 404) { if (!cancelled) setUseFallback(true); return null }
        if (!res.ok) throw new Error('Failed')
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        if (data?.landing) setLanding(data.landing)
        else setUseFallback(true)
      })
      .catch(() => { if (!cancelled) setUseFallback(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <RefreshCw className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" />
      </div>
    )
  }

  if (useFallback || !landing) {
    return <Landing />
  }

  const title = landing.meta_title || landing.title
  const description = landing.meta_description || ''
  const canonical = landing.canonical_url || `${window.location.origin}/`
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
        <meta property="og:title" content={title} />
        {description && <meta property="og:description" content={description} />}
        {landing.og_image && <meta property="og:image" content={landing.og_image} />}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content={landing.og_image ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={title} />
        {description && <meta name="twitter:description" content={description} />}
        {landing.og_image && <meta name="twitter:image" content={landing.og_image} />}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <article
        className="landing-content"
        dangerouslySetInnerHTML={{ __html: landing.content }}
      />
    </>
  )
}
