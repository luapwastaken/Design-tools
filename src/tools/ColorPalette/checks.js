// ── Palette checks ────────────────────────────────────────────────────────────
//
// Pure analysis. No React, no rendering. Every Check panel and the Report read
// from here, so the Report doesn't reimplement each check and then drift out of
// agreement with the panel it summarises.
//
// Each function returns { findings, ...data }. A finding is:
//   { sev: 'issue' | 'note' | 'good', text: string }
// `sev` drives both the panel's inline display and the Report's roll-up.

import { toOklch, contrast, inSrgbGamut } from '../../lib/color.js'
import { hexToCmyk, tac, tacWarning, richBlackSuggestion, getProfile } from '../../lib/cmyk.js'
import { nearestMatch } from '../../lib/colorMatch.js'
import riso from '../../data/riso.json'
import hks from '../../data/hks.json'
import ral from '../../data/ral.json'
import ncs from '../../data/ncs.json'

export const INK_LIBRARIES = [
  { id: 'riso', label: 'Riso', data: riso },
  { id: 'hks',  label: 'HKS',  data: hks },
  { id: 'ral',  label: 'RAL',  data: ral },
  { id: 'ncs',  label: 'NCS',  data: ncs },
]

const pct = v => `${Math.round(v * 100)}%`
const nameOf = sw => sw.name || sw.hex

// ── Value structure ───────────────────────────────────────────────────────────
//
// The squint test, made arithmetic. A palette lives or dies on its value
// structure — it's the first thing taught and the first thing to fail in
// greyscale or single-colour print — and until now the tool only mentioned it in
// one sentence of Harmony's prose.
//
// Lightness here is OKLCH L, which is perceptual: equal numeric steps look like
// equal steps, which is exactly what "is this ramp even?" needs.

export function valueStructure(swatches) {
  const findings = []
  if (swatches.length < 2) {
    return { findings, rows: [], range: 0, gaps: [], collisions: [] }
  }

  const rows = swatches
    .map(sw => ({ sw, l: toOklch(sw.hex).l }))
    .sort((a, b) => a.l - b.l)

  const lMin = rows[0].l
  const lMax = rows[rows.length - 1].l
  const range = lMax - lMin

  // Pairs sitting at effectively the same value. These are the swatches that
  // vanish into each other the moment colour is removed — the single most
  // common reason a palette that looked fine as chips fails in use.
  const collisions = []
  for (let i = 0; i < rows.length - 1; i++) {
    const d = rows[i + 1].l - rows[i].l
    if (d < 0.06) collisions.push({ a: rows[i], b: rows[i + 1], delta: d })
  }

  // Gaps in the ramp — somewhere a mid-tone is missing.
  const gaps = []
  for (let i = 0; i < rows.length - 1; i++) {
    const d = rows[i + 1].l - rows[i].l
    if (d > 0.28) gaps.push({ from: rows[i], to: rows[i + 1], delta: d })
  }

  if (range < 0.35) {
    findings.push({
      sev: 'issue',
      text: `Everything sits between ${pct(lMin)} and ${pct(lMax)} lightness. Squint and the palette merges into one tone — there's no value anchor to build a composition on.`,
    })
  } else if (lMin > 0.4) {
    findings.push({
      sev: 'note',
      text: `No dark anchor — the deepest colour (${nameOf(rows[0].sw)}) only reaches ${pct(lMin)}. Shadows and linework have nothing to land on.`,
    })
  } else if (lMax < 0.75) {
    findings.push({
      sev: 'note',
      text: `No light — the brightest colour (${nameOf(rows[rows.length - 1].sw)}) tops out at ${pct(lMax)}. Highlights will feel capped.`,
    })
  } else {
    findings.push({
      sev: 'good',
      text: `Value range spans ${pct(lMin)} to ${pct(lMax)} — the palette holds its structure in greyscale.`,
    })
  }

  for (const c of collisions) {
    findings.push({
      sev: 'issue',
      text: `${nameOf(c.a.sw)} and ${nameOf(c.b.sw)} are the same value (${pct(c.a.l)} vs ${pct(c.b.l)}). In greyscale, or in one-colour print, they become the same swatch.`,
    })
  }

  for (const g of gaps) {
    findings.push({
      sev: 'note',
      text: `A ${Math.round(g.delta * 100)}-point jump between ${nameOf(g.from.sw)} and ${nameOf(g.to.sw)} — a mid-tone in that gap would smooth the transition.`,
    })
  }

  return { findings, rows, range, gaps, collisions }
}

