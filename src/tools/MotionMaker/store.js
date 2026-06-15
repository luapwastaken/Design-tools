// ── Motion Maker — document store ──────────────────────────────────────────────
//
// Module-level pub/sub store (same shape as PostFX/store.js). Holds the working
// MotionDoc (canvas, fps, frame range, nodes, edges) plus the user's saved-preset
// library, with debounced undo/redo snapshots and localStorage autosave. The
// transport `frame` is NOT kept here — it changes every rAF tick during playback,
// so it lives as ephemeral component state to avoid store/autosave churn.

import { useEffect, useState } from 'react'
import { markDirty } from '../../lib/unsavedChanges.js'
import { defaultParams, makeNodeId, NODE_DEFS } from './nodes.js'
import { computeLayout, BOTH_LAYOUTS } from '../LogoMaker/layout.js'

const KEY = 'designtools-motion'
const SHARED_LOGO_KEY = 'designtools-shared-motion'   // structured Logo hand-off
export const TOOL_ID = 'motion-maker'

// ── Default document ─────────────────────────────────────────────────────────────
function starterDoc() {
  const scene = { id: makeNodeId('scene'), type: 'scene', pos: { x: 620, y: 120 }, params: {} }
  const icon = { id: makeNodeId('icon'), type: 'icon', pos: { x: 120, y: 60 }, params: defaultParams('icon') }
  const wordmark = { id: makeNodeId('wordmark'), type: 'wordmark', pos: { x: 120, y: 300 }, params: defaultParams('wordmark') }
  return {
    fps: 30, frameStart: 0, frameEnd: 90,
    canvas: { w: 1080, h: 1080, bg: 'transparent' },
    nodes: [icon, wordmark, scene],
    edges: [
      { id: 'e_icon', source: icon.id, target: scene.id, sourceHandle: 'objout', targetHandle: 'objin' },
      { id: 'e_wm', source: wordmark.id, target: scene.id, sourceHandle: 'objout', targetHandle: 'objin' },
    ],
    view: { x: 0, y: 0, zoom: 1 },
  }
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      doc: d.doc || starterDoc(),
      savedPresets: d.savedPresets || [],
    }
  } catch { return { doc: starterDoc(), savedPresets: [] } }
}

let _state = { selectedId: null, presetId: null, ...load() }
const _listeners = new Set()

// ── Undo / redo (debounced full-doc snapshots) ───────────────────────────────────
let _history = []
let _histIdx = -1
let _applying = false
let _debounce = null

const clone = o => JSON.parse(JSON.stringify(o))

function pushHistory() {
  if (_applying) return
  clearTimeout(_debounce)
  _debounce = setTimeout(() => {
    const next = _history.slice(0, _histIdx + 1)
    next.push(clone(_state.doc))
    if (next.length > 80) next.shift()
    _history = next
    _histIdx = next.length - 1
  }, 350)
}
setTimeout(() => { if (!_history.length) { _history = [clone(_state.doc)]; _histIdx = 0 } }, 0)

export function undo() {
  if (_histIdx <= 0) return
  _applying = true; _histIdx--
  _state = { ..._state, doc: clone(_history[_histIdx]) }; notify()
  _applying = false
}
export function redo() {
  if (_histIdx >= _history.length - 1) return
  _applying = true; _histIdx++
  _state = { ..._state, doc: clone(_history[_histIdx]) }; notify()
  _applying = false
}
export function canUndo() { return _histIdx > 0 }
export function canRedo() { return _histIdx < _history.length - 1 }

function notify() {
  try { localStorage.setItem(KEY, JSON.stringify({ doc: _state.doc, savedPresets: _state.savedPresets })) } catch {}
  markDirty(TOOL_ID)
  for (const fn of _listeners) fn(_state)
}

export function getState() { return _state }
export function subscribe(fn) { _listeners.add(fn); return () => _listeners.delete(fn) }
export function useMotion() {
  const [s, set] = useState(_state)
  useEffect(() => subscribe(set), [])
  return s
}

// ── Doc-level patches ─────────────────────────────────────────────────────────────
export function patchDoc(patch, { history = true } = {}) {
  _state = { ..._state, doc: { ..._state.doc, ...patch } }
  notify()
  if (history) pushHistory()
}

export function setSelected(id) { _state = { ..._state, selectedId: id }; notify() }

// ── Node operations ───────────────────────────────────────────────────────────────
// Any structural/param change diverges from an applied preset → strip shows "Custom".
function diverge() { _state.presetId = null }

export function addNode(type, pos = { x: 240, y: 200 }) {
  diverge()
  const node = { id: makeNodeId(type), type, pos, params: defaultParams(type) }
  patchDoc({ nodes: [..._state.doc.nodes, node] })
  setSelected(node.id)
  return node.id
}

