import React from 'react'
import { Sparkles, MousePointer2 } from 'lucide-react'
import { useSiteConfig } from '../contexts/SiteConfigContext'
import { useEffects } from '../contexts/EffectsContext'

const base = 'p-2 rounded-lg transition-all'
const onCls = 'text-blue-500 dark:text-cyan-300 hover:bg-slate-200 dark:hover:bg-slate-800/50'
const offCls = 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800/50'

// Тумблер анимированного фона (звёзды). Локальное переопределение поверх
// глобальной настройки сайта (site_config.enable_starfield).
export function BgToggle() {
  const cfg = useSiteConfig()
  const { bgMode, setBgMode } = useEffects()
  const on = bgMode === 'off' ? false : bgMode === 'on' ? true : (cfg?.config?.enable_starfield !== false)
  return (
    <button
      onClick={() => setBgMode(on ? 'off' : 'on')}
      title={on ? 'Выключить анимированный фон' : 'Включить анимированный фон'}
      aria-pressed={on}
      className={`${base} ${on ? onCls : offCls}`}
    >
      <Sparkles className="w-5 h-5" />
    </button>
  )
}

// Тумблер свечения курсора (админка).
export function CursorToggle() {
  const { cursorMode, setCursorMode } = useEffects()
  const on = cursorMode !== 'off'
  return (
    <button
      onClick={() => setCursorMode(on ? 'off' : 'on')}
      title={on ? 'Выключить свечение курсора' : 'Включить свечение курсора'}
      aria-pressed={on}
      className={`${base} ${on ? onCls : offCls}`}
    >
      <MousePointer2 className="w-5 h-5" />
    </button>
  )
}
