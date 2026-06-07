// ── Halftone renderer ─────────────────────────────────────────────────────────
//
// Classic AM (amplitude-modulated) halftone: the image is sampled on a rotated
// grid of cells; each cell paints a dot whose size tracks the local ink density.
//
// One unified entry — renderHalftone(img, opts) — covers three ink modes:
//   • mono     single ink dot screen on a paper colour
//   • cmyk     four rotated process screens (C/M/Y/K)
//   • palette  one screen per palette colour, separated as its own layer
//
// Every mode returns { composite, layers:[{ key, name, colorCss, angle, canvas }] }
// so the UI can preview the composite, toggle individual ink layers on/off, and
// export each layer separately. Output is rendered at `scale`× source resolution
// so the dots stay crisp / vector-like. Dot shapes: round / square / diamond.

const DEG = Math.PI / 180

function rgbToCmyk(r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const k = 1 - Math.max(rr, gg, bb)
  if (k >= 1) return [0, 0, 0, 1]
  return [(1 - rr - k) / (1 - k), (1 - gg - k) / (1 - k), (1 - bb - k) / (1 - k), k]
}

function luminance(r, g, b) { return (0.299 * r + 0.587 * g + 0.114 * b) / 255 }

function clampIdx(v, hi) { return v < 0 ? 0 : v > hi ? hi : v | 0 }

// Distinct screen angles assigned to palette inks (index-cycled) to limit moiré.
const ANGLE_SET = [15, 75, 0, 45, 22.5, 52.5, 67.5, 7.5, 37.5, 82.5, 30, 60, 12, 48, 68, 3]

// ── Coverage sources ────────────────────────────────────────────────────────────
// A "coverage function" maps a source pixel (sx, sy) → ink amount 0..1.

function channelCoverage(data, W, H, channel) {
  return (sx, sy) => {
    const o = (clampIdx(sy, H - 1) * W + clampIdx(sx, W - 1)) * 4
    const r = data[o], g = data[o + 1], b = data[o + 2]
    if (channel === 'luma') return 1 - luminance(r, g, b)
    const cmyk = rgbToCmyk(r, g, b)
    return cmyk[{ c: 0, m: 1, y: 2, k: 3 }[channel]]
  }
}

function arrayCoverage(arr, W, H) {
  return (sx, sy) => arr[clampIdx(sy, H - 1) * W + clampIdx(sx, W - 1)]
}

// Decompose an image into per-ink coverage maps against a paper colour.
//
// Two things keep it from looking blobby:
//   • dot size tracks distance-from-paper (a tonal field), so light areas get
//     small dots and dark/saturated areas grow — not flat solid regions;
//   • each pixel is blended between its TWO nearest inks rather than hard-snapped
//     to one, so colour transitions are smooth and neighbouring screens (at
//     different angles) interleave into a rosette instead of single-colour blobs.
function buildPaletteCoverage(img, inks, paper) {
  const { width: W, height: H, data } = img
  const n = inks.length
  const maps = inks.map(() => new Float32Array(W * H))
  const dist2 = (a, r, g, b) => {
    const dr = a[0] - r, dg = a[1] - g, db = a[2] - b
    return dr * dr + dg * dg + db * db
  }
  // Reference distance for tonal normalisation: the farthest ink from paper.
  let refD = 1
  for (const ink of inks) {
    const d = dist2(ink, paper[0], paper[1], paper[2])
    if (d > refD) refD = d
  }

  for (let p = 0, o = 0; p < W * H; p++, o += 4) {
    const r = data[o], g = data[o + 1], b = data[o + 2]
    // Overall ink amount from how far the pixel sits from paper (0 at paper).
    let A = Math.sqrt(dist2(paper, r, g, b) / refD)
    if (A <= 0.002) continue
    if (A > 1) A = 1

    // Two nearest inks.
    let i1 = -1, d1 = Infinity, i2 = -1, d2 = Infinity
    for (let i = 0; i < n; i++) {
      const d = dist2(inks[i], r, g, b)
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i }
      else if (d < d2) { d2 = d; i2 = i }
    }
    if (i1 < 0) continue
    if (i2 < 0) { maps[i1][p] = A; continue }
    // Linear blend by relative distance: t→0 on i1, 0.5 at the boundary.
    const t = d1 / (d1 + d2 + 1e-6)
    maps[i1][p] = A * (1 - t)
    maps[i2][p] = A * t
  }
  return maps
}

// ── Dot painting ────────────────────────────────────────────────────────────────
function paintDot(ctx, cx, cy, rad, shape, angle) {
  if (rad <= 0.15) return
  if (shape === 'square' || shape === 'diamond') {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((angle + (shape === 'diamond' ? 45 : 0)) * DEG)
    const s = rad * 1.7724
    ctx.fillRect(-s / 2, -s / 2, s, s)
    ctx.restore()
  } else {
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill()
  }
}

// Paint one rotated halftone screen using a coverage function.
function paintScreen(ctx, W, H, coverAt, { cell, angle, shape, scale, color }) {
  ctx.fillStyle = color
  const a = angle * DEG
  const ca = Math.cos(a), sa = Math.sin(a)
  const diag = Math.hypot(W, H)
  const maxR = cell * scale * 0.72
  for (let v = -diag; v <= diag; v += cell) {
    for (let u = -diag; u <= diag; u += cell) {
      const sx = u * ca - v * sa
      const sy = u * sa + v * ca
      if (sx < -cell || sx > W + cell || sy < -cell || sy > H + cell) continue
      const ink = coverAt(sx, sy)
      if (ink <= 0) continue
      paintDot(ctx, sx * scale, sy * scale, maxR * Math.sqrt(ink), shape, angle)
    }
  }
}

