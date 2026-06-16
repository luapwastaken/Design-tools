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

// Feel / Personality — one graph-level dial retimes every user-chosen ease toward a
// coherent character. Each character maps to a signature ease; `easeFn` blends the
// node's own ease toward it by the Feel node's intensity (0 = untouched).
const FEEL_EASE = {
  snappy:     'easeOutCubic',
  smooth:     'easeInOut',
  bouncy:     'outBack',
  mechanical: 'linear',
  organic:    'easeInOutCubic',
}
// Resolve an ease name to a function, applying the active Feel character if any.
function easeFn(name, ctx) {
  const base = EASES[name] || EASES.linear
  const feel = ctx && ctx.feel
  if (!feel || !feel.intensity) return base
  const charE = EASES[FEEL_EASE[feel.character]] || base
  const k = clamp(feel.intensity, 0, 1)
  return t => { const a = base(t); return a + (charE(t) - a) * k }
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

// ── Safe expression evaluator (Expression node) ──────────────────────────────────
// A tiny shunting-yard parser → RPN → evaluate. NEVER uses eval. Supports numbers,
// variables (frame/t/a/b/c), constants (pi/e/tau), + - * / % ^, unary minus, parens,
// and a fixed set of math functions. Compiled forms are cached by source string.
const EXPR_FUNCS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow, exp: Math.exp, log: Math.log }
const EXPR_CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 }
const _exprCache = new Map()

function tokenizeExpr(s) {
  const toks = []; let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue }
    if (/[a-zA-Z_]/.test(c)) { let j = i; while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++; toks.push({ t: 'name', v: s.slice(i, j) }); i = j; continue }
    if ('+-*/%^(),'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue }
    i++   // skip anything unexpected
  }
  return toks
}

