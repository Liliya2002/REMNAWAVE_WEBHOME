const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { verifyToken, verifyAdmin } = require('../middleware');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'landings');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext) ? ext : '.bin';
    const id = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}-${id}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Недопустимый тип файла. Разрешены: jpg, png, webp, gif, svg'));
    cb(null, true);
  },
});

/**
 * POST /api/admin/uploads/landing-image
 * Загрузка одного изображения для использования в редакторе/SEO лендинга.
 * Возвращает { url } — относительный URL, доступный публично.
 */
router.post('/landing-image', verifyToken, verifyAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Файл больше ${MAX_BYTES / 1024 / 1024}MB`
        : (err.message || 'Ошибка загрузки');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
    const url = `/uploads/landings/${req.file.filename}`;
    res.json({ url, filename: req.file.filename, size: req.file.size });
  });
});

module.exports = router;
