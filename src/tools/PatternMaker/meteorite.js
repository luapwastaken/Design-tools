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

const f2 = n => n.toFixed(2)
// Hex (#rrggbb) -> [r,g,b] in 0..1.
function hx(h) {
  const s = (h || '#000000').replace('#', '')
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255]
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
    style = 'lamellae',            // 'lamellae' | 'hairline'
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
    deboss = false, debossDepth = 2,
    seamless = true,
  } = params

  const { W, H } = meteoriteSize(params)
  const rng = mkRng(seed)
  const cx = W / 2, cy = H / 2
  const hairline = style === 'hairline'

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

  // Draw one band rectangle (length L along the lamella, width Wd across it),
  // centred at (mx,my), rotated to the family angle. Handles rim + opacity + the
  // seamless edge-wrap copies.
  const drawBand = (mx, my, L, Wd, angle, op) => {
    const emit = (ox, oy) => {
      const ex = mx + ox, ey = my + oy
      const rot = `${angle.toFixed(2)} ${f2(ex)} ${f2(ey)}`
      if (rimOn && rimW > 0) {
        const rl = L + 2 * rimW, rw = Wd + 2 * rimW
        bands += `<rect x="${f2(ex - rl / 2)}" y="${f2(ey - rw / 2)}" width="${f2(rl)}" height="${f2(rw)}" transform="rotate(${rot})" fill="${rimCol}"/>`
      }
      const opAttr = op != null ? ` fill-opacity="${op.toFixed(2)}"` : ''
      bands += `<rect x="${f2(ex - L / 2)}" y="${f2(ey - Wd / 2)}" width="${f2(L)}" height="${f2(Wd)}" transform="rotate(${rot})" fill="${bandCol}"${opAttr}/>`
    }
    emit(0, 0)
    if (seamless && mode === 'tile') {
      const ext = Math.hypot(L, Wd) / 2 + rimPad + 2
      const wx = mx < ext ? W : (mx > W - ext ? -W : 0)
      const wy = my < ext ? H : (my > H - ext ? -H : 0)
      if (wx) emit(wx, 0)
      if (wy) emit(0, wy)
      if (wx && wy) emit(wx, wy)
    }
  }

  const coverageAt = (mx, my) => {
    const dv = vAnchor === 'bottom' ? (H - my) / H : my / H
    const dh = hAnchor === 'left' ? mx / W : (W - mx) / W
    return (vOn ? ramp(dv, vReach, vSoft) : 1) * (hOn ? ramp(dh, hReach, hSoft) : 1)
  }

  for (const angle of angles) {
    const rad = (angle * Math.PI) / 180
    const dx = Math.cos(rad), dy = Math.sin(rad)   // along the lamella
    const px = -dy, py = dx                         // across the lamellae
    const [pMn, pMx] = projRange(px, py)
    const [dMn, dMx] = projRange(dx, dy)
    const lineLen = dMx - dMn

    let s = pMn
    let guard = 0
    while (s <= pMx && guard++ < 100000) {
      const w = bandMin + rng() * Math.max(0, bandMax - bandMin)

      if (hairline) {
        // One thin continuous rule per lamella — the "machined grid" register.
        // Reach keeps or drops whole lines, sampled at the line midpoint.
        const mt = (dMn + dMx) / 2
        const mx = cx + s * px + mt * dx
        const my = cy + s * py + mt * dy
        const cov = coverageAt(mx, my)
        if (cov >= 1 || rng() < cov) {
          const op = opacityVar ? 0.7 + rng() * 0.3 : null
          drawBand(mx, my, lineLen, Math.max(0.5, bandMin), angle, op)
        }
      } else {
        // Break the lamella into jittered segments with gaps.
        let t = dMn + rng() * segMax
        let gGuard = 0
        while (t <= dMx && gGuard++ < 100000) {
          const segLen = segMin + rng() * Math.max(0, segMax - segMin)
          const mt = t + segLen / 2
          const mx = cx + s * px + mt * dx
          const my = cy + s * py + mt * dy
          const cov = coverageAt(mx, my)
          // Whole segments are kept or dropped — never made translucent — so the
          // reach edge reads as the pattern organically thinning out.
          if (cov >= 1 || rng() < cov) {
            const op = opacityVar ? 0.7 + rng() * 0.3 : null
            drawBand(mx, my, segLen, w, angle, op)
          }
          const gap = gapMin + rng() * Math.max(0, gapMax - gapMin)
          t += segLen + gap
        }
      }
      s += Math.max(1, spacing * (1 + (rng() - 0.5) * spacingJit))
    }
  }

  const Ws = W.toFixed(0), Hs = H.toFixed(0)
  const clipNeeded = seamless && mode === 'tile'
  const clip = clipNeeded ? `<clipPath id="mc"><rect width="${Ws}" height="${Hs}"/></clipPath>` : ''
  const cpAttr = clipNeeded ? ' clip-path="url(#mc)"' : ''

  // Optional blind-deboss preview: bevel the bands from their alpha (works even
  // when band and matrix are the same colour, i.e. a true tone-on-tone emboss).
  const embFilter = deboss
    ? `<filter id="emb" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceAlpha" stdDeviation="${f2(debossDepth)}" result="b"/><feSpecularLighting in="b" surfaceScale="${f2(debossDepth * 1.5)}" specularConstant="1" specularExponent="16" lighting-color="#ffffff" result="s"><feDistantLight azimuth="235" elevation="40"/></feSpecularLighting><feComposite in="s" in2="SourceAlpha" operator="in" result="sc"/><feComposite in="SourceGraphic" in2="sc" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/></filter>`
    : ''
  const embAttr = deboss ? ' filter="url(#emb)"' : ''

  const matrix = `<rect width="${Ws}" height="${Hs}" fill="${matrixCol}"/>`
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${Ws}" height="${Hs}" viewBox="0 0 ${Ws} ${Hs}"><defs>${clip}${embFilter}</defs>${matrix}<g id="tile"${cpAttr}${embAttr}>${bands}</g></svg>`
  return { svg, W, H }
}

