// ── Scan-to-Lineart pipeline ──────────────────────────────────────────────────
//
// Turns a photo/scan of a pencil or ink sketch into clean lineart:
//
//   toGray → flatten (de-paper) → applyLevels → toInk (threshold) → despeckle
//   → compose (colorized RGBA)  /  traceSvg (vector outline)
//
// All stages operate on Float32Array grayscale/alpha buffers in 0..1 so the
// pipeline stays resolution-independent and cheap to re-run.

// ── Grayscale extraction ──────────────────────────────────────────────────────
// channel: 'luma' | 'red' | 'green' | 'blue'
// The blue channel is the classic non-photo-blue trick: blue pencil reflects
// blue light strongly, so it reads near-white there and drops out of the line.
export function toGray(imageData, channel = 'luma', invert = false) {
  const { data, width, height } = imageData
  const n = width * height
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    let v
    if (channel === 'red') v = data[p]
    else if (channel === 'green') v = data[p + 1]
    else if (channel === 'blue') v = data[p + 2]
    else v = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    out[i] = invert ? 1 - v / 255 : v / 255
  }
  return out
}

// ── Separable box blur on a float buffer ──────────────────────────────────────
// Two passes ≈ triangular kernel — smooth enough for background estimation.
export function boxBlurF(src, w, h, radius, passes = 2) {
  const r = Math.max(1, Math.round(radius))
  let a = Float32Array.from(src)
  let b = new Float32Array(src.length)
  for (let p = 0; p < passes; p++) {
    blurH(a, b, w, h, r)
    blurV(b, a, w, h, r)
  }
  return a
}

function blurH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = src[row] * (r + 1)
    for (let x = 1; x <= r; x++) sum += src[row + Math.min(x, w - 1)]
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm
      sum += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)]
    }
  }
}

function blurV(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1)
  for (let x = 0; x < w; x++) {
    let sum = src[x] * (r + 1)
    for (let y = 1; y <= r; y++) sum += src[Math.min(y, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm
      sum += src[Math.min(y + r + 1, h - 1) * w + x] - src[Math.max(y - r, 0) * w + x]
    }
  }
}

// ── Paper flattening (high-pass) ──────────────────────────────────────────────
// Divides each pixel by a heavily blurred copy of itself — uneven lighting,
// paper shadows and page curl all live in the low frequencies and cancel out,
// leaving lines on a uniform ~white field. strength mixes original ↔ flattened.
export function flatten(gray, w, h, radius, strength = 1) {
  const bg = boxBlurF(gray, w, h, radius)
  const out = new Float32Array(gray.length)
  for (let i = 0; i < gray.length; i++) {
    const ratio = Math.min(1, gray[i] / Math.max(bg[i], 0.02))
    out[i] = gray[i] + (ratio - gray[i]) * strength
  }
  return out
}

// ── Levels ────────────────────────────────────────────────────────────────────
// Histogram percentiles → suggested black/white points. Skips the paper mass by
// clipping a small fraction at each end.
export function autoLevels(gray, clipLo = 0.005, clipHi = 0.25) {
  const bins = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) bins[Math.min(255, Math.max(0, gray[i] * 255 | 0))]++
  const total = gray.length
  let lo = 0, hi = 255, acc = 0
  for (let i = 0; i < 256; i++) { acc += bins[i]; if (acc >= total * clipLo) { lo = i; break } }
  acc = 0
  for (let i = 255; i >= 0; i--) { acc += bins[i]; if (acc >= total * clipHi) { hi = i; break } }
  if (hi - lo < 16) { lo = Math.max(0, hi - 16) }
  return { low: lo / 255, high: hi / 255 }
}

export function applyLevels(gray, low, high, gamma = 1) {
  const out = new Float32Array(gray.length)
  const range = Math.max(0.001, high - low)
  const g = 1 / Math.max(0.05, gamma)
  for (let i = 0; i < gray.length; i++) {
    const v = Math.min(1, Math.max(0, (gray[i] - low) / range))
    out[i] = g === 1 ? v : Math.pow(v, g)
  }
  return out
}

