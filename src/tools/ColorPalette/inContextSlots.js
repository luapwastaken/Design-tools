// ── In-context slot resolution ────────────────────────────────────────────────
//
// Deciding which swatch plays which part in a mockup. Pure functions, no React,
// so the picks can be tested rather than eyeballed.
//
// The first version chose by proximity — muted was "the swatch nearest the
// lightness midpoint", surface was "the swatch nearest the background". Both
// are coin flips on legibility: a mid-lightness colour lands near 3:1 against
// either end, so body copy read as broken about half the time, and a palette
// with no near-background colour got a card in a different brand entirely.
//
// Two changes fix it. Slots that need a *relationship* (surface sits just off
// the background; muted must clear 4.5:1 on it) are derived from the pair they
// relate to, which is what real systems do — brand palettes rarely carry their
// own neutrals. Slots that are genuinely brand colours are chosen by whether
// they work, not by how saturated they are.

import { toOklch, contrast, interpolate, toHex } from '../../lib/color.js'

const CHROMATIC = 0.04     // below this a colour reads as a neutral
const ON_BG_MIN = 3        // a button fill must be visible against the page
const MUTED_TARGET = 4.5   // secondary copy is still copy

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }
const lOf = sw => sw.oklch?.l ?? toOklch(sw.hex).l
const cOf = sw => sw.oklch?.c ?? toOklch(sw.hex).c
const hOf = sw => sw.oklch?.h ?? toOklch(sw.hex).h

// ── Derived neutrals ──────────────────────────────────────────────────────────

// A raised surface reads as the page, lifted — not as another brand colour. A
// small step toward the text colour works on light and dark grounds alike,
// which a fixed lighten() does not.
export function deriveSurface(bgHex, textHex) {
  return toHex(interpolate(bgHex, textHex, 0.055, 'oklch'))
}

// Walk the text colour toward the background until it just clears the target.
// Binary search rather than a fixed opacity so it lands on the ratio whatever
// the pair happens to be.
export function deriveMuted(bgHex, textHex, target = MUTED_TARGET) {
  if (contrast(textHex, bgHex) < target) return textHex   // can't get there; don't make it worse
  let lo = 0, hi = 1
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    const hex = toHex(interpolate(textHex, bgHex, mid, 'oklch'))
    contrast(hex, bgHex) >= target ? lo = mid : hi = mid
  }
  return toHex(interpolate(textHex, bgHex, lo, 'oklch'))
}

// ── Ground: the background / text pair ────────────────────────────────────────

function pickGround(swatches, dark) {
  const byRole = r => swatches.find(s => s.role === r)
  const sorted = [...swatches].sort((a, b) => lOf(a) - lOf(b))

  const bg = (dark ? byRole('black') : byRole('white'))
    ?? (dark ? sorted[0] : sorted[sorted.length - 1])

  // Text is whatever reads best on that ground, preferring an explicit role.
  const roleText = dark ? byRole('white') : byRole('black')
  const best = swatches
    .filter(s => s.id !== bg.id)
    .sort((a, b) => contrast(b.hex, bg.hex) - contrast(a.hex, bg.hex))[0]

  const text = roleText && roleText.id !== bg.id && contrast(roleText.hex, bg.hex) >= 4.5
    ? roleText
    : (best ?? bg)

  return { bg, text }
}

// ── Brand slots ───────────────────────────────────────────────────────────────
//
// Ranked candidate lists rather than a single answer, so Shuffle has somewhere
// to go and so a palette that offers nothing legible degrades to "the most
// chromatic thing" instead of returning nothing.

function primaryCandidates(swatches, bg) {
  const chromatic = swatches.filter(s => s.id !== bg.id && cOf(s) >= CHROMATIC)
  const usable = chromatic.filter(s => contrast(s.hex, bg.hex) >= ON_BG_MIN)
  const pool = usable.length ? usable : chromatic.length ? chromatic : swatches.filter(s => s.id !== bg.id)
  const role = swatches.find(s => s.role === 'main')
  const ranked = [...pool].sort((a, b) => cOf(b) - cOf(a))
  // An explicit role leads, but stays in the list so Shuffle can move past it.
  return role && pool.some(s => s.id === role.id)
    ? [role, ...ranked.filter(s => s.id !== role.id)]
    : ranked
}

