// ── Color utilities ───────────────────────────────────────────────────────────
import Color from 'colorjs.io'

// ── Legacy helpers (kept for LogoMaker / PatternMaker compat) ─────────────────

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export function relativeLuminance(r, g, b) {
  const chan = v => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

export function wcagContrast(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1)
  const [r2, g2, b2] = hexToRgb(hex2)
  const l1 = relativeLuminance(r1, g1, b1)
  const l2 = relativeLuminance(r2, g2, b2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function wcagRating(ratio) {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'A'
  return 'fail'
}

// ── OKLCH-aware API ───────────────────────────────────────────────────────────

function _parse(input) {
  if (input instanceof Color) return input
  if (typeof input === 'string') return new Color(input)
  if (input && typeof input === 'object' && 'l' in input) {
    return new Color('oklch', [input.l, input.c, input.h])
  }
  throw new Error('parseColor: unrecognised input')
}

export function parseColor(str) {
  try { return new Color(str) } catch { return null }
}

export function toOklch(color) {
  const c = _parse(color).to('oklch')
  const [l, ch, h] = c.coords
  return { l: l ?? 0, c: ch ?? 0, h: isNaN(h) ? 0 : (h ?? 0) }
}

export function toHex(color) {
  try {
    return _parse(color).to('srgb').toString({ format: 'hex' })
  } catch {
    return '#000000'
  }
}

export function toRgb255(color) {
  const c = _parse(color).to('srgb')
  return [
    Math.round(Math.max(0, Math.min(1, c.coords[0])) * 255),
    Math.round(Math.max(0, Math.min(1, c.coords[1])) * 255),
    Math.round(Math.max(0, Math.min(1, c.coords[2])) * 255),
  ]
}

export function contrast(hexA, hexB) {
  try {
    const a = new Color(hexA)
    const b = new Color(hexB)
    return Math.abs(Color.contrast(a, b, 'WCAG21'))
  } catch {
    return 1
  }
}

export function deltaE(hexA, hexB) {
  try {
    const a = new Color(hexA)
    const b = new Color(hexB)
    return Color.deltaE(a, b, 'OK')
  } catch {
    return 0
  }
}

export function inSrgbGamut(color) {
  try { return _parse(color).inGamut('srgb') } catch { return false }
}

export function gamutMap(color) {
  try {
    const c = _parse(color).clone()
    c.toGamut('srgb')
    return c
  } catch {
    return _parse(color)
  }
}

export function interpolate(colorA, colorB, t, space = 'oklab') {
  const a = _parse(colorA)
  const b = _parse(colorB)
  return Color.mix(a, b, t, { space })
}

// ── Pigment mixing (subtractive / paint-like) ─────────────────────────────────
//
// Realistic paint mixing — blue + yellow → green, not the muddy grey you get
// from averaging RGB. Uses the single-constant Kubelka–Munk model: each linear
// channel is treated as a reflectance, converted to K/S (absorption/scatter),
// mixed by weight, then converted back. This is what makes the Mixer canvas
// behave like wet paint instead of additive light.

const _s2l = new Float64Array(256)   // sRGB 8-bit → linear LUT
for (let i = 0; i < 256; i++) {
  const c = i / 255
  _s2l[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function srgbToLinear(v8) { return _s2l[v8 & 255] }

export function linearToSrgb8(u) {
  const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, v)) * 255)
}

// Reflectance → K/S and back (single-constant Kubelka–Munk).
export function reflectanceToKS(R) {
  R = Math.min(0.9999, Math.max(0.0001, R))
  return (1 - R) * (1 - R) / (2 * R)
}
export function ksToReflectance(ks) {
  return 1 + ks - Math.sqrt(ks * ks + 2 * ks)
}

// Mix two linear-RGB triplets as pigments at ratio t (0 = a, 1 = b).
// Operates in-place-free on [r,g,b] arrays of 0..1 linear values.
export function mixLinearPigment(a, b, t) {
  const out = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const ks = reflectanceToKS(a[i]) * (1 - t) + reflectanceToKS(b[i]) * t
    out[i] = ksToReflectance(ks)
  }
  return out
}

// Mix two hex colors like paint. Returns a hex string.
export function mixPigments(hexA, hexB, t = 0.5) {
  const a = [srgbToLinear(parseInt(hexA.slice(1, 3), 16)), srgbToLinear(parseInt(hexA.slice(3, 5), 16)), srgbToLinear(parseInt(hexA.slice(5, 7), 16))]
  const b = [srgbToLinear(parseInt(hexB.slice(1, 3), 16)), srgbToLinear(parseInt(hexB.slice(3, 5), 16)), srgbToLinear(parseInt(hexB.slice(5, 7), 16))]
  const m = mixLinearPigment(a, b, t)
  return '#' + m.map(v => linearToSrgb8(v).toString(16).padStart(2, '0')).join('')
}

// Convert oklch {l,c,h} to a clamped hex string for display
export function oklchToHex(l, c, h) {
  try {
    const col = new Color('oklch', [l, c, isNaN(h) ? 0 : h])
    col.toGamut('srgb')
    return col.to('srgb').toString({ format: 'hex' })
  } catch {
    return '#808080'
  }
}