// ── Threshold → ink alpha ─────────────────────────────────────────────────────
// mode 'soft':     smooth ramp around the threshold — keeps anti-aliased edges.
// mode 'hard':     pure binary.
// mode 'adaptive': local mean comparison — handles residual uneven tone, picks
//                  up faint lines that a global threshold misses.
export function toInk(gray, w, h, opts) {
  const { mode = 'soft', threshold = 0.5, softness = 0.1, blockSize = 32, offset = 0.06 } = opts
  const out = new Float32Array(gray.length)
  if (mode === 'adaptive') {
    const mean = boxBlurF(gray, w, h, blockSize)
    for (let i = 0; i < gray.length; i++) out[i] = mean[i] - gray[i] > offset ? 1 : 0
    return out
  }
  if (mode === 'hard') {
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] < threshold ? 1 : 0
    return out
  }
  const lo = threshold - softness, hi = threshold + softness
  const inv = 1 / Math.max(0.001, hi - lo)
  for (let i = 0; i < gray.length; i++) {
    const t = Math.min(1, Math.max(0, (hi - gray[i]) * inv))
    out[i] = t * t * (3 - 2 * t)   // smoothstep
  }
  return out
}

// ── Otsu threshold ────────────────────────────────────────────────────────────
// Classic between-class variance maximisation — finds the natural split between
// the line mass and the paper mass in a bimodal histogram. Returns 0..1.
export function otsu(gray) {
  const bins = new Float64Array(256)
  for (let i = 0; i < gray.length; i++) bins[Math.min(255, Math.max(0, gray[i] * 255 | 0))]++
  const total = gray.length
  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * bins[i]
  let sumB = 0, wB = 0, best = 0, bestT = 128
  for (let t = 0; t < 256; t++) {
    wB += bins[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * bins[t]
    const mB = sumB / wB, mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; bestT = t }
  }
  return bestT / 255
}

// ── Line weight ───────────────────────────────────────────────────────────────
// Thickens (amount > 0) or thins (amount < 0) strokes by roughly |amount| px:
// blur the mask, then re-threshold low (anything the blur reached survives →
// dilate) or high (only the solid core survives → erode).
export function adjustWeight(alpha, w, h, amount) {
  if (!amount) return alpha
  const a = Math.abs(amount)
  const r = Math.max(1, Math.ceil(a))
  // one box-blur pass turns an edge into a linear ramp over (2r+1) px, so an
  // off-centre threshold shifts the edge by (t−0.5)·(2r+1) px per side — pick t
  // for exactly `amount` px of growth/shrink instead of a fixed aggressive cut.
  // The ramp calibration assumes a solid mask, so binarise first: soft AA edges
  // would otherwise weaken thin-line cores and make erosion wipe them entirely.
  const solid = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) solid[i] = alpha[i] >= 0.5 ? 1 : 0
  const blurred = boxBlurF(solid, w, h, r, 1)
  const t = Math.min(0.95, Math.max(0.05, 0.5 + (amount > 0 ? -1 : 1) * a / (2 * r + 1)))
  const soft = 0.08
  const out = new Float32Array(alpha.length)
  for (let i = 0; i < blurred.length; i++) {
    const v = Math.min(1, Math.max(0, (blurred[i] - (t - soft)) / (2 * soft)))
    out[i] = v * v * (3 - 2 * v)
  }
  return out
}

