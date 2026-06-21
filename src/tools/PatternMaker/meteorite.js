import { mkRng } from './ui.jsx'

// ── Meteorite pattern engine ────────────────────────────────────────────────────
//
// Pure: params in -> { svg, W, H } out. No React, no DOM. Reuses the seeded RNG so
// the same seed + params always produce byte-identical SVG (determinism).
//
// The look comes from laying down several families of parallel, broken lamellae at
// crossing orientations. Where the families overlap, the interlocking elongated
// triangle network of a Widmanstätten etch emerges on its own.

// Coverage ramp: 1 up to `reach`, then falls linearly to 0 across `softness`.
// d, reach, softness are all normalized 0..1.
function ramp(d, reach, softness) {
  if (d <= reach) return 1
  if (softness <= 0 || d >= reach + softness) return 0
  return 1 - (d - reach) / softness
}

// Canvas pixel size for the chosen output mode.
export function meteoriteSize({ mode, widthMm, heightMm, dpi, tileW, tileH }) {
  if (mode === 'fit') {
    return {
      W: Math.max(2, Math.round((widthMm / 25.4) * dpi)),
      H: Math.max(2, Math.round((heightMm / 25.4) * dpi)),
    }
  }
  return { W: Math.max(2, Math.round(tileW)), H: Math.max(2, Math.round(tileH)) }
}

export function buildMeteorite(params) {
  const {
    seed = 1,
    mode = 'tile',
    angles = [60, 120],
    spacing = 40, spacingJit = 0.4,
    bandMin = 6, bandMax = 16,
    segMin = 60, segMax = 200,
    gapMin = 20, gapMax = 90,
    rimOn = false, rimW = 2,
    matrixCol = '#101015', bandCol = '#c9c4b8', rimCol = '#f4efe6',
    // reach (normalized 0..1)
    vOn = false, vReach = 1, vSoft = 0.2, vAnchor = 'bottom',
    hOn = false, hReach = 1, hSoft = 0.2, hAnchor = 'left',
    opacityVar = false,
    seamless = true,
  } = params

  const { W, H } = meteoriteSize(params)
  const rng = mkRng(seed)
  const cx = W / 2, cy = H / 2

  // Corner offsets from the canvas centre — used to find how far each rotated
  // line family must reach to cover the whole canvas.
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [x - cx, y - cy])
  const projRange = (ux, uy) => {
    let mn = Infinity, mx = -Infinity
    for (const [x, y] of corners) { const v = x * ux + y * uy; if (v < mn) mn = v; if (v > mx) mx = v }
    return [mn, mx]
  }

  const rimPad = rimOn ? Math.max(0, rimW) : 0
  let bands = ''

  for (const angle of angles) {
    const rad = (angle * Math.PI) / 180
    const dx = Math.cos(rad), dy = Math.sin(rad)   // along the lamella
    const px = -dy, py = dx                         // across the lamellae
    const [pMn, pMx] = projRange(px, py)
    const [dMn, dMx] = projRange(dx, dy)

    let s = pMn
    let guard = 0
    while (s <= pMx && guard++ < 100000) {
      const w = bandMin + rng() * Math.max(0, bandMax - bandMin)
      let t = dMn + rng() * segMax
      let gGuard = 0
      while (t <= dMx && gGuard++ < 100000) {
        const segLen = segMin + rng() * Math.max(0, segMax - segMin)
        const mt = t + segLen / 2
        const mx = cx + s * px + mt * dx
        const my = cy + s * py + mt * dy

        const dv = vAnchor === 'bottom' ? (H - my) / H : my / H
        const dh = hAnchor === 'left' ? mx / W : (W - mx) / W
        const coverage =
          (vOn ? ramp(dv, vReach, vSoft) : 1) *
          (hOn ? ramp(dh, hReach, hSoft) : 1)

        // Whole segments are kept or dropped — never made translucent — so the
        // reach edge reads as the pattern organically thinning out.
        if (coverage >= 1 || rng() < coverage) {
          const op = opacityVar ? 0.7 + rng() * 0.3 : null
          const emit = (ox, oy) => {
            const ex = mx + ox, ey = my + oy
            const rot = `${angle.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`
            if (rimOn && rimW > 0) {
              const rl = segLen + 2 * rimW, rw = w + 2 * rimW
              bands += `<rect x="${(ex - rl / 2).toFixed(2)}" y="${(ey - rw / 2).toFixed(2)}" width="${rl.toFixed(2)}" height="${rw.toFixed(2)}" transform="rotate(${rot})" fill="${rimCol}"/>`
            }
            const opAttr = op != null ? ` fill-opacity="${op.toFixed(2)}"` : ''
            bands += `<rect x="${(ex - segLen / 2).toFixed(2)}" y="${(ey - w / 2).toFixed(2)}" width="${segLen.toFixed(2)}" height="${w.toFixed(2)}" transform="rotate(${rot})" fill="${bandCol}"${opAttr}/>`
          }

          emit(0, 0)
          if (seamless && mode === 'tile') {
            const ext = Math.hypot(segLen, w) / 2 + rimPad + 2
            const wx = mx < ext ? W : (mx > W - ext ? -W : 0)
            const wy = my < ext ? H : (my > H - ext ? -H : 0)
            if (wx) emit(wx, 0)
            if (wy) emit(0, wy)
            if (wx && wy) emit(wx, wy)
          }
        }

        const gap = gapMin + rng() * Math.max(0, gapMax - gapMin)
        t += segLen + gap
      }
      s += Math.max(1, spacing * (1 + (rng() - 0.5) * spacingJit))
    }
  }

  const Ws = W.toFixed(0), Hs = H.toFixed(0)
  const clipNeeded = seamless && mode === 'tile'
  const clip = clipNeeded ? `<clipPath id="mc"><rect width="${Ws}" height="${Hs}"/></clipPath>` : ''
  const cpAttr = clipNeeded ? ' clip-path="url(#mc)"' : ''
  const matrix = `<rect width="${Ws}" height="${Hs}" fill="${matrixCol}"/>`
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${Ws}" height="${Hs}" viewBox="0 0 ${Ws} ${Hs}"><defs>${clip}</defs>${matrix}<g id="tile"${cpAttr}>${bands}</g></svg>`
  return { svg, W, H }
}

