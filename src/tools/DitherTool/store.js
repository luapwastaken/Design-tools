// ── Dither tool store — module-level pub/sub, persisted to localStorage ─────────
//
// Holds the processing settings and the user's saved-palette library. Mirrors the
// lightweight store pattern used by the Color Palette tool.

import { useEffect, useState } from 'react'
import { BUILTIN_PALETTES } from './palettes.js'
import { markDirty } from '../../lib/unsavedChanges.js'

const KEY = 'designtools-dither'
const CROSS_TOOL_KEY = 'designtools-shared-colors'   // shared with Color Palette
export const TOOL_ID = 'dither-maker'

// Only the user's *libraries* (saved palettes + presets) persist across sessions.
// Working settings are intentionally ephemeral — they reset to defaults on reload
// unless the user explicitly saves them as a preset.
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { savedPalettes: d.savedPalettes || [], savedPresets: d.savedPresets || [] }
  } catch { return {} }
}

function mkId() { return Math.random().toString(36).slice(2, 9) }

const DEFAULT_STATE = {
  // processing
  algorithm: 'floyd-steinberg',
  mode: 'mono',          // 'mono' | 'tonal' | 'indexed' | 'rgb'
  levels: 4,             // tonal steps / rgb levels-per-channel
  spread: 1,             // ordered dither strength
  strength: 1,           // error-diffusion amount
  serpentine: true,
  paletteId: 'bw',       // selected palette (builtin id or saved id)
  invert: false,
  // adjustments
  brightness: 0,         // -100..100
  contrast: 0,           // -100..100
  blur: 0,               // px
  sharpen: 0,            // 0..1
  denoise: 0,            // -1..1 (negative = add noise)
  resolution: 320,       // working long-edge px (the "pixel size" control)
  sizeMode: 'detail',    // 'detail' (resolution px) | 'pixel' (pixelSize-driven blocks)
  pixelSize: 4,          // px per output block in 'pixel' sizing mode
  gradMap: false,        // map luminance → palette ramp before quantising
  gradStops: null,       // optional [pos…] aligned to the sorted palette (null = even)
  jitter: 0,             // 0..1 ordered-screen threshold jitter (grittier dither)
  phaseAnim: false,      // animate the ordered-screen origin (shimmer) on the live path
  // subject / region mask — limit the effect to a luma band, show original elsewhere
  maskOn: false,
  maskMode: 'luma',      // 'luma' (tone band) | 'subject' (distance from background luma)
  maskRaw: false,        // composite against the raw original (vs the adjusted source)
  maskLo: 0,             // band low edge / subject sensitivity (luma 0..1)
  maskHi: 1,             // band high edge (luma 0..1)
  maskFeather: 0.1,      // soft edge width
  maskInvert: false,     // flip which side keeps the effect
  // levels / tone
  levelsLow: 0,          // input black point 0..1
  levelsHigh: 1,         // input white point 0..1
  levelsGamma: 1,        // midtone gamma
  posterize: 0,          // 0 = off, else N steps
  // halftone
  halftone: false,
  inkMode: 'mono',       // 'mono' | 'cmyk' | 'palette'
  htDpi: 120,            // single intuitive control: dots across long edge (drives res + cell)
  dpi: 150,              // legacy
  lpi: 30,               // legacy
  htAlgo: 'circle',      // circle|square|diamond|triangle|hexagon|ring|line|stochastic
  htGamma: 1,            // tone curve for dot growth (lower = darker mids)
  htDotSize: 1,          // dot size multiplier (1.0 → solid at full tone)
  htReg: 0,              // 0..1 registration misalignment between ink layers (riso feel)
  htDotGain: 0,          // 0..1 ink spread — enlarges every dot (printed look)
  htPaperGrain: 0,       // 0..1 paper-texture noise over the composite
  htFreqVary: 0,         // 0..1 per-ink cell-size variation (moiré control)
  cell: 6,               // legacy (CPU fallback)
  htAngle: 45,
  htShape: 'round',
  htScale: 4,
  angC: 15, angM: 75, angY: 0, angK: 45,
  paperColor: '#ffffff',
  paperTransparent: false,
  htDisabled: [],        // layer keys toggled off in halftone separations
  inkCtl: {},            // per-ink { pos (tonal 0..1), spread (0..1), intensity (0..2) }, keyed by ink key
  // colour controls
  hue: 0,                // -180..180 degrees
  saturation: 0,         // -100..100
  // smart resampling
  resample: 'nearest',   // 'nearest' | 'bilinear' (input scaling)
  edgeShape: 'square',   // 'square' | 'round' | 'diamond' (output cell shape)
  gapColor: '#000000',   // fill behind round/diamond cells
  // post-processing
  post: false,           // master toggle
  glow: true, glowAmt: 0.8, glowThreshold: 0.6, glowTint: '#ffffff',
  crt: false, scan: 0.4, scanCount: 240, curve: 0, vignette: 0.3,
  crtMask: 'none', crtMaskAmt: 0.5,   // phosphor mask: none | aperture | shadow
  chroma: false, chromaAmt: 1,
  glitch: false, glitchAmt: 0.4,      // horizontal slice / RGB-shift
  grain: false, grainAmt: 0.3, grainSize: 1.5,
  grade: false, temp: 0, tint: 0,     // colour grade: temperature / green-magenta
  streak: false, streakAmt: 0.8,      // anamorphic horizontal bloom streaks
  edge: false, edgeAmt: 0.8, edgeThresh: 0.2, edgeColor: '#000000',  // ink outline
  wave: false, waveAmt: 0.3, waveFreq: 10, waveAxis: 'h',            // displacement warp
  vhs: false, vhsAmt: 0.5,            // analog tape composite
  animate: false, animSpeed: 1,       // live-animate glitch/grain/warp/VHS
  // saved palette library + presets
  savedPalettes: [],     // [{ id, name, colors:[hex] }]
  savedPresets: [],      // [{ id, name, settings:{...} }]
  presetId: '',          // currently-applied preset (cleared once settings diverge)
}