// ── Despeckle ─────────────────────────────────────────────────────────────────
// Removes connected ink components smaller than minSize px (dust, paper grain).
// Mutates alpha in place; returns the number of components removed.
export function despeckle(alpha, w, h, minSize) {
  if (minSize <= 0) return 0
  const n = w * h
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  const comp = new Int32Array(n)
  let removed = 0
  for (let start = 0; start < n; start++) {
    if (seen[start] || alpha[start] < 0.2) continue
    // flood fill (4-connected)
    let sp = 0, cn = 0
    stack[sp++] = start; seen[start] = 1
    while (sp > 0) {
      const i = stack[--sp]
      comp[cn++] = i
      const x = i % w, y = (i / w) | 0
      if (x > 0 && !seen[i - 1] && alpha[i - 1] >= 0.2) { seen[i - 1] = 1; stack[sp++] = i - 1 }
      if (x < w - 1 && !seen[i + 1] && alpha[i + 1] >= 0.2) { seen[i + 1] = 1; stack[sp++] = i + 1 }
      if (y > 0 && !seen[i - w] && alpha[i - w] >= 0.2) { seen[i - w] = 1; stack[sp++] = i - w }
      if (y < h - 1 && !seen[i + w] && alpha[i + w] >= 0.2) { seen[i + w] = 1; stack[sp++] = i + w }
    }
    if (cn < minSize) {
      for (let k = 0; k < cn; k++) alpha[comp[k]] = 0
      removed++
    }
  }
  return removed
}

// ── Compose to RGBA ───────────────────────────────────────────────────────────
// lineRgb: [r,g,b] 0..255. bgRgb null → transparent background.
export function compose(alpha, w, h, lineRgb, bgRgb = null) {
  const out = new ImageData(w, h)
  const d = out.data
  const [lr, lg, lb] = lineRgb
  for (let i = 0; i < alpha.length; i++) {
    const p = i * 4, a = alpha[i]
    if (bgRgb) {
      d[p] = bgRgb[0] + (lr - bgRgb[0]) * a
      d[p + 1] = bgRgb[1] + (lg - bgRgb[1]) * a
      d[p + 2] = bgRgb[2] + (lb - bgRgb[2]) * a
      d[p + 3] = 255
    } else {
      d[p] = lr; d[p + 1] = lg; d[p + 2] = lb
      d[p + 3] = Math.round(a * 255)
    }
  }
  return out
}

// ── Mask smoothing ────────────────────────────────────────────────────────────
// Rounds staircase edges and wobble before tracing: blur the ink alpha, then
// re-threshold through a steep smoothstep around 0.5. The blur radius controls
// how much edge roughness is averaged away; the re-threshold keeps the line
// weight from fattening or thinning.
export function smoothMask(alpha, w, h, radius) {
  if (radius <= 0) return alpha
  const blurred = boxBlurF(alpha, w, h, Math.max(1, radius), 2)
  const out = new Float32Array(alpha.length)
  const soft = 0.18
  for (let i = 0; i < blurred.length; i++) {
    const t = Math.min(1, Math.max(0, (blurred[i] - (0.5 - soft)) / (2 * soft)))
    out[i] = t * t * (3 - 2 * t)
  }
  return out
}

// ── Vector trace (marching-squares contour walk) ──────────────────────────────
// Extracts the boundary of the ink mask as closed loops on the pixel grid,
// simplifies them (collinear collapse + Douglas-Peucker) and rounds the
// staircase with Chaikin smoothing. Holes come out as separate loops and
// resolve via the evenodd fill rule. The returned loops are the single source
// of truth for the viewport render, the PNG export and the SVG export.
export function traceContours(alpha, w, h, { simplify = 1, smooth = 1 } = {}) {
  const loops = traceLoops(alpha, w, h)
  const out = []
  for (let loop of loops) {
    loop = collapseCollinear(loop)
    if (simplify > 0) loop = rdpClosed(loop, simplify)
    for (let s = 0; s < smooth; s++) loop = chaikin(loop)
    if (loop.length >= 3) out.push(loop)
  }
  return out
}

