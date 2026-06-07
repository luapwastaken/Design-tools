// ── Material-based colour suggestions ─────────────────────────────────────────
//
// Shadows and highlights aren't just darker/lighter versions of a colour — the
// material decides where the hue, saturation and value go. A red apple's shadow
// stays warm and saturated (waxy subsurface scattering pushes it toward orange);
// red velvet's shadow goes cool and desaturated toward blue-purple (its sheen
// and deep nap swallow light). This encodes those tendencies and builds a full
// occlusion → highlight ramp in OKLCH from any base colour.
//
// Each material describes, for shadow and highlight:
//   temp     hue temperature shift: + warm (toward orange), − cool (toward blue)
//   chroma   saturation multiplier vs. the base
//   value    how far lightness drops (shadow) / rises (highlight)
//   spec     highlight only — how much it jumps to the light-source colour
//            (bright, desaturated, warm) like a glossy/metallic specular
//   sub      subsurface scattering — warms and enriches the shadow terminator

import { toOklch, oklchToHex, maxChromaInGamut } from './color.js'

const WARM = 60          // orange-ish hue anchor
const COOL = 255         // blue-ish hue anchor
const HUE_PULL = 0.5     // base strength of a temperature shift

export const MATERIALS = [
  { id: 'matte',   name: 'Matte / Chalk',
    desc: 'Diffuse and powdery — gently cool, desaturated shadows; soft pale highlight.',
    shadow: { temp: -0.25, chroma: 0.70, value: 0.30 }, highlight: { temp: 0.40, chroma: 0.85, value: 0.28, spec: 0.12 }, sub: 0.00 },
  { id: 'skin',    name: 'Skin',
    desc: 'Warm subsurface glow — shadows flush red/orange, core cools; soft luminous light.',
    shadow: { temp: 0.45, chroma: 1.10, value: 0.26 }, highlight: { temp: 0.45, chroma: 0.80, value: 0.26, spec: 0.30 }, sub: 0.70 },
  { id: 'apple',   name: 'Apple / Wax fruit',
    desc: 'Waxy and translucent — warm, saturated shadow toward orange; crisp white specular.',
    shadow: { temp: 0.55, chroma: 1.18, value: 0.28 }, highlight: { temp: 0.50, chroma: 0.55, value: 0.40, spec: 0.75 }, sub: 0.50 },
  { id: 'velvet',  name: 'Velvet',
    desc: 'Deep nap with a sheen — shadows go cool, desaturated blue-purple; bright rim sheen.',
    shadow: { temp: -0.90, chroma: 0.55, value: 0.34 }, highlight: { temp: -0.20, chroma: 0.70, value: 0.30, spec: 0.35 }, sub: 0.20 },
  { id: 'metal',   name: 'Metal',
    desc: 'Reflective — saturated mid-hue body, dark core, highlight jumps to the light colour.',
    shadow: { temp: 0.05, chroma: 1.25, value: 0.42 }, highlight: { temp: 0.50, chroma: 0.35, value: 0.46, spec: 0.90 }, sub: 0.00 },
  { id: 'plastic', name: 'Glossy plastic',
    desc: 'Even body colour with a crisp, near-white specular highlight.',
    shadow: { temp: -0.10, chroma: 0.95, value: 0.30 }, highlight: { temp: 0.40, chroma: 0.40, value: 0.42, spec: 0.85 }, sub: 0.00 },
  { id: 'leaf',    name: 'Foliage / Leaf',
    desc: 'Thin and translucent — backlit warm-yellow glow, cool blue shadows.',
    shadow: { temp: -0.40, chroma: 1.00, value: 0.30 }, highlight: { temp: 0.70, chroma: 1.05, value: 0.32, spec: 0.40 }, sub: 0.80 },
  { id: 'water',   name: 'Water / Glass',
    desc: 'Transparent and specular — a cool cast with brilliant, near-white highlights.',
    shadow: { temp: -0.50, chroma: 0.90, value: 0.34 }, highlight: { temp: 0.20, chroma: 0.30, value: 0.50, spec: 0.95 }, sub: 0.30 },
  { id: 'wax',     name: 'Wax / Candle',
    desc: 'Deep subsurface warmth — a glowing, warm shadow terminator.',
    shadow: { temp: 0.60, chroma: 1.05, value: 0.26 }, highlight: { temp: 0.55, chroma: 0.70, value: 0.30, spec: 0.35 }, sub: 0.90 },
  { id: 'ceramic', name: 'Ceramic',
    desc: 'Glazed — clean, near-neutral shadow with a smooth bright specular.',
    shadow: { temp: -0.15, chroma: 0.80, value: 0.30 }, highlight: { temp: 0.40, chroma: 0.45, value: 0.40, spec: 0.80 }, sub: 0.10 },
  { id: 'stone',   name: 'Stone / Concrete',
    desc: 'Rough and matte — very desaturated, cool-neutral shadow.',
    shadow: { temp: -0.30, chroma: 0.45, value: 0.32 }, highlight: { temp: 0.25, chroma: 0.60, value: 0.24, spec: 0.08 }, sub: 0.00 },
  { id: 'cloth',   name: 'Cloth',
    desc: 'Soft matte weave — gently cool, desaturated shadow; diffuse highlight.',
    shadow: { temp: -0.20, chroma: 0.65, value: 0.30 }, highlight: { temp: 0.35, chroma: 0.80, value: 0.26, spec: 0.15 }, sub: 0.15 },
]