// ── Reproduction ──────────────────────────────────────────────────────────────
//
// Will this palette survive leaving the screen? PrintPanel already answered that
// for one swatch at a time; nothing ever asked it about the whole palette.
//
// Deliberately NOT included: a CMYK round-trip ΔE. lib/cmyk.js uses a naive GCR
// formula that is very nearly algebraically invertible, so a round-trip would
// report ~0 for every colour and amount to a check that always passes. TAC,
// rich-black and nearest-real-ink are measured against actual profile limits and
// actual ink libraries, so they mean something.

export function reproduction(swatches, profileId, libraryId = 'riso') {
  const profile = getProfile(profileId)
  const library = INK_LIBRARIES.find(l => l.id === libraryId) ?? INK_LIBRARIES[0]
  const findings = []

  const rows = swatches.map(sw => {
    const cmyk = hexToCmyk(sw.hex)
    const t = tacWarning(cmyk, profileId)
    const rich = richBlackSuggestion(cmyk, profileId)
    const srgb = inSrgbGamut(sw.hex)
    const ink = nearestMatch(sw.hex, library.data)
    return { sw, cmyk, tac: t, rich, srgb, ink }
  })

  const overTac = rows.filter(r => r.tac.over)
  const outOfSrgb = rows.filter(r => !r.srgb)
  const farFromInk = rows.filter(r => r.ink && r.ink.deltaE > 8)
  const closeToInk = rows.filter(r => r.ink && r.ink.deltaE <= 3)

  if (overTac.length) {
    findings.push({
      sev: 'issue',
      text: `${overTac.length} colour${overTac.length === 1 ? '' : 's'} exceed ${profile.name}'s ${profile.tac}% ink limit (${overTac.map(r => `${nameOf(r.sw)} at ${tac(r.cmyk)}%`).join(', ')}). Over the limit the sheet won't dry properly and ink offsets onto the next one.`,
    })
  } else {
    findings.push({ sev: 'good', text: `All colours sit within ${profile.name}'s ${profile.tac}% ink limit.` })
  }

  if (outOfSrgb.length) {
    findings.push({
      sev: 'issue',
      text: `${outOfSrgb.map(r => nameOf(r.sw)).join(', ')} fall outside sRGB — they'll clip on most screens before they ever reach a press.`,
    })
  }

  const richOnes = rows.filter(r => r.rich)
  if (richOnes.length) {
    findings.push({
      sev: 'note',
      text: `${richOnes.map(r => nameOf(r.sw)).join(', ')} would print as flat K-only black. A rich black builds more depth — see the per-colour rows below.`,
    })
  }

  if (farFromInk.length) {
    findings.push({
      sev: 'note',
      text: `${farFromInk.map(r => nameOf(r.sw)).join(', ')} have no close match in ${library.label} (nearest is ΔE ${farFromInk.map(r => r.ink.deltaE).join(', ')}). Reproducing them as spot colours means a custom mix.`,
    })
  }
  if (closeToInk.length === rows.length && rows.length) {
    findings.push({
      sev: 'good',
      text: `Every colour is within ΔE 3 of a stock ${library.label} ink — the whole palette is reachable as spot colours.`,
    })
  }

  return { findings, rows, profile, library }
}