export function loopsToSvg(loops, w, h, { color = '#1a1a1a', background = null } = {}) {
  const parts = []
  for (const loop of loops) {
    let d = `M${fmt(loop[0][0])} ${fmt(loop[0][1])}`
    for (let i = 1; i < loop.length; i++) d += `L${fmt(loop[i][0])} ${fmt(loop[i][1])}`
    parts.push(d + 'Z')
  }
  const bgRect = background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bgRect}<path d="${parts.join('')}" fill="${color}" fill-rule="evenodd"/></svg>`
}

// Renders traced loops into a canvas at the given scale with full anti-aliasing.
export function renderLoops(loops, w, h, scale, lineColor, bgColor = null) {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w * scale))
  cv.height = Math.max(1, Math.round(h * scale))
  const ctx = cv.getContext('2d')
  if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, cv.width, cv.height) }
  ctx.scale(cv.width / w, cv.height / h)
  const path = new Path2D()
  for (const loop of loops) {
    path.moveTo(loop[0][0], loop[0][1])
    for (let i = 1; i < loop.length; i++) path.lineTo(loop[i][0], loop[i][1])
    path.closePath()
  }
  ctx.fillStyle = lineColor
  ctx.fill(path, 'evenodd')
  return cv
}

export function traceSvg(alpha, w, h, opts = {}) {
  const { simplify = 1, smooth = 1, color = '#1a1a1a', background = null } = opts
  return loopsToSvg(traceContours(alpha, w, h, { simplify, smooth }), w, h, { color, background })
}

const fmt = v => Math.round(v * 100) / 100

// Directed boundary edges (interior on the left), joined into closed loops.
function traceLoops(alpha, w, h) {
  const filled = i => alpha[i] >= 0.5
  const W1 = w + 1
  // edges: Map<startVertexKey, endVertexKey[]>
  const edges = new Map()
  const addEdge = (a, b) => {
    const list = edges.get(a)
    if (list) list.push(b); else edges.set(a, [b])
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!filled(i)) continue
      const tl = y * W1 + x, tr = tl + 1, bl = tl + W1, br = bl + 1
      if (y === 0 || !filled(i - w)) addEdge(tl, tr)            // top → right
      if (y === h - 1 || !filled(i + w)) addEdge(br, bl)        // bottom → left
      if (x === 0 || !filled(i - 1)) addEdge(bl, tl)            // left → up
      if (x === w - 1 || !filled(i + 1)) addEdge(tr, br)        // right → down
    }
  }
  const loops = []
  for (const [startKey] of edges) {
    let list = edges.get(startKey)
    while (list && list.length) {
      const loop = []
      let cur = startKey
      // walk until we return to the loop start
      for (;;) {
        const outs = edges.get(cur)
        if (!outs || !outs.length) break
        const next = outs.pop()
        loop.push([cur % W1, (cur / W1) | 0])
        cur = next
        if (cur === startKey) break
      }
      if (loop.length >= 4) loops.push(loop)
      list = edges.get(startKey)
    }
  }
  return loops
}

function collapseCollinear(pts) {
  const out = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n]
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) !== 0) out.push(b)
  }
  return out.length >= 3 ? out : pts
}

// Douglas-Peucker for a closed loop: split at the two mutually farthest anchor
// points, simplify each half, rejoin.
function rdpClosed(pts, eps) {
  const n = pts.length
  if (n < 5) return pts
  // anchor 1: any point; anchor 2: farthest from it
  let i2 = 0, best = -1
  for (let i = 1; i < n; i++) {
    const d = dist2(pts[0], pts[i])
    if (d > best) { best = d; i2 = i }
  }
  const half1 = pts.slice(0, i2 + 1)
  const half2 = pts.slice(i2).concat([pts[0]])
  const r1 = rdp(half1, eps), r2 = rdp(half2, eps)
  return r1.slice(0, -1).concat(r2.slice(0, -1))
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts
  const [a, b] = [pts[0], pts[pts.length - 1]]
  let maxD = -1, idx = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b)
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= eps) return [a, b]
  const left = rdp(pts.slice(0, idx + 1), eps)
  const right = rdp(pts.slice(idx), eps)
  return left.slice(0, -1).concat(right)
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1])
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

// One Chaikin corner-cutting pass on a closed loop.
function chaikin(pts) {
  const n = pts.length
  if (n < 3) return pts
  const out = new Array(n * 2)
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n]
    out[i * 2] = [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]
    out[i * 2 + 1] = [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
  }
  return out
}
