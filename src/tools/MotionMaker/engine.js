// ── Motion Maker — deterministic evaluation engine ─────────────────────────────
//
// The whole tool hangs off one pure function: evaluateScene(doc, frame) -> render
// list. No animation lives in React state — the timeline owns a single `frame`
// number and everything (preview, scrubbing, every exporter) derives from this.
// Because it's pure and frame-indexed, frame N is always identical, which is what
// makes scrubbing exact and export reliable.

import { NODE_DEFS } from './nodes.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ── Easing ──────────────────────────────────────────────────────────────────────
export const EASES = {
  linear:     t => t,
  easeIn:     t => t * t,
  easeOut:    t => 1 - (1 - t) * (1 - t),
  easeInOut:  t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeInCubic:    t => t * t * t,
  easeOutCubic:   t => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outBack:    t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2) },
  inBack:     t => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t },
  inOutBack:  t => {
    const c1 = 1.70158, c2 = c1 * 1.525
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
  },
  outElastic: t => {
    if (t === 0 || t === 1) return t
    const c4 = (2 * Math.PI) / 3
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  },
  outBounce:  t => {
    const n1 = 7.5625, d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75 }
    if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375 }
    t -= 2.625 / d1; return n1 * t * t + 0.984375
  },
}

// ── Waveforms (return -1..1 for a phase in turns) ────────────────────────────────
const WAVES = {
  sine:     p => Math.sin(2 * Math.PI * p),
  triangle: p => { const x = ((p % 1) + 1) % 1; return 4 * Math.abs(x - 0.5) - 1 },
  saw:      p => { const x = ((p % 1) + 1) % 1; return 2 * x - 1 },
  square:   p => (Math.sin(2 * Math.PI * p) >= 0 ? 1 : -1),
}

// ── Deterministic hash-based value noise ─────────────────────────────────────────
// Stateless and frame-pure: the same (n, seed) always yields the same number, so
// noise-driven motion scrubs and exports identically (spec: "hash-based, not
// stateful").
function hash01(n, seed = 0) {
  const x = Math.sin(n * 127.1 + seed * 311.7 + 13.13) * 43758.5453
  return x - Math.floor(x)            // 0..1
}
// Smooth interpolated value noise sampled at position t (0..1 output).
function valueNoise(t, seed = 0) {
  const i = Math.floor(t), f = t - i
  const a = hash01(i, seed), b = hash01(i + 1, seed)
  const u = f * f * (3 - 2 * f)       // smoothstep
  return a + (b - a) * u
}
// Signed (-1..1) fBm noise with octaves for richer wiggle.
function fbmSigned(t, seed = 0, octaves = 1) {
  let amp = 1, freq = 1, sum = 0, norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(t * freq, seed + o * 17) * 2 - 1)
    norm += amp; amp *= 0.5; freq *= 2
  }
  return norm ? sum / norm : 0
}

