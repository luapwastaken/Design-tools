// ── Spectral pigment engine ───────────────────────────────────────────────────
//
// Real paint does not mix like light (additive RGB) or even like the simple
// single-constant Kubelka–Munk we used before. Pigments absorb and scatter
// light differently at every wavelength, so the only way blue + yellow → green
// (and not grey) — and the only way a transparent stainer behaves differently
// from an opaque, high-tint pigment — is to model the actual reflectance
// spectrum and mix with two-constant Kubelka–Munk (separate K = absorption and
// S = scattering per wavelength).
//
// Pipeline:
//   hex ──▶ linear sRGB ──▶ reflectance spectrum (36 bands, 380–730nm)
//   spectrum (+ pigment traits) ──▶ K[], S[]
//   mix: K,S add by concentration ──▶ reflectance ──▶ XYZ ──▶ linear sRGB ──▶ hex
//
// CMFs use Wyman/Sloan/Shirley's analytic Gaussian fit to CIE 1931 2°, and the
// whole thing is white-normalised (a flat reflectance of 1 maps to #ffffff), so
// small approximations in the CMFs/illuminant wash out and the round-trip is
// stable. No data tables, no network — works offline inside Electron.

// 18 bands (20nm) is plenty for believable pigment mixing and ~2× lighter than
// the 36-band version — every per-pixel render and per-cell flow step pays for
// the band count, so this matters a lot for canvas performance.
const LAMBDA_MIN = 380
const LAMBDA_STEP = 20
const N = 18                                   // 380…720nm
const LAMBDAS = Array.from({ length: N }, (_, i) => LAMBDA_MIN + i * LAMBDA_STEP)

// Piecewise-Gaussian helper (asymmetric: different sigma below/above the peak).
function pg(x, mu, s1, s2) {
  const t = (x - mu) * (x < mu ? 1 / s1 : 1 / s2)
  return Math.exp(-0.5 * t * t)
}

// CIE 1931 2° colour-matching functions — multi-lobe Gaussian approximation.
const CMF_X = new Float64Array(N)
const CMF_Y = new Float64Array(N)
const CMF_Z = new Float64Array(N)
for (let i = 0; i < N; i++) {
  const l = LAMBDAS[i]
  CMF_X[i] = 1.056 * pg(l, 599.8, 37.9, 31.0) + 0.362 * pg(l, 442.0, 16.0, 26.7) - 0.065 * pg(l, 501.1, 20.4, 26.2)
  CMF_Y[i] = 0.821 * pg(l, 568.8, 46.9, 40.5) + 0.286 * pg(l, 530.9, 16.3, 31.1)
  CMF_Z[i] = 1.217 * pg(l, 437.0, 11.8, 36.0) + 0.681 * pg(l, 459.0, 26.0, 13.8)
}

// XYZ → linear sRGB (D65).
function xyzToLinear(X, Y, Z) {
  return [
     3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
     0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ]
}

// Spectrum → unnormalised linear sRGB.
function spectrumToLinearRaw(spec) {
  let X = 0, Y = 0, Z = 0
  for (let i = 0; i < N; i++) { X += spec[i] * CMF_X[i]; Y += spec[i] * CMF_Y[i]; Z += spec[i] * CMF_Z[i] }
  return xyzToLinear(X, Y, Z)
}

// White balance: a flat reflectance of 1 must come back as pure white.
const FLAT = new Float64Array(N).fill(1)
const WHITE = spectrumToLinearRaw(FLAT)

export function spectrumToLinear(spec) {
  const [r, g, b] = spectrumToLinearRaw(spec)
  return [r / WHITE[0], g / WHITE[1], b / WHITE[2]]
}

// Allocation-free variant for the per-pixel sim — writes into out3 = [r,g,b].
export function spectrumToLinearInto(spec, out3) {
  let X = 0, Y = 0, Z = 0
  for (let i = 0; i < N; i++) { X += spec[i] * CMF_X[i]; Y += spec[i] * CMF_Y[i]; Z += spec[i] * CMF_Z[i] }
  out3[0] = ( 3.2406 * X - 1.5372 * Y - 0.4986 * Z) / WHITE[0]
  out3[1] = (-0.9689 * X + 1.8758 * Y + 0.0415 * Z) / WHITE[1]
  out3[2] = ( 0.0557 * X - 0.2040 * Y + 1.0570 * Z) / WHITE[2]
  return out3
}

// ── sRGB ⇄ linear ─────────────────────────────────────────────────────────────
const s2lLUT = new Float64Array(256)
for (let i = 0; i < 256; i++) { const c = i / 255; s2lLUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }

function lin2srgb8(u) {
  const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, v)) * 255)
}

export function hexToLinear(hex) {
  return [s2lLUT[parseInt(hex.slice(1, 3), 16)], s2lLUT[parseInt(hex.slice(3, 5), 16)], s2lLUT[parseInt(hex.slice(5, 7), 16)]]
}

export function linearToHex(r, g, b) {
  return '#' + [r, g, b].map(v => lin2srgb8(v).toString(16).padStart(2, '0')).join('')
}

export function spectrumToHex(spec) {
  const [r, g, b] = spectrumToLinear(spec)
  return linearToHex(r, g, b)
}