// ── Role coverage ─────────────────────────────────────────────────────────────
//
// The role system is load-bearing and silent about its own gaps: AutoFix needs a
// swatch tagged white or black to grade contrast against, and ExportPanel builds
// CSS variable names from roles and names. Nothing ever told you the palette was
// missing a piece those features depend on.

const ROLE_ORDER = ['black', 'main', 'accent', 'white', 'pop', 'freeform']

export function roleCoverage(swatches) {
  const findings = []
  const counts = Object.fromEntries(ROLE_ORDER.map(r => [r, 0]))
  for (const sw of swatches) if (counts[sw.role] !== undefined) counts[sw.role]++

  const hasBg = counts.white > 0 || counts.black > 0

  if (!hasBg) {
    findings.push({
      sev: 'issue',
      text: 'No swatch is tagged "white" or "black", so nothing is marked as your background. AutoFix can\'t run its contrast pass without one.',
    })
  }
  if (!counts.main) {
    findings.push({ sev: 'note', text: 'No "main" colour — nothing in the palette is declared the primary.' })
  }
  if (counts.accent > 2) {
    findings.push({
      sev: 'note',
      text: `${counts.accent} colours are tagged "accent". An accent works by being the exception; more than one or two and none of them reads as special.`,
    })
  }
  const freeform = counts.freeform
  if (freeform && freeform === swatches.length) {
    findings.push({
      sev: 'note',
      text: 'Every swatch is still "freeform". Assigning roles is what lets AutoFix, Export and the in-context preview know what each colour is for.',
    })
  }
  if (!findings.length) {
    findings.push({ sev: 'good', text: 'Roles cover a background, a primary and a restrained set of accents.' })
  }

  return { findings, counts }
}

// ── Accessibility roll-up ─────────────────────────────────────────────────────
//
// A one-line summary for the Report. The Accessibility panel remains the place
// to actually read the detail; this only answers "is there a problem here".

export function accessibilityRollup(swatches) {
  const findings = []
  if (swatches.length < 2) return { findings, worst: null }

  const bg = swatches.find(s => s.role === 'white')
    ?? swatches.find(s => s.role === 'black')
    ?? swatches.reduce((a, b) => (toOklch(a.hex).l > toOklch(b.hex).l ? a : b))

  const rows = swatches
    .filter(s => s.id !== bg.id)
    .map(s => ({ sw: s, ratio: contrast(s.hex, bg.hex) }))

  if (!rows.length) return { findings, worst: null }

  const failing = rows.filter(r => r.ratio < 4.5)
  const worst = rows.reduce((a, b) => (a.ratio < b.ratio ? a : b))

  if (failing.length) {
    findings.push({
      sev: failing.length === rows.length ? 'issue' : 'note',
      text: `${failing.length} of ${rows.length} colours fall below AA (4.5:1) against ${nameOf(bg)} — worst is ${nameOf(worst.sw)} at ${worst.ratio.toFixed(2)}:1.`,
    })
  } else {
    findings.push({
      sev: 'good',
      text: `Every colour clears AA against ${nameOf(bg)} — the tightest is ${worst.ratio.toFixed(2)}:1.`,
    })
  }

  return { findings, worst, bg }
}

// ── Report roll-up ────────────────────────────────────────────────────────────

export function runAll(swatches, profileId, libraryId) {
  const sections = [
    { id: 'value',         label: 'Value structure', panel: 'Structure',      ...valueStructure(swatches) },
    { id: 'accessibility', label: 'Accessibility',   panel: 'Accessibility',  ...accessibilityRollup(swatches) },
    { id: 'reproduction',  label: 'Reproduction',    panel: 'Reproduction',   ...reproduction(swatches, profileId, libraryId) },
    { id: 'roles',         label: 'Role coverage',   panel: 'Report',         ...roleCoverage(swatches) },
  ]
  const issues = sections.flatMap(s => s.findings.filter(f => f.sev === 'issue'))
  const notes  = sections.flatMap(s => s.findings.filter(f => f.sev === 'note'))
  return { sections, issues, notes }
}
