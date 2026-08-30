// ── Palette store — module-level pub/sub, persisted to localStorage ───────────
import { useEffect, useState } from 'react'
import { toOklch, toHex, oklchToHex, lumaHex, oklchForLuma } from '../../lib/color.js'
import { markDirty } from '../../lib/unsavedChanges.js'

const TOOL_ID = 'color-palette'

const KEY = 'designtools-colorpalette'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

function mkId() { return Math.random().toString(36).slice(2, 9) }

function defaultSwatch(hex = '#5ab4ff', role = 'freeform', meta = {}) {
  const oklch = toOklch(hex)
  return { id: mkId(), hex, oklch, name: meta.name || '', role, material: meta.material || '', locked: false, spotColor: false, history: [] }
}

const DEFAULT_STATE = {
  swatches: [
    defaultSwatch('#1a1a2e', 'black'),
    defaultSwatch('#16213e', 'main'),
    defaultSwatch('#5ab4ff', 'accent'),
    defaultSwatch('#f0f0f0', 'white'),
  ],
  active: null,
  printProfile: 'FOGRA39',
  valueLockEnabled: false,
  hueLockEnabled: false,
  risoMode: false,
  risoInks: [],
  mode: 'design',  // 'design' | 'illustration'
}

function savedState() {
  const s = load()
  const merged = { ...DEFAULT_STATE, ...s }
  // Repair anything persisted by an older build. `oklch` and `history` were both
  // added after the first release, and a swatch missing `oklch` throws the moment
  // any panel sorts by lightness — which several of the Check panels now do.
  // Derived from the hex, so it costs nothing and can't be wrong.
  merged.swatches = (merged.swatches ?? []).map(sw => ({
    ...sw,
    oklch: sw.oklch && typeof sw.oklch.l === 'number' ? sw.oklch : toOklch(sw.hex),
    history: Array.isArray(sw.history) ? sw.history : [],
    role: sw.role ?? 'freeform',
  }))
  return merged
}

let _state = { ...savedState(), selected: [] }
if (!_state.active && _state.swatches.length) _state.active = _state.swatches[0].id

const _listeners = new Set()

// ── Undo / redo ───────────────────────────────────────────────────────────────
let _history = []
let _histIdx = -1
let _isApplying = false
let _histDebounce = null

function snapState(s) {
  const { selected, ...rest } = s
  return JSON.parse(JSON.stringify(rest))
}

function pushHistory() {
  if (_isApplying) return
  clearTimeout(_histDebounce)
  _histDebounce = setTimeout(() => {
    const next = _history.slice(0, _histIdx + 1)
    next.push(snapState(_state))
    if (next.length > 100) next.shift()
    _history = next
    _histIdx = next.length - 1
  }, 400)
}

export function undo() {
  if (_histIdx <= 0) return
  _isApplying = true
  _histIdx--
  _state = { ..._state, ...JSON.parse(JSON.stringify(_history[_histIdx])) }
  notify()
  _isApplying = false
}

export function redo() {
  if (_histIdx >= _history.length - 1) return
  _isApplying = true
  _histIdx++
  _state = { ..._state, ...JSON.parse(JSON.stringify(_history[_histIdx])) }
  notify()
  _isApplying = false
}
// ─────────────────────────────────────────────────────────────────────────────

function notify() {
  // Don't persist ephemeral selection state
  const { selected, ...toSave } = _state
  localStorage.setItem(KEY, JSON.stringify(toSave))
  markDirty(TOOL_ID)
  for (const fn of _listeners) fn(_state)
}

function setState(patch) {
  _state = { ..._state, ...patch }
  notify()
  pushHistory()
}

// Seed initial history snapshot after a tick so module init is complete
setTimeout(() => {
  if (_history.length === 0) {
    _history = [snapState(_state)]
    _histIdx = 0
  }
}, 0)

export function getState() { return _state }

export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function usePalette() {
  const [s, set] = useState(_state)
  useEffect(() => subscribe(set), [])
  return s
}

// ── Swatch mutations ──────────────────────────────────────────────────────────

export function addSwatch(hex = '#808080', role = 'freeform', meta = {}) {
  const sw = defaultSwatch(hex, role, meta)
  setState({ swatches: [..._state.swatches, sw], active: sw.id })
}

export function removeSwatch(id) {
  const swatches = _state.swatches.filter(s => s.id !== id)
  const active = swatches.find(s => s.id === _state.active)?.id ?? swatches[0]?.id ?? null
  setState({ swatches, active })
}

