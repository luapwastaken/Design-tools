// ── Post-FX tool store — module-level pub/sub, persisted to localStorage ────────
//
// Holds the working effect stack plus the user's saved-preset library. Mirrors
// the lightweight store pattern used by the Dither tool: only the *library*
// (saved presets) persists across sessions; the working stack is ephemeral and
// resets on reload unless saved as a preset.

import { useEffect, useState } from 'react'
import { markDirty } from '../../lib/unsavedChanges.js'
import { defaultLayer } from './effects.js'

const KEY = 'designtools-postfx'
const SHARED_IMAGE_KEY = 'designtools-shared-image'   // cross-tool image hand-off
export const TOOL_ID = 'post-fx'

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { savedPresets: d.savedPresets || [] }
  } catch { return {} }
}

function mkId() { return Math.random().toString(36).slice(2, 9) }

const DEFAULT_STATE = {
  stack: [],          // [{ id, type, enabled, opacity, blend, params{} }]
  selectedId: null,   // layer currently open in the controls panel
  selectedPresetId: null,  // applied preset (cleared once the stack diverges)
  animate: false,     // drive uTime for animated effects (glitch/grain/vhs/wave)
  animSpeed: 1,
  savedPresets: [],   // [{ id, name, stack:[...] }]
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
export function canUndo() { return _histIdx > 0 }
export function canRedo() { return _histIdx < _history.length - 1 }

function notify() {
  localStorage.setItem(KEY, JSON.stringify({ savedPresets: _state.savedPresets }))
  markDirty(TOOL_ID)
  for (const fn of _listeners) fn(_state)
}

export function getState() { return _state }

export function setState(patch) {
  // Any change that doesn't explicitly carry a preset id diverges from the
  // applied preset — clear the selection so the picker shows "Custom" (mirrors
  // the Dither tool). applyPreset / saveCurrentPreset pass it through.
  if (!('selectedPresetId' in patch)) patch = { ...patch, selectedPresetId: null }
  _state = { ..._state, ...patch }
  notify()
  pushHistory()
}

export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function usePostFX() {
  const [s, set] = useState(_state)
  useEffect(() => subscribe(set), [])
  return s
}

// ── Stack operations ───────────────────────────────────────────────────────────
export function addEffect(type) {
  const layer = defaultLayer(type)
  setState({ stack: [..._state.stack, layer], selectedId: layer.id })
  return layer.id
}

export function removeEffect(id) {
  const stack = _state.stack.filter(l => l.id !== id)
  const selectedId = _state.selectedId === id ? (stack[stack.length - 1]?.id ?? null) : _state.selectedId
  setState({ stack, selectedId })
}

export function updateLayer(id, patch) {
  setState({ stack: _state.stack.map(l => l.id === id ? { ...l, ...patch } : l) })
}

export function setLayerParam(id, key, value) {
  setState({
    stack: _state.stack.map(l => l.id === id ? { ...l, params: { ...l.params, [key]: value } } : l),
  })
}

export function toggleLayer(id) {
  updateLayer(id, { enabled: !_state.stack.find(l => l.id === id)?.enabled })
}

// Pure UI selection — preserve the applied-preset highlight (no divergence).
export function selectLayer(id) { setState({ selectedId: id, selectedPresetId: _state.selectedPresetId }) }

export function moveLayer(id, dir) {
  const stack = [..._state.stack]
  const i = stack.findIndex(l => l.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= stack.length) return
  ;[stack[i], stack[j]] = [stack[j], stack[i]]
  setState({ stack })
}

// Reorder by moving the layer at `from` to index `to` (drag & drop).
export function reorderLayer(from, to) {
  if (from === to) return
  const stack = [..._state.stack]
  const [moved] = stack.splice(from, 1)
  stack.splice(to, 0, moved)
  setState({ stack })
}

export function duplicateLayer(id) {
  const src = _state.stack.find(l => l.id === id)
  if (!src) return
  const copy = { ...JSON.parse(JSON.stringify(src)), id: mkId() }
  const i = _state.stack.findIndex(l => l.id === id)
  const stack = [..._state.stack]
  stack.splice(i + 1, 0, copy)
  setState({ stack, selectedId: copy.id })
}

export function clearStack() { setState({ stack: [], selectedId: null }) }

export function resetState() {
  setState({ stack: [], selectedId: null, animate: false, animSpeed: 1 })
}

// ── Presets ────────────────────────────────────────────────────────────────────
export function saveCurrentPreset(name) {
  const p = { id: mkId(), name: name || 'Preset', stack: JSON.parse(JSON.stringify(_state.stack)) }
  setState({ savedPresets: [..._state.savedPresets, p], selectedPresetId: p.id })
  return p.id
}

export function applyPreset(preset) {
  const stack = (preset.stack || []).map(l => ({ ...JSON.parse(JSON.stringify(l)), id: mkId() }))
  setState({ stack, selectedId: stack[stack.length - 1]?.id ?? null, selectedPresetId: preset.id ?? null })
}

export function removeSavedPreset(id) {
  setState({ savedPresets: _state.savedPresets.filter(p => p.id !== id) })
}

// ── Cross-tool image hand-off ──────────────────────────────────────────────────
// Other tools (e.g. Dither) drop a PNG dataURL under this tool's bucket; we read
// it once on mount and clear it so we don't re-import on every visit.
export function getIncomingImage() {
  try {
    const d = JSON.parse(localStorage.getItem(SHARED_IMAGE_KEY) || '{}')
    return d[TOOL_ID] || null
  } catch { return null }
}

export function clearIncomingImage() {
  try {
    const d = JSON.parse(localStorage.getItem(SHARED_IMAGE_KEY) || '{}')
    delete d[TOOL_ID]
    localStorage.setItem(SHARED_IMAGE_KEY, JSON.stringify(d))
  } catch {}
}

// Called by the *sending* tool (Dither) to push its current result here.
export function sendImageToPostFX(dataUrl) {
  try {
    const d = JSON.parse(localStorage.getItem(SHARED_IMAGE_KEY) || '{}')
    d[TOOL_ID] = dataUrl
    localStorage.setItem(SHARED_IMAGE_KEY, JSON.stringify(d))
  } catch {}
}
