// ── Dither engine ─────────────────────────────────────────────────────────────
//
// Operates on ImageData. Two families of algorithm:
//   • error-diffusion kernels (Floyd–Steinberg, Atkinson, Stucki, …)
//   • ordered / threshold-map screens (Bayer, clustered-dot, blue noise, …)
//
// plus the trivial Threshold / Random / IGN methods. Every algorithm quantises
// each pixel to the nearest entry in a working palette, so the same code path
// serves Mono / Tonal / Indexed colour modes; RGB mode quantises per-channel.
//
// Exported surface:
//   ALGORITHMS            ordered list of { id, label, group } for the UI
//   processImage(src, opts)   → new ImageData, dithered
//   buildPalette(opts)        → [[r,g,b], …] working palette for a colour mode

// ── Error-diffusion kernels ───────────────────────────────────────────────────
// cells: [dx, dy, weight] relative to current pixel; divisor normalises weights.

const DIFFUSION = {
  'floyd-steinberg': {
    label: 'Floyd–Steinberg', div: 16,
    cells: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]],
  },
  'false-floyd-steinberg': {
    label: 'False Floyd–Steinberg', div: 8,
    cells: [[1, 0, 3], [0, 1, 3], [1, 1, 2]],
  },
  'jarvis': {
    label: 'Jarvis–Judice–Ninke', div: 48,
    cells: [[1, 0, 7], [2, 0, 5],
            [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
            [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  },
  'stucki': {
    label: 'Stucki', div: 42,
    cells: [[1, 0, 8], [2, 0, 4],
            [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
            [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  },
  'atkinson': {
    label: 'Atkinson', div: 8,
    cells: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]],
  },
  'burkes': {
    label: 'Burkes', div: 32,
    cells: [[1, 0, 8], [2, 0, 4],
            [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]],
  },
  'sierra': {
    label: 'Sierra (3 row)', div: 32,
    cells: [[1, 0, 5], [2, 0, 3],
            [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
            [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
  },
  'sierra-2': {
    label: 'Sierra (2 row)', div: 16,
    cells: [[1, 0, 4], [2, 0, 3],
            [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]],
  },
  'sierra-lite': {
    label: 'Sierra Lite', div: 4,
    cells: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]],
  },
  'stevenson-arce': {
    label: 'Stevenson–Arce', div: 200,
    cells: [[2, 0, 32],
            [-3, 1, 12], [-1, 1, 26], [1, 1, 30], [3, 1, 16],
            [-2, 2, 12], [0, 2, 26], [2, 2, 12],
            [-3, 3, 5], [-1, 3, 12], [1, 3, 12], [3, 3, 5]],
  },
  'shiau-fan': {
    label: 'Shiau–Fan', div: 8,
    cells: [[1, 0, 4], [-2, 1, 1], [-1, 1, 1], [0, 1, 2]],
  },
  'shiau-fan-2': {
    label: 'Shiau–Fan 2', div: 16,
    cells: [[1, 0, 8], [-3, 1, 1], [-2, 1, 1], [-1, 1, 2], [0, 1, 4]],
  },
}

// ── Ordered threshold maps ─────────────────────────────────────────────────────
// Each entry resolves to a square matrix of thresholds in 0..1 (centre of bin).

// Bayer matrix, generated recursively. size must be a power of two.
function bayer(n) {
  if (n === 1) return [[0]]
  const half = bayer(n / 2)
  const h = n / 2
  const m = Array.from({ length: n }, () => new Array(n))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const v = half[y][x] * 4
      m[y][x]         = v + 0
      m[y][x + h]     = v + 2
      m[y + h][x]     = v + 3
      m[y + h][x + h] = v + 1
    }
  }
  return m
}

// Build a normalised threshold map (values in 0..1, exclusive of 0 and 1) from
// an integer rank matrix where each cell holds a unique 0..(n*n-1) ordering.
function normaliseRank(rankMatrix) {
  const n = rankMatrix.length
  const total = n * n
  return rankMatrix.map(row => row.map(v => (v + 0.5) / total))
}

// Ordered screen from a continuous "spot" function: rank cells by f() value so
// the brightest-to-darkest growth follows the spot shape. Produces clustered-dot
// and line screens depending on f.
function spotScreen(n, f) {
  const pts = []
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      pts.push({ x, y, v: f(x, y, n) })
  pts.sort((a, b) => a.v - b.v)
  const rank = Array.from({ length: n }, () => new Array(n))
  pts.forEach((p, i) => { rank[p.y][p.x] = i })
  return normaliseRank(rank)
}

// Centred round dot (clustered). Distance from the cell centre, wrapped so the
// pattern tiles seamlessly into a 45°-style halftone grid.
function roundSpot(x, y, n) {
  const cx = (x + 0.5) / n - 0.5
  const cy = (y + 0.5) / n - 0.5
  return -(cx * cx + cy * cy)   // centre grows first → clustered dot
}
function diamondSpot(x, y, n) {
  const cx = Math.abs((x + 0.5) / n - 0.5)
  const cy = Math.abs((y + 0.5) / n - 0.5)
  return -(cx + cy)
}
function lineSpot(angle) {
  return (x, y, n) => {
    const a = angle * Math.PI / 180
    return Math.cos(a) * x + Math.sin(a) * y - Math.floor((Math.cos(a) * x + Math.sin(a) * y) / n) * n
  }
}

// Lazily built / cached threshold maps keyed by algorithm id.
const _mapCache = {}
function getOrderedMap(id) {
  if (_mapCache[id]) return _mapCache[id]
  let m
  switch (id) {
    case 'bayer-2':  m = normaliseRank(bayer(2)); break
    case 'bayer-4':  m = normaliseRank(bayer(4)); break
    case 'bayer-8':  m = normaliseRank(bayer(8)); break
    case 'bayer-16': m = normaliseRank(bayer(16)); break
    case 'cluster-4':  m = spotScreen(4, roundSpot); break
    case 'cluster-6':  m = spotScreen(6, roundSpot); break
    case 'cluster-8':  m = spotScreen(8, roundSpot); break
    case 'diamond-6':  m = spotScreen(6, diamondSpot); break
    case 'diamond-8':  m = spotScreen(8, diamondSpot); break
    case 'line-h-4':   m = spotScreen(4, lineSpot(90)); break
    case 'line-v-4':   m = spotScreen(4, lineSpot(0));  break
    case 'line-d-8':   m = spotScreen(8, lineSpot(45)); break
    case 'bluenoise-16': m = blueNoise(16); break
    case 'bluenoise-32': m = blueNoise(32); break
    case 'bluenoise-64': m = blueNoise(64); break
    default: m = normaliseRank(bayer(8))
  }
  _mapCache[id] = m
  return m
}

// ── Blue-noise via void-and-cluster ─────────────────────────────────────────────
// Generates a tileable blue-noise threshold matrix. Cost scales with n²·log; we
// only build 16/32/64 and cache them for the session.
function blueNoise(n) {
  const N = n * n
  const sigma = 1.9
  const gauss = []
  const R = Math.ceil(sigma * 3)
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++)
      gauss.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))])

  const binary = new Uint8Array(N)
  const energy = new Float32Array(N)
  const idx = (x, y) => ((y + n) % n) * n + ((x + n) % n)

  const addEnergy = (x, y, sign) => {
    for (const [dx, dy, w] of gauss) energy[idx(x + dx, y + dy)] += sign * w
  }

  // Seed ~10% of cells pseudo-randomly, then relax to the most "void" spots.
  let seeds = Math.max(1, Math.round(N * 0.1))
  let s = 0x1234abcd
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % N) }
  let placed = 0
  while (placed < seeds) {
    const p = rnd()
    if (!binary[p]) { binary[p] = 1; addEnergy(p % n, (p / n) | 0, 1); placed++ }
  }
  // Relax: move tightest cluster point into largest void until stable.
  for (let iter = 0; iter < N * 2; iter++) {
    let hi = -1, hiE = -Infinity, lo = -1, loE = Infinity
    for (let p = 0; p < N; p++) {
      if (binary[p] && energy[p] > hiE) { hiE = energy[p]; hi = p }
      if (!binary[p] && energy[p] < loE) { loE = energy[p]; lo = p }
    }
    if (hi < 0 || lo < 0) break
    binary[hi] = 0; addEnergy(hi % n, (hi / n) | 0, -1)
    if (hi === lo) break
    binary[lo] = 1; addEnergy(lo % n, (lo / n) | 0, 1)
  }

  const rank = new Int32Array(N).fill(-1)
  // Phase 1: remove tightest clusters from the seed pattern (ranks down to 0).
  const work = binary.slice()
  const workE = energy.slice()
  let count = placed
  for (let r = count - 1; r >= 0; r--) {
    let hi = -1, hiE = -Infinity
    for (let p = 0; p < N; p++) if (work[p] && workE[p] > hiE) { hiE = workE[p]; hi = p }
    if (hi < 0) break
    work[hi] = 0
    for (const [dx, dy, w] of gauss) workE[idx(hi % n + dx, ((hi / n) | 0) + dy)] -= w
    rank[hi] = r
  }
  // Phase 2: fill the rest into the largest voids (ranks up to N-1).
  const work2 = binary.slice()
  const work2E = energy.slice()
  for (let r = count; r < N; r++) {
    let lo = -1, loE = Infinity
    for (let p = 0; p < N; p++) if (!work2[p] && work2E[p] < loE) { loE = work2E[p]; lo = p }
    if (lo < 0) break
    work2[lo] = 1
    for (const [dx, dy, w] of gauss) work2E[idx(lo % n + dx, ((lo / n) | 0) + dy)] += w
    rank[lo] = r
  }
  // Any leftovers (shouldn't happen) get arbitrary ranks.
  let next = 0
  for (let p = 0; p < N; p++) if (rank[p] < 0) { while (next < N) { next++ } rank[p] = p }

  const m = Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => (rank[y * n + x] + 0.5) / N))
  return m
}

