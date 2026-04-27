const express = require('express');
const router = express.Router();
const db = require('../db');

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getSiteOrigin(req) {
  // Берём из FRONTEND_URL (должен быть в .env), иначе из request
  const env = process.env.FRONTEND_URL;
  if (env) return env.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  return `${proto}://${req.get('host')}`;
}

/**
 * GET /sitemap.xml
 * Sitemap из статических роутов + опубликованных лендингов
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    const origin = getSiteOrigin(req);

    const staticPaths = [
      { loc: '/',         priority: '1.0', changefreq: 'weekly' },
      { loc: '/pricing',  priority: '0.9', changefreq: 'weekly' },
      { loc: '/servers',  priority: '0.8', changefreq: 'weekly' },
    ];

    const r = await db.query(
      `SELECT slug, COALESCE(updated_at, published_at, NOW()) AS lastmod
       FROM landing_pages
       WHERE is_published = true
       ORDER BY menu_order ASC, id ASC`
    );

    const urls = [
      ...staticPaths.map(s => `
  <url>
    <loc>${escapeXml(origin + s.loc)}</loc>
    <changefreq>${s.changefreq}</changefreq>
    <priority>${s.priority}</priority>
  </url>`),
      ...r.rows.map(row => `
  <url>
    <loc>${escapeXml(origin + '/p/' + row.slug)}</loc>
    <lastmod>${new Date(row.lastmod).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`),
    ].join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap error:', err);
    res.status(500).send('Failed to generate sitemap');
  }
});

/**
 * GET /robots.txt
 */
router.get('/robots.txt', (req, res) => {
  const origin = getSiteOrigin(req);
  const body = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /dashboard',
    'Disallow: /connect',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /payment/',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(body);
});

module.exports = router;
