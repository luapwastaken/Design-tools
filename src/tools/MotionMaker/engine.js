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

// ── Value node evaluation → a number at `frame` ──────────────────────────────────
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

// ── Build a renderable scene object from a source node ───────────────────────────
function sourceObject(node, rp, ctx) {
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
    const o = sourceObject(node, rp, ctx)
    return o ? [o] : []
  }

  // modifier / output: pull objects from upstream, then (for modifiers) transform
  const inputs = ctx.objEdgesByTarget[nodeId] || []
  let objs = []
  for (const srcId of inputs) objs = objs.concat(gatherObjects(srcId, frame, ctx, new Set(seen)))

  switch (node.type) {
    case 'transform': return objs.map(o => applyTransform(o, rp, ctx))
    case 'array':     return applyArray(objs, rp)
    case 'mirror':    return applyMirror(objs, rp, ctx)
    case 'wiggle':    return applyWiggle(objs, rp, frame)
    case 'clip':      return applyClip(objs, rp, frame, ctx)
    case 'physics':   return applyPhysics(objs, rp, frame, ctx)
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
