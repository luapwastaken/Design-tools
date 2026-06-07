// ── Paint flow simulation ─────────────────────────────────────────────────────
//
// A wet-canvas grid that makes paint behave physically. Colour is stored the
// way real pigment works: each cell accumulates absorption (K) and scattering
// (S) spectra. Laying down paint just ADDS that pigment's K·c and S·c — so
// mixing is order-independent, matches the mixing well exactly, and blue over
// yellow makes green (Kubelka–Munk in reflectance space) with no muddy RGB
// round-trips. Reflectance R = 1+K/S−√((K/S)²+2K/S) per band, integrated to
// sRGB only at render time.
//
// Mediums:
//   watercolor — water diffuses and carries pigment, pigment piles at drying
//                edges (edge-darkening / blooms), and it dries.
//   oil        — body paint that doesn't flow on its own; pushed around with the
//                brush and the palette knife, building up.
//
// Perf: spectra are 18 bands, only the touched region is re-rendered (dirty
// rect) and the flow step only walks the wet bounding box. Brush edges use a
// soft sub-pixel coverage falloff (clean anti-aliasing, no texture).

import {
  SPECTRAL_BANDS as N,
  spectrumToLinearInto, ksToRefl,
  hexToSpectrum, reflToKS,
} from './spectral.js'

const LOAD_MAX = 6
const COVER_K = 1.7          // how fast load builds opaque coverage
const DRY_WATER = 0.02       // below this a cell is dry/fixed
const CELL_MIX_CAP = 2       // cap on how strongly settled paint resists a fresh stroke
const DEPOSIT_EPS = 0.012    // skip brush-edge dabs too faint to see — kills the
                             // "invisible halo" that later strokes would mix into

export class PaintSim {
  constructor(w, h) {
    this.w = w; this.h = h
    const n = w * h
    this.K = new Float32Array(n * N)
    this.S = new Float32Array(n * N)
    this.load = new Float32Array(n)
    this.water = new Float32Array(n)
    this.op = new Float32Array(n)
    this.stain = new Float32Array(n)

    this._spec = new Float64Array(N)
    this._out3 = [0, 0, 0]
    this._tmp = new Float32Array(n)
    this._bK = new Float64Array(N)
    this._bS = new Float64Array(N)
    this.brush = { tint: 1, opacity: 0.6, staining: 0.4 }
    this.wetCount = 0
    this.dirty = null        // {x0,y0,x1,y1} region needing re-render
    this.wb = null           // wet bounding box
  }

