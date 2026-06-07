// ── sRGB ↔ CMYK conversion ────────────────────────────────────────────────────
// Uses profile TAC limits from iccProfiles.json metadata.
// Note: this is numeric approximation, not ICC-managed color.

import iccProfiles from '../data/iccProfiles.json'

export function getProfile(id) {
  return iccProfiles.find(p => p.id === id) ?? iccProfiles[0]
}

export function rgbToCmyk(r255, g255, b255) {
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  const c = (1 - r - k) / (1 - k)
  const m = (1 - g - k) / (1 - k)
  const y = (1 - b - k) / (1 - k)
  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100),
  }
}

export function cmykToRgb(c, m, y, k) {
  const cf = c / 100, mf = m / 100, yf = y / 100, kf = k / 100
  return {
    r: Math.round(255 * (1 - cf) * (1 - kf)),
    g: Math.round(255 * (1 - mf) * (1 - kf)),
    b: Math.round(255 * (1 - yf) * (1 - kf)),
  }
}

export function tac(cmyk) {
  return cmyk.c + cmyk.m + cmyk.y + cmyk.k
}

export function tacWarning(cmyk, profileId) {
  const profile = getProfile(profileId)
  const t = tac(cmyk)
  return { tac: t, limit: profile.tac, over: t > profile.tac }
}

// Rich black suggestion: when K is near 100 and CMY are very low,
// suggest a rich black appropriate for the substrate.
export function richBlackSuggestion(cmyk, profileId) {
  const profile = getProfile(profileId)
  if (cmyk.k < 80 || cmyk.c + cmyk.m + cmyk.y > 30) return null
  if (profile.substrate === 'coated') return { c: 40, m: 30, y: 30, k: 100 }
  if (profile.substrate === 'newsprint') return { c: 20, m: 15, y: 15, k: 100 }
  return { c: 30, m: 20, y: 20, k: 100 }  // uncoated
}

export function hexToCmyk(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return rgbToCmyk(r, g, b)
}
