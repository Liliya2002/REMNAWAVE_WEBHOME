const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/landings/menu
 * Список лендингов для отображения в верхнем меню сайта.
 * Только published + show_in_menu, отсортировано по menu_order, затем по id.
 * ВАЖНО: должен идти ПЕРЕД маршрутом /:slug, иначе слово "menu" попадёт туда.
 */
router.get('/menu', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT slug, title, menu_order
       FROM landing_pages
       WHERE is_published = true AND show_in_menu = true
       ORDER BY menu_order ASC, id ASC`
    );
    res.json({ items: r.rows });
  } catch (err) {
    console.error('Public landing menu error:', err);
    // Меню — некритично; вернём пустой список вместо 500
    res.json({ items: [] });
  }
});

/**
 * GET /api/landings/:slug
 * Публичный endpoint — возвращает только опубликованную страницу.
 */
router.get('/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!slug || slug.length > 120) return res.status(400).json({ error: 'Invalid slug' });

    const r = await db.query(
      `SELECT slug, title, content,
              meta_title, meta_description, meta_keywords, og_image, canonical_url,
              schema_type, published_at, updated_at
       FROM landing_pages
       WHERE slug = $1 AND is_published = true`,
      [slug]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const landing = r.rows[0];

    // Async fire-and-forget: счётчик просмотров. Сюда же запишем UA/referer (для аналитики).
    // Боты можно отсечь по UA-эвристике, чтобы не раздувать таблицу.
    const ua = String(req.headers['user-agent'] || '').slice(0, 255);
    const referer = String(req.headers['referer'] || '').slice(0, 500);
    const isBot = /bot|crawler|spider|crawling|preview|fetch/i.test(ua);
    if (!isBot) {
      db.query(
        `INSERT INTO landing_page_visits (landing_id, user_agent, referrer)
         SELECT id, $2, $3 FROM landing_pages WHERE slug = $1 AND is_published = true`,
        [slug, ua, referer]
      ).catch(err => console.error('Visit insert error:', err.message));
    }

    res.json({ landing });
  } catch (err) {
    console.error('Public landing get error:', err);
    res.status(500).json({ error: 'Failed to load landing' });
  }
});

module.exports = router;
