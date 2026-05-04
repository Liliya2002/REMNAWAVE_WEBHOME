const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, verifyAdmin } = require('../middleware');
const { sanitizeLandingHtml } = require('../services/landingSanitizer');
const { DEFAULT_HOME_HTML, DEFAULT_HOME_META } = require('../services/defaultHomeTemplate');

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// === Audit log helpers ===
const AUDITABLE_FIELDS = [
  'slug', 'title', 'content', 'is_published', 'show_in_menu', 'menu_order',
  'meta_title', 'meta_description', 'meta_keywords', 'og_image', 'canonical_url',
  'schema_type',
];
function diffPayload(oldRow, newRow) {
  const changes = {};
  if (!oldRow) return null; // create — пишем без diff
  for (const k of AUDITABLE_FIELDS) {
    const a = oldRow[k];
    const b = newRow[k];
    if (a === undefined || b === undefined) continue;
    if (String(a ?? '') !== String(b ?? '')) {
      // content храним только превью (первые 80 симв.), чтобы аудит-таблица не разбухала
      if (k === 'content') {
        changes[k] = [String(a || '').slice(0, 80) + '…', String(b || '').slice(0, 80) + '…'];
      } else {
        changes[k] = [a, b];
      }
    }
  }
  return Object.keys(changes).length ? changes : null;
}
async function writeAudit(landingId, userId, action, changes) {
  try {
    await db.query(
      `INSERT INTO landing_page_audit (landing_id, user_id, action, changes)
       VALUES ($1, $2, $3, $4)`,
      [landingId, userId, action, changes ? JSON.stringify(changes) : null]
    );
  } catch (err) {
    console.error('Audit write error:', err.message);
  }
}

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') return 'Slug обязателен';
  if (slug.length < 1 || slug.length > 120) return 'Slug 1–120 символов';
  if (!SLUG_REGEX.test(slug)) return 'Slug может содержать только строчные буквы, цифры и дефис';
  return null;
}

function validatePayload(body, { isCreate }) {
  const errors = [];
  if (isCreate || body.slug !== undefined) {
    const slugErr = validateSlug(body.slug);
    if (slugErr) errors.push(slugErr);
  }
  if (isCreate || body.title !== undefined) {
    if (!body.title || typeof body.title !== 'string' || body.title.length > 255) {
      errors.push('Title обязателен и не длиннее 255 символов');
    }
  }
  if (body.meta_title && body.meta_title.length > 255) errors.push('meta_title слишком длинный');
  if (body.meta_description && body.meta_description.length > 500) errors.push('meta_description слишком длинный');
  if (body.meta_keywords && body.meta_keywords.length > 500) errors.push('meta_keywords слишком длинный');
  return errors;
}

/**
 * GET /api/admin/landings
 * Список всех лендингов (с фильтрами)
 */
router.get('/', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let where = '';
    const params = [];
    if (status === 'published') where = 'WHERE is_published = true';
    else if (status === 'draft') where = 'WHERE is_published = false';

    const r = await db.query(
      `SELECT lp.id, lp.slug, lp.title, lp.is_published, lp.show_in_menu, lp.menu_order,
              lp.meta_title, lp.meta_description,
              lp.created_at, lp.updated_at, lp.published_at,
              COALESCE(v30.views30, 0) AS views_30d,
              (sc.home_landing_id = lp.id) AS is_home
       FROM landing_pages lp
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS views30
         FROM landing_page_visits
         WHERE landing_id = lp.id AND visited_at > NOW() - INTERVAL '30 days'
       ) v30 ON true
       LEFT JOIN site_config sc ON true
       ${where}
       ORDER BY lp.updated_at DESC`,
      params
    );
    res.json({ landings: r.rows });
  } catch (err) {
    console.error('Landings list error:', err);
    res.status(500).json({ error: 'Failed to load landings' });
  }
});

/**
 * GET /api/admin/landings/:id
 * Получить лендинг для редактирования
 */
router.get('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const r = await db.query(
      `SELECT lp.*, (sc.home_landing_id = lp.id) AS is_home
         FROM landing_pages lp
         LEFT JOIN site_config sc ON true
        WHERE lp.id = $1`,
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ landing: r.rows[0] });
  } catch (err) {
    console.error('Landing get error:', err);
    res.status(500).json({ error: 'Failed to load landing' });
  }
});

/**
 * POST /api/admin/landings
 * Создать новый лендинг
 */