export function removeNode(id) {
  diverge()
  const nodes = _state.doc.nodes.filter(n => n.id !== id)
  const edges = _state.doc.edges.filter(e => e.source !== id && e.target !== id)
  patchDoc({ nodes, edges })
  if (_state.selectedId === id) setSelected(null)
}

export function updateNodeParam(id, key, value) {
  diverge()
  let nodes = _state.doc.nodes.map(n =>
    n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n)
  // When a source image is set and BOTH icon + wordmark now have images while still
  // at their default transform, auto-arrange them as a lockup (so dropping both in
  // doesn't leave them overlapping at full size). Won't clobber manual positioning.
  if (key === 'image') {
    const icon = nodes.find(n => n.type === 'icon')
    const wm = nodes.find(n => n.type === 'wordmark')
    const untouched = n => n && (n.params.x || 0) === 0 && (n.params.y || 0) === 0 && (n.params.scale ?? 1) === 1 && (n.params.rotate || 0) === 0
    if (icon?.params.image && wm?.params.image && untouched(icon) && untouched(wm)) {
      nodes = applyLockup(nodes, _state.doc.canvas)
    }
  }
  patchDoc({ nodes })
}

// React Flow change handlers feed final node/edge arrays back here.
export function setNodes(nodes) { patchDoc({ nodes }, { history: false }) }
export function setEdges(edges) { diverge(); patchDoc({ edges }, { history: false }) }
export function commitHistory() { pushHistory() }

// Estimate a node's rendered height (mirrors Graph.jsx layout: 28px header + 8px
// pad, +18px value summary, +20px per numeric socket row, +50px image preview) so
// Tidy can stack without overlaps or wasteful gaps.
function nodeHeight(node) {
  const def = NODE_DEFS[node.type]
  let h = 28 + 10
  if (def.category === 'value') h += 18
  h += def.params.filter(p => p.type === 'number').length * 20
  if (def.params.some(p => p.type === 'image')) h += 50
  return h
}

// ── Auto-layout (pure) ─────────────────────────────────────────────────────────────
// Unified layered layout: EVERY edge (object flow AND value→property) means the
// source must sit one column left of its target. Value/driver nodes are first-class
// members of the layering, so a driver lands in the column just left of what it
// drives — never overlapping a node and never routing a wire back over one. Each
// column is packed by real node height and vertically centred. Returns an id→pos map.
export function computeLayout_(doc) {
  const preds = {}            // targetId -> [predecessorId] (both edge kinds)
  for (const e of doc.edges) (preds[e.target] ||= []).push(e.source)

  const depthMemo = {}
  const depth = (id, seen) => {
    if (depthMemo[id] != null) return depthMemo[id]
    if (seen.has(id)) return 0
    seen.add(id)
    const ps = preds[id] || []
    const d = ps.length ? Math.max(...ps.map(p => depth(p, new Set(seen)))) + 1 : 0
    depthMemo[id] = d
    return d
  }
  doc.nodes.forEach(n => depth(n.id, new Set()))

  const cols = {}
  doc.nodes.forEach(n => { const c = depthMemo[n.id] || 0; (cols[c] ||= []).push(n) })

  const COLW = 320, GAPY = 44, X0 = 80, CENTER_Y = 360
  const pos = {}
  Object.keys(cols).map(Number).sort((a, b) => a - b).forEach(c => {
    // value nodes first within a column reads tidiest next to their targets
    const list = cols[c].slice().sort((a, b) =>
      (NODE_DEFS[a.type].category === 'value' ? 0 : 1) - (NODE_DEFS[b.type].category === 'value' ? 0 : 1))
    const total = list.reduce((s, n) => s + nodeHeight(n), 0) + GAPY * (list.length - 1)
    let y = CENTER_Y - total / 2
    for (const n of list) { pos[n.id] = { x: X0 + c * COLW, y }; y += nodeHeight(n) + GAPY }
  })
  return pos
}

// Apply the layout to a doc's nodes (pure) — used by presets and the logo hand-off.
export function laidOut(doc) {
  const pos = computeLayout_(doc)
  return { ...doc, nodes: doc.nodes.map(n => pos[n.id] ? { ...n, pos: pos[n.id] } : n) }
}

export function tidyGraph() {
  patchDoc({ nodes: laidOut(_state.doc).nodes })
}

// ── Presets (node-graph templates) ────────────────────────────────────────────────
export function saveCurrentPreset(name) {
  const p = { id: makeNodeId('preset'), name: name || 'Preset', doc: clone(_state.doc) }
  _state = { ..._state, savedPresets: [..._state.savedPresets, p] }
  notify()
  return p.id
}
export function removeSavedPreset(id) {
  _state = { ..._state, savedPresets: _state.savedPresets.filter(p => p.id !== id) }
  notify()
}

// Replace the entire doc (used by preset apply / reset / project load).
export function loadDoc(doc, presetId = null) {
  _state = { ..._state, doc: clone(doc), selectedId: null, presetId }
  notify(); pushHistory()
}
export function resetDoc() { loadDoc(starterDoc()) }
export { starterDoc }