// ── Riemersma (space-filling-curve) dither ──────────────────────────────────────
// Walks the image along a Hilbert curve, carrying a short exponentially-weighted
// history of quantisation error instead of a 2-D kernel. Because the curve keeps
// neighbouring visits spatially close, error stays local and the result has an
// organic, isotropic grain with no directional kernel artefacts.

// Smallest Hilbert order whose 2^order square covers both dimensions.
function hilbertOrder(W, H) {
  let order = 1
  while ((1 << order) < Math.max(W, H)) order++
  return order
}

// Yield in-bounds (x,y) in Hilbert-curve order over a 2^order × 2^order square.
function* hilbertPoints(order, W, H) {
  const n = 1 << order
  const total = n * n
  for (let d = 0; d < total; d++) {
    let t = d, x = 0, y = 0
    for (let s = 1; s < n; s <<= 1) {
      const rx = 1 & (t >> 1)
      const ry = 1 & (t ^ rx)
      if (ry === 0) {
        if (rx === 1) { x = s - 1 - x; y = s - 1 - y }
        const tmp = x; x = y; y = tmp
      }
      x += s * rx; y += s * ry
      t >>= 2
    }
    if (x < W && y < H) yield (y * W + x)
  }
}

// queueLen / ratio shape the error memory: a longer queue / higher ratio spreads
// error further (smoother), a tighter ratio keeps it crisp.
function riemersma(sd, od, W, H, mapColor, queueLen, ratio) {
  const n = queueLen
  const base = Math.pow(ratio, 1 / (n - 1))
  const weights = new Float32Array(n)
  let wsum = 0
  for (let i = 0; i < n; i++) { weights[i] = Math.pow(base, n - 1 - i); wsum += weights[i] }   // newest (i=n-1) weighted 1
  const hr = new Float32Array(n), hg = new Float32Array(n), hb = new Float32Array(n)
  const order = hilbertOrder(W, H)
  for (const p of hilbertPoints(order, W, H)) {
    let er = 0, eg = 0, eb = 0
    for (let i = 0; i < n; i++) { const w = weights[i]; er += hr[i] * w; eg += hg[i] * w; eb += hb[i] * w }
    er /= wsum; eg /= wsum; eb /= wsum
    const o = p * 4
    const or = clamp8(sd[o] + er), og = clamp8(sd[o + 1] + eg), ob = clamp8(sd[o + 2] + eb)
    const [nr, ng, nb] = mapColor(or, og, ob)
    od[o] = nr; od[o + 1] = ng; od[o + 2] = nb; od[o + 3] = 255
    hr.copyWithin(0, 1); hg.copyWithin(0, 1); hb.copyWithin(0, 1)
    hr[n - 1] = or - nr; hg[n - 1] = og - ng; hb[n - 1] = ob - nb
  }
}