// ── Color helpers (color-value socket) ───────────────────────────────────────────
function parseHex(hex) {
  let h = String(hex || '#000').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
function lerpColor(a, b, t) {
  const A = parseHex(a), B = parseHex(b)
  return '#' + A.map((v, i) => hex2(v + (B[i] - v) * t)).join('')
}
function hexToRgba(hex, a) { const [r, g, b] = parseHex(hex); return `rgba(${r},${g},${b},${a})` }

// ── Value node evaluation → a number (or color string) at `frame` ─────────────────
export function evalValueNode(node, frame, ctx, seen) {
  // value→value chaining (unlock 1): a value node may itself be driven by upstream
  // value nodes. Resolve its params through the bindings first (with a cycle guard),
  // then evaluate — so Math/Map Range/Curve/Mix/Clamp all compose into a value chain.
  if (seen && seen.has(node.id)) return 0
  const trail = new Set(seen || []); trail.add(node.id)
  const p = ctx ? resolveParams(node, frame, ctx, trail) : (node.params || {})
  switch (node.type) {
    case 'ramp': {
      const span = (p.endFrame - p.startFrame) || 1
      const t = clamp((frame - p.startFrame) / span, 0, 1)
      const e = (EASES[p.ease] || EASES.linear)(t)
      return p.from + (p.to - p.from) * e
    }
    case 'lfo': {
      const ph = frame / (p.period || 1) + (p.phase || 0)
      const w = (WAVES[p.wave] || WAVES.sine)(ph)
      return (p.offset || 0) + (p.amp || 0) * w
    }
    case 'spring': {
      const fps = ctx?.fps || 30
      const t = Math.max(0, frame - p.startFrame) / fps
      const wn = p.stiffness                       // natural angular frequency
      const z = clamp(p.damping, 0.001, 0.999)     // damping ratio (underdamped)
      const wd = wn * Math.sqrt(1 - z * z)
      const env = Math.exp(-z * wn * t)
      const osc = Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t)
      return p.to + (p.from - p.to) * env * osc
    }
    case 'constant':
      return p.value || 0
    case 'time': {
      if (p.mode === 'seconds') return frame / (ctx?.fps || 30) * (p.scale ?? 1) + (p.offset || 0)
      if (p.mode === '0-1') {
        const span = (ctx.frameEnd - ctx.frameStart) || 1
        return clamp((frame - ctx.frameStart) / span, 0, 1) * (p.scale ?? 1) + (p.offset || 0)
      }
      return frame * (p.scale ?? 1) + (p.offset || 0)   // raw frame
    }
    case 'noise': {
      const t = frame * (p.frequency || 0.05)
      return (p.offset || 0) + (p.amplitude || 0) * fbmSigned(t, p.seed || 0, Math.round(p.octaves || 1))
    }
    case 'pulse': {
      const interval = Math.max(1, p.interval || 1)
      const width = Math.max(1, p.width || 1)
      const local = (((frame - (p.phase || 0)) % interval) + interval) % interval
      let env = 0
      if (local < width) {
        const u = local / width                       // 0..1 across the pulse
        if (p.shape === 'gate') env = 1
        else if (p.shape === 'spike') env = 1 - Math.abs(2 * u - 1)   // triangular peak
        else env = 1 - u                              // 'decay': sharp attack, linear release
      }
      return (p.amp ?? 1) * env
    }
    case 'randomHold': {
      const interval = Math.max(1, p.interval || 1)
      const idx = Math.floor((frame) / interval)
      const lo = p.min ?? 0, hi = p.max ?? 1
      const at = i => lo + (hi - lo) * hash01(i, (p.seed || 0) + 0.5)
      const v = at(idx)
      const smooth = clamp(p.smooth || 0, 0, 1)
      if (smooth <= 0) return v
      // ease toward the next held value over the tail of the interval
      const frac = (frame - idx * interval) / interval
      const k = clamp((frac - (1 - smooth)) / (smooth || 1), 0, 1)
      const e = EASES.easeInOut(k)
      return v + (at(idx + 1) - v) * e
    }
    case 'keyframes': {
      const keys = Array.isArray(p.keys) ? [...p.keys].sort((a, b) => a.frame - b.frame) : []
      if (!keys.length) return 0
      const first = keys[0], last = keys[keys.length - 1]
      const span = last.frame - first.frame
      let f = frame
      if (frame < first.frame || frame > last.frame) {
        if (p.extrapolate === 'loop' && span > 0) {
          f = first.frame + ((((frame - first.frame) % span) + span) % span)
        } else if (p.extrapolate === 'ping-pong' && span > 0) {
          const m = ((((frame - first.frame) % (2 * span)) + 2 * span) % (2 * span))
          f = first.frame + (m <= span ? m : 2 * span - m)
        } else {
          return frame < first.frame ? first.value : last.value   // hold
        }
      }
      for (let i = 0; i < keys.length - 1; i++) {
        const k0 = keys[i], k1 = keys[i + 1]
        if (f >= k0.frame && f <= k1.frame) {
          const t = (f - k0.frame) / ((k1.frame - k0.frame) || 1)
          const e = (EASES[k1.ease] || EASES.linear)(t)
          return k0.value + (k1.value - k0.value) * e
        }
      }
      return last.value
    }

    // ── Value operators (unlock 1: value→value chaining) ───────────────────────────
    case 'math': {
      const a = p.a || 0, b = p.b || 0
      switch (p.op) {
        case '-': return a - b
        case '*': return a * b
        case '/': return b !== 0 ? a / b : 0
        case 'mod': return b !== 0 ? ((a % b) + b) % b : 0
        case 'pow': return Math.pow(a, b)
        case 'min': return Math.min(a, b)
        case 'max': return Math.max(a, b)
        case 'abs': return Math.abs(a)
        case 'neg': return -a
        case 'sin': return Math.sin(a)
        case 'cos': return Math.cos(a)
        case 'floor': return Math.floor(a)
        case 'round': return Math.round(a)
        default: return a + b   // '+'
      }
    }
    case 'mapRange': {
      const denom = (p.inMax - p.inMin) || 1
      let t = (p.input - p.inMin) / denom
      if (p.clamp === 'on') t = clamp(t, 0, 1)
      const e = (EASES[p.ease] || EASES.linear)(t)
      return p.outMin + (p.outMax - p.outMin) * e
    }
    case 'curve':
      return (EASES[p.ease] || EASES.linear)(clamp(p.input || 0, 0, 1))
    case 'mix': {
      const a = p.a || 0, b = p.b || 0, t = clamp(p.t ?? 0, 0, 1)
      const target = p.mode === 'add' ? a + b : p.mode === 'multiply' ? a * b : b
      return a + (target - a) * t   // t blends a → (op result); lerp mode → a→b
    }
    case 'clamp': {
      let v = clamp(p.input || 0, p.min, p.max)
      const steps = Math.round(p.steps || 0)
      if (steps > 1) {
        const range = p.max - p.min
        if (range !== 0) v = p.min + Math.round(((v - p.min) / range) * (steps - 1)) / (steps - 1) * range
      }
      return v
    }

    // ── Color value nodes → a color string ─────────────────────────────────────────
    case 'colorSwatch': {
      const a = clamp(p.alpha ?? 1, 0, 1)
      return a >= 1 ? p.color : hexToRgba(p.color, a)
    }
    case 'gradientMap':
      return lerpColor(p.colorA, p.colorB, clamp(p.input ?? 0, 0, 1))
    default:
      return 0
  }
}

