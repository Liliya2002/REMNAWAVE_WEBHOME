import React, { createContext, useContext, useState, useEffect } from 'react'

const SiteConfigContext = createContext(null)

export function useSiteConfig() {
  return useContext(SiteConfigContext)
}

export function SiteConfigProvider({ children }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchConfig()
  }, [])

  async function fetchConfig() {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/public/config`)
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config || null)
        applyConfigToDOM(data.config)
      }
    } catch (err) {
      console.warn('Failed to load site config:', err)
    } finally {
      setLoading(false)
    }
  }

  // Обновить конфиг (вызывается админом после сохранения)
  function refreshConfig() {
    fetchConfig()
  }

  return (
    <SiteConfigContext.Provider value={{ config, loading, refreshConfig }}>
      {children}
    </SiteConfigContext.Provider>
  )
}

/**
 * Применяет конфигурацию: CSS-переменные, title, favicon, custom_css
 */
function applyConfigToDOM(cfg) {
  if (!cfg) return

  const root = document.documentElement

  // --- CSS-переменные цветов ---
  if (cfg.color_primary) root.style.setProperty('--color-primary', cfg.color_primary)
  if (cfg.color_secondary) root.style.setProperty('--color-secondary', cfg.color_secondary)
  if (cfg.color_accent) root.style.setProperty('--color-accent', cfg.color_accent)
  if (cfg.color_danger) root.style.setProperty('--color-danger', cfg.color_danger)
  if (cfg.color_success) root.style.setProperty('--color-success', cfg.color_success)

  // --- Шрифт ---
  if (cfg.font_family) {
    root.style.setProperty('--font-family', cfg.font_family)
    root.style.fontFamily = cfg.font_family
  }
  if (cfg.font_size_base) {
    root.style.setProperty('--font-size-base', cfg.font_size_base)
    root.style.fontSize = cfg.font_size_base
  }

  // --- Ширина контейнера ---
  if (cfg.layout_width) root.style.setProperty('--layout-width', cfg.layout_width)

  // --- <title> ---
  if (cfg.site_title) {
    document.title = cfg.site_title
  }

  // --- <meta description> ---
  if (cfg.site_description) {
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', cfg.site_description)
  }

  // --- Favicon ---
  if (cfg.site_favicon_url) {
    let link = document.querySelector("link[rel~='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = cfg.site_favicon_url
  }

  // --- Custom CSS ---
  const existingCustomStyle = document.getElementById('site-custom-css')
  if (existingCustomStyle) existingCustomStyle.remove()

  if (cfg.custom_css) {
    const style = document.createElement('style')
    style.id = 'site-custom-css'
    style.textContent = cfg.custom_css
    document.head.appendChild(style)
  }

  // --- Google Analytics ---
  if (cfg.google_analytics_id && !document.getElementById('ga-script')) {
    const script = document.createElement('script')
    script.id = 'ga-script'
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${cfg.google_analytics_id}`
    document.head.appendChild(script)

    const inlineScript = document.createElement('script')
    inlineScript.textContent = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${cfg.google_analytics_id}');
    `
    document.head.appendChild(inlineScript)
  }
}