// ── Gradient map ────────────────────────────────────────────────────────────────
// Replace each pixel's colour with a sample from a colour ramp indexed by its
// luminance. Used as a pre-quantise step so the dither resolves a clean duotone /
// multitone gradient instead of the photo's own colours.
// `colors` are ramp stops dark→light; optional `positions` (0..1, same length) place
// each stop along the luminance axis — defaults to even spacing.
export function gradientMap(img, colors, positions) {
  if (!colors || colors.length < 2) return img
  const n = colors.length
  // Pair colours with positions, then sort ascending by position so interpolation
  // is well-defined even if the user drags a stop past its neighbour.
  const stops = colors.map((c, i) => ({ c, p: positions && positions.length === n ? positions[i] : i / (n - 1) }))
  stops.sort((a, b) => a.p - b.p)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
    let k = 0
    while (k < n - 1 && l > stops[k + 1].p) k++
    const a = stops[k], b = stops[Math.min(n - 1, k + 1)]
    const span = b.p - a.p
    const t = span > 1e-5 ? Math.max(0, Math.min(1, (l - a.p) / span)) : 0
    d[i]     = a.c[0] + (b.c[0] - a.c[0]) * t
    d[i + 1] = a.c[1] + (b.c[1] - a.c[1]) * t
    d[i + 2] = a.c[2] + (b.c[2] - a.c[2]) * t
  }
  return img
}