function compileExpr(src) {
  const toks = tokenizeExpr(src)
  const out = [], ops = []
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3, 'u-': 4 }
  const right = { '^': true, 'u-': true }
  let prev = null
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    if (tk.t === 'num') { out.push(tk); prev = 'val' }
    else if (tk.t === 'name') {
      if (toks[k + 1] && toks[k + 1].t === 'op' && toks[k + 1].v === '(') { ops.push({ t: 'func', v: tk.v }); prev = 'func' }
      else { out.push(tk); prev = 'val' }
    } else if (tk.v === ',') {
      while (ops.length && !(ops[ops.length - 1].v === '(')) out.push(ops.pop()); prev = 'comma'
    } else if (tk.v === '(') { ops.push(tk); prev = '(' }
    else if (tk.v === ')') {
      while (ops.length && ops[ops.length - 1].v !== '(') out.push(ops.pop())
      ops.pop()
      if (ops.length && ops[ops.length - 1].t === 'func') out.push(ops.pop())
      prev = 'val'
    } else {
      let op = tk.v
      if (op === '-' && (prev === null || prev === 'op' || prev === '(' || prev === 'comma' || prev === 'func')) op = 'u-'
      while (ops.length) {
        const top = ops[ops.length - 1]
        if (top.t === 'op' && top.v !== '(' && (right[op] ? prec[op] < prec[top.v] : prec[op] <= prec[top.v])) out.push(ops.pop())
        else break
      }
      ops.push({ t: 'op', v: op }); prev = 'op'
    }
  }
  while (ops.length) out.push(ops.pop())
  return (vars) => {
    const st = []
    for (const tk of out) {
      if (tk.t === 'num') st.push(tk.v)
      else if (tk.t === 'name') st.push(tk.v in vars ? vars[tk.v] : (EXPR_CONSTS[tk.v] ?? 0))
      else if (tk.t === 'func') {
        const f = EXPR_FUNCS[tk.v]; if (!f) { st.push(0); continue }
        const args = []; for (let n = 0; n < Math.max(1, f.length); n++) args.unshift(st.pop())
        st.push(f(...args))
      } else if (tk.v === 'u-') st.push(-(st.pop() || 0))
      else {
        const b = st.pop(), a = st.pop()
        st.push(tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b
          : tk.v === '/' ? (b ? a / b : 0) : tk.v === '%' ? (b ? ((a % b) + b) % b : 0)
          : tk.v === '^' ? Math.pow(a, b) : 0)
      }
    }
    return st.length ? st[st.length - 1] : 0
  }
}
function getExpr(src) {
  if (!_exprCache.has(src)) { try { _exprCache.set(src, compileExpr(src)) } catch { _exprCache.set(src, () => 0) } }
  return _exprCache.get(src)
}

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
      const e = easeFn(p.ease, ctx)(t)
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
          const e = easeFn(k1.ease, ctx)(t)
          return k0.value + (k1.value - k0.value) * e
        }
      }
      return last.value
    }

    // Sequencer — fire an attack/decay envelope at each trigger frame and combine the
    // active ones (sum / max / latest). A multi-event pulse generator: drive scale,
    // opacity, glitch bursts… off a score of frames.
    case 'sequencer': {
      const evs = Array.isArray(p.steps) ? p.steps : []
      const atk = Math.max(0, p.attack || 0), dec = Math.max(1, p.decay || 1)
      let sum = 0, mx = 0, latest = 0, fired = false
      for (const ev of evs) {
        const age = frame - (ev.frame || 0)
        if (age < 0 || age >= atk + dec) continue
        const e = age < atk ? (atk > 0 ? age / atk : 1) : 1 - (age - atk) / dec
        const v = (ev.value ?? 0) * e
        sum += v; if (Math.abs(v) >= Math.abs(mx)) mx = v; latest = v; fired = true
      }
      if (!fired) return 0
      return p.mode === 'sum' ? sum : p.mode === 'latest' ? latest : mx
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
      const e = easeFn(p.ease, ctx)(t)
      return p.outMin + (p.outMax - p.outMin) * e
    }
    case 'curve':
      return easeFn(p.ease, ctx)(clamp(p.input || 0, 0, 1))
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

    // Delay / Sample & Hold re-evaluate their bound input source at a shifted/held
    // frame (the value-domain analogue of multi-frame sampling).
    case 'delay': {
      const src = ctx?.valueBindings?.[`${node.id}::prop:input`]
      if (src && ctx.nodeById?.[src]) return evalValueNode(ctx.nodeById[src], frame - (p.frames || 0), ctx, trail)
      return p.input || 0
    }
    case 'sampleHold': {
      const src = ctx?.valueBindings?.[`${node.id}::prop:input`]
      const interval = Math.max(1, p.interval || 1), ph = p.phase || 0
      const sampleFrame = Math.floor((frame - ph) / interval) * interval + ph
      if (src && ctx.nodeById?.[src]) return evalValueNode(ctx.nodeById[src], sampleFrame, ctx, trail)
      return p.input || 0
    }
    case 'expression': {
      const span = ((ctx?.frameEnd ?? 0) - (ctx?.frameStart ?? 0)) || 1
      const t = clamp((frame - (ctx?.frameStart ?? 0)) / span, 0, 1)
      let v = 0
      try { v = getExpr(String(p.expr || ''))({ frame, t, a: p.a || 0, b: p.b || 0, c: p.c || 0 }) } catch { v = 0 }
      return Number.isFinite(v) ? v : 0
    }

    // ── Color value nodes → a color string ─────────────────────────────────────────
    case 'colorSwatch': {
      const a = clamp(p.alpha ?? 1, 0, 1)
      return a >= 1 ? p.color : hexToRgba(p.color, a)
    }
    case 'gradientMap':
      return lerpColor(p.colorA, p.colorB, clamp(p.input ?? 0, 0, 1))
    case 'brandPalette': {
      const cols = [p.c1, p.c2, p.c3, p.c4, p.c5].slice(0, Math.max(1, Math.min(5, Math.round(p.count || 5))))
      const step = Math.max(1, p.cycleFrames || 1)
      let idx
      if (p.mode === 'cycle') idx = Math.floor(frame / step)
      else if (p.mode === 'random') idx = Math.floor(hash01(Math.floor(frame / step), p.seed || 0) * cols.length)
      else idx = Math.round(p.index || 0)
      return cols[(((idx % cols.length) + cols.length) % cols.length)]
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
      if (srcNode && !srcNode.bypass) out[p.key] = evalValueNode(srcNode, frame, ctx, seen)
    }
  }
  // Seed/Shuffle — a global seed node offsets every node's `seed` so one dial re-rolls
  // all randomness coherently. (The seed node has no `seed` param, so it can't self-shift.)
  if (ctx.seedOffset && typeof out.seed === 'number' && !ctx.valueBindings[`${node.id}::prop:seed`]) {
    out.seed = out.seed + ctx.seedOffset
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
      const e = easeFn(rp.ease, ctx)(clamp((frame - rp.startFrame) / span, 0, 1))
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

  // Null / Anchor — an invisible parent carrying a transform. Renders nothing (no render
  // kind 'null'); Parent/Pin reads its transform and consumes it.
  if (node.type === 'null') {
    return {
      id: node.id, kind: 'null',
      x: cx + rp.x, y: cy + rp.y, scale: rp.scale ?? 1, rotate: rp.rotate || 0,
      w: 0, h: 0, opacity: 0,
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

// Split — break a Text object into per-letter / per-word objects, each centred at its
// own position so downstream modifiers (Effector, Echo, Transform…) animate per piece.
// Non-text objects pass through. Whitespace keeps its advance but emits nothing.
function applySplit(objs, rp) {
  const out = []
  for (const o of objs) {
    if (o.kind !== 'text' || o.string == null) { out.push(o); continue }
    const s = o.string
    const units = rp.by === 'words' ? s.split(/(\s+)/) : Array.from(s)
    const adv = o.h * 0.55 + (rp.tracking || 0)              // per-char advance
    const widths = units.map(u => Math.max(0, (u.length || 1)) * adv)
    const total = widths.reduce((a, b) => a + b, 0)
    let cursor = -total / 2
    units.forEach((u, i) => {
      const uw = widths[i]
      const cxOff = cursor + uw / 2
      cursor += uw
      if (u.trim() === '') return                            // skip whitespace (spacing kept)
      out.push({ ...o, id: `${o.id}~u${i}`, string: u, align: 'center', x: o.x + cxOff, w: uw })
    })
  }
  return out
}

// Effector — the mograph backbone. Samples a spatial/index falloff field per object and
// applies weighted transform offsets across them — e.g. "a wave of scale across a grid"
// when fed Array copies. The field is built in (Field + Effector folded into one node);
// drive `phase` with a Ramp/LFO to sweep the wave.
function applyEffector(objs, rp, ctx) {
  const n = objs.length
  if (!n) return objs
  const curve = easeFn(rp.falloffCurve, ctx)
  const cx = ctx.canvas.w / 2 + (rp.centerX || 0), cy = ctx.canvas.h / 2 + (rp.centerY || 0)
  const size = rp.size || 1
  const strength = rp.strength ?? 1
  const fall = Math.max(0.001, rp.falloff || 1)
  return objs.map((o, i) => {
    let f
    if (rp.field === 'linear') {
      f = clamp((o.x - (cx - size / 2)) / size, 0, 1)
    } else if (rp.field === 'radial') {
      f = clamp(1 - Math.hypot(o.x - cx, o.y - cy) / size, 0, 1)
    } else if (rp.field === 'noise') {
      f = (fbmSigned(o.x * 0.01 + o.y * 0.013, rp.seed || 0) + 1) / 2
    } else { // by-index wave: a bump centred at `phase` across the copies
      const u = n > 1 ? i / (n - 1) : 0
      f = clamp(1 - Math.abs(u - clamp(rp.phase ?? 0, 0, 1)) / fall, 0, 1)
    }
    const wt = curve(clamp(f, 0, 1)) * strength
    const sc = 1 + ((rp.scale ?? 1) - 1) * wt
    const op = 1 + ((rp.opacity ?? 1) - 1) * wt
    return {
      ...o,
      x: o.x + (rp.posX || 0) * wt, y: o.y + (rp.posY || 0) * wt,
      w: o.w * sc, h: o.h * sc,
      rotate: o.rotate + (rp.rotate || 0) * wt,
      opacity: clamp(o.opacity * op, 0, 1),
    }
  })
}

// Parent / Pin — make every child inherit the transform of the first Null/Anchor in the
// stream. The null's pose is read as a delta from canvas centre (translate + scale +
// rotate about centre); children are transformed by it (blended by `influence`) and the
// null is consumed (it never renders). 'position' mode pins location only. With no null
// present it degrades to a plain pin offset.
function applyParent(objs, rp, ctx) {
  const cx = ctx.canvas.w / 2, cy = ctx.canvas.h / 2
  const par = objs.find(o => o.kind === 'null')
  const kids = objs.filter(o => o.kind !== 'null')
  const infl = clamp(rp.influence ?? 1, 0, 1)
  let tx = (rp.x || 0) * infl, ty = (rp.y || 0) * infl, scale = 1, rot = 0
  if (par) {
    tx += (par.x - cx) * infl
    ty += (par.y - cy) * infl
    scale = 1 + ((par.scale ?? 1) - 1) * infl
    rot = (par.rotate || 0) * infl
  }
  const posOnly = rp.mode === 'position'
  const rad = rot * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad)
  return kids.map(o => {
    if (posOnly) return { ...o, x: o.x + tx, y: o.y + ty }
    const rx = ((o.x - cx) * c - (o.y - cy) * s) * scale
    const ry = ((o.x - cx) * s + (o.y - cy) * c) * scale
    return {
      ...o, x: cx + rx + tx, y: cy + ry + ty,
      w: o.w * scale, h: o.h * scale, rotate: o.rotate + rot,
    }
  })
}

// Stagger — cascade the upstream animation across objects by index. Re-samples the
// subtree at frame − rank·step per object (rank set by `order`), so Array copies or a
// rig's children fall into their motion one after another. Time-domain (like Echo).
function applyStagger(gather, frame, rp) {
  const base = gather(frame)
  const n = base.length
  const step = rp.step || 0
  if (n <= 1 || !step) return base
  const rank = (i) => {
    switch (rp.order) {
      case 'reverse': return n - 1 - i
      case 'center':  return Math.abs(i - (n - 1) / 2)
      case 'random':  return hash01(i, rp.seed || 0) * (n - 1)
      default:        return i   // forward
    }
  }
  return base.map((o, i) => {
    const sample = gather(frame - rank(i) * step)
    return sample[i] || o
  })
}

// Align / Distribute — snap objects to the canvas (or their own bounding box) and even
// out spacing. relativeTo 'canvas' aligns to canvas edges/centre; 'selection' to the
// group's bbox.
function applyAlign(objs, rp, ctx) {
  if (!objs.length) return objs
  const { w: cw, h: ch } = ctx.canvas
  const pad = rp.padding || 0
  const out = objs.map(o => ({ ...o }))
  const toCanvas = rp.relativeTo !== 'selection'
  const bb = () => {
    const xs = out.map(o => o.x), ys = out.map(o => o.y)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  }
  if (rp.alignX && rp.alignX !== 'off') {
    const b = toCanvas ? null : bb()
    out.forEach(o => {
      if (toCanvas) o.x = rp.alignX === 'left' ? pad + o.w / 2 : rp.alignX === 'right' ? cw - pad - o.w / 2 : cw / 2
      else o.x = rp.alignX === 'left' ? b.minX : rp.alignX === 'right' ? b.maxX : (b.minX + b.maxX) / 2
    })
  }
  if (rp.alignY && rp.alignY !== 'off') {
    const b = toCanvas ? null : bb()
    out.forEach(o => {
      if (toCanvas) o.y = rp.alignY === 'top' ? pad + o.h / 2 : rp.alignY === 'bottom' ? ch - pad - o.h / 2 : ch / 2
      else o.y = rp.alignY === 'top' ? b.minY : rp.alignY === 'bottom' ? b.maxY : (b.minY + b.maxY) / 2
    })
  }
  if (out.length > 1 && (rp.distribute === 'horizontal' || rp.distribute === 'vertical')) {
    const horiz = rp.distribute === 'horizontal'
    const key = horiz ? 'x' : 'y'
    const sorted = [...out].sort((a, b) => a[key] - b[key])
    const span = horiz ? cw : ch
    const lo = toCanvas ? pad : sorted[0][key]
    const hi = toCanvas ? span - pad : sorted[sorted.length - 1][key]
    sorted.forEach((o, i) => { o[key] = lo + (hi - lo) * (i / (sorted.length - 1)) })
  }
  return out
}

// Motion Path — drive each object along a parametric path by progress t (drivable).
// Sets position absolutely; `orient` rotates to the path tangent.
function applyMotionPath(objs, rp, ctx) {
  const t = clamp(rp.t ?? 0, 0, 1)
  const cx = ctx.canvas.w / 2 + (rp.x || 0), cy = ctx.canvas.h / 2 + (rp.y || 0)
  let px, py, tan
  if (rp.pathType === 'line') {
    const L = rp.length || 0; px = cx - L / 2 + t * L; py = cy; tan = 0
  } else if (rp.pathType === 'wave') {
    const L = rp.length || 0, f = rp.freq || 1, amp = rp.amp || 0
    px = cx - L / 2 + t * L; py = cy + Math.sin(t * f * 2 * Math.PI) * amp
    tan = Math.atan2(amp * f * 2 * Math.PI * Math.cos(t * f * 2 * Math.PI), L || 1)
  } else if (rp.pathType === 'arc') {
    const a = (t * (rp.arcDeg || 0)) * Math.PI / 180 - Math.PI / 2
    px = cx + Math.cos(a) * rp.radius; py = cy + Math.sin(a) * rp.radius; tan = a + Math.PI / 2
  } else { // circle
    const a = t * 2 * Math.PI - Math.PI / 2
    px = cx + Math.cos(a) * rp.radius; py = cy + Math.sin(a) * rp.radius; tan = a + Math.PI / 2
  }
  return objs.map(o => ({
    ...o, x: px, y: py,
    rotate: rp.orient === 'on' ? o.rotate + tan * 180 / Math.PI : o.rotate,
  }))
}

// Magnet / Attractor — pull/repel/orbit objects relative to a point, weighted by a
// distance falloff. A static displacement field (animate via Strength / Start f).
function applyMagnet(objs, rp, ctx, frame) {
  if (frame < (rp.startFrame || 0)) return objs
  const mx = ctx.canvas.w / 2 + (rp.x || 0), my = ctx.canvas.h / 2 + (rp.y || 0)
  const radius = rp.radius || 0, strength = rp.strength || 0
  return objs.map(o => {
    const dx = o.x - mx, dy = o.y - my
    const dist = Math.hypot(dx, dy) || 0.0001
    if (radius > 0 && dist > radius) return o
    const n = radius > 0 ? clamp(dist / radius, 0, 1) : 0
    let w = rp.falloff === 'linear' ? (1 - n)
      : rp.falloff === 'inverse-square' ? 1 / (1 + (dist / 100) * (dist / 100))
      : (1 - n) * (1 - n) * (3 - 2 * (1 - n))   // smooth
    const force = strength * w
    const ux = dx / dist, uy = dy / dist
    if (rp.mode === 'orbit') {
      const ang = (force / dist)                       // radians to rotate about the magnet
      const c = Math.cos(ang), s = Math.sin(ang)
      return { ...o, x: mx + (dx * c - dy * s), y: my + (dx * s + dy * c) }
    }
    const dir = rp.mode === 'repel' ? 1 : -1            // attract pulls inward
    return { ...o, x: o.x + ux * force * dir, y: o.y + uy * force * dir }
  })
}

// Orient / Look-at — rotate each object to face a target point, or its own motion
// direction (velocity mode re-samples the previous frame — multi-frame unlock).
function applyOrient(objs, rp, ctx, frame, gather) {
  const off = rp.offsetAngle || 0
  if (rp.mode === 'velocity') {
    const prev = gather(frame - 1)
    const byId = {}
    for (const p of prev) byId[p.id] = p
    return objs.map(o => {
      const p = byId[o.id]
      let ang = o.rotate
      if (p) { const dx = o.x - p.x, dy = o.y - p.y; if (dx || dy) ang = Math.atan2(dy, dx) * 180 / Math.PI }
      return { ...o, rotate: ang + off }
    })
  }
  const tx = ctx.canvas.w / 2 + (rp.targetX || 0), ty = ctx.canvas.h / 2 + (rp.targetY || 0)
  return objs.map(o => ({ ...o, rotate: Math.atan2(ty - o.y, tx - o.x) * 180 / Math.PI + off }))
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
function remapFrame(frame, rp, ctx) {
  const inF = rp.inFrame || 0, outF = rp.outFrame || 0
  if (rp.mode === 'freeze') return inF
  if (rp.mode === 'reverse') return inF + outF - frame
  if (rp.mode === 'speed') return inF + (frame - inF) * (rp.speed ?? 1)
  const span = (outF - inF) || 1
  const e = easeFn(rp.ease, ctx)(clamp((frame - inF) / span, 0, 1))
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
    if (node.bypass) return []                 // muted source contributes nothing
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

  // Bypass / Mute — pass the upstream through untouched (Reroute does the same).
  if (node.bypass) return gather(frame)

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
    case 'stagger':   return applyStagger(gather, frame, rp)
    case 'strobe':    return gather(strobeFrame(frame, rp))
    case 'loop':      return gather(loopFrame(frame, rp, ctx))
    case 'timeRemap': return gather(remapFrame(frame, rp, ctx))
  }

  const objs = gather(frame)

  switch (node.type) {
    case 'transform': return objs.map(o => applyTransform(o, rp, ctx))
    case 'roundCorners': return objs.map(o => ({ ...o, corner: Math.max(0, rp.radius || 0) }))
    case 'parent':    return applyParent(objs, rp, ctx)
    case 'array':     return applyArray(objs, rp)
    case 'mirror':    return applyMirror(objs, rp, ctx)
    case 'wiggle':    return applyWiggle(objs, rp, frame)
    case 'clip':      return applyClip(objs, rp, frame, ctx)
    case 'physics':   return applyPhysics(objs, rp, frame, ctx)
    case 'particles': return applyParticles(objs, rp, frame, ctx)
    case 'shatter':   return applyShatter(objs, rp)
    case 'camera':    return applyCamera(objs, rp, ctx)
    case 'scramble':  return applyScramble(objs, rp, frame)
    case 'align':      return applyAlign(objs, rp, ctx)
    case 'motionPath': return applyMotionPath(objs, rp, ctx)
    case 'magnet':     return applyMagnet(objs, rp, ctx, frame)
    case 'orient':     return applyOrient(objs, rp, ctx, frame, gather)
    case 'effector':   return applyEffector(objs, rp, ctx)
    case 'split':      return applySplit(objs, rp)
    case 'mask': {
      const mcx = ctx.canvas.w / 2 + (rp.x || 0), mcy = ctx.canvas.h / 2 + (rp.y || 0)
      const clip = { shape: rp.shape, x: mcx, y: mcy, w: rp.w, h: rp.h, feather: rp.feather || 0, invert: rp.invert === 'on', cw: ctx.canvas.w, ch: ctx.canvas.h }
      return objs.map(o => ({ ...o, clip }))
    }
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
    case 'outline':    return objs.map(o => withFx(o, { type: 'outline', width: rp.width, color: rp.color }))
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

  // Graph-level nodes (Feel, Seed/Shuffle) sit anywhere in the graph and influence the
  // whole evaluation through ctx, rather than the object/value flow.
  const feelNode = doc.nodes.find(n => n.type === 'feel' && !n.bypass)
  const feel = feelNode ? { character: feelNode.params?.character || 'smooth', intensity: feelNode.params?.intensity ?? 1 } : null
  const seedNode = doc.nodes.find(n => n.type === 'seed' && !n.bypass)
  const seedOffset = seedNode ? Math.round(seedNode.params?.value || 0) : 0

  const ctx = {
    canvas, fps: doc.fps, frameStart: doc.frameStart || 0, frameEnd: doc.frameEnd || 90,
    nodeById, objEdgesByTarget, valueBindings, feel, seedOffset,
  }

  const scene = doc.nodes.find(n => n.type === 'scene')
  const items = scene ? gatherObjects(scene.id, frame, ctx, new Set()) : []
  return { canvas, items }
}