// ── linear sRGB → reflectance spectrum (Smits-style 7-basis) ──────────────────
//
// Brian Smits' decomposition: split the colour into white + one secondary
// (C/M/Y) + one primary (R/G/B) and sum their characteristic reflectance
// curves. The secondaries have a sharp *trough* in the band they absorb (yellow
// dips in blue, cyan dips in red, magenta dips in green) — that trough is what
// keeps subtractive mixes vivid (blue + yellow → green, not grey).

const EPS = 0.0001
const HI = 0.985, LO = 0.015

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
function curve(fn) {
  const out = new Float64Array(N)
  for (let i = 0; i < N; i++) out[i] = LO + (HI - LO) * fn(LAMBDAS[i])
  return out
}
const B_WHITE   = new Float64Array(N).fill(HI)
const B_RED     = curve(l => smoothstep(560, 610, l))
const B_GREEN   = curve(l => smoothstep(475, 515, l) * (1 - smoothstep(580, 620, l)))
const B_BLUE    = curve(l => 1 - smoothstep(455, 500, l))
const B_YELLOW  = curve(l => smoothstep(460, 505, l))
const B_CYAN    = curve(l => 1 - smoothstep(565, 610, l))
const B_MAGENTA = curve(l => Math.max(1 - smoothstep(470, 515, l), smoothstep(585, 625, l)))

export function linearToSpectrum(r, g, b) {
  return linearToSpectrumInto(r, g, b, new Float64Array(N))
}

// Allocation-free Smits decomposition — writes the reflectance into `spec`.
export function linearToSpectrumInto(r, g, b, spec) {
  spec.fill(0)
  const add = (basis, w) => { if (w) for (let i = 0; i < N; i++) spec[i] += w * basis[i] }
  if (r <= g && r <= b) {
    add(B_WHITE, r)
    if (g <= b) { add(B_CYAN, g - r); add(B_BLUE, b - g) }
    else        { add(B_CYAN, b - r); add(B_GREEN, g - b) }
  } else if (g <= r && g <= b) {
    add(B_WHITE, g)
    if (r <= b) { add(B_MAGENTA, r - g); add(B_BLUE, b - r) }
    else        { add(B_MAGENTA, b - g); add(B_RED, r - b) }
  } else {
    add(B_WHITE, b)
    if (r <= g) { add(B_YELLOW, r - b); add(B_GREEN, g - r) }
    else        { add(B_YELLOW, g - b); add(B_RED, r - g) }
  }
  for (let i = 0; i < N; i++) spec[i] = spec[i] < EPS ? EPS : spec[i] > 1 - EPS ? 1 - EPS : spec[i]
  return spec
}

export function hexToSpectrum(hex) {
  const [r, g, b] = hexToLinear(hex)
  return linearToSpectrum(r, g, b)
}

// ── Kubelka–Munk K/S ──────────────────────────────────────────────────────────
// Single-constant K/S from a reflectance. Two-constant mixing then splits this
// into absorption (K) and scattering (S) using the pigment's opacity, so opaque
// pigments cover and transparent ones glaze.
function ks1(R) {
  R = Math.min(0.9999, Math.max(0.0001, R))
  return (1 - R) * (1 - R) / (2 * R)
}
export const reflToKS = ks1
export function ksToRefl(ratio) { return 1 + ratio - Math.sqrt(ratio * ratio + 2 * ratio) }

// ── Paint = a mixable pigment instance ────────────────────────────────────────
//
// Built from a hex (or pigment preset). Carries per-band K and S plus the
// physical traits that make pigments feel different.
//
//   tint        relative tinting strength (Phthalo bullies, earths are meek)
//   opacity     0 transparent glaze … 1 opaque cover  → scattering magnitude
//   granulation 0 smooth … 1 grainy (texture in the wet sim)
//   staining    0 lifts cleanly … 1 stains (resists smudge/lift)

export function makePaint(hex, traits = {}) {
  const { tint = 1, opacity = 0.6, granulation = 0, staining = 0.4, name = '' } = traits
  const spec = hexToSpectrum(hex)
  const S = new Float64Array(N)
  const K = new Float64Array(N)
  const sMag = 0.12 + 0.88 * opacity          // opaque → strong scattering
  for (let i = 0; i < N; i++) {
    S[i] = sMag
    K[i] = ks1(spec[i]) * sMag                // K = (K/S)·S
  }
  return { hex, name, spec, K, S, tint, opacity, granulation, staining }
}

const ksToR = ratio => 1 + ratio - Math.sqrt(ratio * ratio + 2 * ratio)

// Mix paints by concentration. `parts` = [{ paint, amount }] (amount ≥ 0).
// Returns { hex, K, S } so the result can itself be re-mixed or deposited.
export function mixPaints(parts) {
  const K = new Float64Array(N)
  const S = new Float64Array(N)
  let total = 0
  for (const { paint, amount } of parts) {
    const c = amount * paint.tint
    if (c <= 0) continue
    total += c
    for (let i = 0; i < N; i++) { K[i] += c * paint.K[i]; S[i] += c * paint.S[i] }
  }
  if (total <= 0) return { hex: '#ffffff', K, S }
  const spec = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const s = S[i] || 1e-6
    spec[i] = ksToR(K[i] / s)
  }
  return { hex: spectrumToHex(spec), K, S }
}

// Convenience: mix two hexes like paint (defaults to balanced opaque pigments).
export function mixHexPaint(hexA, hexB, t = 0.5) {
  return mixPaints([
    { paint: makePaint(hexA), amount: 1 - t },
    { paint: makePaint(hexB), amount: t },
  ]).hex
}

export { N as SPECTRAL_BANDS }