// ── Algorithm registry (UI order) ───────────────────────────────────────────────
export const ALGORITHMS = [
  { id: 'threshold', label: 'Threshold', group: 'Basic' },
  { id: 'random',    label: 'Random noise', group: 'Basic' },
  { id: 'ign',       label: 'Interleaved gradient', group: 'Basic' },

  ...Object.entries(DIFFUSION).map(([id, k]) => ({ id, label: k.label, group: 'Diffusion' })),

  { id: 'riemersma',      label: 'Riemersma (Hilbert)', group: 'Curve' },
  { id: 'riemersma-hard', label: 'Riemersma (tight)',   group: 'Curve' },

  { id: 'bayer-2',  label: 'Bayer 2×2',  group: 'Ordered' },
  { id: 'bayer-4',  label: 'Bayer 4×4',  group: 'Ordered' },
  { id: 'bayer-8',  label: 'Bayer 8×8',  group: 'Ordered' },
  { id: 'bayer-16', label: 'Bayer 16×16', group: 'Ordered' },

  { id: 'cluster-4', label: 'Clustered dot 4',  group: 'Halftone screen' },
  { id: 'cluster-6', label: 'Clustered dot 6',  group: 'Halftone screen' },
  { id: 'cluster-8', label: 'Clustered dot 8',  group: 'Halftone screen' },
  { id: 'diamond-6', label: 'Diamond 6',        group: 'Halftone screen' },
  { id: 'diamond-8', label: 'Diamond 8',        group: 'Halftone screen' },
  { id: 'line-h-4',  label: 'Line screen H',    group: 'Halftone screen' },
  { id: 'line-v-4',  label: 'Line screen V',    group: 'Halftone screen' },
  { id: 'line-d-8',  label: 'Line screen 45°',  group: 'Halftone screen' },

  { id: 'bluenoise-16', label: 'Blue noise 16', group: 'Blue noise' },
  { id: 'bluenoise-32', label: 'Blue noise 32', group: 'Blue noise' },
  { id: 'bluenoise-64', label: 'Blue noise 64', group: 'Blue noise' },
]

