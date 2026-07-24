import React from 'react'
import { ArrowUp, Check } from 'lucide-react'

// Сравнение версий semver-стиля. -1: a<b, 0: равны, 1: a>b, null: не сравнить.
export function compareVersions(a, b) {
  const na = String(a || '').trim().replace(/^v/i, '')
  const nb = String(b || '').trim().replace(/^v/i, '')
  if (!na || !nb) return null
  const pa = na.split('.').map(x => parseInt(x, 10))
  const pb = nb.split('.').map(x => parseInt(x, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0
    if (Number.isNaN(x) || Number.isNaN(y)) return null
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Показывает текущую версию + индикатор актуальности:
 *   • обновление доступно → янтарный «⬆ latest»
 *   • актуально → зелёная галочка
 *   • latest неизвестен → просто текущая версия
 */
export default function VersionBadge({ current, latest, className = '' }) {
  if (!current) return <span className={`text-slate-500 ${className}`}>—</span>
  const cmp = compareVersions(current, latest)

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono text-slate-200">{current}</span>
      {cmp === -1 && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400"
          title={`Доступно обновление: ${current} → ${latest}`}>
          <ArrowUp className="w-3 h-3" /> {latest}
        </span>
      )}
      {cmp === 0 && (
        <span className="inline-flex items-center px-1 py-0.5 rounded-md text-emerald-400" title="Актуальная версия">
          <Check className="w-3 h-3" />
        </span>
      )}
    </span>
  )
}