function accentCandidates(swatches, bg, primary) {
  const others = swatches.filter(s => s.id !== bg.id && s.id !== primary?.id)
  const chromatic = others.filter(s => cOf(s) >= CHROMATIC)
  const usable = chromatic.filter(s => contrast(s.hex, bg.hex) >= ON_BG_MIN)
  // An all-neutral palette has no chromatic colours left to offer, but handing
  // back an empty list makes accent collapse onto primary and the mockup then
  // shows one colour twice. Any other swatch beats a duplicate.
  const pool = usable.length ? usable : chromatic.length ? chromatic : others
  // Prefer a colour that reads as a different hue from primary — an accent that
  // sits 8° from the primary isn't an accent, it's a shade of it.
  const ranked = [...pool].sort((a, b) => {
    const da = primary ? hueDist(hOf(a), hOf(primary)) : 180
    const db = primary ? hueDist(hOf(b), hOf(primary)) : 180
    const sep = (db > 20 ? 1 : 0) - (da > 20 ? 1 : 0)
    return sep !== 0 ? sep : cOf(b) - cOf(a)
  })
  const role = swatches.find(s => s.role === 'accent') ?? swatches.find(s => s.role === 'pop')
  return role && role.id !== primary?.id && pool.some(s => s.id === role.id)
    ? [role, ...ranked.filter(s => s.id !== role.id)]
    : ranked
}

// ── Resolution ────────────────────────────────────────────────────────────────

export const SLOTS = ['background', 'surface', 'text', 'primary', 'accent', 'muted']

// `variant` walks the candidate space for Shuffle; 0 is the considered default.
export function resolveSlots(swatches, { variant = 0, dark = false, overrides = {} } = {}) {
  if (!swatches.length) return null

  const pin = key => overrides[key] && swatches.find(s => s.id === overrides[key])

  const ground = pickGround(swatches, dark)
  const bg = pin('background') ?? ground.bg
  const text = pin('text') ?? (ground.text.id === bg.id ? ground.text : ground.text)

  const pCands = primaryCandidates(swatches, bg)
  const primary = pin('primary') ?? pCands[variant % Math.max(1, pCands.length)] ?? bg

  const aCands = accentCandidates(swatches, bg, primary)
  const accentStep = pCands.length ? Math.floor(variant / pCands.length) : variant
  const accent = pin('accent') ?? aCands[accentStep % Math.max(1, aCands.length)] ?? primary

  // Derived unless pinned. Kept as { hex } so call sites treat every slot alike.
  const pinnedSurface = pin('surface')
  const pinnedMuted = pin('muted')
  const surface = pinnedSurface ?? { id: null, name: 'Derived', hex: deriveSurface(bg.hex, text.hex) }
  const muted = pinnedMuted ?? { id: null, name: 'Derived', hex: deriveMuted(bg.hex, text.hex) }

  // Some palettes cannot furnish a working interface, and rendering an
  // unreadable mockup without comment reads as the tool being broken rather
  // than the palette being unsuitable. Say which it is.
  const warnings = []
  const groundRatio = contrast(text.hex, bg.hex)
  if (groundRatio < 3) {
    warnings.push(`No legible text and background pair exists in this palette — the best available is ${groundRatio.toFixed(2)}:1. Every layout below will be hard to read until the palette gains a light or a dark.`)
  } else if (groundRatio < 4.5) {
    warnings.push(`The best text and background pair only reaches ${groundRatio.toFixed(2)}:1, which passes for large text but not body copy.`)
  }
  if (accent.id && primary.id && accent.id === primary.id) {
    warnings.push('Only one brand colour is available, so primary and accent are the same. Add a second chromatic colour to see them play off each other.')
  }
  if (swatches.length >= 3 && !swatches.some(s => cOf(s) >= CHROMATIC)) {
    warnings.push('Every colour here is a neutral. There is nothing for the buttons and highlights to be.')
  }

  return {
    slots: { background: bg, surface, text, primary, accent, muted },
    derived: { surface: !pinnedSurface, muted: !pinnedMuted },
    candidates: { primary: pCands, accent: aCands },
    variants: Math.max(1, pCands.length * Math.max(1, aCands.length)),
    groundRatio,
    warnings,
  }
}

// The chart and badge rows exist to put every colour next to every other one at
// small size, which is the only way a six-plus palette actually gets tested.
// Ground colours are excluded — seeing the background plotted as a bar tells
// you nothing.
export function seriesColors(swatches, slots) {
  const groundIds = new Set([slots.background.id, slots.text.id].filter(Boolean))
  const rest = swatches.filter(s => !groundIds.has(s.id))
  return (rest.length ? rest : swatches).map(s => ({ id: s.id, hex: s.hex, name: s.name || s.hex }))
}

// Which swatches the mockup actually put on screen. With more than three
// colours some always go unused, and that is the finding — a nine-colour brand
// that a real interface only needs five of is worth knowing about.
export function coverage(swatches, usedIds) {
  const used = new Set([...usedIds].filter(Boolean))
  return {
    used: swatches.filter(s => used.has(s.id)),
    unused: swatches.filter(s => !used.has(s.id)),
  }
}

// Which scenes are worth showing at this palette size. A nav bar and a card
// exercise three colours; past that you need surfaces that place many colours
// adjacent at once or you are just looking at the same three again.
export function defaultScenes(count) {
  return {
    interface: true,
    status: count >= 4,
    data: count >= 6,
  }
}