// ── Resolve a node's params at `frame`, applying any value-node bindings ──────────
// A value edge targets handle `prop:<key>`; if present, that property is driven by
// the connected value node instead of its static value.
function resolveParams(node, frame, ctx, seen) {
  const def = NODE_DEFS[node.type]
  const out = { ...(node.params || {}) }
  if (!def || !ctx.valueBindings) return out
  for (const p of def.params) {
    const src = ctx.valueBindings[`${node.id}::prop:${p.key}`]
    if (src && ctx.nodeById) {
      const srcNode = ctx.nodeById[src]
      if (srcNode) out[p.key] = evalValueNode(srcNode, frame, ctx, seen)
    }
  }
  return out
}

// Format a number with fixed decimals and optional thousands separators.
function formatNumber(v, decimals, thousands) {
  let s = (v).toFixed(Math.max(0, Math.round(decimals || 0)))
  if (thousands === 'on') {
    const neg = s[0] === '-' ? '-' : ''
    if (neg) s = s.slice(1)
    const [int, frac] = s.split('.')
    s = neg + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '')
  }
  return s
}

// ── Build a renderable scene object from a source node ───────────────────────────
function sourceObject(node, rp, ctx, frame) {
  const { canvas } = ctx
  const cx = canvas.w / 2, cy = canvas.h / 2
  const fit = Math.min(canvas.w, canvas.h) * 0.55   // base footprint for images

  if (node.type === 'shape') {
    return {
      id: node.id, kind: 'shape', shape: rp.kind, color: rp.color,
      w: rp.w, h: rp.h,
      x: cx + rp.x, y: cy + rp.y, rotate: rp.rotate, opacity: rp.opacity,
    }
  }

  // Text — live type. Render uses `h` as the font size, so every w/h-scaling modifier
  // (Transform, Echo, Array…) scales the type naturally.
  if (node.type === 'text' || node.type === 'counter') {
    let str
    if (node.type === 'counter') {
      const span = (rp.endFrame - rp.startFrame) || 1
      const e = (EASES[rp.ease] || EASES.linear)(clamp((frame - rp.startFrame) / span, 0, 1))
      const v = rp.from + (rp.to - rp.from) * e
      str = (rp.prefix || '') + formatNumber(v, rp.decimals, rp.thousands) + (rp.suffix || '')
    } else {
      str = String(rp.string ?? '')
      if (rp.case === 'upper') str = str.toUpperCase()
      else if (rp.case === 'lower') str = str.toLowerCase()
    }
    return {
      id: node.id, kind: 'text', string: str,
      font: rp.font, weight: rp.weight || '700', fill: rp.fill,
      tracking: rp.tracking || 0, align: rp.align || 'center',
      w: rp.size * Math.max(1, str.length) * 0.6, h: rp.size,
      x: cx + rp.x, y: cy + rp.y, rotate: rp.rotate || 0, opacity: rp.opacity,
    }
  }

  if (node.type === 'backdrop') {
    return {
      id: node.id, kind: 'backdrop', mode: rp.mode, colorA: rp.colorA, colorB: rp.colorB, angle: rp.angle,
      w: canvas.w, h: canvas.h, x: cx, y: cy, rotate: 0, opacity: rp.opacity,
    }
  }

  // icon / wordmark — image source
  const img = rp.image
  if (!img || !img.dataUrl) return null
  const aspect = img.aspect || 1
  let w = fit, h = fit
  if (aspect >= 1) h = fit / aspect; else w = fit * aspect
  w *= rp.scale; h *= rp.scale
  return {
    id: node.id, kind: 'image', href: img.dataUrl,
    w, h,
    x: cx + rp.x, y: cy + rp.y, rotate: rp.rotate, opacity: clamp(rp.opacity, 0, 1),
  }
}

