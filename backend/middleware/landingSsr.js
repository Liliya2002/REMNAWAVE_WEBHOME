const fs = require('fs');
const path = require('path');
const db = require('../db');

const DIST_INDEX = path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html');

let indexCache = null;
let indexCacheMtime = 0;

function getIndexHtml() {
  try {
    const stat = fs.statSync(DIST_INDEX);
    if (!indexCache || stat.mtimeMs > indexCacheMtime) {
      indexCache = fs.readFileSync(DIST_INDEX, 'utf8');
      indexCacheMtime = stat.mtimeMs;
    }
    return indexCache;
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMeta(landing, origin, { isHome = false } = {}) {
  const title = landing.meta_title || landing.title;
  const desc = landing.meta_description || '';
  const ogImage = landing.og_image || '';
  const canonical = landing.canonical_url || (isHome ? `${origin}/` : `${origin}/p/${landing.slug}`);
  const lines = [];
  lines.push(`<title>${escapeHtml(title)}</title>`);
  if (desc) lines.push(`<meta name="description" content="${escapeHtml(desc)}">`);
  if (landing.meta_keywords) lines.push(`<meta name="keywords" content="${escapeHtml(landing.meta_keywords)}">`);
  lines.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  // Open Graph
  lines.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
  if (desc) lines.push(`<meta property="og:description" content="${escapeHtml(desc)}">`);
  if (ogImage) lines.push(`<meta property="og:image" content="${escapeHtml(ogImage)}">`);
  lines.push(`<meta property="og:type" content="website">`);
  lines.push(`<meta property="og:url" content="${escapeHtml(canonical)}">`);
  // Twitter
  lines.push(`<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`);
  lines.push(`<meta name="twitter:title" content="${escapeHtml(title)}">`);
  if (desc) lines.push(`<meta name="twitter:description" content="${escapeHtml(desc)}">`);
  if (ogImage) lines.push(`<meta name="twitter:image" content="${escapeHtml(ogImage)}">`);
  // Schema.org JSON-LD
  const schemaType = landing.schema_type || 'WebPage';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: title,
    headline: title,
    description: desc || undefined,
    url: canonical,
    image: ogImage || undefined,
    datePublished: landing.published_at ? new Date(landing.published_at).toISOString() : undefined,
    dateModified: landing.updated_at ? new Date(landing.updated_at).toISOString() : undefined,
  };
  Object.keys(jsonLd).forEach(k => jsonLd[k] === undefined && delete jsonLd[k]);
  lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  return lines.join('\n    ');
}

function buildCsp() {
  // Строгий CSP для лендингов: разрешаем inline-styles (в HTML контенте используется style="..."),
  // но не разрешаем inline-scripts. Скрипты только со своего домена.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // 'unsafe-inline' нужен для inline JSON-LD; в prod-build Vite добавит хеши
    "style-src 'self' 'unsafe-inline'", // inline-style атрибуты в контенте лендинга (очищены sanitize-html)
    "img-src 'self' data: https:",
    "media-src 'self' https:",
    "font-src 'self' data: https:",
    "connect-src 'self'",
    "frame-src https://www.youtube.com https://youtube.com https://youtube-nocookie.com https://player.vimeo.com https://vimeo.com https://rutube.ru https://vk.com https://www.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
}

/**
 * Middleware для GET /p/:slug.
 * Если есть production-build (frontend/dist/index.html) — подменяет meta-теги в нём
 * (SSR-lite: контент остаётся пустым, но search-bots получают правильные title/description/og/JSON-LD).
 * Также ставит Content-Security-Policy для лендингов.
 */
function landingSsrMiddleware(req, res, next) {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return next();

  const tpl = getIndexHtml();
  if (!tpl) {
    // dev-режим (нет dist) — Vite сам обработает; ставим только CSP
    res.setHeader('Content-Security-Policy', buildCsp());
    return next();
  }

  db.query(
    `SELECT slug, title,
            meta_title, meta_description, meta_keywords, og_image, canonical_url,
            schema_type, published_at, updated_at
     FROM landing_pages WHERE slug = $1 AND is_published = true`,
    [slug]
  ).then(r => {
    res.setHeader('Content-Security-Policy', buildCsp());

    if (r.rows.length === 0) {
      // 404, но всё равно отдаём SPA — клиент сам покажет "404"
      return res.status(404).type('html').send(tpl);
    }

    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const origin = process.env.FRONTEND_URL?.replace(/\/$/, '') || `${proto}://${req.get('host')}`;
    const meta = buildMeta(r.rows[0], origin);

    // Подменяем <title> и инжектим meta-теги в <head>
    let html = tpl
      .replace(/<title>[^<]*<\/title>/i, '')
      .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
      .replace('</head>', `    ${meta}\n  </head>`);

    res.type('html').send(html);
  }).catch(err => {
    console.error('Landing SSR error:', err);
    res.setHeader('Content-Security-Policy', buildCsp());
    res.type('html').send(tpl);
  });
}

/**
 * Middleware для GET /.
 * Если в site_config.home_landing_id назначен опубликованный лендинг — подмешиваем его meta-теги.
 * Если назначения нет / лендинг снят с публикации — пропускаем дальше: SPA отрисует дефолтный <Landing />.
 */
function homeLandingSsrMiddleware(req, res, next) {
  // Не трогаем не-HTML запросы (assets, api и т.д.) — на них этот middleware не должен попасть,
  // но на всякий случай отфильтруем по Accept.
  const accept = String(req.headers.accept || '');
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return next();

  const tpl = getIndexHtml();
  if (!tpl) return next(); // dev-режим — пусть Vite разрулит

  db.query(
    `SELECT lp.slug, lp.title,
            lp.meta_title, lp.meta_description, lp.meta_keywords, lp.og_image, lp.canonical_url,
            lp.schema_type, lp.published_at, lp.updated_at
       FROM site_config sc
       JOIN landing_pages lp ON lp.id = sc.home_landing_id
      WHERE lp.is_published = true
      LIMIT 1`
  ).then(r => {
    res.setHeader('Content-Security-Policy', buildCsp());

    if (r.rows.length === 0) {
      // Нет назначенного home-лендинга — отдаём шаблон без подмены, фронт покажет <Landing />
      return res.type('html').send(tpl);
    }

    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const origin = process.env.FRONTEND_URL?.replace(/\/$/, '') || `${proto}://${req.get('host')}`;
    const meta = buildMeta(r.rows[0], origin, { isHome: true });

    let html = tpl
      .replace(/<title>[^<]*<\/title>/i, '')
      .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
      .replace('</head>', `    ${meta}\n  </head>`);

    res.type('html').send(html);
  }).catch(err => {
    console.error('Home landing SSR error:', err);
    res.type('html').send(tpl);
  });
}

module.exports = { landingSsrMiddleware, homeLandingSsrMiddleware };