// Auto-name a color by nearest match in the color-names database
export function autoName(hex, names) {
  if (!names?.length) return ''
  let best = names[0].name
  let bestDe = Infinity
  for (const entry of names) {
    const de = deltaE(hex, entry.hex)
    if (de < bestDe) { bestDe = de; best = entry.name }
  }
  return best
}

// Generate harmony swatches in OKLCH space from a base color
export function generateHarmony(hex, type) {
  const { l, c, h } = toOklch(new Color(hex))
  const shifts = {
    complementary:       [0, 180],
    analogous:           [0, 30, -30],
    triadic:             [0, 120, 240],
    'split-complementary': [0, 150, 210],
    tetradic:            [0, 90, 180, 270],
  }
  const offsets = shifts[type] ?? [0]
  return offsets.map(offset => {
    const nh = ((h + offset) % 360 + 360) % 360
    return oklchToHex(l, c, nh)
  })
}

// Generate a Tailwind-style lightness ramp (10 steps 50-950)
export function generateRamp(hex, steps = 10) {
  const { c, h } = toOklch(new Color(hex))
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1)
    const l = 0.95 - t * 0.9  // 0.95 → 0.05
    return oklchToHex(l, c * 0.9, h)
  })
}

// Inline OKLCH→sRGB math for fast canvas pixel rendering (avoids colorjs.io overhead)
export function oklchPixel(L, C, H) {
  const hr = H * Math.PI / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b

  const l3 = l_ * l_ * l_
  const m3 = m_ * m_ * m_
  const s3 = s_ * s_ * s_

  const X =  1.2270138511035211 * l3 - 0.5577999806518222 * m3 + 0.2812561489664678 * s3
  const Y = -0.0405801784232806 * l3 + 1.1122568696168302 * m3 - 0.0716766786656012 * s3
  const Z = -0.0763812845057069 * l3 - 0.4214819784180127 * m3 + 1.5861632204407947 * s3

  const rl =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
  const gl = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z
  const bl =  0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z

  const gamma = u => u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
  return [
    Math.round(Math.max(0, Math.min(1, gamma(rl))) * 255),
    Math.round(Math.max(0, Math.min(1, gamma(gl))) * 255),
    Math.round(Math.max(0, Math.min(1, gamma(bl))) * 255),
  ]
}

// ── OKLCH gamut + perceived-value (luma) helpers ──────────────────────────────
//
// Shared by the picker canvas and the Value lock. OKLCH `L` is *perceptual*
// lightness, but the greyscale view (and the CSS grayscale() filter) shows
// Rec.709 *luma* — green-heavy, blue-light. The two diverge a lot across hues,
// so a true "value lock" must hold luma constant, not L.

const _MAX_C = 0.37  // matches Picker MAX_C — chroma axis ceiling

// Linear (un-gamma'd) sRGB from OKLCH — for gamut testing only.
function oklchLinearRGB(L, C, H) {
  const hr = H * Math.PI / 180
  const a = C * Math.cos(hr), b = C * Math.sin(hr)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_
  const X =  1.2270138511035211 * l3 - 0.5577999806518222 * m3 + 0.2812561489664678 * s3
  const Y = -0.0405801784232806 * l3 + 1.1122568696168302 * m3 - 0.0716766786656012 * s3
  const Z = -0.0763812845057069 * l3 - 0.4214819784180127 * m3 + 1.5861632204407947 * s3
  return [
     3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
     0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ]
}

export function oklchInGamut(L, C, H) {
  const [r, g, b] = oklchLinearRGB(L, C, H)
  return r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && b >= -0.001 && b <= 1.001
}

// Largest chroma that stays in sRGB gamut at this L + hue.
export function maxChromaInGamut(L, H, maxC = _MAX_C) {
  let lo = 0, hi = maxC
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (oklchInGamut(L, mid, H)) lo = mid; else hi = mid
  }
  return lo
}

// Perceived value = Rec.709 luma on gamma-encoded sRGB (0–1).
// This is exactly what the greyscale() filter renders.
export function lumaOklch(L, C, H) {
  const [r, g, b] = oklchPixel(L, C, H)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export function lumaHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// Value lock: given the chroma + hue the user wants, return the {l, c} whose
// greyscale value (luma) equals `targetLuma`. Luma rises monotonically with L
// at fixed C+H, so L is found by binary search. Chroma is clamped into gamut
// and L re-solved if it had to drop — this keeps the locked value holding even
// as hue rotates through narrow-gamut regions (e.g. saturated blue ↔ yellow).
export function oklchForLuma(targetLuma, C, H) {
  const solveL = c => {
    let lo = 0, hi = 1
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (lumaOklch(mid, c, H) < targetLuma) lo = mid; else hi = mid
    }
    return (lo + hi) / 2
  }
  let c = Math.max(0, Math.min(_MAX_C, C))
  let l = solveL(c)
  for (let i = 0; i < 3; i++) {
    const cmax = maxChromaInGamut(l, H)
    if (c <= cmax + 1e-4) break
    c = cmax
    l = solveL(c)
  }
  return { l, c }
}
