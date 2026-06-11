// ── Paint recipe solver ───────────────────────────────────────────────────────
//
// "How do I mix this colour?" — the inverse of the spectral mixing engine.
// Given a target colour and a set of real pigments, search pigment
// combinations (1–3 paints) and optimise their proportions so the
// Kubelka–Munk mix lands as close to the target as possible.
//
// Proportions are physical parts (what you'd measure out); the engine applies
// each pigment's tinting strength internally, so "70% white" really means 70%
// of the blob is white even though white is a weak tinter.

import { makePaint, mixPaints, ksToRefl, spectrumToLinearInto, hexToLinear, SPECTRAL_BANDS as NB } from './spectral.js'
import { deltaE as deltaEOK } from './color.js'

// color.js deltaE is OKLab-scaled (white↔black = 1.0); ×100 puts it on the
// familiar CIELAB-ish scale the thresholds and penalties below are tuned for.
const deltaE = (a, b) => deltaEOK(a, b) * 100

// ── Fast inner-loop evaluator ────────────────────────────────────────────────
// The search evaluates tens of thousands of mixes; going through hex strings
// and colorjs parsing per evaluation is ~1000× too slow. This path mixes K/S
// in scratch arrays and measures ΔE directly in OKLab, no allocation.
const _K = new Float64Array(NB)
const _S = new Float64Array(NB)
const _spec = new Float64Array(NB)
const _rgb = [0, 0, 0]

function linearToOklab(r, g, b, out) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  out[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
  out[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  return out
}

function hexToOklab(hex) {
  const [r, g, b] = hexToLinear(hex)
  return linearToOklab(r, g, b, [0, 0, 0])
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
const _lab = [0, 0, 0]

// ΔE (×100 OKLab) between the mix of `entries` at `amounts` and targetLab.
function evalMix(entries, amounts, targetLab) {
  _K.fill(0); _S.fill(0)
  for (let p = 0; p < entries.length; p++) {
    const { K, S, tint } = entries[p].paint
    const c = amounts[p] * tint
    if (c <= 0) continue
    for (let i = 0; i < NB; i++) { _K[i] += c * K[i]; _S[i] += c * S[i] }
  }
  for (let i = 0; i < NB; i++) _spec[i] = ksToRefl(_K[i] / (_S[i] || 1e-6))
  spectrumToLinearInto(_spec, _rgb)
  linearToOklab(clamp01(_rgb[0]), clamp01(_rgb[1]), clamp01(_rgb[2]), _lab)
  const dl = _lab[0] - targetLab[0], da = _lab[1] - targetLab[1], db = _lab[2] - targetLab[2]
  return Math.sqrt(dl * dl + da * da + db * db) * 100
}

// Build mixable paints once per pigment list.
export function preparePaints(pigments) {
  return pigments.map(p => ({
    pigment: p,
    paint: makePaint(p.hex, { name: p.name, tint: p.tint, opacity: p.opacity }),
  }))
}

// ── Per-combination optimisers ───────────────────────────────────────────────
// ΔE landscapes over the mixing simplex are smooth and near-unimodal, so a
// coarse grid + local refinement finds the optimum reliably and fast.

function solvePair(targetLab, entries) {
  let best = { amounts: [0.5, 0.5], de: Infinity }
  const probe = t => {
    const de = evalMix(entries, [1 - t, t], targetLab)
    if (de < best.de) { best.de = de; best.amounts = [1 - t, t] }
  }
  for (let t = 0; t <= 20; t++) probe(t / 20)
  for (let step = 0.025; step > 0.003; step /= 2) {
    const t0 = best.amounts[1]
    probe(Math.max(0, t0 - step))
    probe(Math.min(1, t0 + step))
  }
  return best
}

function solveTriple(targetLab, entries) {
  let best = { amounts: [1 / 3, 1 / 3, 1 / 3], de: Infinity }
  const probe = (a, b) => {
    const c = 1 - a - b
    if (c < 0) return
    const de = evalMix(entries, [a, b, c], targetLab)
    if (de < best.de) { best.de = de; best.amounts = [a, b, c] }
  }
  for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10 - a; b++) probe(a / 10, b / 10)
  // pattern-search refinement around the best corner of the coarse grid
  for (let step = 0.05; step > 0.006; step /= 2) {
    const [a0, b0] = best.amounts
    for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, -step], [-step, step]]) {
      probe(Math.min(1, Math.max(0, a0 + da)), Math.min(1, Math.max(0, b0 + db)))
    }
  }
  return best
}

// ── Public solver ────────────────────────────────────────────────────────────
// Returns the topN recipes: { parts: [{ pigment, pct }], hex, de }.
// Recipes using fewer pigments win ties (small ΔE penalty per extra paint),
// because two paints you can actually re-mix beats three that drift.
export function solveRecipe(targetHex, pigments, { maxPigments = 3, topN = 3 } = {}) {
  const prepared = preparePaints(pigments)
  const n = prepared.length
  if (!n) return []
  const targetLab = hexToOklab(targetHex)
  const candidates = []

  // singles
  for (let i = 0; i < n; i++) {
    candidates.push({ entries: [prepared[i]], amounts: [1], de: evalMix([prepared[i]], [1], targetLab) })
  }
  // pairs
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const entries = [prepared[i], prepared[j]]
    const { amounts, de } = solvePair(targetLab, entries)
    candidates.push({ entries, amounts, de })
  }
  // triples
  if (maxPigments >= 3) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      const entries = [prepared[i], prepared[j], prepared[k]]
      const { amounts, de } = solveTriple(targetLab, entries)
      candidates.push({ entries, amounts, de })
    }
  }

  // Drop near-zero ingredients (under 2.5% you can't measure it anyway) and
  // re-evaluate the truncated mix honestly — with strong tinters like Phthalo,
  // a dropped 2% changes the colour, so the original ΔE no longer applies.
  // Then dedupe by the surviving pigment set, keeping the best per set.
  const bySet = new Map()
  for (const c of candidates) {
    const kept = c.entries.map((e, i) => ({ e, a: c.amounts[i] })).filter(x => x.a >= 0.025)
    if (!kept.length) continue
    const total = kept.reduce((s, x) => s + x.a, 0)
    const parts = kept.map(x => ({ pigment: x.e.pigment, paint: x.e.paint, amount: x.a / total }))
    const hex = mixPaints(parts.map(x => ({ paint: x.paint, amount: x.amount }))).hex
    const de = deltaE(targetHex, hex)
    const key = parts.map(x => x.pigment.id).sort().join('+')
    const score = de + (parts.length - 1) * 0.6   // simplicity preference
    const prev = bySet.get(key)
    if (!prev || score < prev.score) bySet.set(key, { score, de, hex, kept: parts })
  }

  return [...bySet.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, topN)
    .map(({ kept, de, hex }) => ({
      parts: kept
        .sort((a, b) => b.amount - a.amount)
        .map(x => ({ pigment: x.pigment, pct: Math.round(x.amount * 100) })),
      hex,
      de,
    }))
}

// Verdict phrasing for a ΔE — used by the UI, kept here so wording is uniform.
export function recipeVerdict(de) {
  if (de < 1.5) return { label: 'Spot on', color: '#22c55e' }
  if (de < 4) return { label: 'Very close', color: '#86c232' }
  if (de < 8) return { label: 'Close', color: '#d3b53f' }
  return { label: 'Nearest possible', color: '#e0795a' }
}
