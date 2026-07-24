/**
 * GET /api/countries — публичный справочник стран ISO 3166-1.
 *
 * Используется фронтом для <CountrySelect> в формах (создание Remnawave-ноды,
 * фильтры, стат-разрезы). Список фактически статический — наполняется один раз
 * миграцией 0016_countries и почти не меняется. Поэтому кэшируется in-memory
 * на 1 час с принудительным сбросом по env-флагу.
 *
 * Ответ:
 *   {
 *     popular: [{ code, name_ru, name_en, flag, region }, ...],   // топ-30
 *     all:     [{ code, name_ru, name_en, flag, region }, ...]    // все, алфавит по name_en
 *   }
 *
 * Никакой фильтрации по region/поиска на бэке — фронт получает весь список
 * (~250 строк, ~25 KB JSON) и фильтрует у себя. Это проще и не требует
 * пагинации/индексов поверх и без того отсортированной таблицы.
 */
const express = require('express')
const router = express.Router()
const db = require('../db')

const CACHE_TTL_MS = 60 * 60 * 1000  // 1 час
let cache = { data: null, fetchedAt: 0 }

router.get('/', async (req, res) => {
  try {
    const now = Date.now()
    if (cache.data && (now - cache.fetchedAt) < CACHE_TTL_MS) {
      return res.json(cache.data)
    }

    const r = await db.query(
      `SELECT code, name_ru, name_en, flag, region, is_popular
         FROM countries
        ORDER BY is_popular DESC, name_en ASC`
    )

    const popular = []
    const all = []
    for (const row of r.rows) {
      const item = {
        code: row.code,
        name_ru: row.name_ru,
        name_en: row.name_en,
        flag: row.flag,
        region: row.region,
      }
      if (row.is_popular) popular.push(item)
      all.push(item)
    }

    cache = { data: { popular, all }, fetchedAt: now }
    res.set('Cache-Control', 'public, max-age=3600')
    res.json(cache.data)
  } catch (err) {
    console.error('[countries] error:', err.message)
    res.status(500).json({ error: 'Не удалось загрузить справочник стран' })
  }
})

module.exports = router