export const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map(m => [m.id, m]))

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function hueLerp(a, b, t) { const d = ((b - a + 540) % 360) - 180; return ((a + d * t) % 360 + 360) % 360 }
function angDist(a, b) { return Math.abs(((b - a + 540) % 360) - 180) }

// Pull a hue toward the warm or cool anchor by `amt` (0..1 of the way).
function pull(baseHue, temp, amt, cap) {
  const anchor = temp >= 0 ? WARM : COOL
  return hueLerp(baseHue, anchor, clamp(Math.abs(temp) * amt, 0, cap))
}

// Build the suggestion ramp. The number of stops depends on the material:
// simple matte surfaces get a compact ramp; reflective and subsurface ones get
// extra stops (a bounced reflected light, a subsurface glow at the terminator,
// and a separate sharp specular) — because that's where their colour actually
// lives. mode: 'grounded' | 'expressive'. heroHex optional.
export function suggestMaterialColors(baseHex, mat, mode, heroHex, intensity = 1) {
  const base = toOklch(baseHex)
  const exp = mode === 'expressive'
  const ext = mode === 'extreme'
  // Three intensities. Grounded is physically true. Expressive pushes the *hue*
  // temperature much further and saturates hard, while keeping shadows luminous
  // (a big value drop just gamut-clamps the colour into mud).
  //
  // Extreme is a fully stylised, graphic setting and works differently: instead
  // of nudging warm/cool, it drives a *base-relative complementary split*. The
  // shadow side rotates hard toward the base's opposite hue (true-complementary
  // tension — green-teal shadows under a red form), the light side rotates the
  // other way, so the two always land on opposite hues no matter the material —
  // the material only picks which way the split leans. It also posterises the
  // value steps for a cel-shaded read and lets stops rival the hero's chroma.
  // `intensity` (0.2–1.6, driven by the UI slider) scales the hue spread and
  // chroma push from bold to nuclear. The in-gamut clamp and luminous-shadow
  // floor still hold, so it never breaks into mud.
  const I = clamp(intensity, 0.2, 1.6)
  const M = ext
    ? { hue: 4.6, chrUp: 2.7, chrDown: 1.6, valUp: 1.2, valDown: 1.0, cap: 0.98,
        split: true, shadowRot: 150, lightRot: 62, iriStep: 50, valSpread: 1.32, rivalHero: true }
    : exp
    ? { hue: 3.0, chrUp: 2.3, chrDown: 1.35, valUp: 1.35, valDown: 1.0, cap: 0.97 }
    : { hue: 1, chrUp: 1, chrDown: 1, valUp: 1, valDown: 1, cap: 0.8 }
  const hero = heroHex ? toOklch(heroHex) : null
  // Material picks which rotational side the split leans (warm-shadow materials
  // swing one way around the wheel, cool-shadow materials the other).
  const splitDir = mat.shadow.temp >= 0 ? 1 : -1

  function build(label, { dl, temp, chromaMul, spec = 0, hueScale = 1, iriPhase = 0 }) {
    // Posterise the value steps in Extreme for a graphic, banded read; keep
    // shadows off the floor so they don't crush to mud.
    const dlx = M.valSpread ? dl * M.valSpread : dl
    let l = clamp(base.l + dlx * (dlx >= 0 ? M.valUp : M.valDown), 0.04, 0.98)
    const lightSide = M.split && dl > 0

    let h
    if (M.split && label !== 'Base') {
      // Shadow side (dl<0) rotates toward the complement. The light side fans out
      // as an *iridescent gradient*: each light stop (Light → Highlight →
      // Specular) steps further around the wheel via `iriPhase`, so the highlights
      // sweep across several hues like an oil-slick instead of one warm ramp.
      const side = dl < 0 ? 1 : -1
      const rot = dl < 0
        ? Math.min(M.shadowRot * hueScale * I, 178)
        : (M.lightRot + iriPhase * M.iriStep) * I
      h = (base.h + splitDir * side * rot + 360) % 360
    } else {
      h = pull(base.h, temp, HUE_PULL * hueScale * M.hue, M.cap)
    }

    // chroma: amplify the deviation from the base (intensity-scaled in Extreme)
    const dev = base.c * chromaMul - base.c
    let c = base.c + dev * (dev >= 0 ? M.chrUp : M.chrDown) * (M.split ? I : 1)
    // Specular jumps toward the bright light-source colour. Normally that washes
    // it to a warm white; in Extreme we resist the wash — the spec stays bright
    // but keeps a strong tint and its iridescent hue (no collapse to warm white).
    if (spec > 0) {
      if (M.split) { c *= 1 - 0.3 * spec; l = clamp(l + 0.06 * spec, 0, 0.95) }
      else { c *= 1 - 0.85 * spec; h = hueLerp(h, WARM, 0.4 * spec); l = clamp(l + 0.1 * spec, 0, 0.985) }
    }
    c = Math.max(0, c)
    // In Extreme, hold the light side back from washing to white and keep it
    // saturated, so the iridescent highlight hues actually read as colour.
    if (lightSide) { l = Math.min(l, 0.87); c = Math.max(c, base.c * (0.85 + 0.25 * I)) }
    // priority/hero weighting. Normally suggestions recede so the hero stays the
    // most saturated; in Extreme they're allowed to rival it (just nudged off the
    // exact hero hue so they don't collide).
    if (hero && label !== 'Base') {
      const collideArc = M.rivalHero ? 26 : 50
      if (angDist(h, hero.h) < collideArc) {
        const sgn = (((h - hero.h + 540) % 360) - 180) >= 0 ? 1 : -1
        h = (hero.h + sgn * (M.rivalHero ? 30 : 55) + 360) % 360
        if (!M.rivalHero) c *= 0.6
      }
      if (!M.rivalHero) c = Math.min(c, hero.c * 0.82)
    }
    c = Math.min(c, maxChromaInGamut(l, h))
    return { label, hex: oklchToHex(l, c, h) }
  }

  // Subsurface materials keep luminous shadows (light scatters through), so they
  // don't darken as far — which lets them hold their warm saturation.
  const sv = mat.shadow.value * (1 - mat.sub * 0.3), hv = mat.highlight.value
  const sSign = mat.shadow.temp >= 0 ? 1 : -1

  // Which extra stops this material warrants.
  const hasReflected = mat.sub > 0.3 || mat.highlight.spec > 0.5
  const hasGlow = mat.sub > 0.45                       // subsurface terminator
  const hasSpecular = mat.highlight.spec > 0.6         // sharp light-coloured spec

  const out = []
  // Deepest occlusion: cooler & greyer — and for subsurface it loses the warm
  // bleed entirely, going cool/neutral in the core (correct for skin/wax).
  out.push(build('Occlusion', { dl: -sv * 1.5, temp: mat.shadow.temp - 0.2 - mat.sub * 0.8, chromaMul: mat.shadow.chroma * 0.7, hueScale: 1.1 }))
  // Core shadow / terminator — subsurface warms it.
  out.push(build('Shadow', { dl: -sv, temp: mat.shadow.temp + mat.sub * 0.5, chromaMul: mat.shadow.chroma * (1 + mat.sub * 0.15) }))
  // Reflected/bounce light: opposite temperature to the shadow (cool sky into a
  // warm shadow, warm ground into a cool one) — the touch that makes form read.
  if (hasReflected) out.push(build('Reflected', { dl: -sv * 0.6, temp: -sSign * 0.6, chromaMul: mat.shadow.chroma * 0.85, hueScale: 0.9 }))
  // Subsurface glow at the terminator — warm and saturated.
  if (hasGlow) out.push(build('Glow', { dl: -sv * 0.28, temp: 0.85, chromaMul: 1.3, hueScale: 0.9 }))
  out.push(build('Base', { dl: 0, temp: 0, chromaMul: 1 }))
  // Light → Highlight → Specular carry rising iriPhase, so in Extreme they fan
  // across the wheel into an iridescent gradient.
  out.push(build('Light', { dl: hv * 0.5, temp: 0.4, chromaMul: mat.highlight.chroma, hueScale: 0.5, iriPhase: 0 }))
  // Main highlight — if there's a separate sharp specular, keep this one colourful.
  out.push(build('Highlight', { dl: hv, temp: mat.highlight.temp, chromaMul: mat.highlight.chroma, spec: hasSpecular ? mat.highlight.spec * 0.35 : mat.highlight.spec, hueScale: 0.6, iriPhase: 1 }))
  // Sharp specular: the light-source colour, near white.
  if (hasSpecular) out.push(build('Specular', { dl: hv * 1.25, temp: 0.4, chromaMul: mat.highlight.chroma, spec: Math.min(0.97, mat.highlight.spec * 1.12), hueScale: 0.5, iriPhase: 2 }))
  return out
}
