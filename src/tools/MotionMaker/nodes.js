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

const FONT_OPTIONS = ['system-ui', 'JetBrains Mono', 'Georgia', 'Impact', 'Courier New', 'Arial Black']

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
  text: {
    type: 'text', label: 'Text', category: 'source',
    obj: { in: false, out: true }, value: false,
    params: [
      { key: 'string', label: 'Text', type: 'text', default: 'TAGLINE' },
      { key: 'font', label: 'Font', type: 'select', options: FONT_OPTIONS, default: 'system-ui' },
      { key: 'weight', label: 'Weight', type: 'select', options: ['400', '600', '700', '900'], default: '700' },
      { key: 'case', label: 'Case', type: 'select', options: ['none', 'upper', 'lower'], default: 'none' },
      { key: 'align', label: 'Align', type: 'select', options: ['left', 'center', 'right'], default: 'center' },
      { key: 'fill', label: 'Fill', type: 'color', default: '#ffffff' },
      N('size', 'Size', 4, 800, 1, 80),
      N('tracking', 'Tracking', -20, 80, 0.5, 0),
      N('x', 'X', -2000, 2000, 1, 0),
      N('y', 'Y', -2000, 2000, 1, 0),
      N('rotate', 'Rotate', -1080, 1080, 1, 0),
      N('opacity', 'Opacity', 0, 1, 0.01, 1),
    ],
  },
  counter: {
    type: 'counter', label: 'Counter / Ticker', category: 'source',
    obj: { in: false, out: true }, value: false,
    params: [
      N('from', 'From', -1e9, 1e9, 1, 0),
      N('to', 'To', -1e9, 1e9, 1, 100),
      N('startFrame', 'Start f', 0, 6000, 1, 0),
      N('endFrame', 'End f', 0, 6000, 1, 60),
      { key: 'ease', label: 'Ease', type: 'select', options: EASE_OPTIONS, default: 'easeOut' },
      N('decimals', 'Decimals', 0, 4, 1, 0),
      { key: 'thousands', label: 'Thousands', type: 'select', options: ['off', 'on'], default: 'off' },
      { key: 'prefix', label: 'Prefix', type: 'text', default: '' },
      { key: 'suffix', label: 'Suffix', type: 'text', default: '' },
      { key: 'font', label: 'Font', type: 'select', options: FONT_OPTIONS, default: 'JetBrains Mono' },
      { key: 'fill', label: 'Fill', type: 'color', default: '#ffffff' },
      N('size', 'Size', 4, 800, 1, 120),
      N('x', 'X', -2000, 2000, 1, 0),
      N('y', 'Y', -2000, 2000, 1, 0),
      N('opacity', 'Opacity', 0, 1, 0.01, 1),
    ],
  },
  backdrop: {
    type: 'backdrop', label: 'Backdrop', category: 'source',
    obj: { in: false, out: true }, value: false,
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['solid', 'linear', 'radial'], default: 'linear' },
      { key: 'colorA', label: 'Color A', type: 'color', default: '#1a1a22' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#0a0a0e' },
      N('angle', 'Angle', 0, 360, 1, 90),
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

  // ── Time-domain modifiers (unlock 4: re-sample upstream at a warped frame) ──────
  echo: {
    type: 'echo', label: 'Echo / Trails', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('copies', 'Copies', 1, 30, 1, 5),
      N('frameDelay', 'Delay f', 1, 60, 1, 3),
      N('opacityFalloff', 'Opacity ×', 0, 1, 0.01, 0.7),
      N('scaleFalloff', 'Scale ×', 0.5, 1.2, 0.01, 1),
      { key: 'mode', label: 'Mode', type: 'select', options: ['echo', 'onion-skin'], default: 'echo' },
    ],
  },
  strobe: {
    type: 'strobe', label: 'Stop-Motion / Strobe', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('step', 'Step f', 1, 30, 1, 2),
      N('phase', 'Phase f', 0, 60, 1, 0),
      N('jitter', 'Jitter f', 0, 20, 1, 0),
    ],
  },
  loop: {
    type: 'loop', label: 'Loop / Boomerang', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['cycle', 'mirror'], default: 'cycle' },
      N('loopFrames', 'Loop f', 1, 600, 1, 60),
    ],
  },
  timeRemap: {
    type: 'timeRemap', label: 'Time Remap', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['remap', 'freeze', 'reverse', 'speed'], default: 'speed' },
      N('inFrame', 'In f', 0, 6000, 1, 0),
      N('outFrame', 'Out f', 0, 6000, 1, 90),
      N('speed', 'Speed', -4, 4, 0.01, 1),
      { key: 'ease', label: 'Ease', type: 'select', options: EASE_OPTIONS, default: 'easeInOut' },
    ],
  },
  shatter: {
    type: 'shatter', label: 'Shatter / Assemble', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('progress', 'Progress', 0, 1, 0.01, 0.5),   // drive with a Ramp
      N('cols', 'Columns', 1, 24, 1, 5),
      N('rows', 'Rows', 1, 24, 1, 5),
      N('spread', 'Spread', 0, 2000, 1, 400),
      N('rotateChaos', 'Rotate chaos', 0, 360, 1, 60),
      N('gravity', 'Gravity', -2000, 2000, 10, 0),
      { key: 'direction', label: 'Direction', type: 'select', options: ['out', 'in'], default: 'out' },
      N('seed', 'Seed', 0, 9999, 1, 1),
    ],
  },
  sort: {
    type: 'sort', label: 'Sort / Layer', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['by-index', 'reverse', 'by-Y', 'by-Y-desc'], default: 'by-Y' },
    ],
  },
  camera: {
    type: 'camera', label: 'Camera', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('x', 'Pan X', -2000, 2000, 1, 0),
      N('y', 'Pan Y', -2000, 2000, 1, 0),
      N('zoom', 'Zoom', 0.05, 10, 0.01, 1),
      N('rotate', 'Rotate', -1080, 1080, 1, 0),
      N('anchorX', 'Anchor X', -2000, 2000, 1, 0),
      N('anchorY', 'Anchor Y', -2000, 2000, 1, 0),
    ],
  },
  switch: {
    type: 'switch', label: 'Switch / Selector', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('index', 'Index', 0, 32, 1, 0),
    ],
  },
  scramble: {
    type: 'scramble', label: 'Scramble / Decode', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('startFrame', 'Start f', 0, 6000, 1, 0),
      N('duration', 'Duration f', 1, 600, 1, 30),
      { key: 'charset', label: 'Charset', type: 'select', options: ['alphanumeric', 'letters', 'symbols', 'binary', 'katakana'], default: 'alphanumeric' },
      { key: 'settleOrder', label: 'Order', type: 'select', options: ['left-right', 'right-left', 'center-out', 'random'], default: 'left-right' },
      N('speed', 'Cycle f', 1, 20, 1, 2),
      N('seed', 'Seed', 0, 9999, 1, 1),
    ],
  },
  particles: {
    type: 'particles', label: 'Particle System', category: 'modifier',
    obj: { in: true, out: true }, value: false,
    params: [
      N('startFrame', 'Start f', 0, 6000, 1, 0),
      N('rate', 'Rate /s', 0, 200, 1, 30),
      N('lifespan', 'Lifespan f', 1, 600, 1, 40),
      { key: 'emitShape', label: 'Emit', type: 'select', options: ['point', 'line', 'circle'], default: 'point' },
      N('emitSize', 'Emit size', 0, 1000, 1, 0),
      N('direction', 'Direction °', -360, 360, 1, 0),
      N('spread', 'Spread °', 0, 360, 1, 40),
      N('velocity', 'Velocity', 0, 100, 0.5, 8),
      N('gravity', 'Gravity', -10, 10, 0.1, 0.3),
      N('rotateVel', 'Spin /f', -60, 60, 1, 0),
      N('scaleStart', 'Scale start', 0, 5, 0.01, 0.5),
      N('scaleEnd', 'Scale end', 0, 5, 0.01, 0.1),
      N('opacityStart', 'Opacity start', 0, 1, 0.01, 1),
      N('opacityEnd', 'Opacity end', 0, 1, 0.01, 0),
      N('maxParticles', 'Max', 1, 1000, 1, 200),
      N('seed', 'Seed', 0, 9999, 1, 1),
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

  // ── Color value nodes (color-value socket unlock) ──────────────────────────────
  colorSwatch: {
    type: 'colorSwatch', label: 'Color Swatch', category: 'value', vtype: 'color',
    obj: { in: false, out: false }, value: true,
    params: [
      { key: 'color', label: 'Color', type: 'color', default: '#ff7849' },
      N('alpha', 'Alpha', 0, 1, 0.01, 1),
    ],
  },
  gradientMap: {
    type: 'gradientMap', label: 'Gradient Map', category: 'value', vtype: 'color',
    obj: { in: false, out: false }, value: true,
    params: [
      N('input', 'Input 0-1', 0, 1, 0.01, 0.5),
      { key: 'colorA', label: 'Color A', type: 'color', default: '#000000' },
      { key: 'colorB', label: 'Color B', type: 'color', default: '#ff7849' },
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
  { group: 'Sources',   types: ['icon', 'wordmark', 'shape', 'text', 'counter', 'backdrop'] },
  { group: 'Modifiers', types: ['transform', 'array', 'mirror', 'wiggle', 'clip', 'physics', 'echo', 'strobe', 'loop', 'timeRemap', 'particles', 'shatter', 'sort', 'camera', 'switch', 'scramble'] },
  { group: 'Appearance', types: ['tint', 'blur', 'glow', 'dropShadow', 'blend', 'dither', 'glitch'] },
  { group: 'Values',    types: ['ramp', 'lfo', 'spring', 'keyframes', 'constant', 'time', 'noise', 'pulse', 'randomHold'] },
  { group: 'Color',     types: ['colorSwatch', 'gradientMap'] },
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