router.post('/', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const errs = validatePayload(req.body || {}, { isCreate: true });
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });

    const {
      slug, title, content,
      meta_title, meta_description, meta_keywords, og_image, canonical_url,
      is_published, show_in_menu, menu_order, schema_type,
    } = req.body;

    const safeContent = sanitizeLandingHtml(content || '');
    const publishedAt = is_published ? new Date() : null;
    const menuOrderNum = Number.isInteger(Number(menu_order)) ? Number(menu_order) : 0;
    const schemaType = ['WebPage', 'Article', 'FAQPage', 'AboutPage', 'ContactPage'].includes(schema_type) ? schema_type : 'WebPage';

    const r = await db.query(
      `INSERT INTO landing_pages
        (slug, title, content, is_published, show_in_menu, menu_order,
         meta_title, meta_description, meta_keywords, og_image, canonical_url,
         schema_type, created_by, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        slug, title, safeContent, !!is_published, !!show_in_menu, menuOrderNum,
        meta_title || null, meta_description || null, meta_keywords || null, og_image || null, canonical_url || null,
        schemaType, req.userId, publishedAt,
      ]
    );
    const created = r.rows[0];
    writeAudit(created.id, req.userId, 'create', null);
    res.json({ landing: created });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug уже занят' });
    console.error('Landing create error:', err);
    res.status(500).json({ error: 'Failed to create landing' });
  }
});

/**
 * PUT /api/admin/landings/:id
 * Обновить лендинг
 */
router.put('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const errs = validatePayload(req.body || {}, { isCreate: false });
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });

    const {
      slug, title, content,
      meta_title, meta_description, meta_keywords, og_image, canonical_url,
      is_published, show_in_menu, menu_order, schema_type,
    } = req.body;

    const safeContent = content !== undefined ? sanitizeLandingHtml(content) : undefined;
    const menuOrderVal = (menu_order !== undefined && Number.isInteger(Number(menu_order)))
      ? Number(menu_order) : null;
    const allowedSchemaTypes = ['WebPage', 'Article', 'FAQPage', 'AboutPage', 'ContactPage'];
    const schemaTypeVal = (schema_type !== undefined && allowedSchemaTypes.includes(schema_type)) ? schema_type : null;

    // Прочитаем "до" — для аудита
    const beforeRes = await db.query('SELECT * FROM landing_pages WHERE id = $1', [id]);
    if (beforeRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const before = beforeRes.rows[0];

    const r = await db.query(
      `UPDATE landing_pages SET
         slug = COALESCE($2, slug),
         title = COALESCE($3, title),
         content = COALESCE($4, content),
         is_published = COALESCE($5, is_published),
         meta_title = COALESCE($6, meta_title),
         meta_description = COALESCE($7, meta_description),
         meta_keywords = COALESCE($8, meta_keywords),
         og_image = COALESCE($9, og_image),
         canonical_url = COALESCE($10, canonical_url),
         show_in_menu = COALESCE($11, show_in_menu),
         menu_order = COALESCE($12, menu_order),
         schema_type = COALESCE($13, schema_type),
         published_at = CASE
           WHEN $5::boolean = true AND is_published = false THEN NOW()
           WHEN $5::boolean = false THEN published_at
           ELSE published_at
         END
       WHERE id = $1
       RETURNING *`,
      [
        id,
        slug !== undefined ? slug : null,
        title !== undefined ? title : null,
        safeContent !== undefined ? safeContent : null,
        is_published !== undefined ? !!is_published : null,
        meta_title !== undefined ? meta_title : null,
        meta_description !== undefined ? meta_description : null,
        meta_keywords !== undefined ? meta_keywords : null,
        og_image !== undefined ? og_image : null,
        canonical_url !== undefined ? canonical_url : null,
        show_in_menu !== undefined ? !!show_in_menu : null,
        menuOrderVal,
        schemaTypeVal,
      ]
    );
    const after = r.rows[0];
    const changes = diffPayload(before, after);
    if (changes) writeAudit(id, req.userId, 'update', changes);
    res.json({ landing: after });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug уже занят' });
    console.error('Landing update error:', err);
    res.status(500).json({ error: 'Failed to update landing' });
  }
});

/**
 * DELETE /api/admin/landings/:id
 */
router.delete('/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const r = await db.query('DELETE FROM landing_pages WHERE id = $1 RETURNING id, slug, title', [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    // landing_id уже удалён, поэтому пишем audit с landing_id = NULL и slug в changes
    writeAudit(null, req.userId, 'delete', { slug: r.rows[0].slug, title: r.rows[0].title });
    res.json({ ok: true });
  } catch (err) {
    console.error('Landing delete error:', err);
    res.status(500).json({ error: 'Failed to delete landing' });
  }
});

/**
 * POST /api/admin/landings/:id/toggle-publish
 */
router.post('/:id/toggle-publish', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const r = await db.query(
      `UPDATE landing_pages
       SET is_published = NOT is_published,
           published_at = CASE WHEN NOT is_published THEN NOW() ELSE published_at END
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const updated = r.rows[0];
    writeAudit(id, req.userId, updated.is_published ? 'publish' : 'unpublish', null);
    res.json({ landing: updated });
  } catch (err) {
    console.error('Landing toggle-publish error:', err);
    res.status(500).json({ error: 'Failed to toggle publish' });
  }
});