export const ALGO_IDS = new Set(ALGORITHMS.map(a => a.id))

// True for screens backed by a precomputed threshold matrix (GPU-uploadable).
export function isMatrixOrdered(id) {
  return id.startsWith('bayer') || id.startsWith('cluster')
    || id.startsWith('diamond') || id.startsWith('line') || id.startsWith('bluenoise')
}

// Flattened threshold matrix for an ordered algorithm → { size, data:Float32Array }.
// Used to upload the screen to a GPU texture.
export function orderedMatrix(id) {
  const m = getOrderedMap(id)
  const n = m.length
  const data = new Float32Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = m[y][x]
  return { size: n, data }
}

// ── Palette construction per colour mode ────────────────────────────────────────
// mode: 'mono' | 'tonal' | 'indexed' | 'rgb'
//   mono   — two endpoint colours (dark, light)
//   tonal  — `levels` steps between the two endpoint colours (a tone ramp)
//   indexed— the supplied palette colours verbatim
//   rgb    — handled specially (per-channel), returns null
export function buildPalette({ mode, levels = 4, paletteColors = [], dark = [0, 0, 0], light = [255, 255, 255] }) {
  if (mode === 'rgb') return null
  if (mode === 'indexed') return paletteColors.length ? paletteColors : [dark, light]
  if (mode === 'mono') return [dark, light]
  // tonal — ramp from dark to light
  const n = Math.max(2, levels)
  const ramp = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    ramp.push([
      Math.round(dark[0] + (light[0] - dark[0]) * t),
      Math.round(dark[1] + (light[1] - dark[1]) * t),
      Math.round(dark[2] + (light[2] - dark[2]) * t),
    ])
  }
  return ramp
}

function _smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
function _toneMask(t, pos, spread) { if (spread >= 0.999) return 1; const w = spread * 0.5; return 1 - _smooth(w, w + w * 0.5 + 0.03, Math.abs(t - pos)) }

// Nearest palette colour by squared Euclidean distance, optionally biased by
// per-colour { pos, spread, intensity } so a colour appears more/less and only
// within a tonal band. `controls` is aligned with `palette` (or null = plain).
function nearest(palette, r, g, b, controls) {
  let best = 0, bestD = Infinity
  const lt = controls ? (0.299 * r + 0.587 * g + 0.114 * b) / 255 : 0
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]
    const dr = r - p[0], dg = g - p[1], db = b - p[2]
    let d = dr * dr + dg * dg + db * db
    if (controls) {
      const c = controls[i]
      const w = c.intensity * (0.25 + 0.75 * _toneMask(lt, c.pos, c.spread))
      d /= Math.max(0.05, w)
    }
    if (d < bestD) { bestD = d; best = i }
  }
  return palette[best]
}

// Per-channel quantise for RGB mode (levels per channel).
function quantChannel(v, levels) {
  const step = 255 / (levels - 1)
  return Math.round(Math.round(v / step) * step)
}

const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : v