export function duplicateSwatch(id) {
  const src = _state.swatches.find(s => s.id === id)
  if (!src) return
  const sw = { ...src, id: mkId(), history: [] }
  const idx = _state.swatches.findIndex(s => s.id === id)
  const swatches = [..._state.swatches]
  swatches.splice(idx + 1, 0, sw)
  setState({ swatches, active: sw.id })
}

export function setActive(id) {
  setState({ active: id })
}

export function updateSwatch(id, patch) {
  const swatches = _state.swatches.map(s => {
    if (s.id !== id) return s
    // Per-swatch lock: block color changes, allow metadata (name, role, locked, spotColor)
    if (s.locked && (patch.hex || patch.oklch)) {
      const { hex, oklch, history, ...meta } = patch
      if (!Object.keys(meta).length) return s
      patch = meta
    }
    // An explicit oklch patch (from the Picker / BG Check) already carries the
    // value/hue lock resolved at full float precision. Re-applying the lock here
    // would solve a *second* time against the quantised hex luma — and once a dark
    // colour's hex rounds to #000000, lumaHex is exactly 0, pinning L to 0 and
    // sticking the swatch on black. So only the hex-derived path re-applies locks.
    const explicitOklch = !!(patch.oklch && !patch.hex)
    // If hex is being updated, keep oklch in sync
    if (patch.hex && !patch.oklch) {
      patch = { ...patch, oklch: toOklch(patch.hex) }
    }
    // If oklch is being updated, keep hex in sync
    if (patch.oklch && !patch.hex) {
      patch = { ...patch, hex: oklchToHex(patch.oklch.l, patch.oklch.c, patch.oklch.h) }
    }
    // Apply locks for hex-originated edits. Hue lock pins H. Value lock holds the
    // *perceived* value (greyscale luma) constant — it re-solves L for the new
    // hue/chroma so the swatch greyscales identically no matter how you move it.
    if (patch.oklch && !explicitOklch) {
      let { l, c, h } = patch.oklch
      if (_state.hueLockEnabled) h = s.oklch.h
      if (_state.valueLockEnabled) {
        const solved = oklchForLuma(lumaHex(s.hex), c, h)
        l = solved.l; c = solved.c
      }
      patch = { ...patch, oklch: { l, c, h }, hex: oklchToHex(l, c, h) }
    }
    const history = patch.hex !== s.hex ? [s.hex, ...s.history].slice(0, 10) : s.history
    return { ...s, ...patch, history }
  })
  setState({ swatches })
}

export function reorderSwatches(from, to) {
  const swatches = [..._state.swatches]
  const [item] = swatches.splice(from, 1)
  swatches.splice(to, 0, item)
  setState({ swatches })
}

export function setMode(mode) { setState({ mode }) }
export function setPrintProfile(id) { setState({ printProfile: id }) }
export function setValueLock(v) { setState({ valueLockEnabled: v }) }
export function setHueLock(v) { setState({ hueLockEnabled: v }) }
export function setRisoMode(v) { setState({ risoMode: v }) }
export function setRisoInks(inks) { setState({ risoInks: inks }) }

// ── Multi-select ──────────────────────────────────────────────────────────────

export function toggleSelected(id) {
  const sel = _state.selected
  setState({ selected: sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id] })
}

export function setSelected(ids) {
  setState({ selected: ids })
}

export function clearSelected() {
  setState({ selected: [] })
}

export function bulkRemove(ids) {
  const set = new Set(ids)
  const swatches = _state.swatches.filter(s => !set.has(s.id))
  const active = swatches.find(s => s.id === _state.active)?.id ?? swatches[0]?.id ?? null
  setState({ swatches, active, selected: [] })
}

export function bulkUpdate(ids, patch) {
  const set = new Set(ids)
  setState({ swatches: _state.swatches.map(s => set.has(s.id) ? { ...s, ...patch } : s) })
}

export function resetPalette() {
  setState({ ...DEFAULT_STATE, active: DEFAULT_STATE.swatches[0]?.id ?? null })
}

// ── Cross-tool send ───────────────────────────────────────────────────────────
// Writes selected swatches into a shared cross-tool key
const CROSS_TOOL_KEY = 'designtools-shared-colors'

export function sendToTool(toolId, hexArray) {
  try {
    const existing = JSON.parse(localStorage.getItem(CROSS_TOOL_KEY) || '{}')
    localStorage.setItem(CROSS_TOOL_KEY, JSON.stringify({ ...existing, [toolId]: hexArray }))
  } catch {}
}

export function getSharedColors(toolId) {
  try {
    const d = JSON.parse(localStorage.getItem(CROSS_TOOL_KEY) || '{}')
    return d[toolId] ?? []
  } catch { return [] }
}