// Apply a preset: builtins rebuild from the current images; saved presets carry a
// whole doc. The applied id is tracked so the strip can show position/divergence.
export function applyPreset(preset, images) {
  const doc = typeof preset.build === 'function' ? preset.build(images) : preset.doc
  loadDoc(laidOut(doc), preset.id)   // auto-arrange so presets never start overlapping
}

// ── Cross-tool hand-off from Logo Maker ───────────────────────────────────────────
// Logo Maker drops a structured payload here; we read it once on mount and clear it
// so we don't re-import on every visit.
export function getIncomingLogo() {
  try { return JSON.parse(localStorage.getItem(SHARED_LOGO_KEY) || 'null') } catch { return null }
}
export function clearIncomingLogo() {
  try { localStorage.removeItem(SHARED_LOGO_KEY) } catch {}
}

// Called by the *sending* tool (Logo Maker) to push a structured layout here.
export function sendLogoToMotion(payload) {
  try { localStorage.setItem(SHARED_LOGO_KEY, JSON.stringify(payload)) } catch {}
}

// ── Lockup arrangement ─────────────────────────────────────────────────────────────
// Compute params (x/y offset from canvas centre, scale) that place an icon + wordmark
// as a proper lockup — same relative scale/gap/alignment as the Logo Maker — by
// running its computeLayout and mapping each element's centre + height into canvas
// space. Mirrors the engine's source sizing (fit = 55% of min canvas, scaled to fit
// 70%), so the on-canvas result matches the lockup exactly instead of overlapping.
const DEFAULT_LOCKUP = { layout: 'h', iconScale: 0.9, gapRatio: 0.28, alignment: 'center' }

function lockupPositions(canvas, L, iconImg, wmImg) {
  let layout = L.layout || DEFAULT_LOCKUP.layout
  // both present but a single-element variation was sent → fall back to horizontal
  if (iconImg && wmImg && !BOTH_LAYOUTS.includes(layout)) layout = 'h'
  const lyt = computeLayout({
    layout,
    iconAspect: iconImg?.aspect || 1,
    wordmarkAspect: wmImg?.aspect || 1,
    iconScale: L.iconScale ?? DEFAULT_LOCKUP.iconScale,
    gapRatio: L.gapRatio ?? DEFAULT_LOCKUP.gapRatio,
    alignment: L.alignment || DEFAULT_LOCKUP.alignment,
  })
  if (!lyt) return null
  const { w: cw, h: ch } = canvas
  const fit = Math.min(cw, ch) * 0.55
  const k = (Math.min(cw, ch) * 0.7) / Math.max(lyt.totalW, lyt.totalH)
  const cxL = lyt.totalW / 2, cyL = lyt.totalH / 2
  const calc = (el, img) => {
    if (!el || !img) return null
    const aspect = img.aspect || 1
    const baseH = aspect >= 1 ? fit / aspect : fit          // rendered height at scale 1
    return { x: (el.x + el.w / 2 - cxL) * k, y: (el.y + el.h / 2 - cyL) * k, scale: (el.h * k) / baseH, rotate: 0 }
  }
  return { icon: calc(lyt.icon, iconImg), wordmark: calc(lyt.wordmark, wmImg) }
}

// Apply lockup positions onto the icon/wordmark source nodes of a node array.
function applyLockup(nodes, canvas, L = {}) {
  const icon = nodes.find(n => n.type === 'icon')
  const wm = nodes.find(n => n.type === 'wordmark')
  const pos = lockupPositions(canvas, L, icon?.params.image, wm?.params.image)
  if (!pos) return nodes
  return nodes.map(n => {
    if (icon && n.id === icon.id && pos.icon) return { ...n, params: { ...n.params, ...pos.icon } }
    if (wm && n.id === wm.id && pos.wordmark) return { ...n, params: { ...n.params, ...pos.wordmark } }
    return n
  })
}

// Manual "Arrange icon + wordmark as lockup" action.
export function arrangeLockup() { patchDoc({ nodes: applyLockup(_state.doc.nodes, _state.doc.canvas) }) }

// Build a fresh doc from an incoming logo payload: Icon + Wordmark sources wired to a
// Scene, arranged as the same lockup that came across (with a horizontal fallback).
export function docFromLogo(payload) {
  const doc = starterDoc()
  const icon = doc.nodes.find(n => n.type === 'icon')
  const wm = doc.nodes.find(n => n.type === 'wordmark')
  if (payload.icon) icon.params.image = payload.icon
  if (payload.wordmark) wm.params.image = payload.wordmark
  if (payload.icon && payload.wordmark) doc.nodes = applyLockup(doc.nodes, doc.canvas, payload.layout || {})
  return doc
}

export function applyIncomingLogo(payload) { loadDoc(laidOut(docFromLogo(payload))) }