// ── Main entry ──────────────────────────────────────────────────────────────────
// opts: {
//   algorithm, mode, levels, paletteColors, dark, light,
//   spread   (0..1 ordered dither strength),
//   serpentine (bool, error diffusion),
//   strength (0..1 error-diffusion amount / dither mix),
// }
export function processImage(src, opts) {
  const { algorithm = 'floyd-steinberg', mode = 'mono', spread = 1, serpentine = true, strength = 1 } = opts
  const W = src.width, H = src.height
  const out = new ImageData(W, H)
  const sd = src.data, od = out.data

  const palette = buildPalette(opts)
  const levels = Math.max(2, opts.levels || 2)

  const palControls = opts.palControls || null
  const mapColor = mode === 'rgb'
    ? (r, g, b) => [quantChannel(r, levels), quantChannel(g, levels), quantChannel(b, levels)]
    : (r, g, b) => nearest(palette, r, g, b, palControls)

  if (algorithm === 'riemersma' || algorithm === 'riemersma-hard') {
    const tight = algorithm === 'riemersma-hard'
    riemersma(sd, od, W, H, mapColor, tight ? 12 : 16, tight ? 1 / 32 : 1 / 16)
  } else if (algorithm in DIFFUSION) {
    diffuse(sd, od, W, H, mapColor, DIFFUSION[algorithm], serpentine, strength)
  } else if (algorithm === 'threshold' || algorithm === 'random' || algorithm === 'ign'
             || algorithm.startsWith('bayer') || algorithm.startsWith('cluster')
             || algorithm.startsWith('diamond') || algorithm.startsWith('line')
             || algorithm.startsWith('bluenoise')) {
    ordered(sd, od, W, H, mapColor, algorithm, spread)
  } else {
    diffuse(sd, od, W, H, mapColor, DIFFUSION['floyd-steinberg'], serpentine, strength)
  }
  return out
}

// Error-diffusion core. Works on a float buffer so quantisation error carries.
function diffuse(sd, od, W, H, mapColor, kernel, serpentine, strength) {
  const buf = new Float32Array(W * H * 3)
  for (let i = 0, j = 0; i < sd.length; i += 4, j += 3) {
    buf[j] = sd[i]; buf[j + 1] = sd[i + 1]; buf[j + 2] = sd[i + 2]
  }
  const { cells, div } = kernel
  for (let y = 0; y < H; y++) {
    const ltr = !serpentine || y % 2 === 0
    const xs = ltr ? 0 : W - 1
    const xe = ltr ? W : -1
    const dx = ltr ? 1 : -1
    for (let x = xs; x !== xe; x += dx) {
      const p = (y * W + x) * 3
      const or = buf[p], og = buf[p + 1], ob = buf[p + 2]
      const [nr, ng, nb] = mapColor(or, og, ob)
      const o = (y * W + x) * 4
      od[o] = nr; od[o + 1] = ng; od[o + 2] = nb; od[o + 3] = 255
      const er = (or - nr) * strength
      const eg = (og - ng) * strength
      const eb = (ob - nb) * strength
      for (const [cdx, cdy, w] of cells) {
        const sx = x + cdx * dx   // mirror x-offsets on right-to-left rows
        const sy = y + cdy
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue
        const q = (sy * W + sx) * 3
        const f = w / div
        buf[q]     = clamp8(buf[q]     + er * f)
        buf[q + 1] = clamp8(buf[q + 1] + eg * f)
        buf[q + 2] = clamp8(buf[q + 2] + eb * f)
      }
    }
  }
}

// Ordered / threshold-map core. Adds a per-pixel bias from the screen before
// quantising. `spread` scales the bias amplitude.
function ordered(sd, od, W, H, mapColor, algorithm, spread) {
  let mapFn
  if (algorithm === 'threshold') {
    mapFn = () => 0
  } else if (algorithm === 'random') {
    mapFn = () => Math.random() - 0.5
  } else if (algorithm === 'ign') {
    mapFn = (x, y) => {
      const v = 52.9829189 * (0.06711056 * x + 0.00583715 * y)
      return (v - Math.floor(v)) - 0.5
    }
  } else {
    const m = getOrderedMap(algorithm)
    const n = m.length
    mapFn = (x, y) => m[y % n][x % n] - 0.5
  }
  const amp = 255 * spread
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const bias = mapFn(x, y) * amp
      const [nr, ng, nb] = mapColor(
        clamp8(sd[o] + bias),
        clamp8(sd[o + 1] + bias),
        clamp8(sd[o + 2] + bias),
      )
      od[o] = nr; od[o + 1] = ng; od[o + 2] = nb; od[o + 3] = 255
    }
  }
}

// ── Pre-processing helpers (sharpen / denoise) ──────────────────────────────────
// Brightness / contrast / blur are applied via canvas ctx.filter upstream; these
// two need explicit convolution.