/**
 * POST /api/admin/landings/import-default-home
 * Создаёт лендинг, заполненный HTML-снимком текущего <Landing /> компонента.
 * Дальше админ редактирует тексты в визуальном редакторе и при желании
 * назначает его главной (set-as-home).
 *
 * Идемпотентность: если slug "home" свободен — занимаем его. Иначе пробуем
 * home-2, home-3, ... до 99. Возвращаем созданный (или ранее созданный) лендинг.
 */
router.post('/import-default-home', verifyToken, verifyAdmin, async (req, res) => {
  try {
    // Подбираем свободный slug
    let slug = 'home';
    for (let i = 2; i <= 99; i++) {
      const r = await db.query('SELECT id FROM landing_pages WHERE slug = $1 LIMIT 1', [slug]);
      if (r.rows.length === 0) break;
      slug = `home-${i}`;
    }

    const safeContent = sanitizeLandingHtml(DEFAULT_HOME_HTML);

    const r = await db.query(
      `INSERT INTO landing_pages
        (slug, title, content, is_published, show_in_menu, menu_order,
         meta_title, meta_description, meta_keywords, schema_type, created_by)
       VALUES ($1,$2,$3,false,false,0,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        slug, DEFAULT_HOME_META.title, safeContent,
        DEFAULT_HOME_META.meta_title, DEFAULT_HOME_META.meta_description,
        DEFAULT_HOME_META.meta_keywords, DEFAULT_HOME_META.schema_type,
        req.userId,
      ]
    );
    const created = r.rows[0];
    writeAudit(created.id, req.userId, 'create', { source: 'import-default-home' });
    res.json({ landing: created });
  } catch (err) {
    console.error('Import-default-home error:', err);
    res.status(500).json({ error: 'Failed to import default home' });
  }
});

/**
 * POST /api/admin/landings/:id/set-as-home
 * Назначить лендинг главной страницей (site_config.home_landing_id).
 * Лендинг должен быть опубликован — иначе посетители увидят 404 от /api/landings/home.
 */
router.post('/:id/set-as-home', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const r = await db.query('SELECT id, is_published FROM landing_pages WHERE id = $1', [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!r.rows[0].is_published) {
      return res.status(400).json({ error: 'Сначала опубликуйте лендинг — иначе главная отдаст 404 и покажется дефолтная страница' });
    }

    await db.query(
      'UPDATE site_config SET home_landing_id = $1 WHERE id = (SELECT id FROM site_config LIMIT 1)',
      [id]
    );
    writeAudit(id, req.userId, 'set_as_home', null);
    res.json({ ok: true, home_landing_id: id });
  } catch (err) {
    console.error('Set-as-home error:', err);
    res.status(500).json({ error: 'Failed to set home landing' });
  }
});

/**
 * POST /api/admin/landings/clear-home
 * Снять любой назначенный лендинг с главной — главная вернётся к дефолтной странице.
 */
router.post('/clear-home', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const before = await db.query('SELECT home_landing_id FROM site_config LIMIT 1');
    const prevId = before.rows[0]?.home_landing_id || null;
    await db.query('UPDATE site_config SET home_landing_id = NULL WHERE id = (SELECT id FROM site_config LIMIT 1)');
    if (prevId) writeAudit(prevId, req.userId, 'clear_home', null);
    res.json({ ok: true });
  } catch (err) {
    console.error('Clear-home error:', err);
    res.status(500).json({ error: 'Failed to clear home landing' });
  }
});

/**
 * GET /api/admin/landings/:id/audit
 * История правок (последние 50)
 */
router.get('/:id/audit', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const r = await db.query(
      `SELECT a.id, a.action, a.changes, a.created_at,
              u.id AS user_id, u.login AS user_login, u.email AS user_email
       FROM landing_page_audit a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.landing_id = $1
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [id]
    );
    res.json({ entries: r.rows });
  } catch (err) {
    console.error('Audit fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

/**
 * GET /api/admin/landings/:id/views?days=30
 * Статистика просмотров: график по дням
 */
router.get('/:id/views', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
    const r = await db.query(
      `SELECT DATE(visited_at) AS day, COUNT(*)::int AS count
       FROM landing_page_visits
       WHERE landing_id = $1 AND visited_at > NOW() - ($2 * INTERVAL '1 day')
       GROUP BY day ORDER BY day ASC`,
      [id, days]
    );
    const total = r.rows.reduce((sum, row) => sum + row.count, 0);
    res.json({ days, total, daily: r.rows });
  } catch (err) {
    console.error('Views fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch views' });
  }
});

module.exports = router;
