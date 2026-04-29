/**
 * Admin docs — подгрузка markdown-инструкций с GitHub в runtime.
 *
 *   GET /api/admin/docs/:slug
 *
 * Запрашивает raw.githubusercontent.com/<GITHUB_REPO>/<DOCS_BRANCH>/docs/admin/<slug>.md
 * Кеш в памяти на DOCS_TTL_MS (10 мин). При недоступности GitHub — отдаёт last-known cached
 * (если он есть) с флагом stale=true.
 *
 * Slug whitelisted, чтобы нельзя было подменить путь.
 *
 * Доступ — только админ (verifyToken + verifyAdmin).
 */
const express = require('express')
const router = express.Router()
const { verifyToken, verifyAdmin } = require('../middleware')

router.use(verifyToken, verifyAdmin)

const GITHUB_REPO = (process.env.GITHUB_REPO || 'Liliya2002/REMNAWAVE_WEBHOME').trim()
const DOCS_BRANCH = (process.env.DOCS_BRANCH || 'main').trim()
const DOCS_TTL_MS = 10 * 60 * 1000 // 10 минут

// Whitelist slug → имя файла. Чтобы поддержать новые вкладки — добавить сюда.
const ALLOWED_DOCS = {
  'remnawave-xray':     'remnawave-xray.md',
  'remnawave-settings': 'remnawave-settings.md',
  'vps-setup':          'vps-setup.md',
  'payments':           'payments.md',
}

const cache = new Map() // slug -> { content, fetchedAt, sha }

async function fetchFromGitHub(filename) {
  const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${DOCS_BRANCH}/docs/admin/${filename}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'vpnwebhome-admin-docs' },
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      throw new Error(`GitHub ${r.status}: ${txt.slice(0, 200)}`)
    }
    return await r.text()
  } finally {
    clearTimeout(timer)
  }
}

router.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase()
  const filename = ALLOWED_DOCS[slug]
  if (!filename) {
    return res.status(404).json({ error: 'Unknown doc slug', slug, allowed: Object.keys(ALLOWED_DOCS) })
  }

  const now = Date.now()
  const cached = cache.get(slug)
  if (cached && (now - cached.fetchedAt) < DOCS_TTL_MS) {
    return res.json({
      slug,
      content: cached.content,
      cached: true,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      source: { repo: GITHUB_REPO, branch: DOCS_BRANCH, filename },
    })
  }

  try {
    const content = await fetchFromGitHub(filename)
    cache.set(slug, { content, fetchedAt: now })
    res.json({
      slug,
      content,
      cached: false,
      fetchedAt: new Date(now).toISOString(),
      source: { repo: GITHUB_REPO, branch: DOCS_BRANCH, filename },
    })
  } catch (err) {
    // Fallback: если есть старый кеш — отдаём его как stale
    if (cached) {
      return res.json({
        slug,
        content: cached.content,
        cached: true,
        stale: true,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        error: err.message,
        source: { repo: GITHUB_REPO, branch: DOCS_BRANCH, filename },
      })
    }
    res.status(502).json({
      error: 'Failed to fetch docs from GitHub',
      detail: err.message,
      source: { repo: GITHUB_REPO, branch: DOCS_BRANCH, filename },
    })
  }
})

module.exports = router
