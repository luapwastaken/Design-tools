// ── Lineart tool store — module-level pub/sub, persisted to localStorage ───────
//
// Holds the processing settings (persisted so a user's scan setup survives a
// reload). The loaded image itself is ephemeral. Mirrors the lightweight store
// pattern used by the Dither / Post FX tools, including debounced undo history.

import { useEffect, useState } from 'react'

const KEY = 'designtools-lineart'
export const TOOL_ID = 'lineart'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export const DEFAULT_STATE = {
  // input
  channel: 'luma',        // 'luma' | 'red' | 'green' | 'blue'
  invert: false,          // scan is negative (white lines on dark)
  // clean-up
  flatten: true,          // remove paper shading / uneven lighting
  flattenRadius: 80,      // blur radius for background estimate, native px
  flattenStrength: 1,
  despeckleSize: 6,       // remove ink islands smaller than this many px²
  // levels
  levelLow: 0.1,
  levelHigh: 0.9,
  gamma: 1,
  // line extraction
  mode: 'soft',           // 'soft' | 'hard' | 'adaptive'
  threshold: 50,          // %
  softness: 10,           // % (soft mode ramp width)
  blockSize: 40,          // adaptive local-mean radius, native px
  offset: 8,              // % below local mean to count as ink
  // quick controls
  lineWeight: 0,          // thicken (+) / thin (−) strokes, native px
  cleanup: 30,            // macro 0..100 → drives despeckleSize + lineSmooth
  showAdvanced: false,    // fine-tune sections expanded
  // line quality (vector smoothing — drives preview + PNG + SVG alike)
  outputMode: 'vector',   // 'vector' (clean traced shapes) | 'raster' (keep pencil texture)
  lineSmooth: 1.5,        // mask blur+rethreshold radius, native px
  svgSimplify: 1,         // trace simplify tolerance, px
  svgSmooth: 2,           // chaikin corner-rounding passes
  // output
  lineColor: '#1a1a1a',
  bgMode: 'transparent',  // 'transparent' | 'white' | 'custom'
  bgColor: '#ffffff',
}

let _state = { ...DEFAULT_STATE, ...load() }
const _listeners = new Set()

// ── Undo / redo (debounced full-state snapshots) ───────────────────────────────
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

function notify() {
  localStorage.setItem(KEY, JSON.stringify(_state))
  for (const fn of _listeners) fn(_state)
}

export function getState() { return _state }

export function setState(patch) {
  _state = { ..._state, ...patch }
  notify()
  pushHistory()
}

export function resetState() { setState({ ...DEFAULT_STATE }) }

export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function useLineart() {
  const [s, set] = useState(_state)
  useEffect(() => subscribe(set), [])
  return s
}
