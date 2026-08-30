// ── Color Palette UI state ────────────────────────────────────────────────────
//
// Which panel is open, how tall the drawer is, how wide the picker column is.
// Deliberately NOT part of store.js: that store calls markDirty() on every
// change (which raises the Electron "unsaved work" prompt on close) and pushes
// an undo snapshot. Dragging a splitter is neither an edit to the palette nor
// something Ctrl+Z should reverse, so this lives in its own key with neither
// behaviour attached.
//
// It persists, which is the actual fix for a long-standing annoyance: panel
// choice and pane sizes used to reset every time the tool was unmounted —
// switching tools in the sidebar, or flipping to Print and back.

import { useEffect, useState } from 'react'

const KEY = 'designtools-colorpalette-ui'

const DEFAULTS = {
  view:       'palette',            // 'palette' | 'print' | 'export'
  mode:       'design',             // 'design' | 'illustration'
  group:      'build',              // design-mode panel group
  panel:      'Generators',         // design-mode panel
  illPanel:   'Shadow/Highlight',   // illustration-mode panel
  leftWidth:  288,                  // picker column, px
  drawerH:    320,                  // panel drawer, px
  drawerOpen: true,
  greyscale:  false,
}

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } }
  catch { return { ...DEFAULTS } }
}

let _ui = load()
const _listeners = new Set()

export function getUi() { return _ui }

export function setUi(patch) {
  _ui = { ..._ui, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(_ui)) } catch {}
  for (const fn of _listeners) fn(_ui)
}

export function useUi() {
  const [s, set] = useState(_ui)
  useEffect(() => {
    _listeners.add(set)
    return () => _listeners.delete(set)
  }, [])
  return s
}