// Apply a Transform modifier's deltas onto an upstream object.
function applyTransform(obj, rp, ctx) {
  const cx = ctx.canvas.w / 2, cy = ctx.canvas.h / 2
  // scale about the canvas centre so growth stays centred
  const nx = cx + (obj.x - cx) * rp.scale + rp.x
  const ny = cy + (obj.y - cy) * rp.scale + rp.y
  return {
    ...obj,
    w: obj.w * rp.scale, h: obj.h * rp.scale,
    x: nx, y: ny,
    rotate: obj.rotate + rp.rotate,
    opacity: clamp(obj.opacity * rp.opacity, 0, 1),
  }
}

// Appearance (unlock 3) — attach an effect descriptor to each object's `fx` chain.
// render.jsx turns the chain into a stacked SVG <filter>; blend is a separate field
// applied as mix-blend-mode. Effects compose in object-flow order.
const withFx = (o, fx) => ({ ...o, fx: [...(o.fx || []), fx] })

// Array / Repeater — emit `count` copies of each object with a compounding per-copy
// delta. Layouts: linear (offset steps), grid (square-ish wrap), radial (around a
// circle). Copies get unique ids so React keys and downstream per-index logic hold.
function applyArray(objs, rp) {
  const count = Math.max(1, Math.round(rp.count || 1))
  const cols = Math.max(1, Math.round(Math.sqrt(count)))
  const out = []
  for (const o of objs) {
    for (let i = 0; i < count; i++) {
      const s = Math.pow(rp.dScale ?? 1, i)
      let dx = 0, dy = 0, drot = (rp.dRotate || 0) * i
      if (rp.layout === 'grid') {
        dx = (rp.dx || 0) * (i % cols); dy = (rp.dy || 0) * Math.floor(i / cols)
      } else if (rp.layout === 'radial') {
        const span = (rp.arc || 360) * Math.PI / 180
        const a = count > 1 ? span * (i / count) : 0
        dx = Math.cos(a - Math.PI / 2) * (rp.radius || 0)
        dy = Math.sin(a - Math.PI / 2) * (rp.radius || 0)
      } else {
        dx = (rp.dx || 0) * i; dy = (rp.dy || 0) * i
      }
      out.push({
        ...o, id: `${o.id}#${i}`,
        x: o.x + dx, y: o.y + dy,
        w: o.w * s, h: o.h * s,
        rotate: o.rotate + drot,
        opacity: clamp(o.opacity * Math.pow(rp.dOpacity ?? 1, i), 0, 1),
      })
    }
  }
  return out
}

// Mirror / Symmetry — reflect copies across the canvas centre axis (x / y / both).
function applyMirror(objs, rp, ctx) {
  const cx = ctx.canvas.w / 2, cy = ctx.canvas.h / 2
  const reflectX = o => ({ ...o, id: `${o.id}~x`, x: 2 * cx - o.x, rotate: -o.rotate })
  const reflectY = o => ({ ...o, id: `${o.id}~y`, y: 2 * cy - o.y, rotate: -o.rotate })
  const out = []
  for (const o of objs) {
    out.push(o)
    if (rp.axis === 'x' || rp.axis === 'both') out.push(reflectX(o))
    if (rp.axis === 'y' || rp.axis === 'both') out.push(reflectY(o))
    if (rp.axis === 'both') out.push({ ...reflectX(reflectY(o)), id: `${o.id}~xy` })
  }
  return out
}

// Wiggle — additive deterministic noise straight onto transform (no value wiring).
function applyWiggle(objs, rp, frame) {
  const t = frame * (rp.frequency || 1) * 0.05
  return objs.map(o => {
    const nx = fbmSigned(t, (rp.seed || 0) + 1) * (rp.posAmp || 0)
    const ny = fbmSigned(t, (rp.seed || 0) + 7) * (rp.posAmp || 0)
    const nr = fbmSigned(t, (rp.seed || 0) + 13) * (rp.rotAmp || 0)
    const ns = 1 + fbmSigned(t, (rp.seed || 0) + 19) * (rp.scaleAmp || 0)
    return { ...o, x: o.x + nx, y: o.y + ny, rotate: o.rotate + nr, w: o.w * ns, h: o.h * ns }
  })
}

