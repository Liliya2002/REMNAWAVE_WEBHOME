/**
 * Проверка актуальных версий RemnaWave Node и Xray-core через GitHub Releases.
 * Кэш в памяти (TTL 6ч) — GitHub без токена лимитирует 60 запросов/час.
 *
 * Форматы тегов различаются: remnawave/node → "2.8.0", XTLS/Xray-core → "v26.3.27".
 * Нормализуем (срезаем ведущий 'v').
 */

const REPOS = {
  node: 'remnawave/node',
  xray: 'XTLS/Xray-core',
}
const TTL_MS = 6 * 60 * 60 * 1000

let cache = { data: null, ts: 0 }

function normalize(v) {
  return String(v || '').trim().replace(/^v/i, '')
}

async function fetchLatest(repo) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vpnwebhome' },
      signal: ctrl.signal,
    })
    if (!r.ok) return null
    const j = await r.json()
    return normalize(j.tag_name || j.name)
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * @returns {{ node: string|null, xray: string|null, fetchedAt: string, cached: boolean }}
 */
async function getLatestVersions() {
  if (cache.data && Date.now() - cache.ts < TTL_MS) {
    return { ...cache.data, cached: true }
  }
  const [node, xray] = await Promise.all([fetchLatest(REPOS.node), fetchLatest(REPOS.xray)])
  // Если оба null (сбой сети) и есть старый кэш — отдаём его.
  if (node == null && xray == null && cache.data) {
    return { ...cache.data, cached: true }
  }
  const data = {
    node: node ?? cache.data?.node ?? null,
    xray: xray ?? cache.data?.xray ?? null,
    fetchedAt: new Date().toISOString(),
  }
  cache = { data, ts: Date.now() }
  return { ...data, cached: false }
}

/**
 * Сравнение версий semver-стиля. -1: a<b, 0: равны, 1: a>b, null: не сравнить.
 */
function compareVersions(a, b) {
  const na = normalize(a), nb = normalize(b)
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

module.exports = { getLatestVersions, compareVersions }
