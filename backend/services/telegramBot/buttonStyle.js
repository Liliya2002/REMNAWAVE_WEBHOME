/**
 * Оформление кнопок меню: цвет и иконка (Bot API 9.4, февраль 2026).
 *
 * Что API реально умеет — и чего не умеет.
 *
 * `style` принимает ровно три значения: primary (тёмно-синий), success
 * (зелёный), danger (красный). Полутонов, осветления и прозрачности у цветных
 * кнопок НЕТ — просили, но такого поля не существует. Зато отсутствие поля и
 * есть прозрачная кнопка: клиент рисует её фоном темы. Поэтому «сделать меню
 * легче» означает красить меньше, а не бледнее — цветом выделяем одно главное
 * действие, остальное оставляем прозрачным.
 *
 * `icon_custom_emoji_id` показывает кастомную иконку перед текстом. Работает
 * только если у владельца бота активен Telegram Premium либо боту куплены
 * юзернеймы на Fragment. Проверить это заранее нельзя: getMe такого не отдаёт.
 * Значит, нужен откат — см. isIconRejection ниже.
 */

/** Три цвета, четвёртого нет. Всё остальное — прозрачная кнопка. */
const STYLES = ['primary', 'success', 'danger']

/**
 * Схема «акценты»: цветом выделено одно действие, остальные прозрачные.
 *
 * Красить всё подряд смысла нет — когда цветные все, акцента не остаётся ни у
 * кого, а меню выглядит тяжелее, чем прозрачное. Значение из настроек кнопки
 * перекрывает эту таблицу.
 */
const DEFAULT_STYLE = {
  cabinet: 'primary',
}

/**
 * Убрать ведущий эмодзи из подписи.
 *
 * Подписи в проекте вида «👤 Личный кабинет». Если к такой кнопке добавить
 * иконку, получится «иконка + 👤 + текст» — два значка подряд. Раз иконка
 * ставится ВМЕСТО эмодзи, эмодзи из подписи убираем.
 *
 * Режем только начало строки и только то, что похоже на значок: буквы и цифры
 * не трогаем, чтобы не откусить первое слово у подписи без эмодзи.
 *
 * Исключение — клавишные эмодзи (1️⃣, #️⃣): они начинаются с обычного символа и
 * становятся значком только из-за хвоста U+FE0F U+20E3. Поэтому цифру режем
 * ровно тогда, когда этот хвост есть, и никогда — саму по себе.
 */
const LEADING_ICON = /^(?:[0-9#*]️?⃣|[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍⃣]|[←-⇿☀-➿⬀-⯿])+\s*/u

function stripLeadingEmoji(label) {
  const s = String(label || '')
  const cut = s.replace(LEADING_ICON, '')
  // Если после чистки ничего не осталось — подпись состояла из одного значка,
  // и тогда лучше оставить как было, чем показать пустую кнопку.
  return cut.trim() ? cut.trim() : s
}

/**
 * Навесить на кнопку цвет и иконку по настройкам.
 *
 * @param {object} btn   готовый объект кнопки (text + callback_data/url/web_app)
 * @param {object} cfg   запись из menu_buttons: { action, style?, icon? }
 * @param {boolean} iconsOk можно ли слать иконки (false после отказа Telegram)
 */
function decorate(btn, cfg = {}, { iconsOk = true } = {}) {
  const style = cfg.style === undefined || cfg.style === null || cfg.style === ''
    ? DEFAULT_STYLE[cfg.action]
    : cfg.style
  // 'none' — явный способ погасить цвет по умолчанию, не выдумывая четвёртый.
  if (STYLES.includes(style)) btn.style = style

  const icon = cfg.icon && String(cfg.icon).trim()
  if (iconsOk && icon) {
    btn.icon_custom_emoji_id = icon
    btn.text = stripLeadingEmoji(btn.text)
  }
  return btn
}

/**
 * Похоже ли, что Telegram отказал именно из-за иконки.
 *
 * Точной формулировки ошибки в документации нет, поэтому смотрим широко: если в
 * тексте и «custom emoji», и признак запрета — считаем, что дело в иконках.
 * Ошибиться в эту сторону безопасно: худшее последствие — одна лишняя отправка
 * без иконок, то есть меню всё равно дойдёт.
 */
function isIconRejection(err) {
  const t = String(err?.description || err?.message || '').toLowerCase()
  if (!t) return false
  // Разделитель в ошибках Telegram то пробел, то подчёркивание
  // («custom emoji is not allowed» и «CUSTOM_EMOJI_NOT_ALLOWED»), поэтому
  // в шаблонах он необязателен.
  return /custom[ _]?emoji/.test(t) &&
         /not[ _]?allow|forbidden|premium|invalid|can'?t|cannot|unavailable|no[ _]?rights/.test(t)
}

/** Выкинуть иконки из готовой разметки — для повторной отправки после отказа. */
function stripIcons(markup) {
  const rows = markup?.inline_keyboard
  if (!Array.isArray(rows)) return markup
  for (const row of rows) {
    for (const b of row) delete b.icon_custom_emoji_id
  }
  return markup
}

/** Есть ли в разметке хоть одна иконка — чтобы зря не пытаться повторять. */
function hasIcons(markup) {
  const rows = markup?.inline_keyboard
  if (!Array.isArray(rows)) return false
  return rows.some(row => row.some(b => b.icon_custom_emoji_id))
}

module.exports = {
  STYLES, DEFAULT_STYLE,
  decorate, stripLeadingEmoji, isIconRejection, stripIcons, hasIcons,
}