// Clip / In-Out — show only between in/out frames, with an enter/exit transition.
function applyClip(objs, rp, frame, ctx) {
  const inF = rp.inFrame || 0, outF = rp.outFrame || 0
  if (frame < inF || frame > outF) return []
  const tr = Math.max(0, rp.transition || 0)
  const cx = ctx.canvas.w / 2
  // progress within the enter (0..1) / exit (0..1) ramps; 1 = fully shown
  let enter = 1, exit = 1
  if (tr > 0) {
    enter = clamp((frame - inF) / tr, 0, 1)
    exit = clamp((outF - frame) / tr, 0, 1)
  }
  const applyEdge = (o, kind, p) => {
    if (kind === 'fade') return { opacity: o.opacity * p }
    if (kind === 'scale') { const s = 0.4 + 0.6 * EASES.easeOut(p); return { w: o.w * s, h: o.h * s, opacity: o.opacity * p } }
    if (kind === 'slide') return { x: o.x + (1 - EASES.easeOut(p)) * (cx > o.x ? 1 : -1) * 200, opacity: o.opacity * p }
    return {}   // 'cut' — instant
  }
  return objs.map(o => {
    let m = { ...o }
    if (enter < 1) m = { ...m, ...applyEdge(m, rp.enter, enter) }
    if (exit < 1) m = { ...m, ...applyEdge(m, rp.exit, exit) }
    return m
  })
}

// Physics / Gravity — deterministic ballistics integrated from startFrame to `frame`
// each call (pure: same frame ⇒ same result). Drop, bounce off a floor, settle.
function applyPhysics(objs, rp, frame, ctx) {
  const start = rp.startFrame || 0
  if (frame <= start) return objs
  const cy = ctx.canvas.h / 2
  const floor = cy + (rp.floorY || 0)
  const g = rp.gravity || 0, bounce = clamp(rp.bounce ?? 0, 0, 1), fr = clamp(rp.friction ?? 1, 0, 1)
  const steps = Math.min(6000, Math.round(frame - start))
  return objs.map(o => {
    let x = o.x, y = o.y, vx = rp.vx || 0, vy = rp.vy || 0
    const limit = floor - o.h / 2
    for (let s = 0; s < steps; s++) {
      vy += g; x += vx; y += vy
      if (y >= limit) { y = limit; vy = -vy * bounce; vx *= fr; if (Math.abs(vy) < 0.4) vy = 0 }
    }
    return { ...o, x, y }
  })
}

// Particle System (unlock 4) — emit copies of each upstream object as particles over
// time. Fully deterministic: particle p is born at a fixed frame and its randomness +
// analytic trajectory derive only from (p, seed), so frame N always renders the same.
function applyParticles(objs, rp, frame, ctx) {
  const fps = ctx.fps || 30
  const ppf = (rp.rate || 0) / fps                 // particles spawned per frame
  if (ppf <= 0) return []
  const start = rp.startFrame || 0
  const life = Math.max(1, rp.lifespan || 1)
  const maxP = Math.max(1, Math.round(rp.maxParticles || 1))
  const lastP = Math.floor((frame - start) * ppf)  // highest index spawned by now
  if (lastP < 0) return []
  // only iterate living particles: born within the last `life` frames, capped by max
  let firstP = Math.max(0, Math.ceil((frame - start - life) * ppf))
  firstP = Math.max(firstP, lastP - maxP + 1)
  const lerp = (a, b, t) => a + (b - a) * t
  const out = []
  for (const tpl of objs) {
    for (let p = firstP; p <= lastP; p++) {
      const birth = start + p / ppf
      const age = frame - birth
      if (age < 0 || age >= life) continue
      const t = age / life
      const r1 = hash01(p, rp.seed || 0), r2 = hash01(p, (rp.seed || 0) + 13), r3 = hash01(p, (rp.seed || 0) + 29)
      // emit-shape offset
      let ox = 0, oy = 0
      if (rp.emitShape === 'line') ox = (r1 * 2 - 1) * (rp.emitSize || 0)
      else if (rp.emitShape === 'circle') {
        const a = r1 * 2 * Math.PI, rad = (rp.emitSize || 0) * Math.sqrt(r2)
        ox = Math.cos(a) * rad; oy = Math.sin(a) * rad
      }
      // velocity (0° points up; spread fans it out)
      const ang = ((rp.direction || 0) + (r2 * 2 - 1) * (rp.spread || 0)) * Math.PI / 180 - Math.PI / 2
      const spd = (rp.velocity || 0) * (0.6 + 0.8 * r3)
      const vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd
      const px = tpl.x + ox + vx * age
      const py = tpl.y + oy + vy * age + 0.5 * (rp.gravity || 0) * age * age
      const sc = lerp(rp.scaleStart ?? 1, rp.scaleEnd ?? 1, t)
      const op = lerp(rp.opacityStart ?? 1, rp.opacityEnd ?? 0, t)
      out.push({
        ...tpl, id: `${tpl.id}~p${p}`,
        x: px, y: py, w: tpl.w * sc, h: tpl.h * sc,
        rotate: tpl.rotate + r3 * 360 + (rp.rotateVel || 0) * age,
        opacity: clamp(tpl.opacity * op, 0, 1),
      })
    }
  }
  return out
}