// Unsharp-style sharpen via a 3×3 kernel, amount 0..1.
export function sharpen(img, amount) {
  if (amount <= 0) return img
  const { width: W, height: H, data: s } = img
  const out = new ImageData(W, H)
  const d = out.data
  const c = 1 + 4 * amount, e = -amount
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        const get = (xx, yy) => s[(Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))) * 4 + ch]
        let v = c * get(x, y) + e * (get(x - 1, y) + get(x + 1, y) + get(x, y - 1) + get(x, y + 1))
        d[o + ch] = clamp8(v)
      }
      d[o + 3] = s[o + 3]
    }
  }
  return out
}

// ── Palette extraction (median cut) ─────────────────────────────────────────────
// Quantises an ImageData down to `n` representative colours. Returns hex strings,
// sorted dark→light. Used to pull a working palette straight out of an image.
export function extractPalette(img, n = 8) {
  const { width: W, height: H, data } = img
  const step = Math.max(1, Math.floor((W * H) / 20000))   // cap sample count
  const pts = []
  for (let p = 0; p < W * H; p += step) {
    const o = p * 4
    if (data[o + 3] < 8) continue
    pts.push([data[o], data[o + 1], data[o + 2]])
  }
  if (!pts.length) return ['#000000', '#ffffff']

  let boxes = [pts]
  while (boxes.length < n) {
    // Split the box with the largest channel range.
    let bi = -1, bestRange = -1, bestCh = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0
        for (const c of box) { if (c[ch] < lo) lo = c[ch]; if (c[ch] > hi) hi = c[ch] }
        const range = hi - lo
        if (range > bestRange) { bestRange = range; bi = i; bestCh = ch }
      }
    }
    if (bi < 0) break
    const box = boxes[bi]
    box.sort((a, b) => a[bestCh] - b[bestCh])
    const mid = box.length >> 1
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid))
  }

  const colors = boxes.filter(b => b.length).map(box => {
    let r = 0, g = 0, b = 0
    for (const c of box) { r += c[0]; g += c[1]; b += c[2] }
    const k = box.length
    return [Math.round(r / k), Math.round(g / k), Math.round(b / k)]
  })
  colors.sort((a, b) =>
    (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) - (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]))
  return colors.map(([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''))
}

// Levels / tone curve + optional posterize. low/high in 0..1 (input black/white
// points), gamma >0 (midtone), posterize 0 = off else N quantise steps.
export function applyLevels(img, low = 0, high = 1, gamma = 1, posterize = 0) {
  if (low === 0 && high === 1 && gamma === 1 && (!posterize || posterize < 2)) return img
  const d = img.data
  const span = Math.max(1e-4, high - low)
  const invG = 1 / Math.max(0.01, gamma)
  const post = posterize >= 2 ? posterize : 0
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let v = (i / 255 - low) / span
    v = v < 0 ? 0 : v > 1 ? 1 : v
    v = Math.pow(v, invG)
    if (post) v = Math.round(v * (post - 1)) / (post - 1)
    lut[i] = Math.round(v * 255)
  }
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]] }
  return img
}

// Add uniform random noise, amount 0..1 (the negative side of the denoise control).
export function addNoise(img, amount) {
  if (amount <= 0) return img
  const d = img.data
  const a = amount * 90
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * a
    d[i] = clamp8(d[i] + n); d[i + 1] = clamp8(d[i + 1] + n); d[i + 2] = clamp8(d[i + 2] + n)
  }
  return img
}

// Denoise via a simple 3×3 box average mixed back by amount 0..1.
export function denoise(img, amount) {
  if (amount <= 0) return img
  const { width: W, height: H, data: s } = img
  const out = new ImageData(W, H)
  const d = out.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0, n = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy
            if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
            sum += s[(yy * W + xx) * 4 + ch]; n++
          }
        const avg = sum / n
        d[o + ch] = clamp8(s[o + ch] * (1 - amount) + avg * amount)
      }
      d[o + 3] = s[o + 3]
    }
  }
  return out
}