  _markDirty(x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0)
    x1 = Math.min(this.w - 1, x1 | 0); y1 = Math.min(this.h - 1, y1 | 0)
    if (!this.dirty) { this.dirty = { x0, y0, x1, y1 }; return }
    const d = this.dirty
    if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0
    if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1
  }
  _markWet(x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0)
    x1 = Math.min(this.w - 1, x1 | 0); y1 = Math.min(this.h - 1, y1 | 0)
    if (!this.wb) { this.wb = { x0, y0, x1, y1 }; return }
    const d = this.wb
    if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0
    if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1
  }
  consumeDirty() { const d = this.dirty; this.dirty = null; return d }
  markAllDirty() { this.dirty = { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 } }

  clear() {
    this.K.fill(0); this.S.fill(0); this.load.fill(0); this.water.fill(0)
    this.op.fill(0); this.stain.fill(0)
    this.wetCount = 0; this.wb = null
    this.markAllDirty()
  }

  setBrush(paint) {
    if (paint.K && paint.S) { this._bK.set(paint.K); this._bS.set(paint.S) }
    else {
      const spec = hexToSpectrum(paint.hex)
      const sMag = 0.12 + 0.88 * (paint.opacity ?? 0.6)
      for (let i = 0; i < N; i++) { this._bS[i] = sMag; this._bK[i] = reflToKS(spec[i]) * sMag }
    }
    this.brush.tint = paint.tint ?? 1
    this.brush.opacity = paint.opacity ?? 0.6
    this.brush.staining = paint.staining ?? 0.4
  }

  _falloff(dx, dy, r, hardness, aspect, cosA, sinA) {
    const rx = dx * cosA + dy * sinA
    const ry = (-dx * sinA + dy * cosA) / aspect
    const d = Math.sqrt(rx * rx + ry * ry)
    if (d > r) return -1
    const inner = hardness * r
    return 1 - smoothstep(inner, r, d)
  }

  deposit(opts) {
    const { x, y, r, flow, water = 0, load = 1, hardness = 0.1, aspect = 1, angle = 0 } = opts
    const { w, h, K, S } = this
    const cosA = Math.cos(angle), sinA = Math.sin(angle)
    const reach = Math.ceil(r * Math.max(1, aspect)) + 1
    const x0 = Math.max(0, (x - reach) | 0), x1 = Math.min(w - 1, (x + reach) | 0)
    const y0 = Math.max(0, (y - reach) | 0), y1 = Math.min(h - 1, (y + reach) | 0)
    const bK = this._bK, bS = this._bS, bTint = this.brush.tint

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const f = this._falloff(px - x, py - y, r, hardness, aspect, cosA, sinA)
        if (f <= 0) continue
        const i = py * w + px
        const add = flow * f
        if (add < DEPOSIT_EPS && this.load[i] < DEPOSIT_EPS) continue  // no invisible halo
        const c = add * bTint * load
        if (c <= 0) continue
        const base = i * N
        for (let b = 0; b < N; b++) { K[base + b] += c * bK[b]; S[base + b] += c * bS[b] }

        const wasDry = this.water[i] < DRY_WATER
        this.load[i] = Math.min(LOAD_MAX, this.load[i] + add * load)
        if (water > this.water[i]) this.water[i] = Math.min(1, water)
        const k = Math.min(1, add)
        this.op[i]    += (this.brush.opacity    - this.op[i])    * k
        this.stain[i] += (this.brush.staining   - this.stain[i]) * k
        if (wasDry && this.water[i] >= DRY_WATER) this.wetCount++
      }
    }
    this._markDirty(x0, y0, x1, y1)
    if (water >= DRY_WATER) this._markWet(x0 - 1, y0 - 1, x1 + 1, y1 + 1)
  }

  smudge(opts) {
    const { x, y, vx, vy, r, strength, hardness = 0.3, aspect = 1, angle = 0 } = opts
    const { w, h, K, S } = this
    const cosA = Math.cos(angle), sinA = Math.sin(angle)
    const reach = Math.ceil(r * Math.max(1, aspect)) + 1
    const x0 = Math.max(1, (x - reach) | 0), x1 = Math.min(w - 2, (x + reach) | 0)
    const y0 = Math.max(1, (y - reach) | 0), y1 = Math.min(h - 2, (y + reach) | 0)

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const f = this._falloff(px - x, py - y, r, hardness, aspect, cosA, sinA)
        if (f <= 0) continue
        const i = py * w + px
        const sx = Math.max(0, Math.min(w - 1, Math.round(px - vx)))
        const sy = Math.max(0, Math.min(h - 1, Math.round(py - vy)))
        const j = sy * w + sx
        const pull = strength * f * (1 - 0.7 * this.stain[i])
        if (pull <= 0) continue
        const bi = i * N, bj = j * N
        for (let b = 0; b < N; b++) {
          K[bi + b] += (K[bj + b] - K[bi + b]) * pull
          S[bi + b] += (S[bj + b] - S[bi + b]) * pull
        }
        this.load[i] += (this.load[j] - this.load[i]) * pull
        if (this.water[j] > this.water[i]) this.water[i] += (this.water[j] - this.water[i]) * pull
      }
    }
    this._markDirty(x0, y0, x1, y1)
  }

  step(params = {}) {
    if (this.wetCount <= 0 || !this.wb) return false
    const { diffuse = 0.16, evaporate = 0.012, edge = 0.4, spread = 0.14 } = params
    const { w, h, water, load, K, S } = this
    const tmp = this._tmp
    // work the wet box (grown by 1 — water creeps outward each tick)
    const bx0 = Math.max(1, this.wb.x0 - 1), bx1 = Math.min(w - 2, this.wb.x1 + 1)
    const by0 = Math.max(1, this.wb.y0 - 1), by1 = Math.min(h - 2, this.wb.y1 + 1)
    // Snapshot region = box + 1-cell border. Diffusion reads the four neighbours
    // of every box cell, so those neighbours must be in `tmp` and fresh for THIS
    // field/band — otherwise box-edge cells read stale cross-band data, which
    // corrupts the spectra into a spreading black void. bx/by are in [1,w-2]/
    // [1,h-2], so the border stays in bounds.
    const cx0 = bx0 - 1, cx1 = bx1 + 1, cy0 = by0 - 1, cy1 = by1 + 1
    const snap = field => { for (let y = cy0; y <= cy1; y++) { const r = y * w; for (let x = cx0; x <= cx1; x++) tmp[r + x] = field[r + x] } }

    // 1) water diffusion
    snap(water)
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = y * w + x
        if (tmp[i] < DRY_WATER && tmp[i - 1] < DRY_WATER && tmp[i + 1] < DRY_WATER && tmp[i - w] < DRY_WATER && tmp[i + w] < DRY_WATER) continue
        const avg = (tmp[i - 1] + tmp[i + 1] + tmp[i - w] + tmp[i + w]) * 0.25
        water[i] = tmp[i] + (avg - tmp[i]) * diffuse
      }
    }

    // 2) pigment spreads through wet paper, band by band (within the wet box)
    for (let b = 0; b < N; b++) {
      for (let y = cy0; y <= cy1; y++) { const r = y * w; for (let x = cx0; x <= cx1; x++) { const i = r + x; tmp[i] = K[i * N + b] } }
      diffuseBand(K, tmp, water, w, b, N, spread, bx0, by0, bx1, by1)
      for (let y = cy0; y <= cy1; y++) { const r = y * w; for (let x = cx0; x <= cx1; x++) { const i = r + x; tmp[i] = S[i * N + b] } }
      diffuseBand(S, tmp, water, w, b, N, spread, bx0, by0, bx1, by1)
    }

    // 3) edge darkening + evaporate; track the new wet box
    let wet = 0, nx0 = w, ny0 = h, nx1 = 0, ny1 = 0
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = y * w + x
        const wi = water[i]
        if (wi < DRY_WATER) continue
        const drain = wi - (water[i - 1] + water[i + 1] + water[i - w] + water[i + w]) * 0.25
        if (drain > 0 && load[i] > 0) load[i] = Math.min(LOAD_MAX, load[i] + drain * edge)
        const nwi = wi - evaporate
        if (nwi < DRY_WATER) water[i] = 0
        else {
          water[i] = nwi; wet++
          if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y
        }
      }
    }
    this.wetCount = wet
    this.wb = wet > 0 ? { x0: nx0, y0: ny0, x1: nx1, y1: ny1 } : null
    this._markDirty(bx0, by0, bx1, by1)
    return wet > 0
  }

  render(imageData, rect) {
    const { w, h, load, op, K, S } = this
    const d = imageData.data
    const spec = this._spec, out = this._out3
    const x0 = rect ? rect.x0 : 0, y0 = rect ? rect.y0 : 0
    const x1 = rect ? rect.x1 : w - 1, y1 = rect ? rect.y1 : h - 1
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x
        const j = i * 4
        const l = load[i]
        if (l <= 0) { d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = 255; continue }
        const base = i * N
        for (let b = 0; b < N; b++) {
          let s = S[base + b]; if (s < 1e-6) s = 1e-6
          let kk = K[base + b]; if (kk < 0) kk = 0
          spec[b] = ksToRefl(kk / s)
        }
        spectrumToLinearInto(spec, out)
        let cov = 1 - Math.exp(-COVER_K * l * (0.3 + 0.7 * op[i]))
        if (cov > 1) cov = 1
        d[j]     = lin8(1 - cov + out[0] * cov)
        d[j + 1] = lin8(1 - cov + out[1] * cov)
        d[j + 2] = lin8(1 - cov + out[2] * cov)
        d[j + 3] = 255
      }
    }
  }

  sampleHex(x, y) {
    const i = Math.max(0, Math.min(this.h - 1, y | 0)) * this.w + Math.max(0, Math.min(this.w - 1, x | 0))
    if (this.load[i] <= 0) return '#ffffff'
    const base = i * N, spec = this._spec, out = this._out3
    for (let b = 0; b < N; b++) {
      let s = this.S[base + b]; if (s < 1e-6) s = 1e-6
      let kk = this.K[base + b]; if (kk < 0) kk = 0
      spec[b] = ksToRefl(kk / s)
    }
    spectrumToLinearInto(spec, out)
    const cov = 1 - Math.exp(-COVER_K * this.load[i] * (0.3 + 0.7 * this.op[i]))
    return '#' + [out[0], out[1], out[2]].map(v => lin8(1 - cov + v * cov).toString(16).padStart(2, '0')).join('')
  }
}

function diffuseBand(dst, src, water, w, b, N, coeff, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      if (water[i] < DRY_WATER) continue
      const avg = (src[i - 1] + src[i + 1] + src[i - w] + src[i + w]) * 0.25
      dst[i * N + b] = src[i] + (avg - src[i]) * coeff * water[i]
    }
  }
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function lin8(u) {
  const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(0, u), 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, v)) * 255)
}