// Scramble / Decode — cycle random glyphs that settle into the real text. Operates on
// text objects' `string`; deterministic per (position, frame, seed).
const SCRAMBLE_CHARS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  symbols: '!@#$%^&*<>/?=+~|',
  binary: '01',
  katakana: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ',
}
function applyScramble(objs, rp, frame) {
  const chars = SCRAMBLE_CHARS[rp.charset] || SCRAMBLE_CHARS.alphanumeric
  const start = rp.startFrame || 0, dur = Math.max(1, rp.duration || 1)
  const t = clamp((frame - start) / dur, 0, 1)
  const speed = Math.max(1, Math.round(rp.speed || 1))
  const tick = Math.floor(frame / speed)
  return objs.map(o => {
    if (o.kind !== 'text' || o.string == null) return o
    const s = o.string, n = s.length
    const revealCount = Math.floor(t * n)
    const revealed = (i) => {
      switch (rp.settleOrder) {
        case 'right-left':  return i >= n - revealCount
        case 'center-out':  return Math.abs(i - (n - 1) / 2) <= (revealCount - 1) / 2
        case 'random':      return hash01(i, (rp.seed || 0) + 101) < t   // stable per-char reveal time
        default:            return i < revealCount   // left-right
      }
    }
    let out = ''
    for (let i = 0; i < n; i++) {
      const ch = s[i]
      if (ch === ' ' || revealed(i)) out += ch
      else out += chars[Math.floor(hash01(i * 131 + tick * 977, rp.seed || 0) * chars.length)]
    }
    return { ...o, string: out }
  })
}

// Camera — global zoom/pan/rotate of the whole comp about an anchor point. Applies to
// every upstream item, so it's drivable like any node (push-ins, whip-pans).
function applyCamera(objs, rp, ctx) {
  const cx = ctx.canvas.w / 2, cy = ctx.canvas.h / 2
  const ax = cx + (rp.anchorX || 0), ay = cy + (rp.anchorY || 0)
  const zoom = rp.zoom ?? 1
  const rad = (rp.rotate || 0) * Math.PI / 180
  const c = Math.cos(rad), s = Math.sin(rad)
  return objs.map(o => {
    const dx = o.x - ax, dy = o.y - ay
    const rx = (dx * c - dy * s) * zoom, ry = (dx * s + dy * c) * zoom
    return {
      ...o,
      x: ax + rx + (rp.x || 0), y: ay + ry + (rp.y || 0),
      w: o.w * zoom, h: o.h * zoom,
      rotate: o.rotate + (rp.rotate || 0),
    }
  })
}

// Shatter / Assemble — fragment each object into a cols×rows grid and fly the pieces
// out by `progress` (direction 'in' runs it in reverse as a reveal). Image pieces keep
// their own sub-region of the source (render kind 'fragment' with a clip rect); shapes
// become solid cells. Deterministic per piece via hash(k, seed).
function applyShatter(objs, rp) {
  const cols = Math.max(1, Math.round(rp.cols || 1))
  const rows = Math.max(1, Math.round(rp.rows || 1))
  const t = clamp(rp.direction === 'in' ? 1 - (rp.progress ?? 0) : (rp.progress ?? 0), 0, 1)
  const out = []
  for (const o of objs) {
    const cw = o.w / cols, ch = o.h / rows
    const isImg = o.kind === 'image'
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        const hx = (i + 0.5) * cw - o.w / 2          // cell home offset from object centre
        const hy = (j + 0.5) * ch - o.h / 2
        const r1 = hash01(k, rp.seed || 0), r2 = hash01(k, (rp.seed || 0) + 13), r3 = hash01(k, (rp.seed || 0) + 29)
        const ang = r1 * 2 * Math.PI
        const dist = (rp.spread || 0) * t * (0.5 + 0.5 * r2)
        const flyX = Math.cos(ang) * dist
        const flyY = Math.sin(ang) * dist + (rp.gravity || 0) * t * t
        const piece = {
          id: `${o.id}~s${k}`,
          x: o.x + hx + flyX, y: o.y + hy + flyY,
          rotate: o.rotate + (r3 * 2 - 1) * (rp.rotateChaos || 0) * t,
          opacity: clamp(o.opacity * (1 - t), 0, 1),
          w: cw, h: ch, blend: o.blend, fx: o.fx,
        }
        if (isImg) out.push({ ...piece, kind: 'fragment', href: o.href, imgW: o.w, imgH: o.h, imgCX: -hx, imgCY: -hy })
        else out.push({ ...piece, kind: 'shape', shape: 'rect', color: o.color })
      }
    }
  }
  return out
}