// ── Ink-definition assembly ─────────────────────────────────────────────────────
// Returns an array of { key, name, colorCss, angle, coverAt } for the chosen mode.
function buildInks(img, opts) {
  const { inkMode, data } = { inkMode: opts.inkMode, data: img.data }
  const W = img.width, H = img.height

  if (inkMode === 'cmyk') {
    const ang = opts.angles || { c: 15, m: 75, y: 0, k: 45 }
    return [
      { key: 'c', name: 'Cyan',    colorCss: 'rgb(0,174,239)', angle: ang.c, coverAt: channelCoverage(data, W, H, 'c') },
      { key: 'm', name: 'Magenta', colorCss: 'rgb(236,0,140)', angle: ang.m, coverAt: channelCoverage(data, W, H, 'm') },
      { key: 'y', name: 'Yellow',  colorCss: 'rgb(255,242,0)', angle: ang.y, coverAt: channelCoverage(data, W, H, 'y') },
      { key: 'k', name: 'Black',   colorCss: 'rgb(0,0,0)',     angle: ang.k, coverAt: channelCoverage(data, W, H, 'k') },
    ]
  }

  if (inkMode === 'palette') {
    // inks: [[r,g,b]], paper: [r,g,b], names: [hex]
    const { inks, paper, names } = opts
    const maps = buildPaletteCoverage(img, inks, paper)
    return inks.map((ink, i) => ({
      key: names[i],
      name: names[i],
      colorCss: `rgb(${ink[0]},${ink[1]},${ink[2]})`,
      angle: ANGLE_SET[i % ANGLE_SET.length],
      coverAt: arrayCoverage(maps[i], W, H),
    }))
  }

  // mono
  return [{
    key: 'ink', name: 'Ink', colorCss: opts.ink || '#000000', angle: opts.angle ?? 45,
    coverAt: channelCoverage(data, W, H, 'luma'),
  }]
}

// ── Main entry ──────────────────────────────────────────────────────────────────
// opts: { inkMode, cell, shape, scale, bg, disabled:Set,
//         (mono) ink, paper, angle
//         (cmyk) angles
//         (palette) inks, paper, names }
export function renderHalftone(img, opts) {
  const { cell = 6, shape = 'round', scale = 3, bg = '#ffffff' } = opts
  const disabled = opts.disabled || new Set()
  const W = Math.round(img.width * scale)
  const H = Math.round(img.height * scale)

  const inkDefs = buildInks(img, opts)

  // Render each ink to its own transparent layer.
  const layers = inkDefs.map(def => {
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    paintScreen(cv.getContext('2d'), img.width, img.height, def.coverAt,
      { cell, angle: def.angle, shape, scale, color: def.colorCss })
    return { key: def.key, name: def.name, colorCss: def.colorCss, angle: def.angle, canvas: cv }
  })

  // Composite enabled layers over paper with multiply (realistic overprint).
  const composite = document.createElement('canvas')
  composite.width = W; composite.height = H
  const cctx = composite.getContext('2d')
  cctx.fillStyle = bg
  cctx.fillRect(0, 0, W, H)
  cctx.globalCompositeOperation = 'multiply'
  for (const layer of layers) {
    if (disabled.has(layer.key)) continue
    // Draw the layer over white first so transparent gaps multiply to no-op.
    const tmp = document.createElement('canvas')
    tmp.width = W; tmp.height = H
    const tctx = tmp.getContext('2d')
    tctx.fillStyle = '#ffffff'
    tctx.fillRect(0, 0, W, H)
    tctx.drawImage(layer.canvas, 0, 0)
    cctx.drawImage(tmp, 0, 0)
  }
  cctx.globalCompositeOperation = 'source-over'

  return { composite, layers }
}

// ── SVG export (vector dots) ─────────────────────────────────────────────────────
// Builds one scalable SVG with a coloured <g> per enabled ink layer.
export function renderHalftoneSvg(img, opts) {
  const { cell = 6, shape = 'round', bg = '#ffffff' } = opts
  const disabled = opts.disabled || new Set()
  const W = img.width, H = img.height
  const inkDefs = buildInks(img, opts)
  const maxR = cell * 0.72

  let groups = ''
  for (const def of inkDefs) {
    if (disabled.has(def.key)) continue
    const a = def.angle * DEG
    const ca = Math.cos(a), sa = Math.sin(a)
    const diag = Math.hypot(W, H)
    let dots = ''
    for (let v = -diag; v <= diag; v += cell) {
      for (let u = -diag; u <= diag; u += cell) {
        const sx = u * ca - v * sa
        const sy = u * sa + v * ca
        if (sx < -cell || sx > W + cell || sy < -cell || sy > H + cell) continue
        const ink = def.coverAt(sx, sy)
        if (ink <= 0.01) continue
        const rad = maxR * Math.sqrt(ink)
        if (rad < 0.05) continue
        if (shape === 'square' || shape === 'diamond') {
          const s = (rad * 1.7724).toFixed(2)
          const rot = def.angle + (shape === 'diamond' ? 45 : 0)
          dots += `<rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" transform="translate(${sx.toFixed(2)},${sy.toFixed(2)}) rotate(${rot})"/>`
        } else {
          dots += `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${rad.toFixed(2)}"/>`
        }
      }
    }
    groups += `<g fill="${def.colorCss}" data-ink="${def.name}" style="mix-blend-mode:multiply">${dots}</g>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${bg}"/>${groups}</svg>`
}
