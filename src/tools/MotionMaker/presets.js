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

// Splice a modifier/effect node into an element's object flow: tf → fx → scene
// (replacing the direct tf → scene edge). Returns the inserted node so the caller
// can wire value drivers into its property sockets.
const insertFx = (sk, el, fxNode) => {
  sk.nodes.push(fxNode)
  sk.edges = sk.edges.filter(e => !(e.source === el.tf.id && e.target === sk.scene.id))
  sk.edges.push(objEdge(el.tf, fxNode), objEdge(fxNode, sk.scene))
  return fxNode
}

// Insert one node between *all* elements and the Scene (e.g. a global Camera): every
// object edge into the Scene is rerouted through the node, then the node feeds Scene.
const insertGlobal = (sk, node) => {
  sk.nodes.push(node)
  sk.edges.forEach(e => { if (e.target === sk.scene.id && (e.targetHandle || 'objin') === 'objin') e.target = node.id })
  sk.edges.push(objEdge(node, sk.scene))
  return node
}

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
  {
    id: 'echo-trails', name: 'Echo Trails',
    build: (images) => doc(images, (sk) => {
      sk.elements.forEach((el, i) => {
        const dir = i % 2 === 0 ? -1 : 1
        const x = mk('ramp', { from: dir * 420, to: 0, startFrame: i * 4, endFrame: i * 4 + 30, ease: 'easeOut' }, { x: 80, y: el.baseY + 120 })
        sk.nodes.push(x); sk.edges.push(valEdge(x, el.tf, 'x'))
        insertFx(sk, el, mk('echo', { copies: 6, frameDelay: 2, opacityFalloff: 0.55, scaleFalloff: 0.98, mode: 'echo' }, { x: 560, y: el.baseY }))
      })
    }),
  },
  {
    id: 'dither-resolve', name: 'Dither Resolve',
    build: (images) => doc(images, (sk) => {
      sk.elements.forEach((el, i) => {
        // logo materialising through a dither field — drive the reveal 0→1
        const di = insertFx(sk, el, mk('dither', { mode: 'noise', cells: 0.08, seed: 1 + i, amount: 0 }, { x: 560, y: el.baseY }))
        const rv = mk('ramp', { from: 0, to: 1, startFrame: i * 6, endFrame: i * 6 + 34, ease: 'easeInOut' }, { x: 560, y: el.baseY + 160 })
        sk.nodes.push(rv); sk.edges.push(valEdge(rv, di, 'amount'))
      })
    }),
  },
  {
    id: 'glitch-in', name: 'Glitch In',
    build: (images) => doc(images, (sk) => {
      sk.elements.forEach((el, i) => {
        const gl = insertFx(sk, el, mk('glitch', { intensity: 0, blockSize: 40, rgbSplit: 14, interval: 6, seed: 3 + i }, { x: 560, y: el.baseY }))
        const inten = mk('ramp', { from: 2, to: 0, startFrame: i * 4, endFrame: i * 4 + 28, ease: 'easeOut' }, { x: 560, y: el.baseY + 160 })
        const op = mk('ramp', { from: 0, to: 1, startFrame: i * 4, endFrame: i * 4 + 10, ease: 'easeOut' }, { x: 80, y: el.baseY + 120 })
        sk.nodes.push(inten, op); sk.edges.push(valEdge(inten, gl, 'intensity'), valEdge(op, el.tf, 'opacity'))
      })
    }),
  },
  {
    id: 'shatter-assemble', name: 'Shatter Assemble',
    build: (images) => doc(images, (sk) => {
      sk.elements.forEach((el, i) => {
        // direction 'in' runs the shatter in reverse — pieces fly together into the logo
        const sh = insertFx(sk, el, mk('shatter', { cols: 6, rows: 6, spread: 520, rotateChaos: 80, direction: 'in', seed: 2 + i, progress: 0 }, { x: 560, y: el.baseY }))
        const pr = mk('ramp', { from: 0, to: 1, startFrame: i * 6, endFrame: i * 6 + 36, ease: 'easeOut' }, { x: 560, y: el.baseY + 160 })
        sk.nodes.push(pr); sk.edges.push(valEdge(pr, sh, 'progress'))
      })
    }),
  },
  {
    id: 'camera-push', name: 'Camera Push-In',
    build: (images) => doc(images, (sk) => {
      sk.elements.forEach((el, i) => {
        const op = mk('ramp', { from: 0, to: 1, startFrame: i * 4, endFrame: i * 4 + 16, ease: 'easeOut' }, { x: 80, y: el.baseY + 120 })
        sk.nodes.push(op); sk.edges.push(valEdge(op, el.tf, 'opacity'))
      })
      const cam = insertGlobal(sk, mk('camera', { zoom: 1.25 }, { x: 600, y: 120 }))
      const zoom = mk('ramp', { from: 1.25, to: 1, startFrame: 0, endFrame: 60, ease: 'easeOut' }, { x: 600, y: 300 })
      sk.nodes.push(zoom); sk.edges.push(valEdge(zoom, cam, 'zoom'))
    }),
  },
]

export function imagesFromDoc(d) {
  return {
    icon: d.nodes.find(n => n.type === 'icon')?.params.image || null,
    wordmark: d.nodes.find(n => n.type === 'wordmark')?.params.image || null,
  }
}