// ── Time-domain modifiers (unlock 4) ──────────────────────────────────────────────
// Echo / Trails — time-delayed ghosts of the upstream motion, falling off in opacity
// and scale. Trailing ghosts draw oldest-first (behind), then the current frame on top.
function applyEcho(gather, frame, rp) {
  const copies = Math.max(0, Math.round(rp.copies || 0))
  const delay = Math.max(1, rp.frameDelay || 1)
  const opF = clamp(rp.opacityFalloff ?? 0.7, 0, 1)
  const scF = rp.scaleFalloff ?? 1
  const out = []
  const ghost = (i, dir) => {
    const op = Math.pow(opF, i), sc = Math.pow(scF, i)
    for (const o of gather(frame + dir * i * delay)) {
      out.push({ ...o, id: `${o.id}~e${dir}${i}`, opacity: clamp(o.opacity * op, 0, 1), w: o.w * sc, h: o.h * sc })
    }
  }
  for (let i = copies; i >= 1; i--) ghost(i, -1)                              // trailing past
  if (rp.mode === 'onion-skin') for (let i = copies; i >= 1; i--) ghost(i, +1) // leading future
  for (const o of gather(frame)) out.push(o)                                  // current on top
  return out
}

// Stop-Motion / Strobe — hold the upstream on a stepped frame for choppy charm.
function strobeFrame(frame, rp) {
  const step = Math.max(1, Math.round(rp.step || 1))
  const phase = rp.phase || 0
  const idx = Math.floor((frame - phase) / step)
  let f = idx * step + phase
  if (rp.jitter) f += Math.round((hash01(idx, 7) * 2 - 1) * rp.jitter)
  return f
}

// Loop / Boomerang — wrap the upstream's time into a seamless loop of `loopFrames`.
function loopFrame(frame, rp, ctx) {
  const L = Math.max(1, Math.round(rp.loopFrames || 1))
  const start = ctx.frameStart || 0
  const d = frame - start
  if (rp.mode === 'mirror') {
    const m = (((d % (2 * L)) + 2 * L) % (2 * L))
    return start + (m <= L ? m : 2 * L - m)
  }
  return start + (((d % L) + L) % L)   // cycle
}

// Time Remap / Time Warp — rewrite the frame fed upstream: freeze, reverse, speed-
// scale, or ease the timing itself across [inFrame, outFrame].
function remapFrame(frame, rp) {
  const inF = rp.inFrame || 0, outF = rp.outFrame || 0
  if (rp.mode === 'freeze') return inF
  if (rp.mode === 'reverse') return inF + outF - frame
  if (rp.mode === 'speed') return inF + (frame - inF) * (rp.speed ?? 1)
  const span = (outF - inF) || 1
  const e = (EASES[rp.ease] || EASES.linear)(clamp((frame - inF) / span, 0, 1))
  return inF + e * span               // remap: ease the timing
}

