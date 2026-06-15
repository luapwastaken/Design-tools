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
  source:     '#ff7849',  // tool accent
  modifier:   '#5ab4ff',
  appearance: '#f472b6',  // per-object SVG-filter effects
  value:      '#a3e635',
  output:     '#8b5cf6',
}

// Param types: 'number' | 'image' | 'select' | 'color' | 'keyframes'
const N = (key, label, min, max, step, def) => ({ key, label, type: 'number', min, max, step, default: def })

// Shared easing vocabulary (mirrors EASES keys in engine.js — kept as a plain list
// here to avoid a circular import between nodes.js and engine.js).
export const EASE_OPTIONS = [
  'linear', 'easeIn', 'easeOut', 'easeInOut',
  'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'outBack', 'inBack', 'inOutBack', 'outElastic', 'outBounce',
]

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
  array: {
    type: 'array', label: 'Array / Repeater', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('count', 'Count', 1, 200, 1, 5),
      { key: 'layout', label: 'Layout', type: 'select', options: ['linear', 'grid', 'radial'], default: 'linear' },
      N('dx', 'X step', -1000, 1000, 1, 120),
      N('dy', 'Y step', -1000, 1000, 1, 0),
      N('dScale', 'Scale ×/copy', 0.1, 2, 0.01, 1),
      N('dRotate', 'Rotate +/copy', -360, 360, 1, 0),
      N('dOpacity', 'Opacity ×/copy', 0, 1, 0.01, 1),
      N('radius', 'Radius', 0, 2000, 1, 300),
      N('arc', 'Arc °', -360, 360, 1, 360),
    ],
  },
  mirror: {
    type: 'mirror', label: 'Mirror / Symmetry', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      { key: 'axis', label: 'Axis', type: 'select', options: ['x', 'y', 'both'], default: 'x' },
    ],
  },
  wiggle: {
    type: 'wiggle', label: 'Wiggle', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('posAmp', 'Pos amp', 0, 1000, 1, 30),
      N('rotAmp', 'Rot amp', 0, 360, 1, 0),
      N('scaleAmp', 'Scale amp', 0, 1, 0.01, 0),
      N('frequency', 'Frequency', 0.01, 10, 0.01, 1),
      N('seed', 'Seed', 0, 9999, 1, 1),
    ],
  },
  clip: {
    type: 'clip', label: 'Clip / In-Out', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('inFrame', 'In f', 0, 6000, 1, 0),
      N('outFrame', 'Out f', 0, 6000, 1, 90),
      N('transition', 'Transition f', 0, 240, 1, 12),
      { key: 'enter', label: 'Enter', type: 'select', options: ['fade', 'scale', 'slide', 'cut'], default: 'fade' },
      { key: 'exit', label: 'Exit', type: 'select', options: ['fade', 'scale', 'slide', 'cut'], default: 'fade' },
    ],
  },
  physics: {
    type: 'physics', label: 'Physics / Gravity', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('startFrame', 'Start f', 0, 6000, 1, 0),
      N('gravity', 'Gravity', -10, 10, 0.1, 1),
      N('vx', 'Vel X', -100, 100, 0.5, 0),
      N('vy', 'Vel Y', -100, 100, 0.5, 0),
      N('bounce', 'Bounce', 0, 1, 0.01, 0.5),
      N('friction', 'Friction', 0, 1, 0.01, 0.98),
      N('floorY', 'Floor Y', -2000, 2000, 1, 400),
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
      { key: 'ease', label: 'Ease', type: 'select', options: EASE_OPTIONS, default: 'easeInOut' },
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

  keyframes: {
    type: 'keyframes', label: 'Keyframes', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      { key: 'keys', label: 'Keys', type: 'keyframes', default: [
        { frame: 0, value: 0, ease: 'easeOut' },
        { frame: 30, value: 1, ease: 'easeOut' },
      ] },
      { key: 'extrapolate', label: 'Extrapolate', type: 'select', options: ['hold', 'loop', 'ping-pong'], default: 'hold' },
    ],
  },
  constant: {
    type: 'constant', label: 'Constant', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('value', 'Value', -5000, 5000, 0.01, 1),
    ],
  },
  time: {
    type: 'time', label: 'Time', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['frame', 'seconds', '0-1'], default: 'frame' },
      N('scale', 'Scale', -100, 100, 0.01, 1),
      N('offset', 'Offset', -5000, 5000, 0.01, 0),
    ],
  },
  noise: {
    type: 'noise', label: 'Noise', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('frequency', 'Frequency', 0.001, 5, 0.001, 0.05),
      N('amplitude', 'Amplitude', -5000, 5000, 0.01, 1),
      N('offset', 'Offset', -5000, 5000, 0.01, 0),
      N('octaves', 'Octaves', 1, 6, 1, 1),
      N('seed', 'Seed', 0, 9999, 1, 1),
    ],
  },
  pulse: {
    type: 'pulse', label: 'Pulse / Beat', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('interval', 'Interval f', 1, 6000, 1, 30),
      N('width', 'Width f', 1, 6000, 1, 6),
      { key: 'shape', label: 'Shape', type: 'select', options: ['spike', 'gate', 'decay'], default: 'decay' },
      N('amp', 'Amplitude', -5000, 5000, 0.01, 1),
      N('phase', 'Phase f', 0, 6000, 1, 0),
    ],
  },
  randomHold: {
    type: 'randomHold', label: 'Random Hold', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('interval', 'Interval f', 1, 6000, 1, 15),
      N('min', 'Min', -5000, 5000, 0.01, 0),
      N('max', 'Max', -5000, 5000, 0.01, 1),
      N('smooth', 'Smooth', 0, 1, 0.01, 0),
      N('seed', 'Seed', 0, 9999, 1, 1),
    ],
  },

  // ── Value operators (value → value; unlock 1: value→value chaining) ────────────
  math: {
    type: 'math', label: 'Math', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      { key: 'op', label: 'Op', type: 'select',
        options: ['+', '-', '*', '/', 'mod', 'pow', 'min', 'max', 'abs', 'neg', 'sin', 'cos', 'floor', 'round'],
        default: '+' },
      N('a', 'A', -5000, 5000, 0.01, 0),
      N('b', 'B', -5000, 5000, 0.01, 1),
    ],
  },
  mapRange: {
    type: 'mapRange', label: 'Map Range', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('input', 'Input', -5000, 5000, 0.01, 0),
      N('inMin', 'In min', -5000, 5000, 0.01, 0),
      N('inMax', 'In max', -5000, 5000, 0.01, 1),
      N('outMin', 'Out min', -5000, 5000, 0.01, 0),
      N('outMax', 'Out max', -5000, 5000, 0.01, 100),
      { key: 'clamp', label: 'Clamp', type: 'select', options: ['on', 'off'], default: 'on' },
      { key: 'ease', label: 'Ease', type: 'select', options: EASE_OPTIONS, default: 'linear' },
    ],
  },
  curve: {
    type: 'curve', label: 'Curve / Shaper', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('input', 'Input 0-1', 0, 1, 0.01, 0),
      { key: 'ease', label: 'Ease', type: 'select', options: EASE_OPTIONS, default: 'easeInOut' },
    ],
  },
  mix: {
    type: 'mix', label: 'Mix', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('a', 'A', -5000, 5000, 0.01, 0),
      N('b', 'B', -5000, 5000, 0.01, 1),
      N('t', 'Mix t', 0, 1, 0.01, 0.5),
      { key: 'mode', label: 'Mode', type: 'select', options: ['lerp', 'add', 'multiply'], default: 'lerp' },
    ],
  },
  clamp: {
    type: 'clamp', label: 'Clamp / Quantize', category: 'value',
    obj: { in: false, out: false }, value: true,
    params: [
      N('input', 'Input', -5000, 5000, 0.01, 0),
      N('min', 'Min', -5000, 5000, 0.01, 0),
      N('max', 'Max', -5000, 5000, 0.01, 1),
      N('steps', 'Steps', 0, 64, 1, 0),
    ],
  },

  // ── Appearance / effects (per-object SVG filters; unlock 3) ────────────────────
  tint: {
    type: 'tint', label: 'Tint / Color', category: 'appearance',
    obj: { in: true, out: true }, value: false,
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['multiply', 'replace', 'hue-shift'], default: 'multiply' },
      { key: 'color', label: 'Color', type: 'color', default: '#ff7849' },
      N('amount', 'Amount', 0, 1, 0.01, 1),
      N('hueShift', 'Hue °', -180, 180, 1, 0),
    ],
  },
  blur: {
    type: 'blur', label: 'Blur', category: 'appearance',
    obj: { in: true, out: true }, value: false,
    params: [
      N('radius', 'Radius', 0, 100, 0.5, 4),
      { key: 'direction', label: 'Direction', type: 'select', options: ['uniform', 'horizontal', 'vertical'], default: 'uniform' },
    ],
  },
  glow: {
    type: 'glow', label: 'Glow / Bloom', category: 'appearance',
    obj: { in: true, out: true }, value: false,
    params: [
      N('radius', 'Radius', 0, 100, 0.5, 8),
      N('intensity', 'Intensity', 0, 1, 0.01, 0.8),
      { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
    ],
  },
  dropShadow: {
    type: 'dropShadow', label: 'Drop Shadow', category: 'appearance',
    obj: { in: true, out: true }, value: false,
    params: [
      N('dx', 'Offset X', -200, 200, 1, 0),
      N('dy', 'Offset Y', -200, 200, 1, 12),
      N('blur', 'Blur', 0, 100, 0.5, 8),
      N('opacity', 'Opacity', 0, 1, 0.01, 0.5),
      { key: 'color', label: 'Color', type: 'color', default: '#000000' },
    ],
  },
  blend: {
    type: 'blend', label: 'Blend Mode', category: 'appearance',
    obj: { in: true, out: true }, value: false,
    params: [
      { key: 'mode', label: 'Mode', type: 'select',
        options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion'],
        default: 'multiply' },
    ],
  },
  dither: {
    type: 'dither', label: 'Dither / Halftone', category: 'appearance',
    obj: { in: true, out: true }, value: false,
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['noise', 'ordered'], default: 'noise' },
      N('amount', 'Reveal', 0, 1, 0.01, 1),   // drivable: wire a Ramp for the resolve-in
      N('cells', 'Grain', 0.005, 0.4, 0.005, 0.06),
      N('levels', 'Levels', 2, 16, 1, 4),
      N('seed', 'Seed', 0, 9999, 1, 1),
    ],
  },
  glitch: {
    type: 'glitch', label: 'Glitch / Datamosh', category: 'appearance',
    obj: { in: true, out: true }, value: false,
    params: [
      N('intensity', 'Intensity', 0, 2, 0.01, 1),
      N('blockSize', 'Block', 0, 200, 1, 30),
      N('rgbSplit', 'RGB split', 0, 40, 0.5, 10),
      N('interval', 'Interval f', 1, 600, 1, 30),
      N('seed', 'Seed', 0, 9999, 1, 1),
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
  { group: 'Modifiers', types: ['transform', 'array', 'mirror', 'wiggle', 'clip', 'physics'] },
  { group: 'Appearance', types: ['tint', 'blur', 'glow', 'dropShadow', 'blend', 'dither', 'glitch'] },
  { group: 'Values',    types: ['ramp', 'lfo', 'spring', 'keyframes', 'constant', 'time', 'noise', 'pulse', 'randomHold'] },
  { group: 'Operators', types: ['math', 'mapRange', 'curve', 'mix', 'clamp'] },
  { group: 'Output',    types: ['scene'] },
]

// Build a node's default params object from its schema.
export function defaultParams(type) {
  const def = NODE_DEFS[type]
  if (!def) return {}
  const out = {}
  // clone non-primitive defaults (e.g. Keyframes' key array) so instances don't share
  // and mutate the same object reference.
  for (const p of def.params) out[p.key] = (p.default && typeof p.default === 'object')
    ? JSON.parse(JSON.stringify(p.default)) : p.default
  return out
}

let _seq = 0
export function makeNodeId(type) {
  _seq += 1
  return `${type}_${Date.now().toString(36)}_${_seq}`
}