let _state = { ...DEFAULT_STATE, ...load() }
const _listeners = new Set()

// ── Undo / redo ───────────────────────────────────────────────────────────────
// Debounced snapshots of the whole settings object (cheap — it's small JSON).
let _history = []
let _histIdx = -1
let _applying = false
let _debounce = null

function snap() { return JSON.parse(JSON.stringify(_state)) }

function pushHistory() {
  if (_applying) return
  clearTimeout(_debounce)
  _debounce = setTimeout(() => {
    const next = _history.slice(0, _histIdx + 1)
    next.push(snap())
    if (next.length > 80) next.shift()
    _history = next
    _histIdx = next.length - 1
  }, 350)
}

setTimeout(() => { if (!_history.length) { _history = [snap()]; _histIdx = 0 } }, 0)

export function undo() {
  if (_histIdx <= 0) return
  _applying = true; _histIdx--
  _state = JSON.parse(JSON.stringify(_history[_histIdx])); notify()
  _applying = false
}
export function redo() {
  if (_histIdx >= _history.length - 1) return
  _applying = true; _histIdx++
  _state = JSON.parse(JSON.stringify(_history[_histIdx])); notify()
  _applying = false
}
export function canUndo() { return _histIdx > 0 }
export function canRedo() { return _histIdx < _history.length - 1 }

function notify() {
  // Persist libraries only — never the working settings.
  localStorage.setItem(KEY, JSON.stringify({ savedPalettes: _state.savedPalettes, savedPresets: _state.savedPresets }))
  markDirty(TOOL_ID)
  for (const fn of _listeners) fn(_state)
}

export function getState() { return _state }

export function setState(patch) {
  // Any manual edit diverges from the applied preset — clear the selection so the
  // picker shows "Custom" (applyPreset passes presetId explicitly to keep it).
  if (!('presetId' in patch)) patch = { ...patch, presetId: '' }
  _state = { ..._state, ...patch }
  notify()
  pushHistory()
}

// Per-ink tonal/intensity control (merge patch into the ink's entry).
export function setInkCtl(key, patch) {
  const cur = _state.inkCtl[key] || {}
  setState({ inkCtl: { ..._state.inkCtl, [key]: { ...cur, ...patch } } })
}

export function resetState() {
  setState({ ...DEFAULT_STATE, savedPalettes: _state.savedPalettes, savedPresets: _state.savedPresets, paletteId: _state.paletteId })
}

export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function useDither() {
  const [s, set] = useState(_state)
  useEffect(() => subscribe(set), [])
  return s
}

// ── Palette library ─────────────────────────────────────────────────────────────

// All palettes available for selection: builtins + saved.
export function allPalettes() {
  return [...BUILTIN_PALETTES, ..._state.savedPalettes]
}