// Preset parameter bundles. Each is fully tweakable after loading.
export const PRESETS = {
  Coarse:     { angles2: 2, baseAngle: 30, spacing: 60, spacingJit: 0.4, bandMin: 10, bandMax: 22, segMin: 90, segMax: 260, gapMin: 30, gapMax: 110, rimOn: false },
  Fine:       { angles2: 2, baseAngle: 30, spacing: 26, spacingJit: 0.35, bandMin: 4, bandMax: 9, segMin: 50, segMax: 160, gapMin: 18, gapMax: 70, rimOn: false },
  Etched:     { angles2: 2, baseAngle: 35, spacing: 34, spacingJit: 0.5, bandMin: 6, bandMax: 14, segMin: 60, segMax: 200, gapMin: 24, gapMax: 90, rimOn: true, rimW: 2 },
  Triangular: { angles2: 3, baseAngle: 20, spacing: 40, spacingJit: 0.45, bandMin: 6, bandMax: 13, segMin: 70, segMax: 210, gapMin: 26, gapMax: 95, rimOn: false },
  Sparse:     { angles2: 2, baseAngle: 30, spacing: 70, spacingJit: 0.6, bandMin: 5, bandMax: 12, segMin: 40, segMax: 130, gapMin: 60, gapMax: 180, rimOn: false },
}

// Evenly distribute `count` orientations across 180°, offset by baseAngle.
export function anglesFor(count, baseAngle) {
  const out = []
  for (let i = 0; i < count; i++) out.push(baseAngle + (i * 180) / count)
  return out
}
