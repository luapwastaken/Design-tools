// ── Nearest-match against print color libraries ───────────────────────────────
// Uses ΔE OK (via colorjs.io) for perceptual accuracy.
// Results are cached per (hex, library) to avoid re-running on every render.

import { deltaE } from './color.js'

const _cache = new Map()

function cacheKey(hex, lib) { return `${hex}:${lib}` }

export function nearestMatch(hex, library) {
  const key = cacheKey(hex, library)
  if (_cache.has(key)) return _cache.get(key)
  let best = null
  let bestDe = Infinity
  for (const entry of library) {
    const de = deltaE(hex, entry.hex)
    if (de < bestDe) {
      bestDe = de
      best = { ...entry, deltaE: Math.round(de * 10) / 10 }
    }
  }
  _cache.set(key, best)
  return best
}

export function clearMatchCache() { _cache.clear() }

// Find nearest in multiple libraries at once
export function nearestMatches(hex, libraries) {
  return Object.fromEntries(
    Object.entries(libraries).map(([name, lib]) => [name, nearestMatch(hex, lib)])
  )
}