// Real-etch duotone: embed a raster image (a scanned Widmanstätten faceplate,
// say) and map its luminance between the two brand inks. Honest — it's the real
// material, not a generated stand-in. Structure/reach controls don't apply here.
export function buildDuotone({ href, matrixCol = '#151515', bandCol = '#f0ede8', contrast = 1, ...size }) {
  const { W, H } = meteoriteSize(size)
  const Ws = W.toFixed(0), Hs = H.toFixed(0)
  if (!href) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${Ws}" height="${Hs}" viewBox="0 0 ${Ws} ${Hs}"><rect width="${Ws}" height="${Hs}" fill="${matrixCol}"/></svg>`
    return { svg, W, H }
  }
  const [mr, mg, mb] = hx(matrixCol)
  const [br, bg, bb] = hx(bandCol)
  const v = n => n.toFixed(4)
  const slope = contrast, inter = (1 - contrast) / 2
  const filter =
    `<filter id="duo" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"/>` +
    `<feComponentTransfer><feFuncR type="linear" slope="${v(slope)}" intercept="${v(inter)}"/><feFuncG type="linear" slope="${v(slope)}" intercept="${v(inter)}"/><feFuncB type="linear" slope="${v(slope)}" intercept="${v(inter)}"/></feComponentTransfer>` +
    `<feComponentTransfer><feFuncR type="table" tableValues="${v(mr)} ${v(br)}"/><feFuncG type="table" tableValues="${v(mg)} ${v(bg)}"/><feFuncB type="table" tableValues="${v(mb)} ${v(bb)}"/></feComponentTransfer>` +
    `</filter>`
  const img = `<image href="${href}" xlink:href="${href}" x="0" y="0" width="${Ws}" height="${Hs}" preserveAspectRatio="xMidYMid slice"/>`
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Ws}" height="${Hs}" viewBox="0 0 ${Ws} ${Hs}"><defs>${filter}</defs><rect width="${Ws}" height="${Hs}" fill="${matrixCol}"/><g filter="url(#duo)">${img}</g></svg>`
  return { svg, W, H }
}

// Preset parameter bundles. Each is fully tweakable after loading. Presets may
// carry colours/rim too; those keys are applied only when present.
export const PRESETS = {
  Coarse:     { angles2: 2, baseAngle: 30, spacing: 60, spacingJit: 0.4, bandMin: 10, bandMax: 22, segMin: 90, segMax: 260, gapMin: 30, gapMax: 110, rimOn: false },
  Fine:       { angles2: 2, baseAngle: 30, spacing: 26, spacingJit: 0.35, bandMin: 4, bandMax: 9, segMin: 50, segMax: 160, gapMin: 18, gapMax: 70, rimOn: false },
  Etched:     { angles2: 2, baseAngle: 35, spacing: 34, spacingJit: 0.5, bandMin: 6, bandMax: 14, segMin: 60, segMax: 200, gapMin: 24, gapMax: 90, rimOn: true, rimW: 2 },
  Triangular: { angles2: 3, baseAngle: 20, spacing: 40, spacingJit: 0.45, bandMin: 6, bandMax: 13, segMin: 70, segMax: 210, gapMin: 26, gapMax: 95, rimOn: false },
  Sparse:     { angles2: 2, baseAngle: 30, spacing: 70, spacingJit: 0.6, bandMin: 5, bandMax: 12, segMin: 40, segMax: 130, gapMin: 60, gapMax: 180, rimOn: false },
  // On-brand for Monolith: pure monochrome (#151515 / #F0EDE8), two families at
  // ~31° to echo the bracket logomark cut, restrained, no rim hue.
  Monolith:   { angles2: 2, baseAngle: 31, spacing: 46, spacingJit: 0.4, bandMin: 5, bandMax: 14, segMin: 70, segMax: 220, gapMin: 30, gapMax: 110, rimOn: false,
                matrixCol: '#151515', bandCol: '#f0ede8' },
}

// Common Monolith packaging panels (mm). Loading one switches to Fit mode.
export const PANELS = [
  ['Lid 120×120', 120, 120],
  ['Slipcase 100×100', 100, 100],
  ['Sleeve face 150×100', 150, 100],
  ['Belly band 210×60', 210, 60],
  ['Cert card 90×55', 90, 55],
]

// Evenly distribute `count` orientations across 180°, offset by baseAngle.
export function anglesFor(count, baseAngle) {
  const out = []
  for (let i = 0; i < count; i++) out.push(baseAngle + (i * 180) / count)
  return out
}