// Gather the objects produced by walking the object-flow graph backwards from a
// node. Each object input may have multiple incoming edges → an array.
function gatherObjects(nodeId, frame, ctx, seen) {
  if (seen.has(nodeId)) return []        // guard against cycles
  seen.add(nodeId)
  const node = ctx.nodeById[nodeId]
  if (!node) return []
  const def = NODE_DEFS[node.type]
  const rp = resolveParams(node, frame, ctx)

  if (def.category === 'source') {
    const o = sourceObject(node, rp, ctx, frame)
    return o ? [o] : []
  }

  // modifier / output: pull objects from upstream, then (for modifiers) transform.
  // `gather(f)` re-evaluates the whole upstream subtree at frame f — the multi-frame
  // sampling unlock (4). Because the engine is pure f(frame), time-domain modifiers
  // just call it with a warped frame.
  const inputs = ctx.objEdgesByTarget[nodeId] || []
  const gather = (f) => {
    let out = []
    for (const srcId of inputs) out = out.concat(gatherObjects(srcId, f, ctx, new Set(seen)))
    return out
  }

  // Switch / Selector — route between object inputs by a drivable index (wire order =
  // input order). Gathers only the selected branch, so unused branches cost nothing.
  if (node.type === 'switch') {
    if (!inputs.length) return []
    const n = inputs.length
    const pick = (((Math.round(rp.index || 0)) % n) + n) % n
    return gatherObjects(inputs[pick], frame, ctx, new Set(seen))
  }

  // ── Time-domain modifiers (re-time the upstream subtree) ───────────────────────
  switch (node.type) {
    case 'echo':      return applyEcho(gather, frame, rp)
    case 'strobe':    return gather(strobeFrame(frame, rp))
    case 'loop':      return gather(loopFrame(frame, rp, ctx))
    case 'timeRemap': return gather(remapFrame(frame, rp))
  }

  const objs = gather(frame)

  switch (node.type) {
    case 'transform': return objs.map(o => applyTransform(o, rp, ctx))
    case 'array':     return applyArray(objs, rp)
    case 'mirror':    return applyMirror(objs, rp, ctx)
    case 'wiggle':    return applyWiggle(objs, rp, frame)
    case 'clip':      return applyClip(objs, rp, frame, ctx)
    case 'physics':   return applyPhysics(objs, rp, frame, ctx)
    case 'particles': return applyParticles(objs, rp, frame, ctx)
    case 'shatter':   return applyShatter(objs, rp)
    case 'camera':    return applyCamera(objs, rp, ctx)
    case 'scramble':  return applyScramble(objs, rp, frame)
    case 'sort': {
      const a = [...objs]
      if (rp.mode === 'reverse') a.reverse()
      else if (rp.mode === 'by-Y') a.sort((p, q) => p.y - q.y)
      else if (rp.mode === 'by-Y-desc') a.sort((p, q) => q.y - p.y)
      return a   // 'by-index' keeps incoming order; later items render on top
    }
    // ── Appearance / effects ──────────────────────────────────────────────────────
    case 'tint':       return objs.map(o => withFx(o, { type: 'tint', mode: rp.mode, color: rp.color, amount: rp.amount, hueShift: rp.hueShift }))
    case 'blur':       return objs.map(o => withFx(o, { type: 'blur', radius: rp.radius, direction: rp.direction }))
    case 'glow':       return objs.map(o => withFx(o, { type: 'glow', radius: rp.radius, intensity: rp.intensity, color: rp.color }))
    case 'dropShadow': return objs.map(o => withFx(o, { type: 'dropShadow', dx: rp.dx, dy: rp.dy, blur: rp.blur, opacity: rp.opacity, color: rp.color }))
    case 'blend':      return objs.map(o => ({ ...o, blend: rp.mode }))
    case 'dither':
      return objs.map(o => withFx(o, {
        type: 'dither', mode: rp.mode, levels: Math.max(2, Math.round(rp.levels || 4)),
        cells: rp.cells || 0.06, reveal: clamp(rp.amount ?? 1, 0, 1), seed: Math.round(rp.seed || 0),
      }))
    case 'glitch': {
      // Static filter per frame; the schedule lives here — bake per-frame offsets so the
      // glitch fires in bursts every `interval` and jitters deterministically by frame+seed.
      const interval = Math.max(1, rp.interval || 1)
      const phase = ((frame % interval) + interval) % interval
      const burst = phase < Math.max(1, interval * 0.4) ? 1 : 0
      const j = hash01(Math.floor(frame), rp.seed || 0)
      const amt = burst * clamp(rp.intensity ?? 1, 0, 2) * (0.4 + 0.6 * j)
      const split = amt * (rp.rgbSplit ?? 8) * (hash01(frame + 11, rp.seed || 0) * 2 - 1)
      const displace = amt * (rp.blockSize ?? 20)
      return objs.map(o => withFx(o, { type: 'glitch', rgbSplit: split, displace, blockFreqY: 0.35, seed: Math.floor(frame) + Math.round(rp.seed || 0) }))
    }
    default:          return objs   // scene / passthrough
  }
}

// ── Main entry: evaluate the whole document at a frame → render list ──────────────
export function evaluateScene(doc, frame) {
  const canvas = doc.canvas
  const nodeById = {}
  for (const n of doc.nodes) nodeById[n.id] = n

  // index edges: object flow vs value bindings
  const objEdgesByTarget = {}        // targetId -> [sourceId]
  const valueBindings = {}           // `${targetId}::${targetHandle}` -> sourceId
  for (const e of doc.edges) {
    if ((e.targetHandle || 'objin') === 'objin' && (e.sourceHandle || 'objout') === 'objout') {
      (objEdgesByTarget[e.target] ||= []).push(e.source)
    } else if ((e.targetHandle || '').startsWith('prop:')) {
      valueBindings[`${e.target}::${e.targetHandle}`] = e.source
    }
  }

  const ctx = {
    canvas, fps: doc.fps, frameStart: doc.frameStart || 0, frameEnd: doc.frameEnd || 90,
    nodeById, objEdgesByTarget, valueBindings,
  }

  const scene = doc.nodes.find(n => n.type === 'scene')
  const items = scene ? gatherObjects(scene.id, frame, ctx, new Set()) : []
  return { canvas, items }
}
