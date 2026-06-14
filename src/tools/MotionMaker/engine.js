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
  outBack:    t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2) },
  outElastic: t => {
    if (t === 0 || t === 1) return t
    const c4 = (2 * Math.PI) / 3
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  },
}

// ── Waveforms (return -1..1 for a phase in turns) ────────────────────────────────
const WAVES = {
  sine:     p => Math.sin(2 * Math.PI * p),
  triangle: p => { const x = ((p % 1) + 1) % 1; return 4 * Math.abs(x - 0.5) - 1 },
  saw:      p => { const x = ((p % 1) + 1) % 1; return 2 * x - 1 },
  square:   p => (Math.sin(2 * Math.PI * p) >= 0 ? 1 : -1),
}

// ── Value node evaluation → a number at `frame` ──────────────────────────────────
export function evalValueNode(node, frame, ctx) {
  const p = node.params || {}
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
    default:
      return 0
  }
}

// ── Resolve a node's params at `frame`, applying any value-node bindings ──────────
// A value edge targets handle `prop:<key>`; if present, that property is driven by
// the connected value node instead of its static value.
function resolveParams(node, frame, ctx) {
  const def = NODE_DEFS[node.type]
  const out = { ...(node.params || {}) }
  if (!def) return out
  for (const p of def.params) {
    const src = ctx.valueBindings[`${node.id}::prop:${p.key}`]
    if (src) {
      const srcNode = ctx.nodeById[src]
      if (srcNode) out[p.key] = evalValueNode(srcNode, frame, ctx)
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

  if (node.type === 'transform') return objs.map(o => applyTransform(o, rp, ctx))
  return objs   // scene / passthrough
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

  const ctx = { canvas, fps: doc.fps, nodeById, objEdgesByTarget, valueBindings }

  const scene = doc.nodes.find(n => n.type === 'scene')
  const items = scene ? gatherObjects(scene.id, frame, ctx, new Set()) : []
  return { canvas, items }
}