export function getPalette(id) {
  return allPalettes().find(p => p.id === id) || BUILTIN_PALETTES[0]
}

export function savePalette(name, colors) {
  const p = { id: mkId(), name: name || 'Palette', colors }
  setState({ savedPalettes: [..._state.savedPalettes, p], paletteId: p.id })
  return p.id
}

export function updateSavedPalette(id, patch) {
  setState({ savedPalettes: _state.savedPalettes.map(p => p.id === id ? { ...p, ...patch } : p) })
}

export function removeSavedPalette(id) {
  const savedPalettes = _state.savedPalettes.filter(p => p.id !== id)
  const paletteId = _state.paletteId === id ? 'bw' : _state.paletteId
  setState({ savedPalettes, paletteId })
}

// ── Presets ─────────────────────────────────────────────────────────────────────
// A preset is a named bundle of visual settings (+ an optional inline palette).
const PRESET_KEYS = [
  'algorithm', 'mode', 'levels', 'spread', 'strength', 'serpentine', 'invert',
  'brightness', 'contrast', 'blur', 'sharpen', 'denoise', 'resolution',
  'sizeMode', 'pixelSize', 'gradMap', 'gradStops', 'jitter', 'phaseAnim',
  'maskOn', 'maskMode', 'maskRaw', 'maskLo', 'maskHi', 'maskFeather', 'maskInvert',
  'levelsLow', 'levelsHigh', 'levelsGamma', 'posterize',
  'halftone', 'inkMode', 'cell', 'htAngle', 'htShape', 'htScale',
  'htDpi', 'dpi', 'lpi', 'htAlgo', 'htGamma', 'htDotSize', 'paperColor', 'paperTransparent', 'inkCtl',
  'htReg', 'htDotGain', 'htPaperGrain', 'htFreqVary',
  'hue', 'saturation', 'resample', 'edgeShape', 'gapColor',
  'post', 'glow', 'glowAmt', 'glowThreshold', 'glowTint',
  'crt', 'scan', 'scanCount', 'curve', 'vignette', 'crtMask', 'crtMaskAmt',
  'chroma', 'chromaAmt',
  'glitch', 'glitchAmt', 'grain', 'grainAmt', 'grainSize', 'grade', 'temp', 'tint',
  'streak', 'streakAmt', 'edge', 'edgeAmt', 'edgeThresh', 'edgeColor',
  'wave', 'waveAmt', 'waveFreq', 'waveAxis', 'vhs', 'vhsAmt', 'animate', 'animSpeed',
  'paletteId',
]

export function applyPreset(preset) {
  const patch = {}
  for (const k of PRESET_KEYS) if (preset.settings && k in preset.settings) patch[k] = preset.settings[k]
  if (preset.palette && preset.palette.length) {
    let pal = _state.savedPalettes.find(p => p.name === preset.name)
    if (!pal) {
      pal = { id: mkId(), name: preset.name, colors: preset.palette }
      patch.savedPalettes = [..._state.savedPalettes, pal]
    }
    patch.paletteId = pal.id
  }
  patch.presetId = preset.id   // keep the selection (setState clears it otherwise)
  setState(patch)
}

export function saveCurrentPreset(name) {
  const settings = {}
  for (const k of PRESET_KEYS) settings[k] = _state[k]
  const p = { id: mkId(), name: name || 'Preset', settings }
  setState({ savedPresets: [..._state.savedPresets, p], presetId: p.id })
  return p.id
}

export function removeSavedPreset(id) {
  setState({ savedPresets: _state.savedPresets.filter(p => p.id !== id) })
}

// ── Cross-tool receive ──────────────────────────────────────────────────────────
// Colours pushed from the Color Palette tool land under the shared key. Read them
// on demand (the tool remounts when selected, so this runs fresh each visit).
export function getIncomingColors() {
  try {
    const d = JSON.parse(localStorage.getItem(CROSS_TOOL_KEY) || '{}')
    return d[TOOL_ID] ?? []
  } catch { return [] }
}

// Clear the incoming bucket once consumed so we don't re-prompt every visit.
export function clearIncomingColors() {
  try {
    const d = JSON.parse(localStorage.getItem(CROSS_TOOL_KEY) || '{}')
    delete d[TOOL_ID]
    localStorage.setItem(CROSS_TOOL_KEY, JSON.stringify(d))
  } catch {}
}
