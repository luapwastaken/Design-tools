// ── Motion Maker — built-in presets (node-graph templates) ─────────────────────
//
// A preset rebuilds the document from the current Icon/Wordmark images: each source
// flows through its own Transform into the Scene, and value nodes (Ramp/LFO/Spring)
// are wired into the Transform's property sockets to animate it. Because presets are
// just graphs, every node stays tweakable after you apply one.

import { defaultParams, makeNodeId } from './nodes.js'

const mk = (type, params, pos) => ({ id: makeNodeId(type), type, pos, params: { ...defaultParams(type), ...params } })
const objEdge = (s, t) => ({ id: makeNodeId('edge'), source: s.id, target: t.id, sourceHandle: 'objout', targetHandle: 'objin' })
const valEdge = (s, t, key) => ({ id: makeNodeId('edge'), source: s.id, target: t.id, sourceHandle: 'valout', targetHandle: `prop:${key}` })

// Build the source→transform→scene skeleton shared by every preset.
function skeleton(images) {
  const scene = mk('scene', {}, { x: 760, y: 160 })
  const nodes = [scene]
  const edges = []
  const elements = []

  const add = (type, image, baseY) => {
    if (!image) return null
    const src = mk(type, { image }, { x: 80, y: baseY })
    const tf = mk('transform', {}, { x: 400, y: baseY })
    nodes.push(src, tf)
    edges.push(objEdge(src, tf), objEdge(tf, scene))
    const el = { src, tf, baseY }
    elements.push(el)
    return el
  }

  const icon = add('icon', images.icon, 40)
  const wm = add('wordmark', images.wordmark, 320)
  // if nothing imported yet, still give an empty icon source so the graph isn't bare
  if (!icon && !wm) {
    const src = mk('icon', {}, { x: 80, y: 40 })
    const tf = mk('transform', {}, { x: 400, y: 40 })
    nodes.push(src, tf); edges.push(objEdge(src, tf), objEdge(tf, scene))
    elements.push({ src, tf, baseY: 40 })
  }
  return { scene, nodes, edges, elements }
}

function doc(images, build) {
  const sk = skeleton(images)
  build(sk)
  return {
    fps: 30, frameStart: 0, frameEnd: 90,
    canvas: { w: 1080, h: 1080, bg: 'transparent' },
    nodes: sk.nodes, edges: sk.edges, view: { x: 0, y: 0, zoom: 0.85 },
  }
}

export const PRESETS = [
  {
    id: 'pop-settle', name: 'Pop & Settle',
    build: (images) => doc(images, ({ nodes, edges, elements }) => {
      elements.forEach((el, i) => {
        const sp = mk('spring', { from: 0.2, to: 1, startFrame: i * 6, stiffness: 9, damping: 0.32 }, { x: 80, y: el.baseY + 120 })
        nodes.push(sp); edges.push(valEdge(sp, el.tf, 'scale'))
      })
    }),
  },
  {
    id: 'fade-scale', name: 'Fade + Scale In',
    build: (images) => doc(images, ({ nodes, edges, elements }) => {
      elements.forEach((el, i) => {
        const op = mk('ramp', { from: 0, to: 1, startFrame: i * 5, endFrame: i * 5 + 18, ease: 'easeOut' }, { x: 80, y: el.baseY + 120 })
        const sc = mk('ramp', { from: 0.7, to: 1, startFrame: i * 5, endFrame: i * 5 + 24, ease: 'easeOut' }, { x: 80, y: el.baseY + 200 })
        nodes.push(op, sc); edges.push(valEdge(op, el.tf, 'opacity'), valEdge(sc, el.tf, 'scale'))
      })
    }),
  },
  {
    id: 'slide-in', name: 'Slide In',
    build: (images) => doc(images, ({ nodes, edges, elements }) => {
      elements.forEach((el, i) => {
        const dir = i % 2 === 0 ? -1 : 1
        const x = mk('ramp', { from: dir * 500, to: 0, startFrame: i * 4, endFrame: i * 4 + 26, ease: 'outBack' }, { x: 80, y: el.baseY + 120 })
        const op = mk('ramp', { from: 0, to: 1, startFrame: i * 4, endFrame: i * 4 + 12, ease: 'easeOut' }, { x: 80, y: el.baseY + 200 })
        nodes.push(x, op); edges.push(valEdge(x, el.tf, 'x'), valEdge(op, el.tf, 'opacity'))
      })
    }),
  },
  {
    id: 'idle-breathe', name: 'Idle Breathing Loop',
    build: (images) => doc(images, ({ nodes, edges, elements }) => {
      elements.forEach((el, i) => {
        // period = full range so the loop is seamless by construction
        const sc = mk('lfo', { wave: 'sine', period: 90, amp: 0.04, offset: 1, phase: i * 0.25 }, { x: 80, y: el.baseY + 120 })
        nodes.push(sc); edges.push(valEdge(sc, el.tf, 'scale'))
      })
    }),
  },
]

export function imagesFromDoc(d) {
  return {
    icon: d.nodes.find(n => n.type === 'icon')?.params.image || null,
    wordmark: d.nodes.find(n => n.type === 'wordmark')?.params.image || null,
  }
}
