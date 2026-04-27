const sanitizeHtml = require('sanitize-html');

// Конфиг санитайзера: щедрый whitelist для лендингов, но без script/event-handlers/javascript:
const SANITIZE_OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'ul', 'ol', 'li',
    'b', 'i', 'em', 'strong', 'u', 's', 'small', 'mark', 'sup', 'sub',
    'img', 'figure', 'figcaption',
    'blockquote', 'code', 'pre', 'kbd',
    'br', 'hr',
    'div', 'span', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'iframe',
    'video', 'source',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'data-*', 'aria-*', 'role'],
    a: ['href', 'target', 'rel', 'name'],
    img: ['src', 'srcset', 'alt', 'width', 'height', 'loading'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder'],
    video: ['src', 'controls', 'autoplay', 'loop', 'muted', 'poster', 'width', 'height'],
    source: ['src', 'type'],
    table: ['border', 'cellpadding', 'cellspacing'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
  },
  // Только https:// и относительные. Никаких javascript:, data:, vbscript:.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'], // data: разрешён только для img (base64-картинки)
  },
  // iframe — только из доверенных доменов (видео-плееры, карты)
  allowedIframeHostnames: [
    'www.youtube.com', 'youtube.com', 'youtube-nocookie.com',
    'player.vimeo.com', 'vimeo.com',
    'rutube.ru', 'rutu.be',
    'vk.com', 'vkvideo.ru',
    'www.google.com', // карты
  ],
  // CSS-свойства, которые можно оставлять в style="..." (whitelist).
  allowedStyles: {
    '*': {
      color: [/^[\w#().,%\s-]+$/],
      'background-color': [/^[\w#().,%\s-]+$/],
      'background': [/^[\w#().,%\s\-:/'"]+$/],
      'background-image': [/^[\w#().,%\s\-:/'"]+$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/^[\d.]+(px|em|rem|%|pt)$/],
      'font-weight': [/^(normal|bold|bolder|lighter|\d+)$/],
      'font-family': [/^[\w\s,'"-]+$/],
      'font-style': [/^(normal|italic|oblique)$/],
      'line-height': [/^[\d.]+(px|em|rem|%)?$/],
      'letter-spacing': [/^[-\d.]+(px|em|rem)$/],
      'text-decoration': [/^(none|underline|overline|line-through)$/],
      'text-transform': [/^(none|uppercase|lowercase|capitalize)$/],
      width: [/^[\d.]+(px|em|rem|%|vw)$/, /^auto$/],
      'max-width': [/^[\d.]+(px|em|rem|%|vw)$/, /^none$/],
      height: [/^[\d.]+(px|em|rem|%|vh)$/, /^auto$/],
      margin: [/^[\d\s.\-a-z%]+$/],
      'margin-top': [/^[\d.\-]+(px|em|rem|%)$/, /^auto$/],
      'margin-right': [/^[\d.\-]+(px|em|rem|%)$/, /^auto$/],
      'margin-bottom': [/^[\d.\-]+(px|em|rem|%)$/, /^auto$/],
      'margin-left': [/^[\d.\-]+(px|em|rem|%)$/, /^auto$/],
      padding: [/^[\d\s.a-z%]+$/],
      'padding-top': [/^[\d.]+(px|em|rem|%)$/],
      'padding-right': [/^[\d.]+(px|em|rem|%)$/],
      'padding-bottom': [/^[\d.]+(px|em|rem|%)$/],
      'padding-left': [/^[\d.]+(px|em|rem|%)$/],
      border: [/^[\w#().,%\s-]+$/],
      'border-radius': [/^[\d.]+(px|em|rem|%)$/],
      'box-shadow': [/^[\w#().,%\s-]+$/],
      display: [/^(block|inline|inline-block|flex|inline-flex|grid|inline-grid|none)$/],
      'flex-direction': [/^(row|row-reverse|column|column-reverse)$/],
      'justify-content': [/^(flex-start|flex-end|center|space-between|space-around|space-evenly)$/],
      'align-items': [/^(flex-start|flex-end|center|stretch|baseline)$/],
      gap: [/^[\d.]+(px|em|rem)$/],
      opacity: [/^[\d.]+$/],
    },
  },
  // Заставляем все внешние ссылки иметь rel="noopener noreferrer" чтобы исключить tabnabbing
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') {
        const rel = (attribs.rel || '').split(/\s+/).filter(Boolean);
        if (!rel.includes('noopener')) rel.push('noopener');
        if (!rel.includes('noreferrer')) rel.push('noreferrer');
        attribs.rel = rel.join(' ');
      }
      return { tagName, attribs };
    },
  },
};

function sanitizeLandingHtml(rawHtml) {
  if (typeof rawHtml !== 'string') return '';
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}

module.exports = { sanitizeLandingHtml };
