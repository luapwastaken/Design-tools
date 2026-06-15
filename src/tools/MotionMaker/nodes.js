// ── Motion Maker — node registry ───────────────────────────────────────────────
//
// Every node type the graph understands is described here as data: its label,
// category, sockets, and parameter schema. The engine (engine.js) reads this to
// evaluate the graph at a frame; the editor (Graph.jsx) reads it to render nodes
// and the inspector (Inspector.jsx) to build param controls. Adding a node type =
// adding an entry here plus (for value/object nodes) a branch in the engine.
//
// Socket model (see spec): object flow runs source -> modifier -> Scene on the
// 'objout'/'objin' handles; value nodes plug their 'valout' into a target node's
// `prop:<key>` handle to drive that property over time.

export const CATEGORY_COLOR = {
  source:   '#ff7849',  // tool accent
  modifier: '#5ab4ff',
  value:    '#a3e635',
  output:   '#8b5cf6',
}

// Param types: 'number' | 'image' | 'select' | 'color'
const N = (key, label, min, max, step, def) => ({ key, label, type: 'number', min, max, step, default: def })

export const NODE_DEFS = {
  // ── Sources ──────────────────────────────────────────────────────────────────
  icon: {
    type: 'icon', label: 'Icon', category: 'source',
    obj: { in: false, out: true }, value: false,
    params: [
      { key: 'image', label: 'Image', type: 'image', default: null },
      N('x', 'X', -2000, 2000, 1, 0),
      N('y', 'Y', -2000, 2000, 1, 0),
      N('scale', 'Scale', 0.01, 10, 0.01, 1),
      N('rotate', 'Rotate', -1080, 1080, 1, 0),
      N('opacity', 'Opacity', 0, 1, 0.01, 1),
    ],
  },
  wordmark: {
    type: 'wordmark', label: 'Wordmark', category: 'source',
    obj: { in: false, out: true }, value: false,
    params: [
      { key: 'image', label: 'Image', type: 'image', default: null },
      N('x', 'X', -2000, 2000, 1, 0),
      N('y', 'Y', -2000, 2000, 1, 0),
      N('scale', 'Scale', 0.01, 10, 0.01, 1),
      N('rotate', 'Rotate', -1080, 1080, 1, 0),
      N('opacity', 'Opacity', 0, 1, 0.01, 1),
    ],
  },
  shape: {
    type: 'shape', label: 'Shape', category: 'source',
    obj: { in: false, out: true }, value: false,
    params: [
      { key: 'kind', label: 'Kind', type: 'select', options: ['rect', 'ellipse'], default: 'rect' },
      { key: 'color', label: 'Color', type: 'color', default: '#ff7849' },
      N('w', 'Width', 1, 2000, 1, 300),
      N('h', 'Height', 1, 2000, 1, 300),
      N('x', 'X', -2000, 2000, 1, 0),
      N('y', 'Y', -2000, 2000, 1, 0),
      N('rotate', 'Rotate', -1080, 1080, 1, 0),
      N('opacity', 'Opacity', 0, 1, 0.01, 1),
    ],
  },

  // ── Modifiers ────────────────────────────────────────────────────────────────
  transform: {
    type: 'transform', label: 'Transform', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('x', 'X +', -2000, 2000, 1, 0),
      N('y', 'Y +', -2000, 2000, 1, 0),
      N('scale', 'Scale ×', 0.01, 10, 0.01, 1),
      N('rotate', 'Rotate +', -1080, 1080, 1, 0),
      N('opacity', 'Opacity ×', 0, 1, 0.01, 1),
    ],
  },

  // ── Value nodes ──────────────────────────────────────────────────────────────
  ramp: {
    type: 'ramp', label: 'Ramp', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('from', 'From', -5000, 5000, 0.01, 0),
      N('to', 'To', -5000, 5000, 0.01, 1),
      N('startFrame', 'Start f', 0, 6000, 1, 0),
      N('endFrame', 'End f', 0, 6000, 1, 30),
      { key: 'ease', label: 'Ease', type: 'select',
        options: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'outBack', 'outElastic'],
        default: 'easeInOut' },
    ],
  },
  lfo: {
    type: 'lfo', label: 'LFO', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      { key: 'wave', label: 'Wave', type: 'select',
        options: ['sine', 'triangle', 'saw', 'square'], default: 'sine' },
      N('period', 'Period f', 1, 6000, 1, 60),
      N('amp', 'Amplitude', -5000, 5000, 0.01, 1),
      N('offset', 'Offset', -5000, 5000, 0.01, 0),
      N('phase', 'Phase', 0, 1, 0.01, 0),
    ],
  },
  spring: {
    type: 'spring', label: 'Spring', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('from', 'From', -5000, 5000, 0.01, 0),
      N('to', 'To', -5000, 5000, 0.01, 1),
      N('startFrame', 'Start f', 0, 6000, 1, 0),
      N('stiffness', 'Stiffness', 0.5, 40, 0.1, 8),
      N('damping', 'Damping', 0.01, 0.999, 0.01, 0.4),
    ],
  },

  // ── Output ───────────────────────────────────────────────────────────────────
  scene: {
    type: 'scene', label: 'Scene', category: 'output',
    obj: { in: true, out: false }, value: false,
    params: [],
  },
}

export const NODE_TYPES = Object.keys(NODE_DEFS)

// Convenience groupings for the "add node" menu.
export const NODE_MENU = [
  { group: 'Sources',   types: ['icon', 'wordmark', 'shape'] },
  { group: 'Modifiers', types: ['transform'] },
  { group: 'Values',    types: ['ramp', 'lfo', 'spring'] },
  { group: 'Output',    types: ['scene'] },
]

// Build a node's default params object from its schema.
export function defaultParams(type) {
  const def = NODE_DEFS[type]
  if (!def) return {}
  const out = {}
  for (const p of def.params) out[p.key] = p.default
  return out
}

let _seq = 0
export function makeNodeId(type) {
  _seq += 1
  return `${type}_${Date.now().toString(36)}_${_seq}`
}
