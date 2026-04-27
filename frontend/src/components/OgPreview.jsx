import React from 'react'

/**
 * Мокапы карточек как они будут выглядеть в Telegram / Twitter / Facebook
 * на основе title, description, og_image, slug.
 */
export default function OgPreview({ title, description, ogImage, slug }) {
  const t = title || 'Заголовок страницы'
  const d = description || 'Краткое описание появится здесь...'
  const url = `${window.location.host}/p/${slug || 'your-slug'}`

  const placeholder = (
    <div className="w-full h-full bg-gradient-to-br from-slate-700 via-slate-600 to-slate-700 flex items-center justify-center">
      <span className="text-slate-400 text-xs">Нет OG-картинки</span>
    </div>
  )

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-slate-400 mb-2">Telegram / WhatsApp / iMessage</div>
        <div className="max-w-md bg-slate-900/60 border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="aspect-[1.91/1] bg-slate-800 overflow-hidden">
            {ogImage ? <img src={ogImage} alt="" className="w-full h-full object-cover" /> : placeholder}
          </div>
          <div className="p-3">
            <div className="text-[11px] text-slate-500 truncate">{url}</div>
            <div className="text-sm text-white font-semibold truncate mt-0.5">{t}</div>
            <div className="text-xs text-slate-300 mt-1 line-clamp-2">{d}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-2">Twitter / X (summary_large_image)</div>
        <div className="max-w-md bg-slate-900/60 border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="aspect-[1.91/1] bg-slate-800 overflow-hidden border-b border-slate-700/50">
            {ogImage ? <img src={ogImage} alt="" className="w-full h-full object-cover" /> : placeholder}
          </div>
          <div className="p-3">
            <div className="text-[11px] text-slate-500 truncate">{url}</div>
            <div className="text-sm text-white truncate mt-0.5">{t}</div>
            <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{d}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-2">Facebook / VK</div>
        <div className="max-w-md bg-slate-100 text-slate-800 rounded-md overflow-hidden">
          <div className="aspect-[1.91/1] bg-slate-300 overflow-hidden">
            {ogImage ? <img src={ogImage} alt="" className="w-full h-full object-cover" /> : (
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">Нет OG-картинки</div>
            )}
          </div>
          <div className="p-3 bg-slate-200">
            <div className="text-[10px] text-slate-500 uppercase truncate">{url.replace(/.*?\//, '').split('/')[0] || window.location.host}</div>
            <div className="text-sm font-semibold mt-0.5 truncate">{t}</div>
            <div className="text-xs text-slate-700 mt-0.5 line-clamp-2">{d}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
